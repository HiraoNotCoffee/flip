import { describe, it, expect } from 'vitest'
import type { Card, Rank, Suit } from './card'
import { evaluateHand, rankHands } from './handEvaluator'

function c(rank: number, suit: Suit): Card {
  return { rank: rank as Rank, suit }
}

describe('evaluate5Cards / evaluateHand', () => {
  // === Basic hand detection ===

  it('detects high card', () => {
    const hand = evaluateHand(
      [c(2, 'spade'), c(7, 'heart')],
      [c(9, 'diamond'), c(11, 'club'), c(13, 'spade')]
    )
    expect(hand.rank).toBe('high_card')
  })

  it('detects one pair', () => {
    const hand = evaluateHand(
      [c(10, 'spade'), c(10, 'heart')],
      [c(3, 'diamond'), c(7, 'club'), c(14, 'spade')]
    )
    expect(hand.rank).toBe('one_pair')
  })

  it('detects two pair', () => {
    const hand = evaluateHand(
      [c(10, 'spade'), c(10, 'heart')],
      [c(7, 'diamond'), c(7, 'club'), c(14, 'spade')]
    )
    expect(hand.rank).toBe('two_pair')
  })

  it('detects three of a kind', () => {
    const hand = evaluateHand(
      [c(10, 'spade'), c(10, 'heart')],
      [c(10, 'diamond'), c(7, 'club'), c(14, 'spade')]
    )
    expect(hand.rank).toBe('three_of_a_kind')
  })

  it('detects straight', () => {
    const hand = evaluateHand(
      [c(8, 'spade'), c(9, 'heart')],
      [c(10, 'diamond'), c(11, 'club'), c(12, 'spade')]
    )
    expect(hand.rank).toBe('straight')
  })

  it('detects flush', () => {
    const hand = evaluateHand(
      [c(2, 'heart'), c(5, 'heart')],
      [c(8, 'heart'), c(11, 'heart'), c(13, 'heart')]
    )
    expect(hand.rank).toBe('flush')
  })

  it('detects full house', () => {
    const hand = evaluateHand(
      [c(10, 'spade'), c(10, 'heart')],
      [c(10, 'diamond'), c(7, 'club'), c(7, 'spade')]
    )
    expect(hand.rank).toBe('full_house')
  })

  it('detects four of a kind', () => {
    const hand = evaluateHand(
      [c(10, 'spade'), c(10, 'heart')],
      [c(10, 'diamond'), c(10, 'club'), c(7, 'spade')]
    )
    expect(hand.rank).toBe('four_of_a_kind')
  })

  it('detects straight flush', () => {
    const hand = evaluateHand(
      [c(8, 'heart'), c(9, 'heart')],
      [c(10, 'heart'), c(11, 'heart'), c(12, 'heart')]
    )
    expect(hand.rank).toBe('straight_flush')
  })

  it('detects royal flush', () => {
    const hand = evaluateHand(
      [c(10, 'spade'), c(11, 'spade')],
      [c(12, 'spade'), c(13, 'spade'), c(14, 'spade')]
    )
    expect(hand.rank).toBe('royal_flush')
  })

  // === Wheel (A-2-3-4-5) ===

  it('detects wheel straight (A-2-3-4-5)', () => {
    const hand = evaluateHand(
      [c(14, 'spade'), c(2, 'heart')],
      [c(3, 'diamond'), c(4, 'club'), c(5, 'spade')]
    )
    expect(hand.rank).toBe('straight')
  })

  it('detects wheel straight flush (A-2-3-4-5 same suit)', () => {
    const hand = evaluateHand(
      [c(14, 'heart'), c(2, 'heart')],
      [c(3, 'heart'), c(4, 'heart'), c(5, 'heart')]
    )
    expect(hand.rank).toBe('straight_flush')
  })

  // === 7-card evaluation (pick best 5 from 7) ===

  it('finds best hand from 7 cards', () => {
    // Hole: K♠ K♥, Board: K♦ 3♣ 3♠ 8♦ 2♥
    const hand = evaluateHand(
      [c(13, 'spade'), c(13, 'heart')],
      [c(13, 'diamond'), c(3, 'club'), c(3, 'spade'), c(8, 'diamond'), c(2, 'heart')]
    )
    expect(hand.rank).toBe('full_house')
  })

  it('finds flush from 7 cards with mixed suits', () => {
    // Hole: A♥ 3♥, Board: 5♥ 9♥ K♥ 2♠ 7♣
    const hand = evaluateHand(
      [c(14, 'heart'), c(3, 'heart')],
      [c(5, 'heart'), c(9, 'heart'), c(13, 'heart'), c(2, 'spade'), c(7, 'club')]
    )
    expect(hand.rank).toBe('flush')
  })

  it('finds straight from 7 cards with noise', () => {
    // Hole: 6♠ 7♥, Board: 8♦ 9♣ 10♠ 2♥ 3♦
    const hand = evaluateHand(
      [c(6, 'spade'), c(7, 'heart')],
      [c(8, 'diamond'), c(9, 'club'), c(10, 'spade'), c(2, 'heart'), c(3, 'diamond')]
    )
    expect(hand.rank).toBe('straight')
  })

  // === Hand comparison / ranking ===

  it('flush beats straight', () => {
    const flush = evaluateHand(
      [c(2, 'heart'), c(5, 'heart')],
      [c(8, 'heart'), c(11, 'heart'), c(13, 'heart')]
    )
    const straight = evaluateHand(
      [c(8, 'spade'), c(9, 'heart')],
      [c(10, 'diamond'), c(11, 'club'), c(12, 'spade')]
    )
    expect(flush.rankValue).toBeGreaterThan(straight.rankValue)
  })

  it('full house beats flush', () => {
    const fullHouse = evaluateHand(
      [c(10, 'spade'), c(10, 'heart')],
      [c(10, 'diamond'), c(7, 'club'), c(7, 'spade')]
    )
    const flush = evaluateHand(
      [c(2, 'heart'), c(5, 'heart')],
      [c(8, 'heart'), c(11, 'heart'), c(13, 'heart')]
    )
    expect(fullHouse.rankValue).toBeGreaterThan(flush.rankValue)
  })

  it('higher pair beats lower pair', () => {
    const pairK = evaluateHand(
      [c(13, 'spade'), c(13, 'heart')],
      [c(2, 'diamond'), c(5, 'club'), c(9, 'spade')]
    )
    const pairQ = evaluateHand(
      [c(12, 'spade'), c(12, 'heart')],
      [c(2, 'diamond'), c(5, 'club'), c(9, 'spade')]
    )
    expect(pairK.rankValue).toBeGreaterThan(pairQ.rankValue)
  })

  it('pair kicker matters', () => {
    // Both have pair of Kings, but different kickers
    const pairK_A = evaluateHand(
      [c(13, 'spade'), c(13, 'heart')],
      [c(14, 'diamond'), c(5, 'club'), c(3, 'spade')]
    )
    const pairK_Q = evaluateHand(
      [c(13, 'diamond'), c(13, 'club')],
      [c(12, 'diamond'), c(5, 'spade'), c(3, 'heart')]
    )
    expect(pairK_A.rankValue).toBeGreaterThan(pairK_Q.rankValue)
  })

  it('two pair: higher second pair wins', () => {
    // AA-KK vs AA-QQ
    const aaKK = evaluateHand(
      [c(14, 'spade'), c(14, 'heart')],
      [c(13, 'diamond'), c(13, 'club'), c(2, 'spade')]
    )
    const aaQQ = evaluateHand(
      [c(14, 'diamond'), c(14, 'club')],
      [c(12, 'diamond'), c(12, 'spade'), c(2, 'heart')]
    )
    expect(aaKK.rankValue).toBeGreaterThan(aaQQ.rankValue)
  })

  it('two pair kicker matters', () => {
    // KK-QQ-A vs KK-QQ-J
    const kqA = evaluateHand(
      [c(13, 'spade'), c(13, 'heart')],
      [c(12, 'diamond'), c(12, 'club'), c(14, 'spade')]
    )
    const kqJ = evaluateHand(
      [c(13, 'diamond'), c(13, 'club')],
      [c(12, 'spade'), c(12, 'heart'), c(11, 'spade')]
    )
    expect(kqA.rankValue).toBeGreaterThan(kqJ.rankValue)
  })

  it('higher straight beats lower straight', () => {
    const highStraight = evaluateHand(
      [c(9, 'spade'), c(10, 'heart')],
      [c(11, 'diamond'), c(12, 'club'), c(13, 'spade')]
    )
    const lowStraight = evaluateHand(
      [c(8, 'spade'), c(9, 'heart')],
      [c(10, 'diamond'), c(11, 'club'), c(12, 'heart')]
    )
    expect(highStraight.rankValue).toBeGreaterThan(lowStraight.rankValue)
  })

  it('ace-high straight beats wheel', () => {
    const aceHigh = evaluateHand(
      [c(10, 'spade'), c(11, 'heart')],
      [c(12, 'diamond'), c(13, 'club'), c(14, 'spade')]
    )
    const wheel = evaluateHand(
      [c(14, 'heart'), c(2, 'diamond')],
      [c(3, 'club'), c(4, 'spade'), c(5, 'heart')]
    )
    expect(aceHigh.rankValue).toBeGreaterThan(wheel.rankValue)
  })

  it('higher flush beats lower flush', () => {
    const highFlush = evaluateHand(
      [c(14, 'heart'), c(13, 'heart')],
      [c(11, 'heart'), c(9, 'heart'), c(7, 'heart')]
    )
    const lowFlush = evaluateHand(
      [c(13, 'spade'), c(12, 'spade')],
      [c(11, 'spade'), c(9, 'spade'), c(7, 'spade')]
    )
    expect(highFlush.rankValue).toBeGreaterThan(lowFlush.rankValue)
  })

  it('higher full house beats lower full house (by trips)', () => {
    // KKK-22 vs QQQ-AA
    const kFull = evaluateHand(
      [c(13, 'spade'), c(13, 'heart')],
      [c(13, 'diamond'), c(2, 'club'), c(2, 'spade')]
    )
    const qFull = evaluateHand(
      [c(12, 'spade'), c(12, 'heart')],
      [c(12, 'diamond'), c(14, 'club'), c(14, 'spade')]
    )
    expect(kFull.rankValue).toBeGreaterThan(qFull.rankValue)
  })

  it('full house: same trips, higher pair wins', () => {
    // AAA-KK vs AAA-QQ
    const aaKK = evaluateHand(
      [c(14, 'spade'), c(14, 'heart')],
      [c(14, 'diamond'), c(13, 'club'), c(13, 'spade')]
    )
    const aaQQ = evaluateHand(
      [c(14, 'club'), c(14, 'diamond')],
      [c(14, 'heart'), c(12, 'club'), c(12, 'spade')]
    )
    expect(aaKK.rankValue).toBeGreaterThan(aaQQ.rankValue)
  })

  // === rankHands ===

  it('rankHands returns correct rankings', () => {
    const board = [c(2, 'diamond'), c(5, 'club'), c(9, 'spade'), c(11, 'heart'), c(3, 'diamond')]
    const hand1 = evaluateHand([c(14, 'spade'), c(14, 'heart')], board) // pair of aces
    const hand2 = evaluateHand([c(13, 'spade'), c(13, 'heart')], board) // pair of kings
    const hand3 = evaluateHand([c(7, 'spade'), c(8, 'heart')], board)   // high card

    const ranks = rankHands([hand1, hand2, hand3])
    expect(ranks[0]).toBe(1) // aces = winner
    expect(ranks[1]).toBe(2) // kings = 2nd
    expect(ranks[2]).toBe(3) // high card = 3rd
  })

  it('rankHands handles ties', () => {
    const board = [c(14, 'diamond'), c(13, 'club'), c(12, 'spade'), c(11, 'heart'), c(10, 'diamond')]
    // Both players make the same straight on the board
    const hand1 = evaluateHand([c(2, 'spade'), c(3, 'heart')], board)
    const hand2 = evaluateHand([c(4, 'spade'), c(5, 'heart')], board)

    const ranks = rankHands([hand1, hand2])
    expect(ranks[0]).toBe(ranks[1]) // should tie
  })

  // === Edge cases & potential bugs ===

  it('straight not confused with non-consecutive cards', () => {
    // Should NOT be a straight: 2, 4, 6, 8, 10
    const hand = evaluateHand(
      [c(2, 'spade'), c(4, 'heart')],
      [c(6, 'diamond'), c(8, 'club'), c(10, 'spade')]
    )
    expect(hand.rank).not.toBe('straight')
  })

  it('three of a kind vs straight: straight wins', () => {
    const trips = evaluateHand(
      [c(7, 'spade'), c(7, 'heart')],
      [c(7, 'diamond'), c(2, 'club'), c(13, 'spade')]
    )
    const straight = evaluateHand(
      [c(8, 'spade'), c(9, 'heart')],
      [c(10, 'diamond'), c(11, 'club'), c(12, 'spade')]
    )
    expect(straight.rankValue).toBeGreaterThan(trips.rankValue)
  })

  it('four of a kind beats full house', () => {
    const quads = evaluateHand(
      [c(10, 'spade'), c(10, 'heart')],
      [c(10, 'diamond'), c(10, 'club'), c(7, 'spade')]
    )
    const fullHouse = evaluateHand(
      [c(14, 'spade'), c(14, 'heart')],
      [c(14, 'diamond'), c(13, 'club'), c(13, 'spade')]
    )
    expect(quads.rankValue).toBeGreaterThan(fullHouse.rankValue)
  })

  it('straight flush beats four of a kind', () => {
    const sf = evaluateHand(
      [c(8, 'heart'), c(9, 'heart')],
      [c(10, 'heart'), c(11, 'heart'), c(12, 'heart')]
    )
    const quads = evaluateHand(
      [c(14, 'spade'), c(14, 'heart')],
      [c(14, 'diamond'), c(14, 'club'), c(13, 'spade')]
    )
    expect(sf.rankValue).toBeGreaterThan(quads.rankValue)
  })

  // === 7 card scenarios with tricky evaluation ===

  it('picks flush over straight when both possible from 7 cards', () => {
    // Hole: 8♥ 9♥, Board: 10♥ J♠ Q♥ 2♥ 3♣
    // Has straight (8-9-10-J-Q) and also flush (8♥-9♥-10♥-Q♥-2♥)
    const hand = evaluateHand(
      [c(8, 'heart'), c(9, 'heart')],
      [c(10, 'heart'), c(11, 'spade'), c(12, 'heart'), c(2, 'heart'), c(3, 'club')]
    )
    expect(hand.rank).toBe('flush')
  })

  it('picks full house over flush when both possible from 7 cards', () => {
    // Hole: K♥ K♠, Board: K♦ 5♥ 5♠ 2♥ 8♥
    // Has flush possibility (K♥-5♥-2♥-8♥ + need 1 more heart) - not actually 5 hearts
    // Has full house: KKK-55
    const hand = evaluateHand(
      [c(13, 'heart'), c(13, 'spade')],
      [c(13, 'diamond'), c(5, 'heart'), c(5, 'spade'), c(2, 'heart'), c(8, 'heart')]
    )
    expect(hand.rank).toBe('full_house')
  })

  it('board straight: player with higher card uses it', () => {
    // Board has 8-9-10-J-Q straight
    // Player 1: A♠ 2♥ (makes no improvement, straight is 8-Q)
    // Player 2: K♠ 7♥ (makes 9-10-J-Q-K straight)
    const board = [c(8, 'diamond'), c(9, 'club'), c(10, 'spade'), c(11, 'heart'), c(12, 'diamond')]
    const hand1 = evaluateHand([c(14, 'spade'), c(2, 'heart')], board)
    const hand2 = evaluateHand([c(13, 'spade'), c(7, 'heart')], board)
    expect(hand2.rankValue).toBeGreaterThan(hand1.rankValue)
  })

  it('higher kicker on trips decides winner', () => {
    // Both have trip 7s, different kickers
    const board = [c(7, 'diamond'), c(7, 'club'), c(7, 'spade'), c(3, 'heart'), c(2, 'diamond')]
    const hand1 = evaluateHand([c(14, 'spade'), c(6, 'heart')], board) // trips-7 kicker A,6
    const hand2 = evaluateHand([c(13, 'spade'), c(12, 'heart')], board) // trips-7 kicker K,Q
    expect(hand1.rankValue).toBeGreaterThan(hand2.rankValue)
  })

  it('one pair: second kicker breaks tie', () => {
    // Both pair of aces, first kicker K, second kicker differs
    const board = [c(14, 'diamond'), c(13, 'club'), c(5, 'spade')]
    const hand1 = evaluateHand([c(14, 'spade'), c(12, 'heart')], board) // AA, K Q 5
    const hand2 = evaluateHand([c(14, 'heart'), c(11, 'diamond')], board) // AA, K J 5
    expect(hand1.rankValue).toBeGreaterThan(hand2.rankValue)
  })

  it('one pair: third kicker breaks tie', () => {
    // Both pair of aces, kickers K Q, third differs
    const board = [c(14, 'diamond'), c(13, 'club'), c(12, 'spade')]
    const hand1 = evaluateHand([c(14, 'spade'), c(10, 'heart')], board) // AA, K Q 10
    const hand2 = evaluateHand([c(14, 'heart'), c(9, 'diamond')], board) // AA, K Q 9
    expect(hand1.rankValue).toBeGreaterThan(hand2.rankValue)
  })

  it('high card: second card breaks tie', () => {
    const board = [c(14, 'diamond'), c(9, 'club'), c(5, 'spade')]
    const hand1 = evaluateHand([c(13, 'spade'), c(2, 'heart')], board) // A K 9 5 2
    const hand2 = evaluateHand([c(12, 'spade'), c(2, 'diamond')], board) // A Q 9 5 2
    expect(hand1.rankValue).toBeGreaterThan(hand2.rankValue)
  })

  // === Regression: reported bugs ===

  it('two pair beats one pair (reported: P1 7dQs vs P2 Qd5c, board TcKsQc3d7h)', () => {
    // P1: 7♦ Q♠ → two pair QQ77 with K kicker
    // P2: Q♦ 5♣ → one pair QQ with K,T,7 kickers
    // P1 should win
    const board = [c(10, 'club'), c(13, 'spade'), c(12, 'club'), c(3, 'diamond'), c(7, 'heart')]
    const p1 = evaluateHand([c(7, 'diamond'), c(12, 'spade')], board)
    const p2 = evaluateHand([c(12, 'diamond'), c(5, 'club')], board)

    expect(p1.rank).toBe('two_pair')
    expect(p2.rank).toBe('one_pair')
    expect(p1.rankValue).toBeGreaterThan(p2.rankValue)

    const ranks = rankHands([p1, p2])
    expect(ranks[0]).toBe(1) // P1 wins
    expect(ranks[1]).toBe(2) // P2 loses
  })

  // Verify no rank tier overlaps: every hand of rank N must beat every hand of rank N-1
  it('rank tiers never overlap: two pair always beats one pair', () => {
    // Worst two pair (33-22 with 4 kicker) vs best one pair (AA with K,Q,J kickers)
    const worstTwoPair = evaluateHand(
      [c(3, 'spade'), c(3, 'heart')],
      [c(2, 'diamond'), c(2, 'club'), c(4, 'spade')]
    )
    const bestOnePair = evaluateHand(
      [c(14, 'spade'), c(14, 'heart')],
      [c(13, 'diamond'), c(12, 'club'), c(11, 'spade')]
    )
    expect(worstTwoPair.rank).toBe('two_pair')
    expect(bestOnePair.rank).toBe('one_pair')
    expect(worstTwoPair.rankValue).toBeGreaterThan(bestOnePair.rankValue)
  })

  it('rank tiers never overlap: three of a kind always beats two pair', () => {
    const worstTrips = evaluateHand(
      [c(2, 'spade'), c(2, 'heart')],
      [c(2, 'diamond'), c(3, 'club'), c(4, 'spade')]
    )
    const bestTwoPair = evaluateHand(
      [c(14, 'spade'), c(14, 'heart')],
      [c(13, 'diamond'), c(13, 'club'), c(12, 'spade')]
    )
    expect(worstTrips.rankValue).toBeGreaterThan(bestTwoPair.rankValue)
  })

  it('rank tiers never overlap: straight always beats three of a kind', () => {
    const worstStraight = evaluateHand(
      [c(14, 'spade'), c(2, 'heart')],
      [c(3, 'diamond'), c(4, 'club'), c(5, 'spade')]
    )
    const bestTrips = evaluateHand(
      [c(14, 'heart'), c(14, 'diamond')],
      [c(14, 'club'), c(13, 'spade'), c(12, 'heart')]
    )
    expect(worstStraight.rankValue).toBeGreaterThan(bestTrips.rankValue)
  })

  it('rank tiers never overlap: flush always beats straight', () => {
    const worstFlush = evaluateHand(
      [c(2, 'heart'), c(3, 'heart')],
      [c(4, 'heart'), c(5, 'heart'), c(7, 'heart')]
    )
    const bestStraight = evaluateHand(
      [c(10, 'spade'), c(11, 'heart')],
      [c(12, 'diamond'), c(13, 'club'), c(14, 'spade')]
    )
    expect(worstFlush.rankValue).toBeGreaterThan(bestStraight.rankValue)
  })

  it('rank tiers never overlap: full house always beats flush', () => {
    const worstFullHouse = evaluateHand(
      [c(2, 'spade'), c(2, 'heart')],
      [c(2, 'diamond'), c(3, 'club'), c(3, 'spade')]
    )
    const bestFlush = evaluateHand(
      [c(14, 'heart'), c(13, 'heart')],
      [c(12, 'heart'), c(11, 'heart'), c(9, 'heart')]
    )
    expect(worstFullHouse.rankValue).toBeGreaterThan(bestFlush.rankValue)
  })

  it('rank tiers never overlap: four of a kind always beats full house', () => {
    const worstQuads = evaluateHand(
      [c(2, 'spade'), c(2, 'heart')],
      [c(2, 'diamond'), c(2, 'club'), c(3, 'spade')]
    )
    const bestFullHouse = evaluateHand(
      [c(14, 'spade'), c(14, 'heart')],
      [c(14, 'diamond'), c(13, 'club'), c(13, 'spade')]
    )
    expect(worstQuads.rankValue).toBeGreaterThan(bestFullHouse.rankValue)
  })
})
