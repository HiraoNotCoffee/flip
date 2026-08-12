import { useCallback, useEffect, useRef, useState } from 'react'
import { applyPatch, diffPaths, type Doc, type Leaf } from '../utils/docDiff'
import {
  buildJoinUrl,
  createRoomMessage,
  DiscordSyncError,
  embedState,
  extractState,
  parseWebhookUrl,
  readRoomMessage,
  writeRoomMessage,
  type RoomRef,
} from '../utils/discordSync'

export type RoomStatus = 'idle' | 'connecting' | 'live' | 'error'

interface UseDiscordRoomOptions<T extends Doc> {
  /** 参加中のルーム情報を覚えておく localStorage キー */
  storageKey: string
  /** ウェブフックURLを覚えておく localStorage キー */
  webhookStorageKey: string
  /** 現在のローカルデータ */
  getDoc: () => T
  /** 相手の変更が届いたときに呼ばれる */
  onRemoteDoc: (doc: T) => void
  /** Discord に出す人が読む本文（末尾の同期用データはこのフックが足す） */
  renderMessage: (doc: T, joinUrl: string) => string
}

// 実測（6人が同時にポーリング）では 2.5 秒間隔だと 17% が 429 になり、
// 3 秒間隔＋ゆらぎでは 0% だった。ゆらぎがないと端末同士のタイミングが
// 揃ってしまい、同じ瞬間に殺到して制限に当たりやすくなる。
/** 画面を見ている間の同期間隔。 */
const POLL_MS = 3000
/** 裏に回っている間はゆっくりでいい（Discord のレート制限対策）。 */
const HIDDEN_POLL_MS = 20000
/** 間隔にかけるゆらぎ（±20%）。端末ごとにタイミングをばらけさせる。 */
const JITTER = 0.2
/** 入力してからみんなに届くまでの待ち（連打をまとめる）。 */
const FLUSH_DELAY_MS = 600

function withJitter(ms: number): number {
  return Math.round(ms * (1 - JITTER + Math.random() * JITTER * 2))
}

function loadRef(key: string): RoomRef | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RoomRef
    if (parsed?.id && parsed?.token && parsed?.messageId) return parsed
  } catch {
    // ignore
  }
  return null
}

export function useDiscordRoom<T extends Doc>({
  storageKey,
  webhookStorageKey,
  getDoc,
  onRemoteDoc,
  renderMessage,
}: UseDiscordRoomOptions<T>) {
  const [room, setRoom] = useState<RoomRef | null>(() => loadRef(storageKey))
  const [status, setStatus] = useState<RoomStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [savedWebhookUrl, setSavedWebhookUrl] = useState<string>(
    () => localStorage.getItem(webhookStorageKey) ?? ''
  )

  // まだ Discord に送れていない自分の変更（パス→値）
  const overrides = useRef<Record<string, Leaf>>({})
  const scheduleRef = useRef<((delay: number) => void) | null>(null)
  const lastApplied = useRef<string>('')

  const getDocRef = useRef(getDoc)
  const onRemoteRef = useRef(onRemoteDoc)
  const renderRef = useRef(renderMessage)
  getDocRef.current = getDoc
  onRemoteRef.current = onRemoteDoc
  renderRef.current = renderMessage

  const compose = useCallback((doc: T, joinUrl: string) => {
    return embedState(renderRef.current(doc, joinUrl), doc)
  }, [])

  // 同期ループ
  useEffect(() => {
    if (!room) {
      setStatus('idle')
      overrides.current = {}
      lastApplied.current = ''
      return
    }

    let cancelled = false
    let timer: number | undefined
    let backoffMs = 0

    const nextDelay = () => {
      if (backoffMs > 0) return withJitter(backoffMs)
      return withJitter(document.hidden ? HIDDEN_POLL_MS : POLL_MS)
    }

    const schedule = (delay: number) => {
      if (cancelled) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void tick(), delay)
    }

    const tick = async () => {
      if (cancelled) return
      try {
        const content = await readRoomMessage(room)
        if (cancelled) return

        const remote = extractState<T>(content)
        if (!remote) {
          throw new DiscordSyncError('共有メッセージの中身を読めませんでした', 'not-found')
        }

        let doc = remote
        const pending = { ...overrides.current }
        if (Object.keys(pending).length > 0) {
          doc = applyPatch(remote, pending) as T
          await writeRoomMessage(room, compose(doc, buildJoinUrl(room)))
          if (cancelled) return
          // 送れた分だけ取り下げる（送信中に入った新しい変更は残す）
          for (const [path, value] of Object.entries(pending)) {
            if (overrides.current[path] === value) delete overrides.current[path]
          }
        }

        const serialized = JSON.stringify(doc)
        if (serialized !== lastApplied.current) {
          lastApplied.current = serialized
          onRemoteRef.current(doc)
        }

        backoffMs = 0
        setStatus('live')
        setError(null)
        setLastSyncAt(Date.now())
      } catch (e) {
        if (cancelled) return
        const err =
          e instanceof DiscordSyncError
            ? e
            : new DiscordSyncError(e instanceof Error ? e.message : String(e))
        setStatus('error')
        setError(err.message)
        if (err.kind === 'not-found' || err.kind === 'unauthorized' || err.kind === 'too-long') {
          return // 直らないので叩き続けない
        }
        backoffMs =
          err.kind === 'rate-limit'
            ? Math.max(err.retryAfterMs, 1000)
            : Math.min(30000, Math.max(4000, backoffMs * 2))
      }
      schedule(nextDelay())
    }

    scheduleRef.current = schedule
    setStatus('connecting')
    setError(null)
    void tick()

    const onVisible = () => {
      if (!document.hidden) schedule(0)
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      scheduleRef.current = null
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [room, compose])

  /** ローカルの変更を「送る予定の差分」として溜め、まもなく Discord へ送る。 */
  const push = useCallback((prev: T, next: T) => {
    if (!scheduleRef.current) return
    const changed = diffPaths(prev, next)
    if (Object.keys(changed).length === 0) return
    Object.assign(overrides.current, changed)
    scheduleRef.current(FLUSH_DELAY_MS)
  }, [])

  /** ウェブフックURLから新しい共有を始める（Discord にメッセージを1通投稿する）。 */
  const start = useCallback(
    async (webhookUrl: string): Promise<boolean> => {
      const hook = parseWebhookUrl(webhookUrl)
      if (!hook) {
        setError('ウェブフックURLの形式が違うようです')
        return false
      }
      setStatus('connecting')
      setError(null)
      try {
        const doc = getDocRef.current()
        const messageId = await createRoomMessage(hook, compose(doc, ''))
        const ref: RoomRef = { ...hook, messageId }
        // 参加リンクはメッセージIDが決まってからでないと作れないので、投稿後に入れ直す
        await writeRoomMessage(ref, compose(doc, buildJoinUrl(ref)))

        localStorage.setItem(webhookStorageKey, webhookUrl.trim())
        localStorage.setItem(storageKey, JSON.stringify(ref))
        setSavedWebhookUrl(webhookUrl.trim())
        lastApplied.current = JSON.stringify(doc)
        overrides.current = {}
        setRoom(ref)
        return true
      } catch (e) {
        setStatus('error')
        setError(e instanceof Error ? e.message : String(e))
        return false
      }
    },
    [compose, storageKey, webhookStorageKey]
  )

  /** 共有リンクから参加する。 */
  const join = useCallback(
    async (ref: RoomRef): Promise<boolean> => {
      setStatus('connecting')
      setError(null)
      try {
        const content = await readRoomMessage(ref)
        if (!extractState<T>(content)) {
          setStatus('error')
          setError('この共有リンクのメッセージには同期データがありません')
          return false
        }
        localStorage.setItem(storageKey, JSON.stringify(ref))
        overrides.current = {}
        lastApplied.current = ''
        setRoom(ref)
        return true
      } catch (e) {
        setStatus('error')
        setError(e instanceof Error ? e.message : String(e))
        return false
      }
    },
    [storageKey]
  )

  /** 共有から抜ける（Discord のメッセージはそのまま残る）。 */
  const leave = useCallback(() => {
    localStorage.removeItem(storageKey)
    overrides.current = {}
    setError(null)
    setRoom(null)
  }, [storageKey])

  const forgetWebhook = useCallback(() => {
    localStorage.removeItem(webhookStorageKey)
    setSavedWebhookUrl('')
  }, [webhookStorageKey])

  return {
    room,
    status,
    error,
    lastSyncAt,
    savedWebhookUrl,
    joinUrl: room ? buildJoinUrl(room) : '',
    push,
    start,
    join,
    leave,
    forgetWebhook,
  }
}
