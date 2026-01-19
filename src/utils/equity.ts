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

export function calculateEquity(
  playerHands: Card[][], // Array of [card1, card2] for each player
  boardCards: Card[],
  iterations: number = 1000
): EquityResult[] {
  const numPlayers = playerHands.length
  const results: EquityResult[] = playerHands.map(() => ({
    wins: 0,
    ties: 0,
    total: iterations,
    equity: 0
  }))

  const cardsNeeded = 5 - boardCards.length
  const usedCards = [...boardCards, ...playerHands.flat()]

  if (cardsNeeded === 0) {
    // River - just evaluate once
    const hands = playerHands.map(hand => evaluateHand(hand, boardCards))
    const ranks = rankHands(hands)
    const minRank = Math.min(...ranks)
    const winners = ranks.filter(r => r === minRank).length

    for (let i = 0; i < numPlayers; i++) {
      if (ranks[i] === minRank) {
        if (winners > 1) {
          results[i].ties = 1
        } else {
          results[i].wins = 1
        }
      }
      results[i].total = 1
      results[i].equity = ranks[i] === minRank ? 100 / winners : 0
    }
    return results
  }

  // Monte Carlo simulation
  for (let iter = 0; iter < iterations; iter++) {
    const available = shuffleDeck(getAvailableCards(usedCards))
    const simulatedBoard = [...boardCards, ...available.slice(0, cardsNeeded)]

    const hands = playerHands.map(hand => evaluateHand(hand, simulatedBoard))
    const ranks = rankHands(hands)
    const minRank = Math.min(...ranks)
    const winners = ranks.filter(r => r === minRank).length

    for (let i = 0; i < numPlayers; i++) {
      if (ranks[i] === minRank) {
        if (winners > 1) {
          results[i].ties++
        } else {
          results[i].wins++
        }
      }
    }
  }

  // Calculate equity percentages
  for (let i = 0; i < numPlayers; i++) {
    const effectiveWins = results[i].wins + results[i].ties / 2
    results[i].equity = (effectiveWins / iterations) * 100
  }

  return results
}
