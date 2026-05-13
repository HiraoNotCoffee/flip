import { useMemo, useState } from 'react'
import gtoTable from '../utils/gtoTable_HU.json'
import './GtoRange.css'

type RakeKey = 'cap_3bb' | 'cap_4bb' | 'cap_5bb'

interface NodeData {
  player: 'SB' | 'BB'
  actions: string[]
  strategy: Record<string, number[]>
}

interface ScenarioData {
  meta: {
    scenario: string
    stack_bb: number
    rake_pct: number
    rake_cap_bb: number
    iterations: number
  }
  nodes: Record<string, NodeData>
}

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']

function cellHand(rowIdx: number, colIdx: number): string {
  const r1 = RANKS[rowIdx]
  const r2 = RANKS[colIdx]
  if (rowIdx === colIdx) return r1 + r2
  if (rowIdx < colIdx) return r1 + r2 + 's'
  return r2 + r1 + 'o'
}

function actionColor(action: string): string {
  if (action === 'fold') return '#5a5a5a'
  if (action === 'limp') return '#d4a017'
  if (action === 'check') return '#3b8ed0'
  if (action === 'call') return '#2e8b57'
  if (action.startsWith('open')) return '#c0392b'
  if (action.startsWith('3bet')) return '#a93226'
  if (action.startsWith('4bet')) return '#7b241c'
  if (action.startsWith('raise')) return '#a93226'
  if (action.includes('allin')) return '#6c3483'
  return '#888'
}

function cellGradient(actions: string[], probs: number[]): string {
  let acc = 0
  const stops: string[] = []
  for (let i = 0; i < actions.length; i++) {
    const p = probs[i]
    if (p <= 0.001) continue
    const start = acc * 100
    const end = (acc + p) * 100
    const color = actionColor(actions[i])
    stops.push(`${color} ${start.toFixed(2)}% ${end.toFixed(2)}%`)
    acc += p
  }
  if (stops.length === 0) return '#222'
  if (stops.length === 1) {
    return stops[0].split(' ')[0]
  }
  return `linear-gradient(to right, ${stops.join(', ')})`
}

export function GtoRange() {
  const [rakeKey, setRakeKey] = useState<RakeKey>('cap_5bb')
  const [nodePath, setNodePath] = useState<string>('root')

  const scenario = (gtoTable as { rake_caps: Record<RakeKey, ScenarioData> }).rake_caps[rakeKey]
  const node = scenario.nodes[nodePath]

  const breadcrumb = useMemo(() => {
    if (nodePath === 'root') return ['root']
    return ['root', ...nodePath.split('/')]
  }, [nodePath])

  function navigateTo(targetIndex: number) {
    if (targetIndex === 0) {
      setNodePath('root')
      return
    }
    const parts = nodePath.split('/').slice(0, targetIndex)
    setNodePath(parts.join('/'))
  }

  function drillDown(action: string) {
    const next = nodePath === 'root' ? action : `${nodePath}/${action}`
    if (scenario.nodes[next]) setNodePath(next)
  }

  const childActions = node.actions.filter(a => {
    const next = nodePath === 'root' ? a : `${nodePath}/${a}`
    return scenario.nodes[next] !== undefined
  })

  return (
    <div className="gto-range">
      <div className="gto-controls">
        <div className="gto-rake-tabs">
          {(['cap_3bb', 'cap_4bb', 'cap_5bb'] as RakeKey[]).map(k => (
            <button
              key={k}
              className={`gto-rake-tab ${k === rakeKey ? 'active' : ''}`}
              onClick={() => setRakeKey(k)}
            >
              {k.replace('cap_', '').replace('bb', ' bb cap')}
            </button>
          ))}
        </div>

        <div className="gto-breadcrumb">
          {breadcrumb.map((part, i) => (
            <span key={i} className="gto-bc-item">
              <button onClick={() => navigateTo(i)} className="gto-bc-btn">
                {part}
              </button>
              {i < breadcrumb.length - 1 && <span className="gto-bc-sep">›</span>}
            </span>
          ))}
        </div>

        <div className="gto-node-info">
          <span className="gto-player-badge">{node.player}</span>
          <span className="gto-actions-label">to act:</span>
          {node.actions.map(a => (
            <span key={a} className="gto-action-chip" style={{ background: actionColor(a) }}>
              {a}
            </span>
          ))}
        </div>

        {childActions.length > 0 && (
          <div className="gto-drill">
            <span className="gto-drill-label">drill into:</span>
            {childActions.map(a => (
              <button key={a} className="gto-drill-btn" onClick={() => drillDown(a)}>
                {a} ›
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="gto-grid-wrapper">
        <div className="gto-grid">
          {Array.from({ length: 13 }, (_, row) =>
            Array.from({ length: 13 }, (_, col) => {
              const hand = cellHand(row, col)
              const probs = node.strategy[hand] ?? []
              const bg = cellGradient(node.actions, probs)
              return (
                <div key={`${row}-${col}`} className="gto-cell" style={{ background: bg }}>
                  <span className="gto-cell-label">{hand}</span>
                </div>
              )
            }),
          )}
        </div>
      </div>

      <div className="gto-legend">
        {node.actions.map(a => (
          <div key={a} className="gto-legend-item">
            <span className="gto-legend-swatch" style={{ background: actionColor(a) }} />
            <span>{a}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
