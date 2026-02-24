import { useState, useEffect, useCallback } from 'react'
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
  players: ChipPlayer[]
}

const STORAGE_KEY = 'chip-calculator-data'

const defaultData: ChipData = {
  chipsPer100BB: 30000,
  buyInYen: 3000,
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
  return String(nextId++)
}

export function ChipCalculator() {
  const [data, setData] = useState<ChipData>(loadData)

  // Auto-save
  useEffect(() => {
    saveData(data)
  }, [data])

  const update = useCallback((partial: Partial<ChipData>) => {
    setData(prev => ({ ...prev, ...partial }))
  }, [])

  const updatePlayer = useCallback((id: string, partial: Partial<ChipPlayer>) => {
    setData(prev => ({
      ...prev,
      players: prev.players.map(p => (p.id === id ? { ...p, ...partial } : p)),
    }))
  }, [])

  const addPlayer = () => {
    const num = data.players.length + 1
    setData(prev => ({
      ...prev,
      players: [
        ...prev.players,
        { id: genId(), name: `Player ${num}`, rebuyCount: 1, finalChips: 0 },
      ],
    }))
  }

  const removePlayer = (id: string) => {
    setData(prev => ({
      ...prev,
      players: prev.players.filter(p => p.id !== id),
    }))
  }

  const handleReset = () => {
    setData({ ...defaultData, players: [] })
  }

  // Calculations
  const totalBuyInChips = data.players.reduce(
    (sum, p) => sum + data.chipsPer100BB * p.rebuyCount,
    0
  )
  const totalFinalChips = data.players.reduce((sum, p) => sum + p.finalChips, 0)
  const chipDiff = totalFinalChips - totalBuyInChips
  const totalInvestYen = data.players.reduce(
    (sum, p) => sum + data.buyInYen * p.rebuyCount,
    0
  )

  const calcPnl = (p: ChipPlayer) => {
    if (data.chipsPer100BB === 0) return 0
    const received = data.chipsPer100BB * p.rebuyCount
    return ((p.finalChips - received) / data.chipsPer100BB) * data.buyInYen
  }

  return (
    <div className="chip-calculator">
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
          const pnl = calcPnl(player)
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
                      disabled={player.rebuyCount <= 1}
                      onClick={() =>
                        updatePlayer(player.id, {
                          rebuyCount: Math.max(1, player.rebuyCount - 1),
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
                          rebuyCount: player.rebuyCount + 1,
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
          <div className={`chip-diff ${chipDiff === 0 ? 'match' : 'mismatch'}`}>
            {chipDiff === 0
              ? 'Chips match!'
              : `Chip difference: ${chipDiff > 0 ? '+' : ''}${chipDiff.toLocaleString()}`}
          </div>
        </div>
      )}

      {/* Reset */}
      <div className="chip-reset-section">
        <button className="chip-reset-btn" onClick={handleReset}>
          Reset
        </button>
      </div>
    </div>
  )
}
