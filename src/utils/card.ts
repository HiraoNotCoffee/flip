export type Suit = 'spade' | 'heart' | 'diamond' | 'club'
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 // 11=J, 12=Q, 13=K, 14=A

export interface Card {
  suit: Suit
  rank: Rank
}

export const SUITS: Suit[] = ['spade', 'heart', 'diamond', 'club']
export const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

export const suitSymbol: Record<Suit, string> = {
  spade: '♠',
  heart: '♥',
  diamond: '♦',
  club: '♣'
}

export const suitColor: Record<Suit, string> = {
  spade: '#000',
  heart: '#e74c3c',
  diamond: '#3498db',
  club: '#27ae60'
}

export function rankToString(rank: Rank): string {
  if (rank === 14) return 'A'
  if (rank === 13) return 'K'
  if (rank === 12) return 'Q'
  if (rank === 11) return 'J'
  return rank.toString()
}

export function cardToString(card: Card): string {
  return suitSymbol[card.suit] + rankToString(card.rank)
}

export function createDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank })
    }
  }
  return deck
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

export function isSameCard(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank
}
