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
  if (!card) {
    return <div className={`card card-placeholder card-${size}`} />
  }

  const color = suitColor[card.suit]
  const symbol = suitSymbol[card.suit]
  const rank = rankToString(card.rank)

  // 3D flip animation mode
  if (flip) {
    return (
      <div className={`card-flip-container card-${size}`} onClick={onFlip}>
        <div className={`card-flip-inner ${flipped ? 'flipped' : ''}`}>
          {/* Back of card */}
          <div className={`card card-back card-flip-back card-${size}`}>
            <div className="card-back-pattern" />
          </div>
          {/* Front of card */}
          <div className={`card card-flip-front card-${size}`} style={{ color }}>
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
