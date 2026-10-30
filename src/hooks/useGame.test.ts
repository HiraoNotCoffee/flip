import { describe, expect, test } from 'vitest'
import { dealPocketPairForP1, RIKKUN_PAIR_RANK } from './useGame'
import { evaluateHand, rankHands } from '../utils/handEvaluator'

describe('りっくん専用', () => {
  test.each([2, 3, 4, 5, 6, 7, 8])('%i人: P1 は毎回 88', playerCount => {
    for (let i = 0; i < 500; i++) {
      const { players } = dealPocketPairForP1(playerCount)
      expect(players).toHaveLength(playerCount)
      expect(players[0].hand.map(c => c.rank)).toEqual([RIKKUN_PAIR_RANK, RIKKUN_PAIR_RANK])
    }
  })

  test('88 のマークは毎回ランダム', () => {
    const suits = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const [a, b] = dealPocketPairForP1(4).players[0].hand
      suits.add([a.suit, b.suit].sort().join(''))
    }
    // 4つのマークから2つの組み合わせは6通り
    expect(suits.size).toBe(6)
  })

  test('必ず勝つわけではない（勝率は 100% にならない）', () => {
    // 実際のゲームはフロップ3枚→ターン1枚→リバー1枚を残りの山の先頭から順に出す
    let wins = 0
    const n = 2000
    for (let i = 0; i < n; i++) {
      const { players, remainingDeck } = dealPocketPairForP1(4)
      const board = remainingDeck.slice(0, 5)
      const ranks = rankHands(players.map(p => evaluateHand(p.hand, board)))
      if (ranks[0] === 1) wins++
    }
    // 4人だと 88 の単独勝ちは約28%（普通に配ったときは約24%）
    expect(wins).toBeLessThan(n * 0.5)
    expect(wins).toBeGreaterThan(n * 0.15)
  })

  test('カードが重複しない', () => {
    for (let i = 0; i < 500; i++) {
      const { players, remainingDeck } = dealPocketPairForP1(8)
      const all = [...players.flatMap(p => p.hand), ...remainingDeck].map(c => `${c.rank}${c.suit}`)
      expect(new Set(all).size).toBe(52)
    }
  })
})
