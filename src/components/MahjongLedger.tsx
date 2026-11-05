import { useCallback, useEffect, useRef, useState } from 'react'
import { useDiscordRoom } from '../hooks/useDiscordRoom'
import { roomRefFromHash } from '../utils/discordSync'
import { CODE_LENGTH, normalizeCode } from '../utils/roomCrypto'
import {
  columnTotals,
  RATE_LABEL,
  RATE_YEN,
  rowStatus,
  rowSum,
  toYen,
  yenPerPoint,
  venueBalance,
  venueShares,
  venueWeights,
  type Cell,
  type Rate,
} from '../utils/mahjongSheet'
import { hubTransfers, minimalTransfers } from '../utils/settlement'
import './MahjongLedger.css'

interface SheetData {
  names: string[]
  rows: Cell[][]
  rate: Rate
  /** 「自由」のときの 1pt あたりの円 */
  customYen: number
  /** 場代を各自がいくら払ったか（円）。合計を全員で割り勘する */
  venuePaid: number[]
  /** 場代の全体の時間（空欄なら入っている中で一番長い時間） */
  venueFullHours: Cell
  /** 各自のいた時間。空欄は全体の時間いた扱い。誰も入れなければ均等割り */
  venueHours: Cell[]
  /** ご祝儀チップの枚数（±）。全員の合計は 0 になるはず */
  chips: number[]
  /** ご祝儀1枚の金額（円） */
  chipYen: number
}

const STORAGE_KEY = 'mahjong-sheet-data'
const DEFAULT_PLAYERS = 4
const MIN_PLAYERS = 3
const MAX_PLAYERS = 9
const DEFAULT_ROWS = 8
const DEFAULT_CHIP_YEN = 500
const DEFAULT_CUSTOM_YEN = 30

function emptyRow(columns: number): Cell[] {
  return Array.from({ length: columns }, () => null)
}

function freshData(rate: Rate = 'tenpin'): SheetData {
  return {
    names: Array.from({ length: DEFAULT_PLAYERS }, () => ''),
    rows: Array.from({ length: DEFAULT_ROWS }, () => emptyRow(DEFAULT_PLAYERS)),
    rate,
    customYen: DEFAULT_CUSTOM_YEN,
    venuePaid: Array.from({ length: DEFAULT_PLAYERS }, () => 0),
    venueFullHours: null,
    venueHours: emptyRow(DEFAULT_PLAYERS),
    chips: Array.from({ length: DEFAULT_PLAYERS }, () => 0),
    chipYen: DEFAULT_CHIP_YEN,
  }
}

/** 保存データや共有で届いたデータを、壊れていても使える形に直す。読めなければ null */
function parseSheet(json: string): SheetData | null {
  try {
    const parsed = JSON.parse(json) as Partial<SheetData>
    if (Array.isArray(parsed.names) && Array.isArray(parsed.rows)) {
      const columns = parsed.names.length
      return {
        names: parsed.names.map(n => String(n ?? '')),
        rows: parsed.rows.map(r =>
          Array.from({ length: columns }, (_, c) => (typeof r?.[c] === 'number' ? r[c] : null)),
        ),
        rate: parsed.rate === 'tengo' || parsed.rate === 'custom' ? parsed.rate : 'tenpin',
        customYen:
          typeof parsed.customYen === 'number' && parsed.customYen >= 0
            ? parsed.customYen
            : DEFAULT_CUSTOM_YEN,
        venuePaid: Array.from({ length: columns }, (_, c) => {
          const v = parsed.venuePaid?.[c]
          return typeof v === 'number' && v > 0 ? v : 0
        }),
        venueFullHours: typeof parsed.venueFullHours === 'number' ? parsed.venueFullHours : null,
        venueHours: Array.from({ length: columns }, (_, c) => {
          const v = parsed.venueHours?.[c]
          return typeof v === 'number' ? v : null
        }),
        chips: Array.from({ length: columns }, (_, c) => {
          const v = parsed.chips?.[c]
          return typeof v === 'number' && Number.isFinite(v) ? v : 0
        }),
        chipYen:
          typeof parsed.chipYen === 'number' && parsed.chipYen >= 0 ? parsed.chipYen : DEFAULT_CHIP_YEN,
      }
    }
  } catch {
    // 壊れていたら読めなかったことにする
  }
  return null
}

function loadData(): SheetData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return parseSheet(raw) ?? freshData()
  } catch {
    // 保存先が使えなくても使える
  }
  return freshData()
}

// ---------------------------------------------------------------- Discord 共有
//
// チップ計算と同じ仕組み（Discord のメッセージ1通を保存先にして、コードで暗号化）。
// ここは読み込み専用で、書き込むのは共有を始めた人（ホスト）だけ。リンクから
// 開いた人は表を見るだけで、自分の手元の表は上書きされずに残る。
//
// 書き手が1人なので、表は丸ごと1つの文字列として載せる（差分の仕組みは配列を扱えない）。

const ROOM_STORAGE_KEY = 'mahjong-sheet-room'
const CODE_STORAGE_KEY = 'mahjong-sheet-code'
/** 共有先のURLはチップ計算と共通にする（一度入れれば両方で使える） */
const WEBHOOK_STORAGE_KEY = 'chip-calculator-webhook'
/** このルームで自分がホストか、見ているだけか */
const ROLE_STORAGE_KEY = 'mahjong-sheet-role'
const HASH_KEY = 'mj'

type ShareRole = 'host' | 'viewer'
type SheetDoc = { sheet: string }

function loadRole(): ShareRole | null {
  try {
    const v = localStorage.getItem(ROLE_STORAGE_KEY)
    return v === 'host' || v === 'viewer' ? v : null
  } catch {
    return null
  }
}

function saveRole(role: ShareRole | null) {
  try {
    if (role) localStorage.setItem(ROLE_STORAGE_KEY, role)
    else localStorage.removeItem(ROLE_STORAGE_KEY)
  } catch {
    // ignore
  }
}

/** Discord のチャンネルに出る本文。点数は暗号化して末尾に入るので、ここには出さない */
function renderDiscordMessage(joinUrl: string): string {
  const lines: string[] = []
  lines.push('## 🀄 麻雀点数表')
  lines.push('🔒 中身は暗号化されています（見るだけ・書き換えられるのは共有した人だけ）。')
  lines.push('')
  lines.push(`-# 更新 <t:${Math.floor(Date.now() / 1000)}:T>`)
  if (joinUrl) lines.push(`▶ アプリで見る: ${joinUrl}`)
  return lines.join('\n')
}

function signed(n: number) {
  return `${n > 0 ? '+' : ''}${n.toLocaleString()}`
}

/**
 * スコアの入力欄。iPhone の数字キーボードにはマイナスが無いので、
 * 横の「±」で符号を反転できるようにしてある。
 */
function ScoreCell({
  value,
  onChange,
  readOnly,
}: {
  value: Cell
  onChange: (v: Cell) => void
  readOnly: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const display = draft ?? (value === null ? '' : String(value))

  if (readOnly) {
    return (
      <div className={`mjs-cell readonly ${value !== null && value < 0 ? 'negative' : ''}`}>
        <span>{value === null ? '' : value}</span>
      </div>
    )
  }

  return (
    <div className={`mjs-cell ${value !== null && value < 0 ? 'negative' : ''}`}>
      <button
        className="mjs-sign"
        onClick={() => {
          if (value === null || value === 0) return
          onChange(-value)
          setDraft(null)
        }}
        tabIndex={-1}
        aria-label="符号を反転"
      >
        ±
      </button>
      <input
        type="text"
        inputMode="decimal"
        value={display}
        onFocus={e => {
          setDraft(display)
          e.currentTarget.select()
        }}
        onChange={e => {
          const raw = e.target.value.replace(/[^0-9.-]/g, '')
          setDraft(raw)
          const n = Number(raw)
          onChange(raw === '' || raw === '-' || raw === '.' || Number.isNaN(n) ? null : n)
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  )
}

/** 円の入力欄（0 は空欄で見せる） */
function YenField({
  value,
  onChange,
  readOnly,
}: {
  value: number
  onChange: (v: number) => void
  readOnly: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const display = draft ?? (value === 0 ? '' : String(value))
  if (readOnly) return <span className="mjs-yen-readonly">{value.toLocaleString()}</span>
  return (
    <input
      className="mjs-yen-input"
      type="text"
      inputMode="numeric"
      placeholder="0"
      value={display}
      onFocus={e => {
        setDraft(display)
        e.currentTarget.select()
      }}
      onChange={e => {
        const raw = e.target.value.replace(/[^0-9]/g, '')
        setDraft(raw)
        onChange(raw === '' ? 0 : Number(raw))
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

/** 時間の入力欄（空欄あり・1.5 のような小数も可）。placeholder は空欄のときの扱いを見せる */
function HoursField({
  value,
  onChange,
  readOnly,
  placeholder,
}: {
  value: Cell
  onChange: (v: Cell) => void
  readOnly: boolean
  placeholder: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const display = draft ?? (value === null ? '' : String(value))
  if (readOnly) return <span className="mjs-yen-readonly mjs-hours-readonly">{value ?? placeholder}</span>
  return (
    <input
      className="mjs-yen-input mjs-hours-input"
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      value={display}
      onFocus={e => {
        setDraft(display)
        e.currentTarget.select()
      }}
      onChange={e => {
        const raw = e.target.value.replace(/[^0-9.]/g, '')
        setDraft(raw)
        const n = Number(raw)
        onChange(raw === '' || raw === '.' || Number.isNaN(n) ? null : n)
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

export function MahjongLedger() {
  const [data, setData] = useState<SheetData>(loadData)
  const dataRef = useRef(data)
  const [method, setMethod] = useState<'minimal' | 'hub'>('minimal')
  const [confirm, setConfirm] = useState<{ kind: 'reset' } | { kind: 'row'; index: number } | null>(null)
  const [role, setRole] = useState<ShareRole | null>(loadRole)
  /** 見ている人の画面に出す、ホストの表 */
  const [remote, setRemote] = useState<SheetData | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [webhookInput, setWebhookInput] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const roleRef = useRef(role)

  useEffect(() => {
    dataRef.current = data
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      // 保存できなくても使える
    }
  }, [data])

  useEffect(() => {
    roleRef.current = role
  }, [role])

  const onRemoteDoc = useCallback((doc: SheetDoc) => {
    // ホストは自分の手元が正。届いたものを反映するのは見ている人だけ
    if (roleRef.current !== 'viewer') return
    const sheet = typeof doc.sheet === 'string' ? parseSheet(doc.sheet) : null
    if (sheet) setRemote(sheet)
  }, [])

  const room = useDiscordRoom<SheetDoc>({
    storageKey: ROOM_STORAGE_KEY,
    webhookStorageKey: WEBHOOK_STORAGE_KEY,
    codeStorageKey: CODE_STORAGE_KEY,
    getDoc: () => ({ sheet: JSON.stringify(dataRef.current) }),
    onRemoteDoc,
    renderMessage: renderDiscordMessage,
    hashKey: HASH_KEY,
    username: '麻雀点数表',
  })

  const shared = room.room !== null
  const hosting = shared && role === 'host'
  const viewing = shared && role === 'viewer'

  // ホストは表を書き換えるたびに送る（少し待ってまとめて送るのはフック側がやる）
  const pushToRoom = room.push
  const lastPushed = useRef(JSON.stringify(data))
  useEffect(() => {
    const next = JSON.stringify(data)
    if (!hosting) {
      lastPushed.current = next
      return
    }
    if (next === lastPushed.current) return
    pushToRoom({ sheet: lastPushed.current }, { sheet: next })
    lastPushed.current = next
  }, [data, hosting, pushToRoom])

  // 共有リンク（#mj=...）で開かれたら、見る人として入る。
  // アプリを開いたままタップされたときはハッシュが変わるだけなので hashchange も拾う
  const joinRoom = room.join
  useEffect(() => {
    const joinFromHash = () => {
      const ref = roomRefFromHash(window.location.hash, HASH_KEY)
      if (!ref) return
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      try {
        const current = localStorage.getItem(ROOM_STORAGE_KEY)
        // 自分が共有しているルームのリンクなら、見る人にならずにそのまま
        if (current && (JSON.parse(current) as { messageId?: string }).messageId === ref.messageId) {
          return
        }
      } catch {
        // ignore
      }
      setRemote(null)
      roleRef.current = 'viewer'
      setRole('viewer')
      saveRole('viewer')
      void joinRoom(ref, ref.code)
    }
    joinFromHash()
    window.addEventListener('hashchange', joinFromHash)
    return () => window.removeEventListener('hashchange', joinFromHash)
  }, [joinRoom])

  const handleStart = async (url: string) => {
    setBusy(true)
    // 先にホストにしておく（始めた直後に届く自分のデータで画面が変わらないように）
    roleRef.current = 'host'
    setRole('host')
    saveRole('host')
    lastPushed.current = JSON.stringify(dataRef.current)
    const issued = await room.start(url)
    setBusy(false)
    if (issued) {
      setWebhookInput('')
    } else {
      roleRef.current = null
      setRole(null)
      saveRole(null)
    }
  }

  const handleLeave = () => {
    room.leave()
    roleRef.current = null
    setRole(null)
    saveRole(null)
    setRemote(null)
    setShareOpen(false)
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(room.joinUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // コピーできない環境では、表示されているリンクを長押しでコピーしてもらう
    }
  }

  const lastSyncLabel = room.lastSyncAt
    ? new Date(room.lastSyncAt).toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null

  // 見ている人は、ホストの表が届くまで中身を出さない
  const view = viewing ? remote : data
  const readOnly = viewing

  const shareBar = (
    <div className={`mjs-share-bar ${shared ? 'shared' : ''}`}>
      {shared ? (
        <>
          <span className={`share-status share-status-${room.status}`}>
            {viewing ? '👀 見るだけ' : '📡 共有中'}
            {' ・ '}
            {room.status === 'live'
              ? `同期 ${lastSyncLabel ?? ''}`
              : room.status === 'locked'
                ? 'コード待ち'
                : room.status === 'error'
                  ? '同期できていません'
                  : '接続中…'}
          </span>
          <button className="mjs-share-btn" onClick={() => setShareOpen(true)}>
            {viewing ? 'やめる' : '共有設定'}
          </button>
        </>
      ) : (
        <button className="mjs-share-btn primary" onClick={() => setShareOpen(true)}>
          Discord で共有（見るだけ）
        </button>
      )}
    </div>
  )

  const shareModal = shareOpen && (
    <div className="confirm-overlay" onClick={() => setShareOpen(false)}>
      <div className="share-modal" onClick={e => e.stopPropagation()}>
        <h3>{viewing ? '共有された点数表' : 'Discord で共有'}</h3>
        {viewing ? (
          <>
            <p className="share-note">
              共有した人の点数表を見ています。こちらからは書き換えられません。
              やめると、自分の点数表に戻ります。
            </p>
            <button className="share-leave-btn" onClick={handleLeave}>
              見るのをやめる
            </button>
          </>
        ) : hosting ? (
          <>
            <p className="share-note">
              リンクを開いた人は、この点数表を<strong>見るだけ</strong>できます。
              書き換えられるのはあなただけで、入力するとみんなの画面にも数秒で出ます。
            </p>
            <div className="share-code-label">リンク（共有先に投稿済み）</div>
            <div className="share-link-box">{room.joinUrl}</div>
            <div className="share-actions">
              <button onClick={() => void copyLink()}>{copied ? 'コピーしました' : 'リンクをコピー'}</button>
            </div>
            <p className="share-warning">リンクを知っている人は中身を見られます。身内だけに配ってください。</p>
            <div className="share-divider" />
            <button className="share-leave-btn" onClick={handleLeave}>
              共有をやめる（表は手元に残ります）
            </button>
          </>
        ) : (
          <>
            <p className="share-note">
              Discord に点数表のリンクを投稿します。リンクを開いた人は<strong>見るだけ</strong>で、
              書き換えられるのはあなただけです。
            </p>
            {room.savedWebhookUrl && (
              <button
                className="share-create-btn"
                disabled={busy}
                onClick={() => void handleStart(room.savedWebhookUrl)}
              >
                {busy ? '準備中…' : '共有を開始'}
              </button>
            )}
            {!room.hasBuiltInWebhook && (
              <>
                {room.savedWebhookUrl && <div className="share-divider">または</div>}
                <input
                  className="share-webhook-input"
                  value={webhookInput}
                  onChange={e => setWebhookInput(e.target.value)}
                  placeholder="共有先のURL（Discord のウェブフック）"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button
                  className="share-create-btn"
                  disabled={busy || !webhookInput.trim()}
                  onClick={() => void handleStart(webhookInput)}
                >
                  {busy ? '準備中…' : 'この共有先で開始'}
                </button>
              </>
            )}
            <p className="share-warning">リンクを知っている人は中身を見られます。身内だけに配ってください。</p>
          </>
        )}
        {room.error && <div className="share-error">{room.error}</div>}
        <button className="share-close-btn" onClick={() => setShareOpen(false)}>
          閉じる
        </button>
      </div>
    </div>
  )

  if (!view) {
    return (
      <div className="mjs">
        {shareBar}
        <div className="mjs-waiting">
          {room.needsCode ? (
            <>
              <div className="mjs-waiting-icon">🔒</div>
              <p>共有した人から聞いたコードを入れてください。</p>
              <input
                className="gate-code-input"
                value={codeInput}
                onChange={e => setCodeInput(e.target.value.toUpperCase())}
                placeholder="ABCD-EFGH"
                maxLength={CODE_LENGTH + 1}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
              <button
                className="gate-submit-btn"
                disabled={normalizeCode(codeInput).length !== CODE_LENGTH}
                onClick={() => room.unlock(codeInput)}
              >
                開く
              </button>
            </>
          ) : room.status === 'error' ? (
            <p>{room.error ?? '共有された点数表を読めませんでした'}</p>
          ) : (
            <>
              <div className="gate-spinner" />
              <p>共有された点数表を読み込んでいます…</p>
            </>
          )}
        </div>
        {shareModal}
      </div>
    )
  }

  const { names, rows, rate, customYen, venuePaid, venueFullHours, venueHours, chips, chipYen } = view
  const yen = yenPerPoint(rate, customYen)
  const columns = names.length
  const totals = columnTotals(rows, columns)
  const displayName = (c: number) => names[c].trim() || `名前${c + 1}`
  const venueTotal = venuePaid.reduce((a, b) => a + b, 0)
  const weights = venueWeights(venueHours, venueFullHours)
  const shares = venueShares(venueTotal, weights)
  const venue = venueBalance(venuePaid, weights)
  const usesHours = venueFullHours !== null || venueHours.some(h => h !== null)
  // 全体の時間より長くいたことになっている人がいれば、入力ミスの可能性がある
  const hoursOver =
    venueFullHours !== null && venueHours.some(h => h !== null && h > venueFullHours)
  const chipTotal = rowSum(chips) ?? 0
  const hasChips = chips.some(v => v !== 0)
  const chipYens = chips.map(n => Math.round(n * chipYen))
  // 点数の金額に、ご祝儀と場代（払った額 − 割り勘の負担）を足したものが最終的な収支
  const finals = totals.map((t, c) => toYen(t, yen) + chipYens[c] + venue[c])
  const balances = finals.map((amount, c) => ({ name: displayName(c), amount }))
  const yenGap = balances.reduce((sum, b) => sum + b.amount, 0)
  const pointGap = rowSum(totals) ?? 0
  const transfers =
    method === 'minimal' ? minimalTransfers(balances) : hubTransfers(balances).rows

  const setName = (c: number, name: string) =>
    setData(prev => ({ ...prev, names: prev.names.map((n, i) => (i === c ? name : n)) }))

  const setCell = (r: number, c: number, v: Cell) =>
    setData(prev => {
      const next = prev.rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row))
      // いちばん下の行に書き始めたら、次の行を足しておく
      if (r === next.length - 1 && v !== null) next.push(emptyRow(prev.names.length))
      return { ...prev, rows: next }
    })

  const addPlayer = () =>
    setData(prev =>
      prev.names.length >= MAX_PLAYERS
        ? prev
        : {
            ...prev,
            names: [...prev.names, ''],
            rows: prev.rows.map(r => [...r, null]),
            venuePaid: [...prev.venuePaid, 0],
            venueHours: [...prev.venueHours, null],
            chips: [...prev.chips, 0],
          },
    )

  const removePlayer = () =>
    setData(prev =>
      prev.names.length <= MIN_PLAYERS
        ? prev
        : {
            ...prev,
            names: prev.names.slice(0, -1),
            rows: prev.rows.map(r => r.slice(0, -1)),
            venuePaid: prev.venuePaid.slice(0, -1),
            venueHours: prev.venueHours.slice(0, -1),
            chips: prev.chips.slice(0, -1),
          },
    )

  const setVenuePaid = (c: number, yen: number) =>
    setData(prev => ({ ...prev, venuePaid: prev.venuePaid.map((v, i) => (i === c ? yen : v)) }))

  const setVenueHours = (c: number, h: Cell) =>
    setData(prev => ({ ...prev, venueHours: prev.venueHours.map((v, i) => (i === c ? h : v)) }))

  const setChips = (c: number, n: number) =>
    setData(prev => ({ ...prev, chips: prev.chips.map((v, i) => (i === c ? n : v)) }))

  const addRow = () => setData(prev => ({ ...prev, rows: [...prev.rows, emptyRow(prev.names.length)] }))

  const removeRow = (index: number) =>
    setData(prev => {
      const next = prev.rows.filter((_, i) => i !== index)
      return { ...prev, rows: next.length ? next : [emptyRow(prev.names.length)] }
    })

  const hasContent =
    names.some(n => n !== '') ||
    rows.some(r => r.some(v => v !== null)) ||
    venueTotal > 0 ||
    usesHours ||
    hasChips

  return (
    <div className="mjs">
      {shareBar}
      {!readOnly && (
      <div className="mjs-toolbar">
        <span className="mjs-toolbar-label">人数</span>
        <button className="mjs-tool-btn" onClick={removePlayer} disabled={columns <= MIN_PLAYERS}>
          −
        </button>
        <span className="mjs-count">{columns}人</span>
        <button className="mjs-tool-btn" onClick={addPlayer} disabled={columns >= MAX_PLAYERS}>
          ＋
        </button>
        <span className="mjs-toolbar-hint">スコアは 1000点単位（±で符号）</span>
      </div>
      )}

      <div className="mjs-table-wrap">
        <table className="mjs-table" style={{ minWidth: columns > 4 ? columns * 78 + 80 : undefined }}>
          <thead>
            <tr>
              <th className="mjs-th-no">#</th>
              {names.map((name, c) => (
                <th key={c}>
                  {readOnly ? (
                    <div className="mjs-name readonly">{name.trim() || `名前${c + 1}`}</div>
                  ) : (
                    <input
                      className="mjs-name"
                      value={name}
                      placeholder={`名前${c + 1}`}
                      onChange={e => setName(c, e.target.value)}
                    />
                  )}
                </th>
              ))}
              <th className="mjs-th-sum">計</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const status = rowStatus(row)
              const s = rowSum(row)
              return (
                <tr key={r} className={`mjs-row ${status}`}>
                  <td className="mjs-no">
                    <button
                      className="mjs-no-btn"
                      onClick={() => setConfirm({ kind: 'row', index: r })}
                      disabled={readOnly || (status === 'empty' && rows.length === 1)}
                    >
                      {r + 1}
                    </button>
                  </td>
                  {row.map((v, c) => (
                    <td key={c}>
                      <ScoreCell value={v} onChange={nv => setCell(r, c, nv)} readOnly={readOnly} />
                    </td>
                  ))}
                  <td className="mjs-sum">{s === null ? '' : s === 0 ? '0' : signed(s)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="mjs-total-row">
              <th className="mjs-th-no">計</th>
              {totals.map((t, c) => (
                <td key={c} className={t > 0 ? 'positive' : t < 0 ? 'negative' : ''}>
                  {signed(t)}
                </td>
              ))}
              <td className="mjs-sum">{signed(rowSum(totals) ?? 0)}</td>
            </tr>
            <tr className="mjs-yen-row">
              <th className="mjs-th-no">円</th>
              {totals.map((t, c) => {
                const v = toYen(t, yen)
                return (
                  <td key={c} className={v > 0 ? 'positive' : v < 0 ? 'negative' : ''}>
                    {signed(v)}
                  </td>
                )
              })}
              <td className="mjs-sum" />
            </tr>
            {hasChips && (
              <tr className="mjs-venue-row">
                <th className="mjs-th-no">祝儀</th>
                {chipYens.map((v, c) => (
                  <td key={c} className={v > 0 ? 'positive' : v < 0 ? 'negative' : ''}>
                    {signed(v)}
                  </td>
                ))}
                <td className="mjs-sum" />
              </tr>
            )}
            {venueTotal > 0 && (
              <tr className="mjs-venue-row">
                <th className="mjs-th-no">場代</th>
                {venue.map((v, c) => (
                  <td key={c} className={v > 0 ? 'positive' : v < 0 ? 'negative' : ''}>
                    {signed(v)}
                  </td>
                ))}
                <td className="mjs-sum" />
              </tr>
            )}
            {(venueTotal > 0 || hasChips) && (
              <tr className="mjs-final-row">
                <th className="mjs-th-no">収支</th>
                {finals.map((v, c) => (
                  <td key={c} className={v > 0 ? 'positive' : v < 0 ? 'negative' : ''}>
                    {signed(v)}
                  </td>
                ))}
                <td className="mjs-sum" />
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      <div className="mjs-footer">
        {!readOnly && (
          <button className="mjs-add-row" onClick={addRow}>
            ＋ 半荘を追加
          </button>
        )}
        <div className="mjs-rate">
          {(['tenpin', 'tengo'] as const).map(key => (
            <button
              key={key}
              className={`mjs-rate-btn ${rate === key ? 'active' : ''}`}
              onClick={() => setData(prev => ({ ...prev, rate: key }))}
              disabled={readOnly}
            >
              {RATE_LABEL[key]}
              <span className="mjs-rate-sub">1pt = {RATE_YEN[key]}円</span>
            </button>
          ))}
          {/* 自由入力：押すと選ばれ、中の欄で 1pt あたりの円を変えられる */}
          <div
            className={`mjs-rate-btn custom ${rate === 'custom' ? 'active' : ''} ${readOnly ? 'readonly' : ''}`}
            onClick={() => {
              if (!readOnly && rate !== 'custom') setData(prev => ({ ...prev, rate: 'custom' }))
            }}
          >
            {RATE_LABEL.custom}
            <span className="mjs-rate-sub mjs-rate-custom">
              1pt =
              {readOnly ? (
                <span className="mjs-yen-readonly">{customYen.toLocaleString()}</span>
              ) : (
                <YenField
                  value={customYen}
                  onChange={v => setData(prev => ({ ...prev, customYen: v, rate: 'custom' }))}
                  readOnly={false}
                />
              )}
              円
            </span>
          </div>
        </div>
        <div className="mjs-venue">
          <div className="mjs-venue-header">
            <h3>ご祝儀</h3>
            <span className="mjs-chip-rate">
              1枚
              {readOnly ? (
                <span className="mjs-yen-readonly">{chipYen.toLocaleString()}</span>
              ) : (
                <YenField
                  value={chipYen}
                  onChange={v => setData(prev => ({ ...prev, chipYen: v }))}
                  readOnly={false}
                />
              )}
              円
            </span>
          </div>
          {!readOnly && (
            <p className="mjs-settle-how">各自のチップの枚数を入れてください（±で符号）。全員の合計は 0 になります。</p>
          )}
          {names.map((_, c) => (
            <div key={c} className={`mjs-venue-line ${hasChips && chipTotal !== 0 ? 'chip-off' : ''}`}>
              <span className="mjs-venue-name">{displayName(c)}</span>
              <div className="mjs-chip-cell">
                <ScoreCell
                  value={chips[c] === 0 ? null : chips[c]}
                  onChange={v => setChips(c, v ?? 0)}
                  readOnly={readOnly}
                />
              </div>
              <span className="mjs-venue-unit">枚</span>
              <span className={`mjs-chip-yen ${chipYens[c] > 0 ? 'positive' : chipYens[c] < 0 ? 'negative' : ''}`}>
                {chips[c] === 0 ? '' : `${signed(chipYens[c])}円`}
              </span>
            </div>
          ))}
          {hasChips && chipTotal !== 0 && (
            <p className="mjs-settle-warn">
              枚数の合計が {signed(chipTotal)}枚 になっています（0 になるはずです）。
            </p>
          )}
        </div>

        <div className="mjs-venue">
          <div className="mjs-venue-header">
            <h3>場代</h3>
            {venueTotal > 0 && (
              <span className="mjs-venue-summary">
                合計 ¥{venueTotal.toLocaleString()}
              </span>
            )}
          </div>
          {!readOnly && (
            <p className="mjs-settle-how">
              払った人の欄に金額を入れてください。時間を入れなければ均等割り、入れるといた時間の比率で按分します（空欄の人は全体の時間いた扱い）。
            </p>
          )}
          {(!readOnly || usesHours) && (
            <div className="mjs-venue-full">
              <span>全体の時間</span>
              <HoursField
                value={venueFullHours}
                onChange={h => setData(prev => ({ ...prev, venueFullHours: h }))}
                readOnly={readOnly}
                placeholder="-"
              />
              <span className="mjs-venue-unit">時間</span>
            </div>
          )}
          <div className="mjs-venue-line mjs-venue-head">
            <span className="mjs-venue-name" />
            <span className="mjs-venue-col-paid">払った額</span>
            <span className="mjs-venue-col-hours">いた時間</span>
          </div>
          {names.map((_, c) => (
            <div key={c} className="mjs-venue-line">
              <span className="mjs-venue-name">
                {displayName(c)}
                {venueTotal > 0 && (
                  <span className="mjs-venue-share">負担 ¥{shares[c].toLocaleString()}</span>
                )}
              </span>
              <YenField value={venuePaid[c]} onChange={v => setVenuePaid(c, v)} readOnly={readOnly} />
              <span className="mjs-venue-unit">円</span>
              <HoursField
                value={venueHours[c]}
                onChange={h => setVenueHours(c, h)}
                readOnly={readOnly}
                placeholder={usesHours ? String(weights[c]) : '-'}
              />
              <span className="mjs-venue-unit">h</span>
            </div>
          ))}
          {hoursOver && (
            <p className="mjs-settle-warn">全体の時間より長くいたことになっている人がいます。</p>
          )}
        </div>

        <div className="mjs-settle">
          <div className="mjs-settle-header">
            <h3>精算</h3>
            <div className="mjs-settle-tabs">
              <button
                className={method === 'minimal' ? 'active' : ''}
                onClick={() => setMethod('minimal')}
              >
                回数が少ない
              </button>
              <button className={method === 'hub' ? 'active' : ''} onClick={() => setMethod('hub')}>
                トップにまとめる
              </button>
            </div>
          </div>
          <p className="mjs-settle-how">
            {method === 'minimal'
              ? '送金の回数がいちばん少なくなる組み合わせ'
              : '負けた人はみんなトップに払い、トップが他の勝った人に配る'}
          </p>
          {transfers.length === 0 ? (
            <div className="mjs-settle-empty">やりとりなし</div>
          ) : (
            <ul className="mjs-settle-list">
              {transfers.map((t, i) => (
                <li key={i}>
                  <span className="mjs-settle-from">{t.from}</span>
                  <span className="mjs-settle-arrow">→</span>
                  <span className="mjs-settle-to">{t.to}</span>
                  <span className="mjs-settle-amount">¥{t.amount.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
          {yenGap !== 0 && (
            <p className="mjs-settle-warn">
              {pointGap !== 0 && chipTotal !== 0
                ? '点数とご祝儀の合計が'
                : pointGap !== 0
                  ? '点数の合計が'
                  : 'ご祝儀の枚数の合計が'}{' '}
              0 になっていないので、精算が {signed(yenGap)}円 合いません。
              {pointGap !== 0 && '色の付いた行を確かめてください。'}
            </p>
          )}
        </div>

        <p className="mjs-note">
          {readOnly
            ? '共有した人の点数表を見ています（書き換えられるのは共有した人だけ）。'
            : '行の合計が 0 でなければ色が付きます（多い = 緑、少ない = 赤）。半荘の番号をタップすると、その行を消せます。'}
        </p>
      </div>

      {!readOnly && (
        <div className="chip-reset-section">
          <button
            className="chip-reset-btn"
            onClick={() => setConfirm({ kind: 'reset' })}
            disabled={!hasContent}
          >
            リセット
          </button>
        </div>
      )}

      {confirm && (
        <div className="confirm-overlay" onClick={() => setConfirm(null)}>
          <div className="confirm-modal" onClick={e => e.stopPropagation()}>
            <p>
              {confirm.kind === 'reset'
                ? '名前・全ての点数・ご祝儀・場代を消しますか？'
                : `第${confirm.index + 1}半荘の行を消しますか？`}
            </p>
            <div className="confirm-buttons">
              <button className="confirm-cancel" onClick={() => setConfirm(null)}>
                キャンセル
              </button>
              <button
                className="confirm-ok"
                onClick={() => {
                  if (confirm.kind === 'reset') setData({ ...freshData(rate), customYen, chipYen })
                  else removeRow(confirm.index)
                  setConfirm(null)
                }}
              >
                消す
              </button>
            </div>
          </div>
        </div>
      )}
      {shareModal}
    </div>
  )
}
