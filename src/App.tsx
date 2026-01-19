import { useState } from 'react'
import { useGame } from './hooks/useGame'
import { CardView } from './components/CardView'
import './App.css'

function App() {
  const {
    state,
    playerCount,
    setPlayerCount,
    deal,
    dealFlop,
    dealTurn,
    dealRiver,
    reset
  } = useGame()

  const [riverSqueezeProgress, setRiverSqueezeProgress] = useState(0)

  const handleRiverReveal = () => {
    if (state.stage === 'turn') {
      const interval = setInterval(() => {
        setRiverSqueezeProgress(prev => {
          const newProgress = Math.min(prev + 15, 100)
          if (newProgress >= 100) {
            clearInterval(interval)
            setTimeout(() => {
              dealRiver()
            }, 200)
          }
          return newProgress
        })
      }, 80)
    }
  }

  const handleReset = () => {
    setRiverSqueezeProgress(0)
    reset()
  }

  const getStageButton = () => {
    switch (state.stage) {
      case 'setup':
        return <button className="action-btn deal-btn" onClick={deal}>Deal</button>
      case 'preflop':
        return <button className="action-btn" onClick={dealFlop}>Flop</button>
      case 'flop':
        return <button className="action-btn" onClick={dealTurn}>Turn</button>
      case 'turn':
        return <button className="action-btn squeeze-btn" onClick={handleRiverReveal}>River</button>
      case 'river':
        return <button className="action-btn reset-btn" onClick={handleReset}>Reset</button>
      default:
        return null
    }
  }

  const getRankLabel = (rank: number | null) => {
    if (rank === null) return ''
    if (rank === 1) return '1st'
    if (rank === 2) return '2nd'
    if (rank === 3) return '3rd'
    return rank + 'th'
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Flipout</h1>
        {state.stage === 'setup' && (
          <div className="player-select">
            <label>Players:</label>
            <select
              value={playerCount}
              onChange={(e) => setPlayerCount(Number(e.target.value))}
            >
              {[2, 3, 4, 5, 6, 7, 8].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        )}
        {state.stage !== 'setup' && (
          <button className="reset-small" onClick={handleReset}>Reset</button>
        )}
      </header>

      <main className="main">
        {state.stage !== 'setup' && (
          <>
            <section className="board-section">
              <div className="board">
                {[0, 1, 2, 3, 4].map(i => {
                  const card = state.board[i]
                  const isRiver = i === 4

                  if (!card && state.stage === 'turn' && isRiver && riverSqueezeProgress > 0) {
                    return (
                      <CardView
                        key={i}
                        card={state.deck[0]}
                        squeeze={true}
                        squeezeProgress={riverSqueezeProgress}
                        size="large"
                      />
                    )
                  }

                  if (!card && state.stage === 'turn' && isRiver) {
                    return (
                      <CardView
                        key={i}
                        card={state.deck[0]}
                        faceDown={true}
                        size="large"
                      />
                    )
                  }

                  return (
                    <CardView
                      key={i}
                      card={card || null}
                      size="large"
                    />
                  )
                })}
              </div>
              {state.winnerHandName && (
                <div className="winner-hand">{state.winnerHandName}</div>
              )}
            </section>

            <section className="players-section">
              {state.players.map((player) => (
                <div
                  key={player.id}
                  className={'player' + (player.rank === 1 ? ' winner' : '')}
                >
                  <div className="player-info">
                    <span className="player-label">P{player.id}</span>
                    <span className="player-equity">{player.equity.toFixed(1)}%</span>
                    {player.rank !== null && (
                      <span className={'player-rank rank-' + player.rank}>
                        {getRankLabel(player.rank)}
                      </span>
                    )}
                  </div>
                  <div className="player-hand">
                    <CardView card={player.hand[0]} size="medium" />
                    <CardView card={player.hand[1]} size="medium" />
                  </div>
                </div>
              ))}
            </section>
          </>
        )}

        {state.stage === 'setup' && (
          <div className="setup-message">
            <p>プレイヤー数を選択して</p>
            <p>Dealボタンを押してください</p>
          </div>
        )}
      </main>

      <footer className="footer">
        {getStageButton()}
      </footer>
    </div>
  )
}

export default App
