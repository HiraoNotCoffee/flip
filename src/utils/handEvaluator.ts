import type { Card, Rank, Suit } from './card'

export type HandRank =
  | 'royal_flush'
  | 'straight_flush'
  | 'four_of_a_kind'
  | 'full_house'
  | 'flush'
  | 'straight'
  | 'three_of_a_kind'
  | 'two_pair'
  | 'one_pair'
  | 'high_card'

export const HAND_RANK_ORDER: HandRank[] = [
  'high_card',
  'one_pair',
  'two_pair',
  'three_of_a_kind',
  'straight',
  'flush',
  'full_house',
  'four_of_a_kind',
  'straight_flush',
  'royal_flush'
]

export const HAND_RANK_NAMES: Record<HandRank, string> = {
  royal_flush: 'ロイヤルフラッシュ',
  straight_flush: 'ストレートフラッシュ',
  four_of_a_kind: 'フォーカード',
  full_house: 'フルハウス',
  flush: 'フラッシュ',
  straight: 'ストレート',
  three_of_a_kind: 'スリーカード',
  two_pair: 'ツーペア',
  one_pair: 'ワンペア',
  high_card: 'ハイカード'
}

export interface EvaluatedHand {
  rank: HandRank
  rankValue: number // Higher is better
  kickers: Rank[] // For tie-breaking, sorted descending
  bestCards: Card[] // The 5 cards that make the hand
}

function getCombinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (arr.length < k) return []

  const [first, ...rest] = arr
  const withFirst = getCombinations(rest, k - 1).map(combo => [first, ...combo])
  const withoutFirst = getCombinations(rest, k)
  return [...withFirst, ...withoutFirst]
}

function countRanks(cards: Card[]): Map<Rank, number> {
  const counts = new Map<Rank, number>()
  for (const card of cards) {
    counts.set(card.rank, (counts.get(card.rank) || 0) + 1)
  }
  return counts
}

function countSuits(cards: Card[]): Map<Suit, Card[]> {
  const suits = new Map<Suit, Card[]>()
  for (const card of cards) {
    if (!suits.has(card.suit)) suits.set(card.suit, [])
    suits.get(card.suit)!.push(card)
  }
  return suits
}

function getStraightHighCard(cards: Card[]): Rank | null {
  const ranks = [...new Set(cards.map(c => c.rank))].sort((a, b) => b - a)

  // Check for A-2-3-4-5 (wheel)
  if (ranks.includes(14) && ranks.includes(2) && ranks.includes(3) && ranks.includes(4) && ranks.includes(5)) {
    return 5 as Rank
  }

  // Check for regular straights
  for (let i = 0; i <= ranks.length - 5; i++) {
    if (ranks[i] - ranks[i + 4] === 4) {
      return ranks[i]
    }
  }

  return null
}

function evaluate5Cards(cards: Card[]): EvaluatedHand {
  const rankCounts = countRanks(cards)
  const sortedRanks = cards.map(c => c.rank).sort((a, b) => b - a)
  const suits = countSuits(cards)

  const isFlushHand = [...suits.values()].some(s => s.length === 5)
  const straightHigh = getStraightHighCard(cards)
  const isStraight = straightHigh !== null

  // Count pairs, trips, quads
  const counts = [...rankCounts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    return b[0] - a[0]
  })

  // Royal Flush
  if (isFlushHand && isStraight && straightHigh === 14) {
    return {
      rank: 'royal_flush',
      rankValue: 9000000,
      kickers: [14, 13, 12, 11, 10] as Rank[],
      bestCards: cards
    }
  }

  // Straight Flush
  if (isFlushHand && isStraight) {
    return {
      rank: 'straight_flush',
      rankValue: 8000000 + straightHigh,
      kickers: [straightHigh] as Rank[],
      bestCards: cards
    }
  }

  // Four of a Kind
  if (counts[0][1] === 4) {
    const quadRank = counts[0][0]
    const kicker = counts[1][0]
    return {
      rank: 'four_of_a_kind',
      rankValue: 7000000 + quadRank * 100 + kicker,
      kickers: [quadRank, kicker],
      bestCards: cards
    }
  }

  // Full House
  if (counts[0][1] === 3 && counts[1][1] === 2) {
    return {
      rank: 'full_house',
      rankValue: 6000000 + counts[0][0] * 100 + counts[1][0],
      kickers: [counts[0][0], counts[1][0]],
      bestCards: cards
    }
  }

  // Flush
  if (isFlushHand) {
    const value = sortedRanks.reduce((acc, r, i) => acc + r * Math.pow(15, 4 - i), 0)
    return {
      rank: 'flush',
      rankValue: 5000000 + value,
      kickers: sortedRanks.slice(0, 5) as Rank[],
      bestCards: cards
    }
  }

  // Straight
  if (isStraight) {
    return {
      rank: 'straight',
      rankValue: 4000000 + straightHigh,
      kickers: [straightHigh] as Rank[],
      bestCards: cards
    }
  }

  // Three of a Kind
  if (counts[0][1] === 3) {
    const tripRank = counts[0][0]
    const kickers = counts.slice(1).map(c => c[0]).slice(0, 2)
    return {
      rank: 'three_of_a_kind',
      rankValue: 3000000 + tripRank * 10000 + kickers[0] * 100 + kickers[1],
      kickers: [tripRank, ...kickers] as Rank[],
      bestCards: cards
    }
  }

  // Two Pair
  if (counts[0][1] === 2 && counts[1][1] === 2) {
    const highPair = Math.max(counts[0][0], counts[1][0])
    const lowPair = Math.min(counts[0][0], counts[1][0])
    const kicker = counts[2][0]
    return {
      rank: 'two_pair',
      rankValue: 2000000 + highPair * 10000 + lowPair * 100 + kicker,
      kickers: [highPair, lowPair, kicker] as Rank[],
      bestCards: cards
    }
  }

  // One Pair
  if (counts[0][1] === 2) {
    const pairRank = counts[0][0]
    const kickers = counts.slice(1).map(c => c[0]).slice(0, 3)
    return {
      rank: 'one_pair',
      rankValue: 1000000 + pairRank * 100000 + kickers[0] * 1000 + kickers[1] * 10 + kickers[2],
      kickers: [pairRank, ...kickers] as Rank[],
      bestCards: cards
    }
  }

  // High Card
  const value = sortedRanks.reduce((acc, r, i) => acc + r * Math.pow(15, 4 - i), 0)
  return {
    rank: 'high_card',
    rankValue: value,
    kickers: sortedRanks.slice(0, 5) as Rank[],
    bestCards: cards
  }
}

export function evaluateHand(holeCards: Card[], boardCards: Card[]): EvaluatedHand {
  const allCards = [...holeCards, ...boardCards]

  if (allCards.length < 5) {
    // Not enough cards yet, return high card based on available
    const sorted = allCards.sort((a, b) => b.rank - a.rank)
    return {
      rank: 'high_card',
      rankValue: 0,
      kickers: sorted.map(c => c.rank),
      bestCards: sorted
    }
  }

  const combinations = getCombinations(allCards, 5)
  let bestHand: EvaluatedHand | null = null

  for (const combo of combinations) {
    const evaluated = evaluate5Cards(combo)
    if (!bestHand || evaluated.rankValue > bestHand.rankValue) {
      bestHand = evaluated
    }
  }

  return bestHand!
}

export function compareHands(a: EvaluatedHand, b: EvaluatedHand): number {
  return b.rankValue - a.rankValue
}

export function rankHands(hands: EvaluatedHand[]): number[] {
  const sorted = hands
    .map((hand, index) => ({ hand, index }))
    .sort((a, b) => compareHands(a.hand, b.hand))

  const ranks: number[] = new Array(hands.length)
  let currentRank = 1

  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].hand.rankValue < sorted[i - 1].hand.rankValue) {
      currentRank = i + 1
    }
    ranks[sorted[i].index] = currentRank
  }

  return ranks
}
