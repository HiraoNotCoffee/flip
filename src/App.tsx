import { useState, useEffect, useRef } from 'react'
import { useGame } from './hooks/useGame'
import { CardView } from './components/CardView'
import { ChipCalculator } from './components/ChipCalculator'
import './App.css'

type Page = 'flip' | 'chip'

function App() {
  const {
    state,
    playerCount,
    setPlayerCount,
    specialMode,
    setSpecialMode,
    deal,
    dealFlop,
    dealTurn,
    dealRiver,
    reset
  } = useGame()

  // Page / menu state
  const [page, setPage] = useState<Page>('flip')
  const [menuOpen, setMenuOpen] = useState(false)

  // Track which cards have been dealt/revealed (for animations)
  const [dealtCards, setDealtCards] = useState<number>(0)
  const [revealedBoardCards, setRevealedBoardCards] = useState<number>(0)

  // Results display state
  const [showResults, setShowResults] = useState(false)

  // Store previous equity values (before river)
  const prevEquities = useRef<number[]>([])

  // Reset animation states when game resets
  useEffect(() => {
    if (state.stage === 'setup') {
      setDealtCards(0)
      setRevealedBoardCards(0)
      setShowResults(false)
      prevEquities.current = []
    }
  }, [state.stage])

  // Save equity before river is dealt
  useEffect(() => {
    if (state.stage === 'turn' && state.players.length > 0) {
      prevEquities.current = state.players.map(p => p.equity)
    }
  }, [state.stage, state.players])

  // Deal cards one by one animation
  useEffect(() => {
    if (state.stage === 'preflop' && dealtCards < playerCount * 2) {
      const timer = setTimeout(() => {
        setDealtCards(prev => prev + 1)
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [state.stage, dealtCards, playerCount])

  // Board reveal animation - flop (3 cards one by one)
  useEffect(() => {
    if (state.stage === 'flop' && revealedBoardCards < 3) {
      const timer = setTimeout(() => {
        setRevealedBoardCards(prev => prev + 1)
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [state.stage, revealedBoardCards])

  // Board reveal animation - turn (4th card)
  useEffect(() => {
    if (state.stage === 'turn' && revealedBoardCards < 4) {
      const timer = setTimeout(() => {
        setRevealedBoardCards(4)
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [state.stage, revealedBoardCards])

  // Board reveal animation - river (5th card - wait for flip)
  useEffect(() => {
    if (state.stage === 'river' && revealedBoardCards < 5) {
      const timer = setTimeout(() => {
        setRevealedBoardCards(5)
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [state.stage, revealedBoardCards])

  // Show results after river card is revealed
  useEffect(() => {
    if (state.stage === 'river' && revealedBoardCards >= 5) {
      const timer = setTimeout(() => {
        setShowResults(true)
      }, 400) // Wait for card animation to complete
      return () => clearTimeout(timer)
    }
  }, [state.stage, revealedBoardCards])

  const handleReset = () => {
    reset()
  }

  const handleAction = () => {
    switch (state.stage) {
      case 'setup':
        deal()
        break
      case 'preflop':
        if (dealtCards >= playerCount * 2) dealFlop()
        break
      case 'flop':
        if (revealedBoardCards >= 3) dealTurn()
        break
      case 'turn':
        if (revealedBoardCards >= 4) dealRiver()
        break
      case 'river':
        handleReset()
        break
    }
  }

  const getActionLabel = () => {
    switch (state.stage) {
      case 'setup':
        return 'DEAL'
      case 'preflop':
        return 'FLOP'
      case 'flop':
        return 'TURN'
      case 'turn':
        return 'RIVER'
      case 'river':
        return 'RESET'
      default:
        return 'DEAL'
    }
  }

  const isActionDisabled = () => {
    if (state.stage === 'preflop' && dealtCards < playerCount * 2) return true
    if (state.stage === 'flop' && revealedBoardCards < 3) return true
    if (state.stage === 'turn' && revealedBoardCards < 4) return true
    if (state.stage === 'river' && !showResults) return true
    return false
  }

  const renderPlayerSlot = (index: number) => {
    const player = state.players[index]
    const slotActive = index < playerCount

    if (!slotActive) return null

    if (state.stage === 'setup') {
      return (
        <div key={index} className="player-slot">
          <div className="player-cards">
            <CardView card={null} size="medium" />
            <CardView card={null} size="medium" />
          </div>
          <div className="player-info">
            <div className="player-info-badge">
              <span className="player-label">P{index + 1}</span>
            </div>
          </div>
        </div>
      )
    }

    const cardIndex1 = index * 2
    const cardIndex2 = index * 2 + 1
    const showCard1 = dealtCards > cardIndex1
    const showCard2 = dealtCards > cardIndex2

    const isWinner = showResults && player?.rank === 1

    // Show previous equity until river is revealed
    const displayEquity = state.stage === 'river' && !showResults
      ? prevEquities.current[index] ?? player?.equity ?? 0
      : player?.equity ?? 0

    return (
      <div key={index} className={`player-slot ${isWinner ? 'winner' : ''}`}>
        <div className="player-cards">
          {showCard1 ? (
            <div className="card-dealing">
              <CardView card={player?.hand[0] || null} size="medium" />
            </div>
          ) : (
            <CardView card={null} size="medium" />
          )}
          {showCard2 ? (
            <div className="card-dealing">
              <CardView card={player?.hand[1] || null} size="medium" />
            </div>
          ) : (
            <CardView card={null} size="medium" />
          )}
        </div>
        <div className="player-info">
          <div className="player-info-badge">
            <span className="player-label">P{index + 1}</span>
          </div>
          {player && (
            <div className="player-info-badge">
              <span className="player-equity">{displayEquity.toFixed(1)}%</span>
            </div>
          )}
          {showResults && player?.rank && (
            <div className={`player-info-badge player-rank rank-${player.rank}`}>
              #{player.rank}
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderBoard = () => {
    const boardCards = state.board

    return (
      <div className="board">
        {[0, 1, 2, 3, 4].map(i => {
          const card = boardCards[i] || null
          const isRevealed = i < revealedBoardCards
          const isRiverCard = i === 4

          if (!card) {
            return <div key={i} className="card-empty" />
          }

          // River card - just show it smoothly
          if (isRiverCard && state.stage === 'river' && isRevealed) {
            return (
              <div key={i} className="card-flipping">
                <CardView card={card} size="board" />
              </div>
            )
          }

          if (!isRevealed) {
            return <div key={i} className="card-empty" />
          }

          return (
            <div key={i} className="card-flipping">
              <CardView card={card} size="board" />
            </div>
          )
        })}
      </div>
    )
  }

  const selectPage = (p: Page) => {
    setPage(p)
    setMenuOpen(false)
  }

  return (
    <div className={`app ${specialMode && page === 'flip' ? 'special-mode' : ''}`}>
      <header className="header">
        <div className="header-left">
          <button className="hamburger-btn" onClick={() => setMenuOpen(o => !o)}>
            ☰
          </button>
          <h1>{page === 'flip' ? 'Texas Holdem Flipout' : 'Chip Calculator'}</h1>
        </div>
        {page === 'flip' && (
          <div className="header-controls">
            <label className="special-toggle">
              <input
                type="checkbox"
                checked={specialMode}
                onChange={e => setSpecialMode(e.target.checked)}
                disabled={state.stage !== 'setup'}
              />
              <span className="toggle-slider" />
              <span className="toggle-label">SP</span>
            </label>
            <div className="player-select">
              <label>Players:</label>
              <select
                value={playerCount}
                onChange={e => setPlayerCount(Number(e.target.value))}
                disabled={state.stage !== 'setup'}
              >
                {[2, 3, 4, 5, 6, 7, 8].map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              {state.stage !== 'setup' && (
                <button className="reset-small" onClick={handleReset}>
                  Reset
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Menu overlay */}
      {menuOpen && (
        <div className="menu-overlay" onClick={() => setMenuOpen(false)}>
          <nav className="menu-panel" onClick={e => e.stopPropagation()}>
            <button
              className={`menu-item ${page === 'flip' ? 'active' : ''}`}
              onClick={() => selectPage('flip')}
            >
              Flip
            </button>
            <button
              className={`menu-item ${page === 'chip' ? 'active' : ''}`}
              onClick={() => selectPage('chip')}
            >
              Chip Calculator
            </button>
          </nav>
        </div>
      )}

      {page === 'flip' ? (
        <>
          <main className="main">
            <div className="poker-table-container">
              <div className="poker-table" />
            </div>

            <div className="players-grid">
              {Array.from({ length: 8 }, (_, i) => renderPlayerSlot(i))}
            </div>

            <div className="board-section">
              {renderBoard()}
              {showResults && state.winnerHandName && (
                <div className="winner-hand">{state.winnerHandName}</div>
              )}
            </div>
          </main>

          <footer className="footer">
            <button
              className={`action-btn ${state.stage === 'setup' ? 'deal-btn' : state.stage === 'river' ? 'reset-btn' : ''} ${state.stage === 'turn' ? 'squeeze-btn' : ''}`}
              onClick={handleAction}
              disabled={isActionDisabled()}
            >
              {getActionLabel()}
            </button>
          </footer>
        </>
      ) : (
        <ChipCalculator />
      )}
    </div>
  )
}

export default App