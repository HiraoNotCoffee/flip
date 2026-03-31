import type { Card } from './card'
import { createDeck, isSameCard, shuffleDeck } from './card'
import { evaluateHand, rankHands } from './handEvaluator'

export interface EquityResult {
  wins: number
  ties: number
  total: number
  equity: number // percentage 0-100
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

function tallyResult(
  playerHands: Card[][],
  board: Card[],
  results: EquityResult[]
) {
  const hands = playerHands.map(hand => evaluateHand(hand, board))
  const ranks = rankHands(hands)
  const minRank = Math.min(...ranks)
  const winners = ranks.filter(r => r === minRank).length

  for (let i = 0; i < playerHands.length; i++) {
    if (ranks[i] === minRank) {
      if (winners > 1) {
        results[i].ties++
      } else {
        results[i].wins++
      }
    }
  }
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

  const results: EquityResult[] = playerHands.map(() => ({
    wins: 0,
    ties: 0,
    total: 0,
    equity: 0
  }))

  if (cardsNeeded === 0) {
    // River - single exact evaluation
    tallyResult(playerHands, boardCards, results)
    const minRank = Math.min(...rankHands(playerHands.map(h => evaluateHand(h, boardCards))))
    for (let i = 0; i < numPlayers; i++) {
      results[i].total = 1
      const ranks = rankHands(playerHands.map(h => evaluateHand(h, boardCards)))
      const winners = ranks.filter(r => r === minRank).length
      results[i].equity = ranks[i] === minRank ? 100 / winners : 0
    }
    return results
  }

  if (cardsNeeded <= 2) {
    // Flop (2 cards needed) or Turn (1 card needed) - exact enumeration
    const combos = getCombinations(available, cardsNeeded)

    for (const combo of combos) {
      const simulatedBoard = [...boardCards, ...combo]
      tallyResult(playerHands, simulatedBoard, results)
    }

    const totalCombos = combos.length
    for (let i = 0; i < numPlayers; i++) {
      results[i].total = totalCombos
      const effectiveWins = results[i].wins + results[i].ties / 2
      results[i].equity = (effectiveWins / totalCombos) * 100
    }
    return results
  }

  // Preflop heads-up: exact enumeration (C(48,5) ≈ 1.7M combos)
  if (cardsNeeded === 5 && numPlayers === 2) {
    const combos = getCombinations(available, 5)

    for (const combo of combos) {
      tallyResult(playerHands, combo, results)
    }

    const totalCombos = combos.length
    for (let i = 0; i < numPlayers; i++) {
      results[i].total = totalCombos
      const effectiveWins = results[i].wins + results[i].ties / 2
      results[i].equity = (effectiveWins / totalCombos) * 100
    }
    return results
  }

  // Preflop multiway - Monte Carlo simulation
  const mcIterations = Math.max(iterations, 5000)
  for (let iter = 0; iter < mcIterations; iter++) {
    const shuffled = shuffleDeck([...available])
    const simulatedBoard = [...boardCards, ...shuffled.slice(0, cardsNeeded)]
    tallyResult(playerHands, simulatedBoard, results)
  }

  for (let i = 0; i < numPlayers; i++) {
    results[i].total = mcIterations
    const effectiveWins = results[i].wins + results[i].ties / 2
    results[i].equity = (effectiveWins / mcIterations) * 100
  }

  return results
}
