import type { Card, Rank } from './card'
import { createDeck, isSameCard, shuffleDeck } from './card'
import { evaluateHand, rankHands } from './handEvaluator'
import preflopTable from './preflopTable.json'

export interface EquityResult {
  wins: number
  ties: number
  total: number
  equity: number // percentage 0-100
  lastPlacePct: number // probability of finishing last (0-100)
}

// Canonical hand type: "14-14" (pair), "14-13s" (suited), "14-13o" (offsuit)
function handType(c1: Card, c2: Card): string {
  const high = Math.max(c1.rank, c2.rank) as Rank
  const low = Math.min(c1.rank, c2.rank) as Rank
  if (high === low) return `${high}-${low}`
  const suited = c1.suit === c2.suit ? 's' : 'o'
  return `${high}-${low}${suited}`
}

const preflopLookup = preflopTable as Record<string, number>

function lookupPreflopEquity(hand1: Card[], hand2: Card[]): number | null {
  const t1 = handType(hand1[0], hand1[1])
  const t2 = handType(hand2[0], hand2[1])

  const key1 = `${t1}|${t2}`
  if (key1 in preflopLookup) return preflopLookup[key1]

  const key2 = `${t2}|${t1}`
  if (key2 in preflopLookup) return 100 - preflopLookup[key2]

  return null
}

function getAvailableCards(usedCards: Card[]): Card[] {
  const deck = createDeck()
  return deck.filter(card => !usedCards.some(used => isSameCard(card, used)))
}

function getCombinations(arr: Card[], k: number): Card[][] {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const [first, ...rest] = arr
  const withFirst = getCombinations(rest, k - 1).map(combo => [first, ...combo])
  const withoutFirst = getCombinations(rest, k)
  return [...withFirst, ...withoutFirst]
}

interface TallyState {
  wins: number
  ties: number
  lastCount: number
}

function tallyResult(
  playerHands: Card[][],
  board: Card[],
  tally: TallyState[]
) {
  const hands = playerHands.map(hand => evaluateHand(hand, board))
  const ranks = rankHands(hands)
  const minRank = Math.min(...ranks)
  const maxRank = Math.max(...ranks)
  const winners = ranks.filter(r => r === minRank).length

  for (let i = 0; i < playerHands.length; i++) {
    if (ranks[i] === minRank) {
      if (winners > 1) {
        tally[i].ties++
      } else {
        tally[i].wins++
      }
    }
    if (ranks[i] === maxRank) {
      tally[i].lastCount++
    }
  }
}

function buildResults(tally: TallyState[], total: number): EquityResult[] {
  return tally.map(t => {
    const effectiveWins = t.wins + t.ties / 2
    return {
      wins: t.wins,
      ties: t.ties,
      total,
      equity: (effectiveWins / total) * 100,
      lastPlacePct: (t.lastCount / total) * 100
    }
  })
}

function createTally(n: number): TallyState[] {
  return Array.from({ length: n }, () => ({ wins: 0, ties: 0, lastCount: 0 }))
}

export function calculateEquity(
  playerHands: Card[][],
  boardCards: Card[],
  iterations: number = 2000
): EquityResult[] {
  const numPlayers = playerHands.length
  const cardsNeeded = 5 - boardCards.length
  const usedCards = [...boardCards, ...playerHands.flat()]
  const available = getAvailableCards(usedCards)

  if (cardsNeeded === 0) {
    // River - single exact evaluation
    const tally = createTally(numPlayers)
    tallyResult(playerHands, boardCards, tally)
    return buildResults(tally, 1)
  }

  if (cardsNeeded <= 2) {
    // Flop (2 cards needed) or Turn (1 card needed) - exact enumeration
    const combos = getCombinations(available, cardsNeeded)
    const tally = createTally(numPlayers)

    for (const combo of combos) {
      const simulatedBoard = [...boardCards, ...combo]
      tallyResult(playerHands, simulatedBoard, tally)
    }

    return buildResults(tally, combos.length)
  }

  // Preflop heads-up: use lookup table
  if (cardsNeeded === 5 && numPlayers === 2) {
    const eq = lookupPreflopEquity(playerHands[0], playerHands[1])
    if (eq !== null) {
      return [
        { wins: 0, ties: 0, total: 1, equity: eq, lastPlacePct: 100 - eq },
        { wins: 0, ties: 0, total: 1, equity: 100 - eq, lastPlacePct: eq }
      ]
    }
  }

  // Preflop - Monte Carlo simulation
  const mcIterations = Math.max(iterations, 5000)
  const tally = createTally(numPlayers)

  for (let iter = 0; iter < mcIterations; iter++) {
    const shuffled = shuffleDeck([...available])
    const simulatedBoard = [...boardCards, ...shuffled.slice(0, cardsNeeded)]
    tallyResult(playerHands, simulatedBoard, tally)
  }

  return buildResults(tally, mcIterations)
}
