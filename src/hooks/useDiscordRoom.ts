import { useCallback, useEffect, useRef, useState } from 'react'
import { applyPatch, diffPaths, type Doc, type Leaf } from '../utils/docDiff'
import {
  buildJoinUrl,
  createRoomMessage,
  decodeLegacyState,
  DiscordSyncError,
  embedState,
  extractState,
  parseWebhookUrl,
  readRoomMessage,
  writeRoomMessage,
  type RoomRef,
} from '../utils/discordSync'
import {
  boxToWire,
  deriveKey,
  generateCode,
  normalizeCode,
  open,
  randomSalt,
  saltOf,
  seal,
  wireToBox,
  WrongCodeError,
} from '../utils/roomCrypto'

export type RoomStatus = 'idle' | 'connecting' | 'locked' | 'live' | 'error'

interface UseDiscordRoomOptions<T extends Doc> {
  /** 参加中のルーム情報を覚えておく localStorage キー */
  storageKey: string
  /** ウェブフックURLを覚えておく localStorage キー */
  webhookStorageKey: string
  /** ルームのコードを覚えておく localStorage キー */
  codeStorageKey: string
  /** 現在のローカルデータ */
  getDoc: () => T
  /** 相手の変更が届いたときに呼ばれる */
  onRemoteDoc: (doc: T) => void
  /** Discord に出す人が読む本文（末尾の同期用データはこのフックが足す） */
  renderMessage: (joinUrl: string) => string
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

/**
 * ビルド時に埋め込む共通の投稿先。設定してあれば、使う側は何も入力しなくてよい。
 *
 * 注意: これは配信される JavaScript に含まれる＝公開情報になる。知っている人は
 * そのチャンネルに投稿できるので、身内用チャンネル向け。荒らされたら
 * 発行元で削除すれば即無効になる。
 */
export const BUILT_IN_WEBHOOK_URL: string =
  (import.meta.env.VITE_DISCORD_WEBHOOK_URL as string | undefined) ?? ''

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

/** コードはルームごとに覚える（別のルームに入ったら効かない）。 */
function loadCode(key: string, messageId: string | undefined): string | null {
  if (!messageId) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { messageId?: string; code?: string }
    if (parsed?.messageId === messageId && parsed.code) return parsed.code
  } catch {
    // ignore
  }
  return null
}

export function useDiscordRoom<T extends Doc>({
  storageKey,
  webhookStorageKey,
  codeStorageKey,
  getDoc,
  onRemoteDoc,
  renderMessage,
}: UseDiscordRoomOptions<T>) {
  const [room, setRoom] = useState<RoomRef | null>(() => loadRef(storageKey))
  const [status, setStatus] = useState<RoomStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [code, setCode] = useState<string | null>(() =>
    loadCode(codeStorageKey, loadRef(storageKey)?.messageId)
  )
  const [savedWebhookUrl, setSavedWebhookUrl] = useState<string>(
    () => localStorage.getItem(webhookStorageKey) ?? BUILT_IN_WEBHOOK_URL
  )

  // まだ Discord に送れていない自分の変更（パス→値）
  const overrides = useRef<Record<string, Leaf>>({})
  const scheduleRef = useRef<((delay: number) => void) | null>(null)
  const lastApplied = useRef<string>('')

  // 鍵はコードから作るのが重い（PBKDF2 30万回）ので使い回す
  const keyRef = useRef<{ key: CryptoKey; salt: Uint8Array; code: string } | null>(null)
  const codeRef = useRef<string | null>(code)
  codeRef.current = code

  const getDocRef = useRef(getDoc)
  const onRemoteRef = useRef(onRemoteDoc)
  const renderRef = useRef(renderMessage)
  getDocRef.current = getDoc
  onRemoteRef.current = onRemoteDoc
  renderRef.current = renderMessage

  /** コードと salt から鍵を用意する（同じ組み合わせなら作り直さない）。 */
  const keyFor = useCallback(async (theCode: string, salt: Uint8Array): Promise<CryptoKey> => {
    const cached = keyRef.current
    const saltB64 = String.fromCharCode(...salt)
    if (cached && cached.code === theCode && String.fromCharCode(...cached.salt) === saltB64) {
      return cached.key
    }
    const key = await deriveKey(theCode, salt)
    keyRef.current = { key, salt, code: theCode }
    return key
  }, [])

  /** ドキュメントを暗号化してメッセージ本文を組み立てる。 */
  const composeMessage = useCallback(
    async (doc: T, ref: RoomRef, theCode: string, salt: Uint8Array): Promise<string> => {
      const key = await keyFor(theCode, salt)
      const box = await seal(doc, key, salt)
      // チャンネルに出るリンクはコード入り＝タップだけで参加できる
      return embedState(renderRef.current(buildJoinUrl(ref, theCode)), boxToWire(box))
    },
    [keyFor]
  )

  // 同期ループ
  useEffect(() => {
    setLastSyncAt(null)
    if (!room) {
      setStatus('idle')
      overrides.current = {}
      lastApplied.current = ''
      keyRef.current = null
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

        const found = extractState(content)
        if (!found) {
          throw new DiscordSyncError('共有メッセージの中身を読めませんでした', 'not-found')
        }

        // v1 は暗号化前の平文。v2 はコードで開ける箱。
        let remote: T
        let salt: Uint8Array | null = null
        if (found.version === 'v1') {
          const legacy = decodeLegacyState<T>(found.payload)
          if (!legacy) {
            throw new DiscordSyncError('共有メッセージの中身を読めませんでした', 'not-found')
          }
          remote = legacy
        } else {
          const box = wireToBox(found.payload)
          if (!box) {
            throw new DiscordSyncError('共有メッセージの中身を読めませんでした', 'not-found')
          }
          salt = saltOf(box)
          const theCode = codeRef.current
          if (!theCode) {
            setStatus('locked')
            setError(null)
            return // コードが入力されるまで止める
          }
          const key = await keyFor(theCode, salt)
          if (cancelled) return
          remote = await open<T>(box, key)
        }

        let doc = remote
        const pending = { ...overrides.current }
        if (Object.keys(pending).length > 0) {
          doc = applyPatch(remote, pending) as T
          const theCode = codeRef.current
          // v1 のルームも、書き戻すときに v2（暗号化）へ移行する
          const writeSalt = salt ?? randomSalt()
          if (theCode) {
            await writeRoomMessage(room, await composeMessage(doc, room, theCode, writeSalt))
            if (cancelled) return
            for (const [path, value] of Object.entries(pending)) {
              if (overrides.current[path] === value) delete overrides.current[path]
            }
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
        if (e instanceof WrongCodeError) {
          keyRef.current = null
          setStatus('locked')
          setError(e.message)
          return // 正しいコードが入るまで止める
        }
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
  }, [room, composeMessage, keyFor])

  /** ローカルの変更を「送る予定の差分」として溜め、まもなく Discord へ送る。 */
  const push = useCallback((prev: T, next: T) => {
    if (!scheduleRef.current) return
    const changed = diffPaths(prev, next)
    if (Object.keys(changed).length === 0) return
    Object.assign(overrides.current, changed)
    scheduleRef.current(FLUSH_DELAY_MS)
  }, [])

  /** 新しい共有を始める。コードを発行し、現在のデータを暗号化して1通投稿する。 */
  const start = useCallback(
    async (webhookUrl: string): Promise<string | null> => {
      const hook = parseWebhookUrl(webhookUrl)
      if (!hook) {
        setError('ウェブフックURLの形式が違うようです')
        return null
      }
      setStatus('connecting')
      setError(null)
      try {
        const newCode = generateCode()
        const salt = randomSalt()
        const doc = getDocRef.current()
        const key = await keyFor(newCode, salt)
        const box = await seal(doc, key, salt)

        // 参加リンクはメッセージIDが決まってからでないと作れないので、投稿後に入れ直す
        const messageId = await createRoomMessage(
          hook,
          embedState(renderRef.current(''), boxToWire(box))
        )
        const ref: RoomRef = { ...hook, messageId }
        await writeRoomMessage(ref, await composeMessage(doc, ref, newCode, salt))

        localStorage.setItem(webhookStorageKey, webhookUrl.trim())
        localStorage.setItem(storageKey, JSON.stringify(ref))
        localStorage.setItem(codeStorageKey, JSON.stringify({ messageId, code: newCode }))
        setSavedWebhookUrl(webhookUrl.trim())
        lastApplied.current = JSON.stringify(doc)
        overrides.current = {}
        setCode(newCode)
        codeRef.current = newCode
        setRoom(ref)
        return newCode
      } catch (e) {
        setStatus('error')
        setError(e instanceof Error ? e.message : String(e))
        return null
      }
    },
    [composeMessage, keyFor, storageKey, webhookStorageKey, codeStorageKey]
  )

  /** 共有リンクから参加する。中身を読むにはこのあと unlock でコードが要る。 */
  const join = useCallback(
    async (ref: RoomRef, linkCode?: string): Promise<boolean> => {
      setStatus('connecting')
      setError(null)
      try {
        const content = await readRoomMessage(ref)
        if (!extractState(content)) {
          setStatus('error')
          setError('この共有リンクのメッセージには同期データがありません')
          return false
        }
        localStorage.setItem(storageKey, JSON.stringify(ref))
        overrides.current = {}
        lastApplied.current = ''
        keyRef.current = null
        const known = linkCode
          ? normalizeCode(linkCode)
          : loadCode(codeStorageKey, ref.messageId)
        if (known) {
          localStorage.setItem(
            codeStorageKey,
            JSON.stringify({ messageId: ref.messageId, code: known })
          )
        }
        setCode(known)
        codeRef.current = known
        setRoom(ref)
        return true
      } catch (e) {
        setStatus('error')
        setError(e instanceof Error ? e.message : String(e))
        return false
      }
    },
    [storageKey, codeStorageKey]
  )

  /**
   * コードを作り直す。中身は保ったまま、新しいコードで暗号化し直す。
   *
   * 古いコードを知っている端末は次の同期で復号に失敗し、コード入力待ちに戻る。
   * 「退出させる」だけでは相手の手元のコードは無効にならないので、本当に締め出す
   * にはこれを使う。読み込み→復号→書き込みの順なので、古いコードの端末が
   * 溜めていた変更で上書きしてしまうことはない（復号の時点で止まる）。
   */
  const rotateCode = useCallback(async (): Promise<string | null> => {
    if (!room) return null
    setError(null)
    try {
      const content = await readRoomMessage(room)
      const found = extractState(content)
      if (!found) {
        throw new DiscordSyncError('共有メッセージの中身を読めませんでした', 'not-found')
      }

      let doc: T
      if (found.version === 'v1') {
        const legacy = decodeLegacyState<T>(found.payload)
        if (!legacy) {
          throw new DiscordSyncError('共有メッセージの中身を読めませんでした', 'not-found')
        }
        doc = legacy
      } else {
        const box = wireToBox(found.payload)
        if (!box) {
          throw new DiscordSyncError('共有メッセージの中身を読めませんでした', 'not-found')
        }
        const current = codeRef.current
        if (!current) throw new WrongCodeError()
        doc = await open<T>(box, await keyFor(current, saltOf(box)))
      }

      // 送りそびれている自分の変更があれば一緒に載せる
      const pending = { ...overrides.current }
      if (Object.keys(pending).length > 0) doc = applyPatch(doc, pending) as T

      const newCode = generateCode()
      const salt = randomSalt()
      keyRef.current = null
      await writeRoomMessage(room, await composeMessage(doc, room, newCode, salt))

      overrides.current = {}
      localStorage.setItem(
        codeStorageKey,
        JSON.stringify({ messageId: room.messageId, code: newCode })
      )
      setCode(newCode)
      codeRef.current = newCode
      setStatus('live')
      setLastSyncAt(Date.now())
      return newCode
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    }
  }, [room, composeMessage, keyFor, codeStorageKey])

  /** コードを入れて中身を開く。合っているかは次の同期で分かる。 */
  const unlock = useCallback(
    (input: string) => {
      const normalized = normalizeCode(input)
      if (!normalized) return
      keyRef.current = null
      codeRef.current = normalized
      setCode(normalized)
      setError(null)
      setStatus('connecting')
      if (room) {
        localStorage.setItem(
          codeStorageKey,
          JSON.stringify({ messageId: room.messageId, code: normalized })
        )
      }
      scheduleRef.current?.(0)
    },
    [room, codeStorageKey]
  )

  /** 共有から抜ける（Discord のメッセージはそのまま残る）。 */
  const leave = useCallback(() => {
    localStorage.removeItem(storageKey)
    localStorage.removeItem(codeStorageKey)
    overrides.current = {}
    keyRef.current = null
    setCode(null)
    codeRef.current = null
    setError(null)
    setRoom(null)
  }, [storageKey, codeStorageKey])

  const forgetWebhook = useCallback(() => {
    localStorage.removeItem(webhookStorageKey)
    setSavedWebhookUrl(BUILT_IN_WEBHOOK_URL)
  }, [webhookStorageKey])

  return {
    room,
    status,
    error,
    lastSyncAt,
    savedWebhookUrl,
    /** 共通の投稿先が用意されているか（＝利用者は設定不要か）。 */
    hasBuiltInWebhook: BUILT_IN_WEBHOOK_URL.length > 0,
    code,
    needsCode: status === 'locked',
    /** コード入り＝タップだけで参加できる。チャンネルにもこれが載る。 */
    joinUrl: room ? buildJoinUrl(room, code ?? undefined) : '',
    /** コードなし＝別途コードを伝える必要がある（リンクが流れても中身は守られる）。 */
    joinUrlWithoutCode: room ? buildJoinUrl(room) : '',
    push,
    start,
    join,
    unlock,
    rotateCode,
    leave,
    forgetWebhook,
  }
}
