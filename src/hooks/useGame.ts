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

export function useGame() {
  const [state, setState] = useState<GameState>(INITIAL_STATE)
  const [playerCount, setPlayerCount] = useState(2)
  const [specialMode, setSpecialMode] = useState(false)

  const deal = useCallback(() => {
    const deck = shuffleDeck(createDeck())
    let deckIndex = 0

    const players: Player[] = []
    for (let i = 0; i < playerCount; i++) {
      players.push({
        id: i + 1,
        hand: [deck[deckIndex++], deck[deckIndex++]],
        equity: 0,
        rank: null,
        evaluatedHand: null
      })
    }

    const remainingDeck = deck.slice(deckIndex)

    // Special mode: rig the winner
    if (specialMode) {
      const targetIndex = new Date().getHours() % playerCount
      // Pre-determine the board (first 5 cards from remaining deck)
      const futureBoard = remainingDeck.slice(0, 5)
      // Evaluate all hands against the future board
      const evaluatedHands = players.map(p => evaluateHand(p.hand, futureBoard))
      const ranks = rankHands(evaluatedHands)
      // If target player doesn't have rank 1, swap hands with the winner
      if (ranks[targetIndex] !== 1) {
        const winnerIndex = ranks.indexOf(1)
        const temp = players[targetIndex].hand
        players[targetIndex].hand = players[winnerIndex].hand
        players[winnerIndex].hand = temp
      }
    }

    // Calculate initial equity
    const equities = calculateEquity(
      players.map(p => p.hand),
      [],
      500
    )
    players.forEach((p, i) => {
      p.equity = equities[i].equity
    })

    setState({
      stage: 'preflop',
      players,
      board: [],
      deck: remainingDeck,
      winnerHandName: null
    })
  }, [playerCount, specialMode])

  const dealFlop = useCallback(() => {
    setState(prev => {
      if (prev.stage !== 'preflop') return prev

      const newBoard = [...prev.board, ...prev.deck.slice(0, 3)]
      const newDeck = prev.deck.slice(3)

      const equities = calculateEquity(
        prev.players.map(p => p.hand),
        newBoard,
        500
      )
      const newPlayers = prev.players.map((p, i) => ({
        ...p,
        equity: equities[i].equity
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
        500
      )
      const newPlayers = prev.players.map((p, i) => ({
        ...p,
        equity: equities[i].equity
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
        rank: ranks[i],
        evaluatedHand: evaluatedHands[i]
      }))

      // Get winner hand name
      const winnerIndex = ranks.indexOf(1)
      const winnerHandName = HAND_RANK_NAMES[evaluatedHands[winnerIndex].rank]

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
    specialMode,
    setSpecialMode,
    deal,
    dealFlop,
    dealTurn,
    dealRiver,
    reset
  }
}
