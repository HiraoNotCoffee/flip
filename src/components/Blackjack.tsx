import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  NUM_RANKS,
  initialRemaining,
  totalRemaining,
  remainingDecks,
  probabilities,
  conditionalProbabilities,
  runningCount,
  trueCount,
  DEFAULT_WEIGHTS,
  WEIGHT_PRESETS,
} from '../utils/blackjackCount'
import {
  RANK_LABELS,
  HARD_STRATEGY,
  SOFT_STRATEGY,
  PAIR_STRATEGY,
  ACTION_COLOR,
  ACTION_LABEL,
  ACTION_DESC,
  DEVIATIONS,
  basicAction,
  actionWithDeviation,
  type Action,
  type RankIndex,
} from '../utils/blackjackStrategy'
import './Blackjack.css'

const STORAGE_KEY = 'blackjack-data-v1'

interface BlackjackData {
  decks: number
  remaining: number[]
  weights: number[]
  history: number[] // 押したランクの履歴（undo 用）
}

function defaultData(decks = 8): BlackjackData {
  return {
    decks,
    remaining: initialRemaining(decks),
    weights: [...DEFAULT_WEIGHTS],
    history: [],
  }
}

function loadData(): BlackjackData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const d = JSON.parse(raw) as BlackjackData
      if (
        Array.isArray(d.remaining) && d.remaining.length === NUM_RANKS &&
        Array.isArray(d.weights) && d.weights.length === NUM_RANKS
      ) {
        return { ...d, history: Array.isArray(d.history) ? d.history : [] }
      }
    }
  } catch {
    // ignore
  }
  return defaultData()
}

function saveData(data: BlackjackData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

type TableView = 'hard' | 'soft' | 'pair'

export function Blackjack() {
  const [data, setData] = useState<BlackjackData>(loadData)
  const [tableView, setTableView] = useState<TableView>('hard')
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    saveData(data)
  }, [data])

  const initial = useMemo(() => initialRemaining(data.decks), [data.decks])
  const totalRem = totalRemaining(data.remaining)
  const remDecks = remainingDecks(data.remaining)
  const probs = useMemo(() => probabilities(data.remaining), [data.remaining])
  const probsNo10 = useMemo(() => conditionalProbabilities(data.remaining, 9), [data.remaining])
  const probsNoA = useMemo(() => conditionalProbabilities(data.remaining, 0), [data.remaining])
  const rc = useMemo(() => runningCount(initial, data.remaining, data.weights), [initial, data.remaining, data.weights])
  const tc = trueCount(rc, remDecks)

  const decrement = useCallback((idx: number) => {
    setData(prev => {
      if (prev.remaining[idx] <= 0) return prev
      const next = [...prev.remaining]
      next[idx] -= 1
      return { ...prev, remaining: next, history: [...prev.history, idx] }
    })
  }, [])

  const increment = useCallback((idx: number) => {
    setData(prev => {
      if (prev.remaining[idx] >= initial[idx]) return prev
      const next = [...prev.remaining]
      next[idx] += 1
      // history からは追えないので（明示的な+1）、history は維持
      return { ...prev, remaining: next }
    })
  }, [initial])

  const undo = useCallback(() => {
    setData(prev => {
      if (prev.history.length === 0) return prev
      const last = prev.history[prev.history.length - 1]
      const next = [...prev.remaining]
      const cap = initialRemaining(prev.decks)[last]
      if (next[last] < cap) next[last] += 1
      return { ...prev, remaining: next, history: prev.history.slice(0, -1) }
    })
  }, [])

  const resetShoe = useCallback(() => {
    setData(prev => ({ ...prev, remaining: initialRemaining(prev.decks), history: [] }))
  }, [])

  const changeDecks = useCallback((decks: number) => {
    setData(prev => ({ ...prev, decks, remaining: initialRemaining(decks), history: [] }))
  }, [])

  const setWeight = useCallback((idx: number, w: number) => {
    setData(prev => {
      const ws = [...prev.weights]
      ws[idx] = w
      return { ...prev, weights: ws }
    })
  }, [])

  const applyPreset = useCallback((presetName: string) => {
    const p = WEIGHT_PRESETS.find(x => x.name === presetName)
    if (!p) return
    setData(prev => ({ ...prev, weights: [...p.weights] }))
  }, [])

  return (
    <div className="blackjack">
      {/* ─────────── カウンタ ─────────── */}
      <section className="bj-section bj-counter">
        <div className="bj-section-head">
          <h2>残り枚数</h2>
          <div className="bj-head-actions">
            <button onClick={undo} disabled={data.history.length === 0}>↶ Undo</button>
            <button onClick={resetShoe}>新シュー</button>
            <button onClick={() => setShowSettings(s => !s)}>{showSettings ? '✕' : '⚙'}</button>
          </div>
        </div>

        <div className="bj-card-grid">
          {RANK_LABELS.map((label, i) => {
            const n = data.remaining[i]
            const cap = initial[i]
            const ratio = cap === 0 ? 0 : n / cap
            return (
              <div key={i} className="bj-card-cell">
                <button
                  className="bj-card-btn"
                  onClick={() => decrement(i)}
                  disabled={n <= 0}
                >
                  <div className="bj-card-label">{label}</div>
                  <div className="bj-card-remain">{n}</div>
                  <div className="bj-card-cap">/{cap}</div>
                  <div className="bj-card-bar">
                    <div
                      className="bj-card-bar-fill"
                      style={{
                        width: `${ratio * 100}%`,
                        background: ratio > 0.5 ? '#27ae60' : ratio > 0.25 ? '#f39c12' : '#e74c3c',
                      }}
                    />
                  </div>
                </button>
                <button className="bj-plus" onClick={() => increment(i)} disabled={n >= cap}>+1</button>
              </div>
            )
          })}
        </div>
      </section>

      {/* ─────────── 統計 ─────────── */}
      <section className="bj-section bj-stats">
        <h2>統計</h2>
        <div className="bj-stat-row">
          <div className="bj-stat">
            <span className="bj-stat-label">残デッキ</span>
            <span className="bj-stat-value">{remDecks.toFixed(2)}</span>
          </div>
          <div className="bj-stat">
            <span className="bj-stat-label">残枚数</span>
            <span className="bj-stat-value">{totalRem}</span>
          </div>
          <div className="bj-stat">
            <span className="bj-stat-label">RC</span>
            <span className={`bj-stat-value ${rc > 0 ? 'pos' : rc < 0 ? 'neg' : ''}`}>{rc.toFixed(1)}</span>
          </div>
          <div className="bj-stat">
            <span className="bj-stat-label">TC</span>
            <span className={`bj-stat-value big ${tc > 0 ? 'pos' : tc < 0 ? 'neg' : ''}`}>{tc.toFixed(2)}</span>
          </div>
        </div>

        <details className="bj-prob-details">
          <summary>確率テーブル</summary>
          <table className="bj-prob-table">
            <thead>
              <tr>
                <th></th>
                {RANK_LABELS.map(r => <th key={r}>{r}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>生確率</th>
                {probs.map((p, i) => <td key={i}>{(p * 100).toFixed(2)}%</td>)}
              </tr>
              <tr>
                <th>10抜き</th>
                {probsNo10.map((p, i) => <td key={i}>{i === 9 ? '—' : (p * 100).toFixed(2) + '%'}</td>)}
              </tr>
              <tr>
                <th>A抜き</th>
                {probsNoA.map((p, i) => <td key={i}>{i === 0 ? '—' : (p * 100).toFixed(2) + '%'}</td>)}
              </tr>
            </tbody>
          </table>
        </details>
      </section>

      {/* ─────────── 設定 ─────────── */}
      {showSettings && (
        <section className="bj-section bj-settings">
          <h2>設定</h2>
          <div className="bj-setting-row">
            <label>デッキ数</label>
            <select value={data.decks} onChange={e => changeDecks(Number(e.target.value))}>
              {[1, 2, 4, 6, 8].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="bj-setting-row">
            <label>カウント系統</label>
            <select onChange={e => applyPreset(e.target.value)} defaultValue="">
              <option value="" disabled>プリセット選択...</option>
              {WEIGHT_PRESETS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <div className="bj-weights">
            <div className="bj-weights-head">重み（編集可）</div>
            <div className="bj-weights-grid">
              {RANK_LABELS.map((label, i) => (
                <div key={i} className="bj-weight-cell">
                  <div className="bj-weight-label">{label}</div>
                  <input
                    type="number"
                    step="0.5"
                    value={data.weights[i]}
                    onChange={e => setWeight(i, Number(e.target.value))}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ─────────── 戦略表 ─────────── */}
      <section className="bj-section bj-strategy">
        <div className="bj-section-head">
          <h2>戦略表</h2>
          <div className="bj-tab-group">
            <button className={tableView === 'hard' ? 'active' : ''} onClick={() => setTableView('hard')}>Hard</button>
            <button className={tableView === 'soft' ? 'active' : ''} onClick={() => setTableView('soft')}>Soft</button>
            <button className={tableView === 'pair' ? 'active' : ''} onClick={() => setTableView('pair')}>Pair</button>
          </div>
        </div>

        <StrategyTable kind={tableView} trueCountValue={tc} />

        <div className="bj-legend">
          {(['H','S','D','Ds','P','Ph'] as Action[]).map(a => (
            <span key={a} className="bj-legend-item">
              <span className="bj-legend-swatch" style={{ background: ACTION_COLOR[a] }}>{ACTION_LABEL[a]}</span>
              {ACTION_DESC[a]}
            </span>
          ))}
          <span className="bj-legend-item">
            <span className="bj-legend-swatch bj-dev-swatch">★</span>
            現TCで基本戦略から偏差（デビエーション発動）
          </span>
        </div>

        <details className="bj-dev-list">
          <summary>デビエーション一覧（{DEVIATIONS.length}件）</summary>
          <ul>
            {DEVIATIONS.map((d, i) => {
              const active = d.threshold >= 0 ? tc >= d.threshold : tc <= d.threshold
              return (
                <li key={i} className={active ? 'active' : ''}>
                  <span className="bj-dev-note">{d.note}</span>
                  <span className="bj-dev-cond">
                    TC {d.threshold >= 0 ? '≥' : '≤'} {d.threshold} → {ACTION_LABEL[d.action]}
                  </span>
                  {active && <span className="bj-dev-active">★現在発動中</span>}
                </li>
              )
            })}
          </ul>
        </details>

        {Math.abs(tc) >= 3 && (
          <div className={`bj-insurance ${tc >= 3 ? 'buy' : 'pass'}`}>
            {tc >= 3
              ? `Insurance: BUY（TC ${tc.toFixed(2)} ≥ +3）`
              : `Insurance: PASS（TC ${tc.toFixed(2)}）`}
          </div>
        )}
      </section>
    </div>
  )
}

interface StrategyTableProps {
  kind: TableView
  trueCountValue: number
}

function StrategyTable({ kind, trueCountValue }: StrategyTableProps) {
  // 行（プレイヤー側）の見出しと、各行のキー
  let rows: { label: string; total: number }[] = []
  let getActions: (rowIdx: number) => Action[] = () => []

  if (kind === 'hard') {
    rows = HARD_STRATEGY.map((_, i) => ({ label: String(i + 5), total: i + 5 }))
    getActions = (i) => HARD_STRATEGY[i]
  } else if (kind === 'soft') {
    rows = SOFT_STRATEGY.map((_, i) => ({ label: `A,${i + 2}`, total: i + 13 }))
    getActions = (i) => SOFT_STRATEGY[i]
  } else {
    rows = PAIR_STRATEGY.map((_, i) => ({ label: i === 0 ? 'A,A' : `${i === 9 ? 10 : i + 1},${i === 9 ? 10 : i + 1}`, total: i }))
    getActions = (i) => PAIR_STRATEGY[i]
  }

  return (
    <div className="bj-table-wrap">
      <table className="bj-strategy-table">
        <thead>
          <tr>
            <th className="bj-corner">Dealer →</th>
            {RANK_LABELS.map(r => <th key={r}>{r}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const basicRow = getActions(i)
            return (
              <tr key={i}>
                <th>{row.label}</th>
                {basicRow.map((basicAct, j) => {
                  const dealerIdx = j as RankIndex
                  const total = row.total
                  const { action, deviated } = actionWithDeviation(kind, total, dealerIdx, trueCountValue)
                  return (
                    <td
                      key={j}
                      style={{ background: ACTION_COLOR[action] }}
                      title={`${ACTION_DESC[action]}${deviated ? ` (基本: ${ACTION_LABEL[basicAct]})` : ''}`}
                    >
                      {ACTION_LABEL[action]}
                      {deviated && <span className="bj-dev-mark">★</span>}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// 未使用警告除けに参照
void basicAction
