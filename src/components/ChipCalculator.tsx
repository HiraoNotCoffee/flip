import { useState, useEffect, useCallback, useRef } from 'react'
import { useDiscordRoom } from '../hooks/useDiscordRoom'
import { roomRefFromHash } from '../utils/discordSync'
import type { Doc } from '../utils/docDiff'
import './ChipCalculator.css'

interface ChipPlayer {
  id: string
  name: string
  rebuyCount: number
  finalChips: number
}

interface ChipData {
  chipsPer100BB: number
  buyInYen: number
  rake: number          // レーキ（チップ単位）
  players: ChipPlayer[]
}

const STORAGE_KEY = 'chip-calculator-data'
const ROOM_STORAGE_KEY = 'chip-calculator-room'
const WEBHOOK_STORAGE_KEY = 'chip-calculator-webhook'

const defaultData: ChipData = {
  chipsPer100BB: 30000,
  buyInYen: 3000,
  rake: 0,
  players: [],
}

function loadData(): ChipData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as ChipData
  } catch {
    // ignore
  }
  return { ...defaultData, players: [] }
}

function saveData(data: ChipData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

let nextId = Date.now()
function genId() {
  return `p${nextId++}`
}

// --- 計算 --------------------------------------------------------------------

function calcPnl(data: ChipData, p: ChipPlayer): number {
  if (data.chipsPer100BB === 0) return 0
  const received = data.chipsPer100BB * p.rebuyCount
  return ((p.finalChips - received) / data.chipsPer100BB) * data.buyInYen
}

/** 誰が誰にいくら払うか。送金回数が最小になるよう、最大の負けと最大の勝ちから順に相殺する。 */
function computeSettlements(data: ChipData) {
  const debtors = data.players
    .map(p => ({ name: p.name, amount: -Math.round(calcPnl(data, p)) }))
    .filter(p => p.amount > 0)
    .sort((a, b) => b.amount - a.amount)
  const creditors = data.players
    .map(p => ({ name: p.name, amount: Math.round(calcPnl(data, p)) }))
    .filter(p => p.amount > 0)
    .sort((a, b) => b.amount - a.amount)

  const result: { from: string; to: string; amount: number }[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount)
    if (pay > 0) {
      result.push({ from: debtors[i].name, to: creditors[j].name, amount: pay })
    }
    debtors[i].amount -= pay
    creditors[j].amount -= pay
    if (debtors[i].amount <= 0) i++
    if (creditors[j].amount <= 0) j++
  }
  return result
}

// --- 共有ドキュメント --------------------------------------------------------
// players は id をキーにしたオブジェクトで持ち、並び順は order で表す。
// こうすると「Aさんが名前、Bさんがチップ」を同時に触っても差分がぶつからない。

interface ChipDoc extends Doc {
  chipsPer100BB: number
  buyInYen: number
  rake: number
  players?: Record<string, { name: string; rebuyCount: number; finalChips: number; order: number }>
}

function toDoc(data: ChipData): ChipDoc {
  const players: NonNullable<ChipDoc['players']> = {}
  data.players.forEach((p, index) => {
    players[p.id] = {
      name: p.name,
      rebuyCount: p.rebuyCount,
      finalChips: p.finalChips,
      order: index,
    }
  })
  return {
    chipsPer100BB: data.chipsPer100BB,
    buyInYen: data.buyInYen,
    rake: data.rake,
    players,
  }
}

function fromDoc(doc: ChipDoc): ChipData {
  const players = Object.entries(doc.players ?? {})
    .map(([id, p], index) => ({
      id,
      name: typeof p?.name === 'string' ? p.name : '',
      rebuyCount: Number(p?.rebuyCount ?? 1),
      finalChips: Number(p?.finalChips ?? 0),
      order: Number(p?.order ?? index),
    }))
    .sort((a, b) => a.order - b.order)
    .map(({ id, name, rebuyCount, finalChips }) => ({ id, name, rebuyCount, finalChips }))

  return {
    chipsPer100BB: Number(doc.chipsPer100BB ?? defaultData.chipsPer100BB),
    buyInYen: Number(doc.buyInYen ?? defaultData.buyInYen),
    rake: Number(doc.rake ?? 0),
    players,
  }
}

/** Discord のチャンネルに出る本文。アプリを開いていない人もこれで状況が分かる。 */
function renderDiscordMessage(doc: ChipDoc, joinUrl: string): string {
  const data = fromDoc(doc)
  const lines: string[] = []
  lines.push(`## 🃏 チップ計算`)
  lines.push(
    `100BB = ${data.chipsPer100BB.toLocaleString()} chips ／ 1バイイン = ¥${data.buyInYen.toLocaleString()}` +
      (data.rake > 0 ? ` ／ レーキ ${data.rake.toLocaleString()}` : '')
  )
  lines.push('')

  if (data.players.length === 0) {
    lines.push('*まだプレイヤーがいません*')
  } else {
    const ranked = [...data.players].sort((a, b) => calcPnl(data, b) - calcPnl(data, a))
    for (const p of ranked) {
      const pnl = Math.round(calcPnl(data, p))
      const sign = pnl > 0 ? '+' : pnl < 0 ? '−' : '±'
      const mark = pnl > 0 ? '🟢' : pnl < 0 ? '🔴' : '⚪'
      lines.push(
        `${mark} **${p.name || '(名無し)'}** ${sign}¥${Math.abs(pnl).toLocaleString()}` +
          ` -# (${p.rebuyCount}バイイン / ${p.finalChips.toLocaleString()} chips)`
      )
    }

    const totalBuyInChips = data.players.reduce(
      (sum, p) => sum + data.chipsPer100BB * p.rebuyCount,
      0
    )
    const totalFinalChips = data.players.reduce((sum, p) => sum + p.finalChips, 0)
    const chipDiff = totalFinalChips + data.rake - totalBuyInChips
    if (chipDiff !== 0) {
      lines.push('')
      lines.push(`⚠️ チップが ${chipDiff > 0 ? '+' : ''}${chipDiff.toLocaleString()} 合いません`)
    }

    const settlements = computeSettlements(data)
    if (settlements.length > 0) {
      lines.push('')
      lines.push('**精算**')
      for (const s of settlements) {
        lines.push(
          `${s.from || '(名無し)'} → ${s.to || '(名無し)'} ¥${s.amount.toLocaleString()}`
        )
      }
    }
  }

  lines.push('')
  lines.push(`-# 更新 <t:${Math.floor(Date.now() / 1000)}:T>`)
  if (joinUrl) lines.push(`▶ アプリで開く: ${joinUrl}`)

  return lines.join('\n')
}

export function ChipCalculator() {
  const [data, setData] = useState<ChipData>(loadData)
  const dataRef = useRef(data)

  const applyRemote = useCallback((doc: ChipDoc) => {
    const next = fromDoc(doc)
    dataRef.current = next
    setData(next)
  }, [])

  const room = useDiscordRoom<ChipDoc>({
    storageKey: ROOM_STORAGE_KEY,
    webhookStorageKey: WEBHOOK_STORAGE_KEY,
    getDoc: () => toDoc(dataRef.current),
    onRemoteDoc: applyRemote,
    renderMessage: renderDiscordMessage,
  })

  /** 変更をローカルに即反映しつつ、共有中なら Discord にも送る。 */
  const pushToRoom = room.push
  const mutate = useCallback(
    (fn: (prev: ChipData) => ChipData) => {
      const prev = dataRef.current
      const next = fn(prev)
      dataRef.current = next
      setData(next)
      pushToRoom(toDoc(prev), toDoc(next))
    },
    [pushToRoom]
  )

  // Auto-save
  useEffect(() => {
    saveData(data)
  }, [data])

  // 共有リンク（#dc=...）で開かれたら、その共有に参加する
  const joinRoom = room.join
  useEffect(() => {
    const ref = roomRefFromHash(window.location.hash)
    if (!ref) return
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    void joinRoom(ref)
  }, [joinRoom])

  const update = useCallback(
    (partial: Partial<ChipData>) => {
      mutate(prev => ({ ...prev, ...partial }))
    },
    [mutate]
  )

  const updatePlayer = useCallback(
    (id: string, partial: Partial<ChipPlayer>) => {
      mutate(prev => ({
        ...prev,
        players: prev.players.map(p => (p.id === id ? { ...p, ...partial } : p)),
      }))
    },
    [mutate]
  )

  const addPlayer = () => {
    mutate(prev => ({
      ...prev,
      players: [
        ...prev.players,
        { id: genId(), name: `Player ${prev.players.length + 1}`, rebuyCount: 1, finalChips: 0 },
      ],
    }))
  }

  const removePlayer = (id: string) => {
    mutate(prev => ({ ...prev, players: prev.players.filter(p => p.id !== id) }))
  }

  const [confirmReset, setConfirmReset] = useState(false)

  const handleReset = () => {
    mutate(() => ({ ...defaultData, players: [] }))
    setConfirmReset(false)
  }

  // --- 共有UI ---------------------------------------------------------------
  const [shareOpen, setShareOpen] = useState(false)
  const [webhookInput, setWebhookInput] = useState('')
  const [showHowTo, setShowHowTo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyJoinUrl = async () => {
    try {
      await navigator.clipboard.writeText(room.joinUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // クリップボードが使えない環境では手でコピーしてもらう
    }
  }

  const handleStart = async (url: string) => {
    setBusy(true)
    const ok = await room.start(url)
    setBusy(false)
    if (ok) {
      setWebhookInput('')
      setShareOpen(false)
    }
  }

  const handleLeave = () => {
    room.leave()
    setShareOpen(false)
  }

  const lastSyncLabel = room.lastSyncAt
    ? new Date(room.lastSyncAt).toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null

  // Calculations
  const totalBuyInChips = data.players.reduce(
    (sum, p) => sum + data.chipsPer100BB * p.rebuyCount,
    0
  )
  const totalFinalChips = data.players.reduce((sum, p) => sum + p.finalChips, 0)
  const chipDiff = totalFinalChips + data.rake - totalBuyInChips
  const totalInvestYen = data.players.reduce(
    (sum, p) => sum + data.buyInYen * p.rebuyCount,
    0
  )
  const settlements = computeSettlements(data)

  return (
    <div className="chip-calculator">
      {/* Share bar */}
      <div className={`chip-share-bar ${room.room ? 'shared' : ''}`}>
        {room.room ? (
          <>
            <span className={`share-status share-status-${room.status}`}>
              {room.status === 'live'
                ? `Discord と同期中${lastSyncLabel ? ` ・ ${lastSyncLabel}` : ''}`
                : room.status === 'error'
                  ? '同期できていません'
                  : '接続中…'}
            </span>
            <button className="share-open-btn" onClick={() => setShareOpen(true)}>
              共有設定
            </button>
          </>
        ) : (
          <button className="share-open-btn primary" onClick={() => setShareOpen(true)}>
            Discord でみんなと共有
          </button>
        )}
      </div>
      {room.room && room.error && <div className="share-error-inline">{room.error}</div>}

      {/* Settings */}
      <div className="chip-settings">
        <h2>Settings</h2>
        <div className="setting-row">
          <label>100BB =</label>
          <input
            type="number"
            inputMode="numeric"
            value={data.chipsPer100BB || ''}
            onChange={e => update({ chipsPer100BB: Number(e.target.value) || 0 })}
            placeholder="30000"
          />
          <span style={{ color: '#888', fontSize: '0.85rem' }}>chips</span>
        </div>
        <div className="setting-row">
          <label>1 Buy-in =</label>
          <input
            type="number"
            inputMode="numeric"
            value={data.buyInYen || ''}
            onChange={e => update({ buyInYen: Number(e.target.value) || 0 })}
            placeholder="3000"
          />
          <span style={{ color: '#888', fontSize: '0.85rem' }}>yen</span>
        </div>
        <div className="setting-row">
          <label>Rake =</label>
          <input
            type="number"
            inputMode="numeric"
            value={data.rake || ''}
            onChange={e => update({ rake: Number(e.target.value) || 0 })}
            placeholder="0"
          />
          <span style={{ color: '#888', fontSize: '0.85rem' }}>chips</span>
        </div>
      </div>

      {/* Players */}
      <div className="chip-players">
        <div className="chip-players-header">
          <h2>Players</h2>
          <button className="add-player-btn" onClick={addPlayer}>
            + Add
          </button>
        </div>

        {data.players.map(player => {
          const pnl = calcPnl(data, player)
          const invested = data.buyInYen * player.rebuyCount

          return (
            <div key={player.id} className="player-card">
              <div className="player-card-header">
                <input
                  className="player-name-input"
                  value={player.name}
                  onChange={e => updatePlayer(player.id, { name: e.target.value })}
                />
                <button
                  className="remove-player-btn"
                  onClick={() => removePlayer(player.id)}
                >
                  ×
                </button>
              </div>

              <div className="player-card-fields">
                <div className="field-group">
                  <label>Buy-in count</label>
                  <div className="rebuy-control">
                    <button
                      className="rebuy-btn"
                      disabled={player.rebuyCount <= 0.5}
                      onClick={() =>
                        updatePlayer(player.id, {
                          rebuyCount: Math.max(0.5, player.rebuyCount - 0.5),
                        })
                      }
                    >
                      −
                    </button>
                    <span className="rebuy-count">{player.rebuyCount}</span>
                    <button
                      className="rebuy-btn"
                      onClick={() =>
                        updatePlayer(player.id, {
                          rebuyCount: player.rebuyCount + 0.5,
                        })
                      }
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="field-group">
                  <label>Final chips</label>
                  <input
                    className="final-chips-input"
                    type="number"
                    inputMode="numeric"
                    value={player.finalChips || ''}
                    onChange={e =>
                      updatePlayer(player.id, {
                        finalChips: Number(e.target.value) || 0,
                      })
                    }
                    placeholder="0"
                  />
                </div>
              </div>

              <div className="player-card-result">
                <span>Invested: ¥{invested.toLocaleString()}</span>
                <span
                  className={`player-pnl ${pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : 'zero'}`}
                >
                  {pnl >= 0 ? '+' : ''}¥{Math.round(pnl).toLocaleString()}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Summary */}
      {data.players.length > 0 && (
        <div className="chip-summary">
          <h2>Summary</h2>
          <div className="summary-row">
            <span className="label">Total invested</span>
            <span className="value">¥{totalInvestYen.toLocaleString()}</span>
          </div>
          <div className="summary-row">
            <span className="label">Total buy-in chips</span>
            <span className="value">{totalBuyInChips.toLocaleString()}</span>
          </div>
          <div className="summary-row">
            <span className="label">Total final chips</span>
            <span className="value">{totalFinalChips.toLocaleString()}</span>
          </div>
          {data.rake > 0 && (
            <div className="summary-row">
              <span className="label">Rake</span>
              <span className="value">{data.rake.toLocaleString()}</span>
            </div>
          )}
          <div className={`chip-diff ${chipDiff === 0 ? 'match' : 'mismatch'}`}>
            {chipDiff === 0
              ? 'Chips match!'
              : `Chip difference: ${chipDiff > 0 ? '+' : ''}${chipDiff.toLocaleString()}`}
          </div>

          {/* Settlement: who pays whom */}
          <div className="settlement-section">
            <h3>Settlement</h3>
            {settlements.length === 0 ? (
              <div className="settlement-empty">No transfers needed</div>
            ) : (
              <ul className="settlement-list">
                {settlements.map((s, idx) => (
                  <li key={idx} className="settlement-item">
                    <span className="settlement-from">{s.from}</span>
                    <span className="settlement-arrow">→</span>
                    <span className="settlement-to">{s.to}</span>
                    <span className="settlement-amount">
                      ¥{s.amount.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Reset */}
      <div className="chip-reset-section">
        <button className="chip-reset-btn" onClick={() => setConfirmReset(true)}>
          Reset
        </button>
      </div>

      {/* Confirm Reset Modal */}
      {confirmReset && (
        <div className="confirm-overlay" onClick={() => setConfirmReset(false)}>
          <div className="confirm-modal" onClick={e => e.stopPropagation()}>
            <p>{room.room ? '共有中の全員のデータをリセットします。よろしいですか？' : 'Reset all data?'}</p>
            <div className="confirm-buttons">
              <button className="confirm-cancel" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
              <button className="confirm-ok" onClick={handleReset}>
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {shareOpen && (
        <div className="confirm-overlay" onClick={() => setShareOpen(false)}>
          <div className="share-modal" onClick={e => e.stopPropagation()}>
            <h3>Discord でみんなと共有</h3>

            {room.room ? (
              <>
                <p className="share-note">
                  Discord のメッセージが共有の実体です。チャンネルの「▶ アプリで開く」を
                  みんながタップすれば、同じ画面が数秒ごとに同期されます。
                </p>
                <div className="share-link-box">{room.joinUrl}</div>
                <div className="share-actions">
                  <button onClick={() => void copyJoinUrl()}>
                    {copied ? 'コピーしました' : '参加リンクをコピー'}
                  </button>
                </div>
                <div className="share-divider" />
                <button className="share-leave-btn" onClick={handleLeave}>
                  共有をやめる（自分だけ・データは手元に残ります）
                </button>
              </>
            ) : (
              <>
                <p className="share-note">
                  Discord のチャンネルに1通メッセージを投稿し、それを全員で読み書きします。
                  サーバーもアカウント連携も不要です。
                </p>

                {room.savedWebhookUrl && (
                  <>
                    <button
                      className="share-create-btn"
                      disabled={busy}
                      onClick={() => void handleStart(room.savedWebhookUrl)}
                    >
                      {busy ? '投稿中…' : '前回のチャンネルで共有を開始'}
                    </button>
                    <button className="share-text-btn" onClick={room.forgetWebhook}>
                      別のチャンネルを使う
                    </button>
                    <div className="share-divider">または</div>
                  </>
                )}

                <input
                  className="share-webhook-input"
                  value={webhookInput}
                  onChange={e => setWebhookInput(e.target.value)}
                  placeholder="https://discord.com/api/webhooks/..."
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button
                  className="share-create-btn"
                  disabled={busy || !webhookInput.trim()}
                  onClick={() => void handleStart(webhookInput)}
                >
                  {busy ? '投稿中…' : 'このチャンネルで共有を開始'}
                </button>

                <button className="share-text-btn" onClick={() => setShowHowTo(v => !v)}>
                  ウェブフックURLの取り方 {showHowTo ? '▲' : '▼'}
                </button>
                {showHowTo && (
                  <ol className="share-howto">
                    <li>Discord でチャンネル名の横の⚙️（チャンネルの編集）を開く</li>
                    <li>「連携サービス」→「ウェブフック」→「新しいウェブフック」</li>
                    <li>「ウェブフックURLをコピー」を押す</li>
                    <li>コピーしたURLを上の欄に貼る</li>
                  </ol>
                )}
                <p className="share-warning">
                  ウェブフックURLを知っている人はそのチャンネルに投稿できます。身内の
                  チャンネルで使ってください。不要になったら Discord 側で削除できます。
                </p>
              </>
            )}

            {room.error && <div className="share-error">{room.error}</div>}

            <button className="share-close-btn" onClick={() => setShareOpen(false)}>
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
