import type { Card } from '../utils/card'
import { suitSymbol, suitColor, rankToString } from '../utils/card'
import './CardView.css'

interface CardViewProps {
  card: Card | null
  faceDown?: boolean
  squeeze?: boolean
  squeezeProgress?: number // 0-100
  onSqueeze?: () => void
  size?: 'small' | 'medium' | 'large'
}

export function CardView({
  card,
  faceDown = false,
  squeeze = false,
  squeezeProgress = 0,
  onSqueeze,
  size = 'medium'
}: CardViewProps) {
  if (!card) {
    return <div className={`card card-placeholder card-${size}`} />
  }

  if (faceDown) {
    return (
      <div
        className={`card card-back card-${size}`}
        onClick={onSqueeze}
      >
        <div className="card-back-pattern" />
      </div>
    )
  }

  const color = suitColor[card.suit]
  const symbol = suitSymbol[card.suit]
  const rank = rankToString(card.rank)

  if (squeeze && squeezeProgress < 100) {
    return (
      <div
        className={`card card-squeeze card-${size}`}
        onClick={onSqueeze}
        style={{ '--squeeze-progress': `${squeezeProgress}%` } as React.CSSProperties}
      >
        <div className="card-back-pattern" />
        <div className="card-reveal" style={{ color }}>
          <span className="card-rank">{rank}</span>
          <span className="card-suit">{symbol}</span>
        </div>
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
