import { useState, useEffect } from 'react'
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
  const [dealingCards, setDealingCards] = useState<number[]>([])
  const [isDealing, setIsDealing] = useState(false)

  const handleDeal = () => {
    setIsDealing(true)
    setDealingCards([])
    deal()
  }

  useEffect(() => {
    if (state.stage === 'preflop' && isDealing) {
      const totalCards = playerCount * 2
      let cardIndex = 0
      const interval = setInterval(() => {
        if (cardIndex < totalCards) {
          setDealingCards(prev => [...prev, cardIndex])
          cardIndex++
        } else {
          clearInterval(interval)
          setIsDealing(false)
        }
      }, 150)
      return () => clearInterval(interval)
    }
  }, [state.stage, isDealing, playerCount])

  const handleRiverReveal = () => {
    if (state.stage === 'turn') {
      const interval = setInterval(() => {
        setRiverSqueezeProgress(prev => {
          const newProgress = Math.min(prev + 15, 100)
          if (newProgress >= 100) {
            clearInterval(interval)
            setTimeout(() => dealRiver(), 200)
          }
          return newProgress
        })
      }, 80)
    }
  }

  const handleReset = () => {
    setRiverSqueezeProgress(0)
    setDealingCards([])
    setIsDealing(false)
    reset()
  }

  const getStageButton = () => {
    switch (state.stage) {
      case 'setup':
        return <button className="action-btn deal-btn" onClick={handleDeal}>Deal</button>
      case 'preflop':
        return <button className="action-btn" onClick={dealFlop} disabled={isDealing}>Flop</button>
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

  const isCardVisible = (playerIndex: number, cardIndex: number) => {
    if (state.stage === 'setup') return false
    const dealIndex = playerIndex * 2 + cardIndex
    return dealingCards.includes(dealIndex) || !isDealing
  }

  const renderPlayerSlots = () => {
    const count = state.stage === 'setup' ? playerCount : state.players.length
    return Array.from({ length: count }, (_, i) => {
      const player = state.players[i]
      const isWinner = player?.rank === 1
      return (
        <div key={i} className={'player-slot' + (isWinner ? ' winner' : '')} data-position={i}>
          <div className="player-info-badge">
            <span className="player-label">P{i + 1}</span>
            {player && (
              <>
                <span className="player-equity">{player.equity.toFixed(1)}%</span>
                {player.rank !== null && (
                  <span className={'player-rank rank-' + player.rank}>{getRankLabel(player.rank)}</span>
                )}
              </>
            )}
          </div>
          <div className="player-hand">
            {player ? (
              <>
                {isCardVisible(i, 0) ? (
                  <div className={isDealing && dealingCards.includes(i * 2) ? 'card-dealing' : ''}>
                    <CardView card={player.hand[0]} size="small" />
                  </div>
                ) : <div className="card-empty" />}
                {isCardVisible(i, 1) ? (
                  <div className={isDealing && dealingCards.includes(i * 2 + 1) ? 'card-dealing' : ''}>
                    <CardView card={player.hand[1]} size="small" />
                  </div>
                ) : <div className="card-empty" />}
              </>
            ) : (
              <>
                <div className="card-empty" />
                <div className="card-empty" />
              </>
            )}
          </div>
        </div>
      )
    })
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Flipout</h1>
        {state.stage === 'setup' ? (
          <div className="player-select">
            <label>Players:</label>
            <select value={playerCount} onChange={(e) => setPlayerCount(Number(e.target.value))}>
              {[2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        ) : (
          <button className="reset-small" onClick={handleReset}>Reset</button>
        )}
      </header>

      <main className="main">
        <div className="poker-table-container">
          <div className="poker-table">
            <section className="board-section">
              {state.stage === 'setup' ? (
                <div className="setup-message">
                  <p>プレイヤー数を選択して</p>
                  <p>Dealを押してください</p>
                </div>
              ) : (
                <>
                  <div className="board">
                    {[0, 1, 2, 3, 4].map(i => {
                      const card = state.board[i]
                      if (!card && state.stage === 'turn' && i === 4) {
                        return riverSqueezeProgress > 0 ? (
                          <CardView key={i} card={state.deck[0]} squeeze squeezeProgress={riverSqueezeProgress} size="medium" />
                        ) : (
                          <CardView key={i} card={state.deck[0]} faceDown size="medium" />
                        )
                      }
                      if (!card) return <div key={i} className="card-empty" style={{ width: 44, height: 62 }} />
                      return <CardView key={i} card={card} size="medium" />
                    })}
                  </div>
                  {state.winnerHandName && <div className="winner-hand">{state.winnerHandName}</div>}
                </>
              )}
            </section>
          </div>
          <div className="players-ring" data-count={state.stage === 'setup' ? playerCount : state.players.length}>
            {renderPlayerSlots()}
          </div>
        </div>
      </main>

      <footer className="footer">{getStageButton()}</footer>
    </div>
  )
}

export default App
