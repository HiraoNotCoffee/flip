import { useState, useCallback } from 'react'
import type { Card } from '../utils/card'
import { createDeck, shuffleDeck } from '../utils/card'
import type { EvaluatedHand } from '../utils/handEvaluator'
import { evaluateHand, rankHands, HAND_RANK_NAMES } from '../utils/handEvaluator'
import { calculateEquity } from '../utils/equity'

export type GameStage = 'setup' | 'preflop' | 'flop' | 'turn' | 'river'

export interface Player {
  id: number
  hand: Card[]
  equity: number
  lastPlacePct: number
  rank: number | null
  evaluatedHand: EvaluatedHand | null
}

export interface GameState {
  stage: GameStage
  players: Player[]
  board: Card[]
  deck: Card[]
  winnerHandName: string | null
}

const INITIAL_STATE: GameState = {
  stage: 'setup',
  players: [],
  board: [],
  deck: [],
  winnerHandName: null
}

function dealHands(deck: Card[], playerCount: number): Player[] {
  return Array.from({ length: playerCount }, (_, i) => ({
    id: i + 1,
    hand: [deck[i * 2], deck[i * 2 + 1]],
    equity: 0,
    lastPlacePct: 0,
    rank: null,
    evaluatedHand: null
  }))
}

export function dealFair(playerCount: number) {
  const deck = shuffleDeck(createDeck())
  return { players: dealHands(deck, playerCount), remainingDeck: deck.slice(playerCount * 2) }
}

/** りっくん専用で P1 に配るポケットペアの数字 */
export const RIKKUN_PAIR_RANK = 8

/**
 * りっくん専用: P1 に必ず 88 を配る（マークはランダム）。
 * ほかの人の手札とボードは普通に配るので、P1 は有利なだけで負けることもある
 * （必ず勝たせると不自然なので）。
 */
export function dealPocketPairForP1(playerCount: number) {
  const deck = shuffleDeck(createDeck())
  const pair = deck.filter(c => c.rank === RIKKUN_PAIR_RANK).slice(0, 2)
  const rest = deck.filter(c => !pair.includes(c))
  const ordered = [...pair, ...rest]
  return { players: dealHands(ordered, playerCount), remainingDeck: ordered.slice(playerCount * 2) }
}

export function useGame() {
  const [state, setState] = useState<GameState>(INITIAL_STATE)
  const [playerCount, setPlayerCount] = useState(2)
  const [rikkunMode, setRikkunMode] = useState(false)

  const deal = useCallback(() => {
    const { players, remainingDeck } = rikkunMode
      ? dealPocketPairForP1(playerCount)
      : dealFair(playerCount)

    // Calculate initial equity
    const equities = calculateEquity(
      players.map(p => p.hand),
      [],
      2000
    )
    players.forEach((p, i) => {
      p.equity = equities[i].equity
      p.lastPlacePct = equities[i].lastPlacePct
    })

    setState({
      stage: 'preflop',
      players,
      board: [],
      deck: remainingDeck,
      winnerHandName: null
    })
  }, [playerCount, rikkunMode])

  const dealFlop = useCallback(() => {
    setState(prev => {
      if (prev.stage !== 'preflop') return prev

      const newBoard = [...prev.board, ...prev.deck.slice(0, 3)]
      const newDeck = prev.deck.slice(3)

      const equities = calculateEquity(
        prev.players.map(p => p.hand),
        newBoard,
        2000
      )
      const evaluatedHands = prev.players.map(p => evaluateHand(p.hand, newBoard))
      const ranks = rankHands(evaluatedHands)
      const newPlayers = prev.players.map((p, i) => ({
        ...p,
        equity: equities[i].equity,
        lastPlacePct: equities[i].lastPlacePct,
        rank: ranks[i],
        evaluatedHand: evaluatedHands[i]
      }))

      return {
        ...prev,
        stage: 'flop',
        board: newBoard,
        deck: newDeck,
        players: newPlayers
      }
    })
  }, [])

  const dealTurn = useCallback(() => {
    setState(prev => {
      if (prev.stage !== 'flop') return prev

      const newBoard = [...prev.board, prev.deck[0]]
      const newDeck = prev.deck.slice(1)

      const equities = calculateEquity(
        prev.players.map(p => p.hand),
        newBoard,
        2000
      )
      const evaluatedHands = prev.players.map(p => evaluateHand(p.hand, newBoard))
      const ranks = rankHands(evaluatedHands)
      const newPlayers = prev.players.map((p, i) => ({
        ...p,
        equity: equities[i].equity,
        lastPlacePct: equities[i].lastPlacePct,
        rank: ranks[i],
        evaluatedHand: evaluatedHands[i]
      }))

      return {
        ...prev,
        stage: 'turn',
        board: newBoard,
        deck: newDeck,
        players: newPlayers
      }
    })
  }, [])

  const dealRiver = useCallback(() => {
    setState(prev => {
      if (prev.stage !== 'turn') return prev

      const newBoard = [...prev.board, prev.deck[0]]
      const newDeck = prev.deck.slice(1)

      // Evaluate all hands
      const evaluatedHands = prev.players.map(p => evaluateHand(p.hand, newBoard))
      const ranks = rankHands(evaluatedHands)

      // Calculate final equity (100% for winner, split for ties)
      const equities = calculateEquity(
        prev.players.map(p => p.hand),
        newBoard,
        1
      )

      const newPlayers = prev.players.map((p, i) => ({
        ...p,
        equity: equities[i].equity,
        lastPlacePct: equities[i].lastPlacePct,
        rank: ranks[i],
        evaluatedHand: evaluatedHands[i]
      }))

      // Get winner hand name
      const winnerIndex = ranks.indexOf(1)
      const winnerHandName = HAND_RANK_NAMES[evaluatedHands[winnerIndex].rank]

      // Debug: log hands and board for verification
      console.log('[RIVER DEBUG]')
      console.log('Board:', newBoard.map(c => `${c.rank}${c.suit}`).join(', '))
      newPlayers.forEach((p, i) => {
        console.log(`P${i + 1}: ${p.hand.map(c => `${c.rank}${c.suit}`).join(', ')} → ${evaluatedHands[i].rank} (rank #${ranks[i]})`)
      })
      console.log(`Winner: P${winnerIndex + 1} - ${winnerHandName}`)

      return {
        ...prev,
        stage: 'river',
        board: newBoard,
        deck: newDeck,
        players: newPlayers,
        winnerHandName
      }
    })
  }, [])

  const reset = useCallback(() => {
    setState(INITIAL_STATE)
  }, [])

  return {
    state,
    playerCount,
    setPlayerCount,
    rikkunMode,
    setRikkunMode,
    deal,
    dealFlop,
    dealTurn,
    dealRiver,
    reset
  }
}
