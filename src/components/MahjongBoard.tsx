import { useEffect, useRef, useState } from 'react'
import { SANMA_TABLE } from '../utils/mahjong/sanma'
import {
  PLAYERS,
  WINDS,
  HONBA_POINTS,
  adjustPoints,
  formatK,
  applyDraw,
  applyRon,
  applyTsumo,
  newBoard,
  roundLabel,
  seatWind,
  toggleRiichi,
  type BoardState,
} from '../utils/mahjong/board'
import { usePastPlayers } from '../hooks/usePastPlayers'
import { PastPlayersBar } from './PastPlayers'
import './MahjongBoard.css'

// 麻雀点数管理（3人打ち）: 卓の真ん中に置きっぱなしにして、点数・親・風を見る。
// 席は 0=手前 1=右 2=左。それぞれの人の向きに表示を回す。点数は点数表と同じ翻だけの表。

const STORAGE_KEY = 'mahjong-board-sanma'
const HISTORY_MAX = 100
const SEAT_POS = ['bottom', 'right', 'left'] as const
const SEAT_LABELS = ['手前', '右', '左']
const SEATS = [0, 1, 2]

interface Saved {
  board: BoardState
  history: BoardState[]
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Saved
      if (parsed.board?.points?.length === PLAYERS) {
        // 前の版はリーチを true/false で持っていた
        const fix = (b: BoardState): BoardState => ({ ...b, riichi: b.riichi.map(r => Number(r)) })
        return { board: fix(parsed.board), history: (parsed.history ?? []).map(fix) }
      }
    }
  } catch {
    // ignore
  }
  return { board: newBoard(), history: [] }
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'pickWinner' }
  | { kind: 'pickHow'; winner: number }
  | { kind: 'pickLoser'; winner: number }
  | { kind: 'score'; winner: number; loser: number | null }
  | { kind: 'draw' }
  | { kind: 'settings' }

/** 開いている間は画面を消さない（タブを戻したら取り直す） */
function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let alive = true
    const acquire = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock
        .request('screen')
        .then(l => {
          if (alive) lock = l
          else void l.release()
        })
        .catch(() => {})
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', acquire)
      void lock?.release()
    }
  }, [])
}

export function MahjongBoard() {
  const [{ board, history }, setSaved] = useState<Saved>(load)
  const [mode, setMode] = useState<Mode>({ kind: 'idle' })
  useWakeLock()

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ board, history }))
    } catch {
      // ignore
    }
  }, [board, history])

  /** 元に戻せるように、変える前を履歴に積む */
  const commit = (next: BoardState) =>
    setSaved(prev => ({ board: next, history: [...prev.history, prev.board].slice(-HISTORY_MAX) }))
  const undo = () =>
    setSaved(prev =>
      prev.history.length === 0
        ? prev
        : { board: prev.history[prev.history.length - 1], history: prev.history.slice(0, -1) },
    )

  const nameOf = (seat: number) => board.names[seat].trim() || `${WINDS[seatWind(board, seat)]}家`

  const onSeatTap = (seat: number) => {
    if (mode.kind === 'pickWinner') setMode({ kind: 'pickHow', winner: seat })
    else if (mode.kind === 'pickLoser' && seat !== mode.winner)
      setMode({ kind: 'score', winner: mode.winner, loser: seat })
  }

  const picking = mode.kind === 'pickWinner' || mode.kind === 'pickLoser'

  return (
    <div className="mjb">
      {SEAT_POS.map((pos, seat) => {
        const wind = seatWind(board, seat)
        const isDealer = seat === board.dealer
        const selectable =
          mode.kind === 'pickWinner' || (mode.kind === 'pickLoser' && seat !== mode.winner)
        const isWinner = (mode.kind === 'pickLoser' || mode.kind === 'pickHow') && mode.winner === seat
        return (
          <div key={seat} className={`mjb-seat mjb-${pos}`}>
            <div
              className={`mjb-seat-inner ${isDealer ? 'dealer' : ''} ${selectable ? 'selectable' : ''} ${
                isWinner ? 'winner' : ''
              } ${picking && !selectable && !isWinner ? 'dim' : ''}`}
              onClick={() => onSeatTap(seat)}
            >
              <div className="mjb-seat-top">
                <span className={`mjb-wind ${isDealer ? 'dealer' : ''}`}>{WINDS[wind]}</span>
                {isDealer && <span className="mjb-oya">親</span>}
                <span className="mjb-name">{nameOf(seat)}</span>
              </div>
              <div className="mjb-points">{formatK(board.points[seat])}</div>
              <div className="mjb-seat-bottom">
                <span className={`mjb-diff ${board.points[seat] - board.startPoints >= 0 ? 'plus' : 'minus'}`}>
                  {signed(board.points[seat] - board.startPoints)}
                </span>
                <button
                  className={`mjb-riichi ${board.riichi[seat] ? 'on' : ''} ${board.riichi[seat] === 2 ? 'double' : ''}`}
                  disabled={mode.kind !== 'idle'}
                  onClick={e => {
                    e.stopPropagation()
                    commit(toggleRiichi(board, seat))
                  }}
                >
                  {board.riichi[seat] === 0 ? (
                    'リーチ'
                  ) : (
                    <>
                      <span className="mjb-stick" />
                      {board.riichi[seat] === 2 && <span className="mjb-double">W</span>}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )
      })}

      <div className="mjb-center">
        <div className="mjb-round">{roundLabel(board)}</div>
        <div className="mjb-counters">
          <span>{board.honba}本場</span>
          <span>供託 {board.kyotaku}</span>
        </div>
        {mode.kind === 'pickWinner' && <div className="mjb-prompt">和了った人をタップ</div>}
        {mode.kind === 'pickLoser' && <div className="mjb-prompt">振り込んだ人をタップ</div>}
        {mode.kind === 'pickHow' && (
          <div className="mjb-how">
            <div className="mjb-prompt">{nameOf(mode.winner)} の和了</div>
            <button className="mjb-btn primary" onClick={() => setMode({ kind: 'pickLoser', winner: mode.winner })}>
              ロン
            </button>
            <button className="mjb-btn primary" onClick={() => setMode({ kind: 'score', winner: mode.winner, loser: null })}>
              ツモ
            </button>
          </div>
        )}
        {mode.kind === 'idle' ? (
          <div className="mjb-actions">
            <button className="mjb-btn primary" onClick={() => setMode({ kind: 'pickWinner' })}>
              和了
            </button>
            <button className="mjb-btn" onClick={() => setMode({ kind: 'draw' })}>
              流局
            </button>
            <button className="mjb-btn" onClick={undo} disabled={history.length === 0}>
              戻す
            </button>
            <button className="mjb-btn" onClick={() => setMode({ kind: 'settings' })}>
              設定
            </button>
          </div>
        ) : (
          (picking || mode.kind === 'pickHow') && (
            <button className="mjb-btn ghost" onClick={() => setMode({ kind: 'idle' })}>
              やめる
            </button>
          )
        )}
      </div>

      {mode.kind === 'score' && (
        <ScoreDialog
          board={board}
          winner={mode.winner}
          loser={mode.loser}
          nameOf={nameOf}
          onCancel={() => setMode({ kind: 'idle' })}
          onApply={next => {
            commit(next)
            setMode({ kind: 'idle' })
          }}
        />
      )}
      {mode.kind === 'draw' && (
        <DrawDialog
          board={board}
          nameOf={nameOf}
          onCancel={() => setMode({ kind: 'idle' })}
          onApply={tenpai => {
            commit(applyDraw(board, tenpai))
            setMode({ kind: 'idle' })
          }}
        />
      )}
      {mode.kind === 'settings' && (
        <SettingsDialog board={board} onClose={() => setMode({ kind: 'idle' })} onChange={commit} />
      )}
    </div>
  )
}

function signed(n: number) {
  return n > 0 ? `+${formatK(n)}` : formatK(n)
}

// -------------------------------------------------- 和了の点数
function ScoreDialog({
  board,
  winner,
  loser,
  nameOf,
  onCancel,
  onApply,
}: {
  board: BoardState
  winner: number
  loser: number | null
  nameOf: (seat: number) => string
  onCancel: () => void
  onApply: (next: BoardState) => void
}) {
  const ron = loser !== null
  const isDealer = winner === board.dealer
  const [choice, setChoice] = useState<number | null>(null)
  const row = choice === null ? null : SANMA_TABLE[choice]

  let result: { next: BoardState; text: string } | null = null
  if (row) {
    const extra = board.kyotaku > 0 ? `  供託 +${formatK(board.kyotaku * 1000)}` : ''
    if (ron) {
      const amount = isDealer ? row.dealer.ron : row.child.ron
      const honba = board.honba > 0 ? `（${board.honba}本場 +${formatK(board.honba * HONBA_POINTS)}）` : ''
      result = {
        next: applyRon(board, winner, loser, amount),
        text: `${formatK(amount)}${honba}${extra}`,
      }
    } else if (isDealer) {
      const each = row.dealer.tsumo
      const honba = board.honba > 0 ? `（${board.honba}本場 各+${formatK(board.honba * HONBA_POINTS)}）` : ''
      result = { next: applyTsumo(board, winner, each, 0), text: `${formatK(each)}オール${honba}${extra}` }
    } else {
      const [c, d] = row.child.tsumo
      const honba = board.honba > 0 ? `（${board.honba}本場 各+${formatK(board.honba * HONBA_POINTS)}）` : ''
      result = {
        next: applyTsumo(board, winner, c, d),
        text: `子 ${formatK(c)} / 親 ${formatK(d)}${honba}${extra}`,
      }
    }
  }

  return (
    <div className="mjb-overlay" onClick={onCancel}>
      <div className="mjb-dialog" onClick={e => e.stopPropagation()}>
        <div className="mjb-dialog-title">
          {nameOf(winner)}
          {isDealer && <span className="mjb-oya small">親</span>}
          {ron ? ` ← ${nameOf(loser)} からロン` : ' のツモ'}
        </div>
        {board.riichi[winner] > 0 && (
          <div className="mjb-reminder">
            {board.riichi[winner] === 2 ? 'ダブリー（2翻）' : 'リーチ（1翻）'}も翻に入れてください
          </div>
        )}
        <div className="mjb-grid">
          {SANMA_TABLE.map((h, i) => (
            <button key={h.label} className={`mjb-pill ${choice === i ? 'on' : ''}`} onClick={() => setChoice(i)}>
              {h.label}
            </button>
          ))}
        </div>
        <div className="mjb-result">{result ? result.text : '翻を選んでください'}</div>
        <div className="mjb-dialog-actions">
          <button className="mjb-btn ghost" onClick={onCancel}>
            やめる
          </button>
          <button className="mjb-btn primary" disabled={!result} onClick={() => result && onApply(result.next)}>
            決定
          </button>
        </div>
      </div>
    </div>
  )
}

// -------------------------------------------------- 流局
function DrawDialog({
  board,
  nameOf,
  onCancel,
  onApply,
}: {
  board: BoardState
  nameOf: (seat: number) => string
  onCancel: () => void
  onApply: (tenpai: boolean[]) => void
}) {
  const [tenpai, setTenpai] = useState(SEATS.map(() => false))
  const n = tenpai.filter(Boolean).length
  return (
    <div className="mjb-overlay" onClick={onCancel}>
      <div className="mjb-dialog" onClick={e => e.stopPropagation()}>
        <div className="mjb-dialog-title">流局：テンパイの人を選ぶ</div>
        <div className="mjb-list">
          {SEATS.map(seat => (
            <button
              key={seat}
              className={`mjb-pill wide ${tenpai[seat] ? 'on' : ''}`}
              onClick={() => setTenpai(t => t.map((v, i) => (i === seat ? !v : v)))}
            >
              {WINDS[seatWind(board, seat)]} {nameOf(seat)} {tenpai[seat] ? 'テンパイ' : 'ノーテン'}
            </button>
          ))}
        </div>
        <div className="mjb-result">
          {n === 0 || n === PLAYERS ? '点数の移動なし' : `テンパイ +${formatK(3000 / n)}  ノーテン −${formatK(3000 / (PLAYERS - n))}`}
          {tenpai[board.dealer] ? '　親は続く' : '　親が流れる'}
        </div>
        <div className="mjb-dialog-actions">
          <button className="mjb-btn ghost" onClick={onCancel}>
            やめる
          </button>
          <button className="mjb-btn primary" onClick={() => onApply(tenpai)}>
            決定
          </button>
        </div>
      </div>
    </div>
  )
}

// -------------------------------------------------- 設定
function SettingsDialog({
  board,
  onClose,
  onChange,
}: {
  board: BoardState
  onClose: () => void
  onChange: (next: BoardState) => void
}) {
  // 名前を打つたびに履歴に積まないよう、名前は閉じるときにまとめて反映する
  const [names, setNames] = useState(board.names)
  const [start, setStart] = useState(board.startPoints)
  const [confirmReset, setConfirmReset] = useState(false)
  const [adjust, setAdjust] = useState<string[]>(SEATS.map(() => ''))
  const past = usePastPlayers('mahjong-sheet-past-players', board.names)
  const activeCol = useRef<number | null>(null)

  const close = () => {
    if (names.some((n, i) => n !== board.names[i])) onChange({ ...board, names })
    past.remember(names)
    onClose()
  }
  const set = (patch: Partial<BoardState>) => onChange({ ...board, names, ...patch })

  const pick = (name: string) => {
    const target = activeCol.current ?? names.findIndex(n => n.trim() === '')
    if (target < 0) return
    setNames(ns => ns.map((n, i) => (i === target ? name : n)))
    activeCol.current = null
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  return (
    <div className="mjb-overlay" onClick={close}>
      <div className="mjb-dialog settings" onClick={e => e.stopPropagation()}>
        <div className="mjb-dialog-title">設定</div>

        <div className="mjb-dialog-sub">名前（手前 → 右 → 左 の順に打つ）・点数の手直し（1000点単位）</div>
        <PastPlayersBar list={past.list} used={names} onPick={pick} onForget={past.forget} />
        <div className="mjb-names">
          {SEAT_LABELS.map((label, i) => (
            <label key={i} className="mjb-name-row">
              <span className="mjb-name-label">{label}</span>
              <input
                value={names[i]}
                placeholder={`${WINDS[seatWind(board, i)]}家`}
                maxLength={12}
                onFocus={() => (activeCol.current = i)}
                onBlur={() => {
                  window.setTimeout(() => {
                    if (activeCol.current === i) activeCol.current = null
                  }, 300)
                }}
                onChange={e => setNames(ns => ns.map((n, j) => (j === i ? e.target.value : n)))}
              />
              <input
                className="mjb-adjust"
                inputMode="text"
                placeholder="±"
                value={adjust[i]}
                onChange={e => setAdjust(a => a.map((v, j) => (j === i ? e.target.value : v)))}
              />
              <button
                className="mjb-btn small"
                disabled={!Number(adjust[i])}
                onClick={() => {
                  onChange(adjustPoints({ ...board, names }, i, Math.round(Number(adjust[i]) * 10) * 100))
                  setAdjust(a => a.map((v, j) => (j === i ? '' : v)))
                }}
              >
                足す
              </button>
            </label>
          ))}
        </div>

        <div className="mjb-dialog-sub">局</div>
        <div className="mjb-row">
          <select value={board.roundWind} onChange={e => set({ roundWind: Number(e.target.value) })}>
            {WINDS.map((w, i) => (
              <option key={w} value={i}>
                {w}場
              </option>
            ))}
          </select>
          <select value={board.kyoku} onChange={e => set({ kyoku: Number(e.target.value) })}>
            {[1, 2, 3].map(k => (
              <option key={k} value={k}>
                {k}局
              </option>
            ))}
          </select>
          <select value={board.dealer} onChange={e => set({ dealer: Number(e.target.value) })}>
            {SEAT_LABELS.map((l, i) => (
              <option key={i} value={i}>
                親：{names[i].trim() || l}
              </option>
            ))}
          </select>
        </div>
        <div className="mjb-row">
          <span className="mjb-row-label">本場</span>
          <button className="mjb-btn small" onClick={() => set({ honba: Math.max(0, board.honba - 1) })}>
            −
          </button>
          <span className="mjb-row-value">{board.honba}</span>
          <button className="mjb-btn small" onClick={() => set({ honba: board.honba + 1 })}>
            ＋
          </button>
          <span className="mjb-row-label">供託</span>
          <button className="mjb-btn small" onClick={() => set({ kyotaku: Math.max(0, board.kyotaku - 1) })}>
            −
          </button>
          <span className="mjb-row-value">{board.kyotaku}</span>
          <button className="mjb-btn small" onClick={() => set({ kyotaku: board.kyotaku + 1 })}>
            ＋
          </button>
        </div>

        <div className="mjb-dialog-sub">新しく始める</div>
        <div className="mjb-row">
          <span className="mjb-row-label">持ち点</span>
          <select value={start} onChange={e => setStart(Number(e.target.value))}>
            {[35000, 40000, 30000, 25000].map(p => (
              <option key={p} value={p}>
                {formatK(p)}
              </option>
            ))}
          </select>
          {confirmReset ? (
            <>
              <button
                className="mjb-btn danger"
                onClick={() => {
                  onChange(newBoard(start, names))
                  setConfirmReset(false)
                  onClose()
                }}
              >
                本当にリセット
              </button>
              <button className="mjb-btn ghost" onClick={() => setConfirmReset(false)}>
                やめる
              </button>
            </>
          ) : (
            <button className="mjb-btn" onClick={() => setConfirmReset(true)}>
              東1局から
            </button>
          )}
        </div>
        <p className="mjb-note">リセットしても「戻す」で元に戻せます。</p>

        <div className="mjb-dialog-actions">
          <button className="mjb-btn primary" onClick={close}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
