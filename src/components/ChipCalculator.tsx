import { useState, useEffect, useCallback, useRef } from 'react'
import { useDiscordRoom } from '../hooks/useDiscordRoom'
import { roomRefFromHash } from '../utils/discordSync'
import { CODE_LENGTH, formatCode, normalizeCode } from '../utils/roomCrypto'
import { getClientId } from '../utils/clientId'
import {
  accessOf,
  approvedMembers,
  pendingMembers,
  withMember,
  withoutMember,
  type Member,
} from '../utils/roomMembers'
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
  /** 共有中のみ。ルームを作った端末のID。 */
  hostId?: string
  /** 共有中のみ。参加者と承認状態。 */
  members?: Record<string, Member>
}

const STORAGE_KEY = 'chip-calculator-data'
const ROOM_STORAGE_KEY = 'chip-calculator-room'
const WEBHOOK_STORAGE_KEY = 'chip-calculator-webhook'
const CODE_STORAGE_KEY = 'chip-calculator-code'
/** 共有に参加する前の自分のデータ。共有をやめたら書き戻す。 */
const BACKUP_STORAGE_KEY = 'chip-calculator-backup'

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
  hostId?: string
  members?: Record<string, Member>
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
  const doc: ChipDoc = {
    chipsPer100BB: data.chipsPer100BB,
    buyInYen: data.buyInYen,
    rake: data.rake,
    players,
  }
  if (data.hostId) doc.hostId = data.hostId
  if (data.members) doc.members = { ...data.members }
  return doc
}

function normalizeMembers(raw: ChipDoc['members']): Record<string, Member> | undefined {
  if (!raw) return undefined
  const out: Record<string, Member> = {}
  for (const [id, m] of Object.entries(raw)) {
    if (!m || typeof m.name !== 'string') continue
    const status =
      m.status === 'approved' || m.status === 'denied' || m.status === 'pending'
        ? m.status
        : 'pending'
    out[id] = { name: m.name, status, at: Number(m.at ?? 0) }
  }
  return out
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
    hostId: typeof doc.hostId === 'string' ? doc.hostId : undefined,
    members: normalizeMembers(doc.members),
  }
}

/**
 * Discord のチャンネルに出る本文。
 * 収支そのものは暗号化されて末尾の同期用データに入っているので、ここには出さない
 * （チャンネルにいるだけの人に読まれないようにするのがコードの目的なので、
 * 人が読める表を出してしまうと意味がなくなる）。
 */
function renderDiscordMessage(joinUrl: string): string {
  const lines: string[] = []
  lines.push('## 🃏 チップ計算')
  lines.push('🔒 中身はコードを知っている人だけが開けます。')
  lines.push('')
  lines.push(`-# 更新 <t:${Math.floor(Date.now() / 1000)}:T>`)
  if (joinUrl) {
    lines.push(`▶ アプリで開く: ${joinUrl}`)
    lines.push('-# 開いたあと、ホストから聞いたコードを入力してください。')
  }
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
    codeStorageKey: CODE_STORAGE_KEY,
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

  // 共有リンク（#dc=...）で開かれたら、その共有に参加する。
  // 参加するとルームの内容で上書きされるので、その前に自分のデータを退避しておく。
  //
  // アプリを開いたままリンクをタップした場合はハッシュが変わるだけでページが
  // 再読み込みされないので、hashchange も拾う必要がある。
  const joinRoom = room.join
  useEffect(() => {
    const joinFromHash = () => {
      const ref = roomRefFromHash(window.location.hash)
      if (!ref) return
      window.history.replaceState(null, '', window.location.pathname + window.location.search)

      // すでに同じルームにいるなら入り直さない（退避データを潰さないため）
      try {
        const current = localStorage.getItem(ROOM_STORAGE_KEY)
        if (current && (JSON.parse(current) as { messageId?: string }).messageId === ref.messageId) {
          return
        }
      } catch {
        // ignore
      }

      localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(dataRef.current))
      void joinRoom(ref)
    }

    joinFromHash()
    window.addEventListener('hashchange', joinFromHash)
    return () => window.removeEventListener('hashchange', joinFromHash)
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
    // 参加者と承認状態はルームそのものなので、数字のリセットでは消さない
    mutate(prev => ({
      ...defaultData,
      players: [],
      hostId: prev.hostId,
      members: prev.members,
    }))
    setConfirmReset(false)
  }

  // --- 参加と承認 -------------------------------------------------------------
  const myId = getClientId()
  const access = accessOf(data, myId)
  const inRoom = room.room !== null
  const synced = room.lastSyncAt !== null
  /** 共有中に自分がまだ画面を見られない状態か。 */
  const gate: 'none' | 'connecting' | 'code' | 'form' | 'pending' | 'denied' = !inRoom
    ? 'none'
    : room.needsCode
      ? 'code'
      : !synced
      ? 'connecting'
      : access === 'host' || access === 'approved'
        ? 'none'
        : access === 'pending'
          ? 'pending'
          : access === 'denied'
            ? 'denied'
            : 'form'

  const [nameInput, setNameInput] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const waiting = pendingMembers(data)
  const joined = approvedMembers(data)

  const requestJoin = () => {
    const name = nameInput.trim()
    if (!name) return
    mutate(prev => ({
      ...prev,
      members: withMember(prev, myId, { name, status: 'pending', at: Date.now() }),
    }))
    setNameInput('')
  }

  const setMemberStatus = (id: string, status: Member['status']) => {
    mutate(prev => {
      const current = prev.members?.[id]
      if (!current) return prev
      return { ...prev, members: withMember(prev, id, { ...current, status }) }
    })
  }

  const removeMember = (id: string) => {
    mutate(prev => ({ ...prev, members: withoutMember(prev, id) }))
  }

  // --- 共有UI ---------------------------------------------------------------
  const [shareOpen, setShareOpen] = useState(false)
  const [webhookInput, setWebhookInput] = useState('')
  const [hostNameInput, setHostNameInput] = useState('')
  const [showHowTo, setShowHowTo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)

  const copyText = async (text: string, kind: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // クリップボードが使えない環境では手でコピーしてもらう
    }
  }

  const handleStart = async (url: string) => {
    setBusy(true)
    // 自分をホスト（承認済み）として登録してから投稿する
    const hostName = hostNameInput.trim() || 'ホスト'
    mutate(prev => ({
      ...prev,
      hostId: myId,
      members: { [myId]: { name: hostName, status: 'approved', at: Date.now() } },
    }))
    const issued = await room.start(url)
    setBusy(false)
    if (issued) {
      setWebhookInput('')
      // 発行したコードは伝えてもらう必要があるので、閉じずに見せたままにする
    }
  }

  const handleLeave = () => {
    const wasGated = gate !== 'none'
    room.leave()
    if (wasGated) {
      // まだ画面を見られていない＝ルームの数字は自分のものではないので、参加前に戻す
      let restored: ChipData = { ...defaultData, players: [] }
      try {
        const raw = localStorage.getItem(BACKUP_STORAGE_KEY)
        if (raw) restored = JSON.parse(raw) as ChipData
      } catch {
        // ignore
      }
      dataRef.current = restored
      setData(restored)
    }
    localStorage.removeItem(BACKUP_STORAGE_KEY)
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
                : room.status === 'locked'
                  ? 'コード待ち'
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

      {/* 承認されるまでは中身を出さない */}
      {gate !== 'none' && (
        <div className="gate-card">
          {gate === 'connecting' && (
            <>
              <div className="gate-spinner" />
              <h3>共有に接続しています…</h3>
            </>
          )}

          {gate === 'code' && (
            <>
              <div className="gate-lock">🔒</div>
              <h3>コードを入力</h3>
              <p className="gate-note">
                このルームの中身はコードで暗号化されています。
                <br />
                ホストから聞いたコードを入力してください。
              </p>
              <input
                className="gate-code-input"
                value={codeInput}
                onChange={e => setCodeInput(e.target.value.toUpperCase())}
                onKeyDown={e => {
                  if (e.key === 'Enter') room.unlock(codeInput)
                }}
                placeholder="ABCD-EFGH"
                maxLength={CODE_LENGTH + 1}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
              />
              <button
                className="gate-submit-btn"
                disabled={normalizeCode(codeInput).length !== CODE_LENGTH}
                onClick={() => room.unlock(codeInput)}
              >
                開く
              </button>
            </>
          )}

          {gate === 'form' && (
            <>
              <h3>参加を申請する</h3>
              <p className="gate-note">
                お名前を入力して申請してください。ホストが承認すると画面が見られます。
              </p>
              <input
                className="gate-name-input"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') requestJoin()
                }}
                placeholder="お名前"
                maxLength={20}
                autoFocus
              />
              <button
                className="gate-submit-btn"
                disabled={!nameInput.trim()}
                onClick={requestJoin}
              >
                参加を申請
              </button>
            </>
          )}

          {gate === 'pending' && (
            <>
              <div className="gate-spinner" />
              <h3>承認を待っています</h3>
              <p className="gate-note">
                <strong>{data.members?.[myId]?.name}</strong> として申請しました。
                <br />
                ホストが承認するとこの画面が切り替わります。
              </p>
            </>
          )}

          {gate === 'denied' && (
            <>
              <h3>参加が承認されませんでした</h3>
              <p className="gate-note">ホストに確認のうえ、もう一度申請できます。</p>
              <button
                className="gate-submit-btn"
                onClick={() => setMemberStatus(myId, 'pending')}
              >
                もう一度申請する
              </button>
            </>
          )}

          {gate !== 'connecting' && (
            <button className="gate-cancel-btn" onClick={handleLeave}>
              参加をやめる
            </button>
          )}
        </div>
      )}

      {gate === 'none' && (
        <>
      {/* 参加リクエスト（ホストだけに見える） */}
      {access === 'host' && waiting.length > 0 && (
        <div className="requests-card">
          <h2>参加リクエスト（{waiting.length}）</h2>
          {waiting.map(({ id, member }) => (
            <div key={id} className="request-row">
              <span className="request-name">{member.name}</span>
              <button className="request-deny" onClick={() => setMemberStatus(id, 'denied')}>
                拒否
              </button>
              <button className="request-approve" onClick={() => setMemberStatus(id, 'approved')}>
                承認
              </button>
            </div>
          ))}
        </div>
      )}

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
        </>
      )}

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
                  <strong>リンクとコードの2つ</strong>で共有します。リンクは Discord に貼ってあるので、
                  コードだけ口頭で伝えてください。リンクだけでは中身は開けません。
                </p>
                {room.code && (
                  <>
                    <div className="share-code-label">コード（口頭で伝える）</div>
                    <button
                      className="share-code-big"
                      onClick={() => void copyText(room.code!, 'code')}
                    >
                      {formatCode(room.code)}
                    </button>
                  </>
                )}
                <div className="share-code-label">参加リンク（Discord に投稿済み）</div>
                <div className="share-link-box">{room.joinUrl}</div>
                <div className="share-actions">
                  <button onClick={() => void copyText(room.joinUrl, 'link')}>
                    {copied === 'link' ? 'コピーしました' : '参加リンクをコピー'}
                  </button>
                </div>

                {(joined.length > 0 || waiting.length > 0) && (
                  <>
                    <div className="share-divider">参加者</div>
                    <ul className="member-list">
                      {joined.map(({ id, member }) => (
                        <li key={id} className="member-row">
                          <span className="member-name">
                            {member.name}
                            {id === data.hostId && <span className="member-tag">ホスト</span>}
                            {id === myId && <span className="member-tag self">自分</span>}
                          </span>
                          {access === 'host' && id !== myId && (
                            <button className="member-kick" onClick={() => removeMember(id)}>
                              退出させる
                            </button>
                          )}
                        </li>
                      ))}
                      {waiting.map(({ id, member }) => (
                        <li key={id} className="member-row pending">
                          <span className="member-name">
                            {member.name}
                            <span className="member-tag waiting">承認待ち</span>
                          </span>
                          {access === 'host' && (
                            <button
                              className="member-approve"
                              onClick={() => setMemberStatus(id, 'approved')}
                            >
                              承認
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <div className="share-divider" />
                <button className="share-leave-btn" onClick={handleLeave}>
                  共有をやめる（自分だけ・データは手元に残ります）
                </button>
              </>
            ) : (
              <>
                <p className="share-note">
                  Discord のチャンネルに1通メッセージを投稿し、それを全員で読み書きします。
                  リンクから来た人はあなたが承認するまで中身を見られません。
                </p>

                <input
                  className="share-webhook-input"
                  value={hostNameInput}
                  onChange={e => setHostNameInput(e.target.value)}
                  placeholder="あなたの名前（省略可）"
                  maxLength={20}
                />

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
