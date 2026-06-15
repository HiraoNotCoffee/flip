import { useEffect, useMemo, useState } from 'react'
import type { Card, Suit, Rank } from '../utils/card'
import { SUITS, RANKS, suitSymbol, rankToString, isSameCard } from '../utils/card'

// 4-color deck (HH Export only — keeps the global red/black deck untouched elsewhere).
// spade=black, heart=red, diamond=blue, club=green.
const FOUR_COLOR: Record<Suit, string> = {
  spade: '#1a1a1a',
  heart: '#e53935',
  diamond: '#1e6fe0',
  club: '#1f9d4d',
}

const DEFAULT_PLAYERS = 9
import {
  type Hand,
  type Street,
  type ActionEntry,
  STREETS,
  createHand,
  positionsForSize,
  stateForStreet,
  legalActions,
  formatPokerStars,
  computeTotalPot,
} from '../utils/handHistory'
import './HandBuilder.css'

const STORAGE_KEY = 'hh-builder-hand'

const STREET_LABEL: Record<Street, string> = {
  preflop: 'プリフロップ',
  flop: 'フロップ',
  turn: 'ターン',
  river: 'リバー',
}

// Board card index ranges per street (within hand.board[0..4]).
const BOARD_RANGE: Record<Exclude<Street, 'preflop'>, [number, number]> = {
  flop: [0, 3],
  turn: [3, 4],
  river: [4, 5],
}

function loadHand(): Hand {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return reviveHand(JSON.parse(raw))
  } catch {
    // ignore
  }
  return createHand(DEFAULT_PLAYERS)
}

// JSON round-trips fine for the plain Hand shape (cards are plain objects).
function reviveHand(obj: unknown): Hand {
  const h = obj as Hand
  if (!h.actions) h.actions = createHand(h.numPlayers ?? DEFAULT_PLAYERS).actions
  if (!h.board) h.board = [null, null, null, null, null]
  return h
}

export function HandBuilder() {
  const [hand, setHand] = useState<Hand>(loadHand)
  // Which card slot is being edited: 'hero0' | 'hero1' | 'board0'..'board4' | null
  const [pickTarget, setPickTarget] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hand))
  }, [hand])

  const positions = positionsForSize(hand.numPlayers)

  const update = (patch: Partial<Hand>) => setHand(h => ({ ...h, ...patch }))

  const setNumPlayers = (n: number) => {
    const newPositions = positionsForSize(n)
    setHand(h => ({
      ...h,
      numPlayers: n,
      heroPos: newPositions.includes(h.heroPos) ? h.heroPos : newPositions[0],
      actions: createHand(n).actions, // positions changed -> reset action history
    }))
  }

  // ---- card selection ----
  const usedCards = useMemo(() => {
    const cards: Card[] = []
    hand.heroCards.forEach(c => c && cards.push(c))
    hand.board.forEach(c => c && cards.push(c))
    return cards
  }, [hand.heroCards, hand.board])

  const setCardAt = (target: string, card: Card | null) => {
    setHand(h => {
      if (target.startsWith('hero')) {
        const i = Number(target.slice(4))
        const heroCards = [...h.heroCards] as [Card | null, Card | null]
        heroCards[i] = card
        return { ...h, heroCards }
      }
      const i = Number(target.slice(5))
      const board = [...h.board]
      board[i] = card
      return { ...h, board }
    })
  }

  // ---- actions ----
  const pushAction = (street: Street, entry: ActionEntry) => {
    setHand(h => ({
      ...h,
      actions: { ...h.actions, [street]: [...h.actions[street], entry] },
    }))
  }
  const undoAction = (street: Street) => {
    setHand(h => ({
      ...h,
      actions: { ...h.actions, [street]: h.actions[street].slice(0, -1) },
    }))
  }

  // ---- output ----
  // No manual memoization: formatting is cheap and the React Compiler handles it.
  const text = safeFormat(hand)

  const handleCopy = async () => {
    const out = formatPokerStars(hand, {
      handId: String(Date.now()),
      dateStr: formatNow(),
    })
    try {
      await navigator.clipboard.writeText(out)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable; fall back to selecting the textarea.
    }
  }

  const handleDownload = () => {
    const out = formatPokerStars(hand, {
      handId: String(Date.now()),
      dateStr: formatNow(),
    })
    const blob = new Blob([out], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hand_${Date.now()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleReset = () => {
    if (confirm('入力中のハンドをクリアしますか？')) {
      setHand(createHand(hand.numPlayers))
    }
  }

  return (
    <div className="hh">
      {/* ---- setup ---- */}
      <section className="hh-section">
        <h2>テーブル設定</h2>
        <div className="hh-row">
          <label>人数</label>
          <select value={hand.numPlayers} onChange={e => setNumPlayers(Number(e.target.value))}>
            {[2, 3, 4, 5, 6, 7, 8, 9].map(n => (
              <option key={n} value={n}>{n}-max</option>
            ))}
          </select>
        </div>
        <div className="hh-row">
          <label>SB / BB</label>
          <input
            className="hh-num"
            type="number" inputMode="decimal" step="0.1" min={0}
            value={hand.sb}
            onChange={e => update({ sb: Number(e.target.value) })}
          />
          <span className="hh-sep">/</span>
          <input
            className="hh-num"
            type="number" inputMode="decimal" step="0.1" min={0}
            value={hand.bb}
            onChange={e => update({ bb: Number(e.target.value) })}
          />
        </div>
        <div className="hh-row">
          <label>スタック</label>
          <input
            className="hh-num"
            type="number" inputMode="decimal" step="1" min={0}
            value={hand.defaultStack}
            onChange={e => update({ defaultStack: Number(e.target.value) })}
          />
          <span className="hh-unit">（全員・{(hand.defaultStack / hand.bb).toFixed(0)}BB）</span>
        </div>
        <div className="hh-row hh-row-col">
          <label>ヒーローの<br className="hh-br" />ポジション</label>
          <div className="hh-pos-grid">
            {positions.map(p => (
              <button
                key={p}
                className={`hh-pos-btn ${hand.heroPos === p ? 'active' : ''}`}
                onClick={() => update({ heroPos: p })}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ---- hero cards ---- */}
      <section className="hh-section">
        <h2>ヒーローのハンド（{hand.heroPos}）</h2>
        <div className="hh-cards">
          <CardSlot card={hand.heroCards[0]} onClick={() => setPickTarget('hero0')} />
          <CardSlot card={hand.heroCards[1]} onClick={() => setPickTarget('hero1')} />
        </div>
      </section>

      <p className="hh-hint hh-hint-flow">
        各ストリートはボードを入れるだけで次へ進めます（アクション入力は任意）。
      </p>

      {/* ---- streets ---- */}
      {STREETS.map(street => (
        <StreetSection
          key={street}
          hand={hand}
          street={street}
          onPush={pushAction}
          onUndo={undoAction}
          onPickBoard={i => setPickTarget(`board${i}`)}
        />
      ))}

      {/* ---- output ---- */}
      <section className="hh-section">
        <h2>GTO Wizard用テキスト</h2>
        <div className="hh-pot">推定ポット: ${computeTotalPot(hand).toFixed(2)}</div>
        <textarea className="hh-output" readOnly value={text} rows={12} />
        <div className="hh-actions-row">
          <button className="hh-btn primary" onClick={handleCopy}>
            {copied ? 'コピーしました' : 'コピー'}
          </button>
          <button className="hh-btn" onClick={handleDownload}>.txtダウンロード</button>
          <button className="hh-btn danger" onClick={handleReset}>クリア</button>
        </div>
        <p className="hh-hint">
          GTO Wizardの「Analyze Hand」→「Single Hand」に貼り付け、またはダウンロードした.txtをアップロードしてください。
        </p>
      </section>

      {/* ---- card picker modal ---- */}
      {pickTarget && (
        <CardPicker
          used={usedCards}
          current={getCardAt(hand, pickTarget)}
          onPick={card => { setCardAt(pickTarget, card); setPickTarget(null) }}
          onClear={() => { setCardAt(pickTarget, null); setPickTarget(null) }}
          onClose={() => setPickTarget(null)}
        />
      )}
    </div>
  )
}

function safeFormat(hand: Hand): string {
  try {
    return formatPokerStars(hand)
  } catch {
    return ''
  }
}

function getCardAt(hand: Hand, target: string): Card | null {
  if (target.startsWith('hero')) return hand.heroCards[Number(target.slice(4))]
  return hand.board[Number(target.slice(5))]
}

// ---- street section ----

function StreetSection({
  hand, street, onPush, onUndo, onPickBoard,
}: {
  hand: Hand
  street: Street
  onPush: (s: Street, e: ActionEntry) => void
  onUndo: (s: Street) => void
  onPickBoard: (boardIndex: number) => void
}) {
  // Is this street reachable? Preflop always. Later streets only need that the
  // hand didn't already end (>1 player) and the previous street's board cards
  // are in. We deliberately do NOT require the previous street's betting to be
  // "closed" — entering a full action line is optional; the user may just want
  // to deal the board, and the exporter emits each street from its board alone.
  const reachable = useMemo(() => {
    if (street === 'preflop') return true
    const order = STREETS.slice(0, STREETS.indexOf(street))
    const prev = order[order.length - 1]
    const prevState = stateForStreet(hand, prev)
    if (prevState.handOver) return false
    // Require the previous street's board to be present.
    if (prev !== 'preflop') {
      const [s, e] = BOARD_RANGE[prev as Exclude<Street, 'preflop'>]
      for (let i = s; i < e; i++) if (!hand.board[i]) return false
    }
    return true
  }, [hand, street])

  if (!reachable) return null

  const st = stateForStreet(hand, street)
  const entries = hand.actions[street]

  // Board entry for this (non-preflop) street.
  const needsBoard = street !== 'preflop'
  const boardReady = (() => {
    if (!needsBoard) return true
    const [s, e] = BOARD_RANGE[street as Exclude<Street, 'preflop'>]
    for (let i = s; i < e; i++) if (!hand.board[i]) return false
    return true
  })()

  return (
    <section className="hh-section">
      <h2>{STREET_LABEL[street]}</h2>

      {needsBoard && (
        <div className="hh-board">
          {boardSlots(street).map(i => (
            <CardSlot key={i} card={hand.board[i]} small onClick={() => onPickBoard(i)} />
          ))}
        </div>
      )}

      {(!needsBoard || boardReady) && (
        <>
          <div className="hh-log">
            {entries.length === 0 && <span className="hh-muted">アクションなし</span>}
            {entries.map((a, i) => (
              <span key={i} className="hh-log-item">
                {a.pos} {actionLabel(a)}
              </span>
            ))}
          </div>

          {st.handOver ? (
            <div className="hh-muted">このストリートで終了（1人を残して全員フォールド）</div>
          ) : st.toAct ? (
            <ActionControls key={`${street}-${st.toAct}-${entries.length}`} hand={hand} st={st} onPush={e => onPush(street, e)} />
          ) : (
            <div className="hh-muted">アクション完了 → 次のストリートへ</div>
          )}

          {entries.length > 0 && (
            <button className="hh-btn small" onClick={() => onUndo(street)}>1つ戻す</button>
          )}
        </>
      )}
    </section>
  )
}

function boardSlots(street: Street): number[] {
  if (street === 'flop') return [0, 1, 2]
  if (street === 'turn') return [3]
  if (street === 'river') return [4]
  return []
}

// ---- action controls ----

function ActionControls({
  hand, st, onPush,
}: {
  hand: Hand
  st: ReturnType<typeof stateForStreet>
  onPush: (e: ActionEntry) => void
}) {
  const pos = st.toAct!
  const legal = legalActions(hand, st)
  const facing = st.currentBet - (st.committed[pos] ?? 0)
  const betOpt = legal.find(a => a.type === 'bet' || a.type === 'raise') as
    | { type: 'bet' | 'raise'; min: number; max: number } | undefined
  const minSize = betOpt ? round2(betOpt.min) : 0
  // This component is remounted (via key) whenever the player to act changes,
  // so the size field initialises fresh to the minimum legal size each time.
  const [sizeStr, setSizeStr] = useState(minSize ? String(minSize) : '')

  return (
    <div className="hh-act">
      <div className="hh-act-who">アクション: <strong>{pos}</strong>
        {facing > 1e-9 && <span className="hh-act-facing"> （${facing.toFixed(2)}コール）</span>}
      </div>
      <div className="hh-act-btns">
        {legal.some(a => a.type === 'fold') && (
          <button className="hh-act-btn fold" onClick={() => onPush({ pos, type: 'fold' })}>フォールド</button>
        )}
        {legal.some(a => a.type === 'check') && (
          <button className="hh-act-btn check" onClick={() => onPush({ pos, type: 'check' })}>チェック</button>
        )}
        {legal.some(a => a.type === 'call') && (
          <button className="hh-act-btn call" onClick={() => onPush({ pos, type: 'call' })}>
            コール ${facing.toFixed(2)}
          </button>
        )}
        {betOpt && (
          <div className="hh-act-bet">
            <input
              className="hh-num"
              type="number" inputMode="decimal" step="0.1"
              min={betOpt.min} max={betOpt.max}
              value={sizeStr}
              onChange={e => setSizeStr(e.target.value)}
              placeholder={String(minSize)}
            />
            <button
              className="hh-act-btn raise"
              disabled={!validSize(sizeStr, betOpt)}
              onClick={() => onPush({ pos, type: betOpt.type, toAmount: round2(Number(sizeStr)) })}
            >
              {betOpt.type === 'bet' ? 'ベット' : 'レイズ'} to ${Number(sizeStr || 0).toFixed(2)}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function validSize(s: string, opt: { min: number; max: number }): boolean {
  const v = Number(s)
  return Number.isFinite(v) && v >= opt.min - 1e-9 && v <= opt.max + 1e-9
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function actionLabel(a: ActionEntry): string {
  switch (a.type) {
    case 'fold': return 'フォールド'
    case 'check': return 'チェック'
    case 'call': return 'コール'
    case 'bet': return `ベット ${a.toAmount}`
    case 'raise': return `レイズ ${a.toAmount}`
  }
}

// ---- card slot & picker ----

function CardSlot({ card, onClick, small }: { card: Card | null; onClick: () => void; small?: boolean }) {
  return (
    <button className={`hh-slot ${small ? 'small' : ''} ${card ? 'filled' : ''}`} onClick={onClick}>
      {card ? (
        <span style={{ color: FOUR_COLOR[card.suit] }}>
          {rankToString(card.rank)}{suitSymbol[card.suit]}
        </span>
      ) : (
        <span className="hh-slot-empty">＋</span>
      )}
    </button>
  )
}

function CardPicker({
  used, current, onPick, onClear, onClose,
}: {
  used: Card[]
  current: Card | null
  onPick: (c: Card) => void
  onClear: () => void
  onClose: () => void
}) {
  const [suit, setSuit] = useState<Suit>(current?.suit ?? 'spade')
  const isUsed = (r: Rank, s: Suit) =>
    used.some(c => isSameCard(c, { rank: r, suit: s }) && !(current && isSameCard(current, { rank: r, suit: s })))

  return (
    <div className="hh-modal" onClick={onClose}>
      <div className="hh-modal-body" onClick={e => e.stopPropagation()}>
        <div className="hh-suit-tabs">
          {SUITS.map(s => (
            <button
              key={s}
              className={`hh-suit-tab ${suit === s ? 'active' : ''}`}
              style={{ color: FOUR_COLOR[s] }}
              onClick={() => setSuit(s)}
            >
              {suitSymbol[s]}
            </button>
          ))}
        </div>
        <div className="hh-rank-grid">
          {[...RANKS].reverse().map(r => {
            const disabled = isUsed(r, suit)
            return (
              <button
                key={r}
                className="hh-rank-btn"
                style={{ color: FOUR_COLOR[suit] }}
                disabled={disabled}
                onClick={() => onPick({ rank: r, suit })}
              >
                {rankToString(r)}
              </button>
            )
          })}
        </div>
        <div className="hh-modal-actions">
          <button className="hh-btn small" onClick={onClear}>空にする</button>
          <button className="hh-btn small" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  )
}

function formatNow(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
