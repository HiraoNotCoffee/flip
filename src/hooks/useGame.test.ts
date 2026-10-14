import { describe, expect, test } from 'vitest'
import { dealRiggedForP1 } from './useGame'
import { evaluateHand, rankHands } from '../utils/handEvaluator'

describe('りっくん専用', () => {
  // 実際のゲームはフロップ3枚→ターン1枚→リバー1枚を残りの山の先頭から順に出す
  test.each([2, 3, 4, 5, 6, 7, 8])('%i人: P1 が毎回単独で勝つ', playerCount => {
    for (let i = 0; i < 2000; i++) {
      const { players, remainingDeck } = dealRiggedForP1(playerCount)
      const board = remainingDeck.slice(0, 5)
      const ranks = rankHands(players.map(p => evaluateHand(p.hand, board)))
      expect(ranks[0]).toBe(1)
      expect(ranks.filter(r => r === 1)).toHaveLength(1)
    }
  })

  test('カードが重複しない', () => {
    for (let i = 0; i < 500; i++) {
      const { players, remainingDeck } = dealRiggedForP1(8)
      const all = [...players.flatMap(p => p.hand), ...remainingDeck].map(c => `${c.rank}${c.suit}`)
      expect(new Set(all).size).toBe(52)
    }
  })
})
