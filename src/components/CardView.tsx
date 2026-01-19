import { useRef } from 'react'
import type { Card } from '../utils/card'
import { suitSymbol, suitColor, rankToString } from '../utils/card'
import './CardView.css'

interface CardViewProps {
  card: Card | null
  faceDown?: boolean
  flip?: boolean
  flipped?: boolean
  onFlip?: () => void
  size?: 'small' | 'medium' | 'large'
}

export function CardView({
  card,
  faceDown = false,
  flip = false,
  flipped = false,
  onFlip,
  size = 'medium'
}: CardViewProps) {
  const touchStartX = useRef<number>(0)
  const touchStartY = useRef<number>(0)

  if (!card) {
    return <div className={`card card-placeholder card-${size}`} />
  }

  const color = suitColor[card.suit]
  const symbol = suitSymbol[card.suit]
  const rank = rankToString(card.rank)

  // Swipe handling for flip
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!onFlip || flipped) return

    const touchEndX = e.changedTouches[0].clientX
    const touchEndY = e.changedTouches[0].clientY
    const deltaX = touchEndX - touchStartX.current
    const deltaY = Math.abs(touchEndY - touchStartY.current)

    // Swipe left to flip (at least 30px horizontal, less than 50px vertical)
    if (deltaX < -30 && deltaY < 50) {
      onFlip()
    }
  }

  // 3D flip animation mode - poker app style with swipe
  if (flip) {
    return (
      <div
        className={`card-flip-container card-${size}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onClick={() => !flipped && onFlip?.()}
      >
        <div className={`card-flip-inner card-${size} ${flipped ? 'flipped' : ''}`}>
          {/* Back of card */}
          <div className="card-flip-back">
            <div className="card-back-pattern" />
          </div>
          {/* Front of card */}
          <div className="card-flip-front" style={{ color }}>
            <div className="card-corner top-left">
              <span className="card-rank">{rank}</span>
              <span className="card-suit">{symbol}</span>
            </div>
            <div className="card-center">
              <span className="card-suit-large">{symbol}</span>
            </div>
            <div className="card-corner bottom-right">
              <span className="card-rank">{rank}</span>
              <span className="card-suit">{symbol}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (faceDown) {
    return (
      <div
        className={`card card-back card-${size}`}
        onClick={onFlip}
      >
        <div className="card-back-pattern" />
      </div>
    )
  }

  return (
    <div className={`card card-${size}`} style={{ color }}>
      <div className="card-corner top-left">
        <span className="card-rank">{rank}</span>
        <span className="card-suit">{symbol}</span>
      </div>
      <div className="card-center">
        <span className="card-suit-large">{symbol}</span>
      </div>
      <div className="card-corner bottom-right">
        <span className="card-rank">{rank}</span>
        <span className="card-suit">{symbol}</span>
      </div>
    </div>
  )
}
