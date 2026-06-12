import { describe, it, expect } from 'vitest'
import type { Card } from './card'
import {
  createHand,
  formatPokerStars,
  stateForStreet,
  legalActions,
  computeTotalPot,
  cardCode,
  type Hand,
} from './handHistory'

function c(code: string): Card {
  const rankMap: Record<string, number> = {
    A: 14, K: 13, Q: 12, J: 11, T: 10,
    '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2,
  }
  const suitMap: Record<string, Card['suit']> = {
    s: 'spade', h: 'heart', d: 'diamond', c: 'club',
  }
  return { rank: rankMap[code[0]] as Card['rank'], suit: suitMap[code[1]] }
}

describe('cardCode', () => {
  it('encodes rank+suit', () => {
    expect(cardCode(c('Ts'))).toBe('Ts')
    expect(cardCode(c('Ah'))).toBe('Ah')
    expect(cardCode(c('2c'))).toBe('2c')
  })
})

// Real tenfour hand OUO9kYI1BE801M97znaP, 6-max, $0.50/$1.00.
// Preflop: UTG fold, HJ raise 2.5, CO raise 7.5, BTN fold, SB fold, BB fold, HJ call 7.5
// Flop [5d Ts 4s]: HJ check, CO bet 4.13, HJ call
// Turn [9s]: check, check ; River [5h]: check, check
function tenfourHand(): Hand {
  const h = createHand(6)
  h.sb = 0.5
  h.bb = 1
  h.defaultStack = 100
  h.heroPos = 'SB'
  h.heroCards = [c('7s'), c('8c')]
  h.board = [c('5d'), c('Ts'), c('4s'), c('9s'), c('5h')]
  h.actions.preflop = [
    { pos: 'UTG', type: 'fold' },
    { pos: 'HJ', type: 'raise', toAmount: 2.5 },
    { pos: 'CO', type: 'raise', toAmount: 7.5 },
    { pos: 'BTN', type: 'fold' },
    { pos: 'SB', type: 'fold' },
    { pos: 'BB', type: 'fold' },
    { pos: 'HJ', type: 'call' },
  ]
  h.actions.flop = [
    { pos: 'HJ', type: 'check' },
    { pos: 'CO', type: 'bet', toAmount: 4.13 },
    { pos: 'HJ', type: 'call' },
  ]
  h.actions.turn = [
    { pos: 'HJ', type: 'check' },
    { pos: 'CO', type: 'check' },
  ]
  h.actions.river = [
    { pos: 'HJ', type: 'check' },
    { pos: 'CO', type: 'check' },
  ]
  return h
}

describe('formatPokerStars', () => {
  const text = formatPokerStars(tenfourHand(), {
    handId: '900000001',
    dateStr: '2026/02/11 15:18:45',
  })

  it('has a valid header line', () => {
    expect(text).toMatch(/^PokerStars Hand #900000001: {2}Hold'em No Limit \(\$0\.50\/\$1\.00 USD\) - 2026\/02\/11 15:18:45 ET$/m)
  })

  it('declares 6-max and a button seat', () => {
    expect(text).toMatch(/Table 'TenFour' 6-max Seat #\d is the button/)
  })

  it('posts blinds (hero is in the SB here)', () => {
    expect(text).toContain('Hero: posts small blind $0.50')
    expect(text).toContain('BB: posts big blind $1.00')
  })

  it('marks hero hole cards', () => {
    expect(text).toContain('Dealt to Hero [7s 8c]')
  })

  it('formats the preflop raise wording (raises BY to TOTAL)', () => {
    expect(text).toContain('HJ: raises $1.50 to $2.50') // 2.50 over BB 1.00
    expect(text).toContain('CO: raises $5.00 to $7.50') // 7.50 over 2.50
    expect(text).toContain('HJ: calls $5.00') // 7.50 - already-in 2.50
  })

  it('formats flop bet/call', () => {
    expect(text).toContain('*** FLOP *** [5d Ts 4s]')
    expect(text).toContain('CO: bets $4.13')
    expect(text).toContain('HJ: calls $4.13')
  })

  it('emits turn and river markers', () => {
    expect(text).toContain('*** TURN *** [5d Ts 4s] [9s]')
    expect(text).toContain('*** RIVER *** [5d Ts 4s 9s] [5h]')
  })

  it('SB is the hero name in seats', () => {
    expect(text).toMatch(/Seat \d: Hero \(\$100\.00 in chips\)/)
  })
})

describe('computeTotalPot', () => {
  it('sums committed across streets', () => {
    // Preflop: HJ 7.5 + CO 7.5 + SB 0.5 + BB 1.0 = 16.5; flop 4.13 + 4.13 = 8.26
    const pot = computeTotalPot(tenfourHand())
    expect(pot).toBeCloseTo(24.76, 2)
  })
})

describe('betting engine', () => {
  it('preflop first to act is UTG in 6-max', () => {
    const h = createHand(6)
    const st = stateForStreet(h, 'preflop')
    expect(st.toAct).toBe('UTG')
  })

  it('facing the BB, UTG can fold/call/raise', () => {
    const h = createHand(6)
    const st = stateForStreet(h, 'preflop')
    const types = legalActions(h, st).map(a => a.type).sort()
    expect(types).toEqual(['call', 'fold', 'raise'])
  })

  it('BB gets the option when folded around', () => {
    const h = createHand(6)
    h.actions.preflop = [
      { pos: 'UTG', type: 'fold' },
      { pos: 'HJ', type: 'fold' },
      { pos: 'CO', type: 'fold' },
      { pos: 'BTN', type: 'fold' },
      { pos: 'SB', type: 'call' },
    ]
    const st = stateForStreet(h, 'preflop')
    expect(st.toAct).toBe('BB')
    const types = legalActions(h, st).map(a => a.type).sort()
    expect(types).toEqual(['check', 'raise'])
  })

  it('postflop first to act is SB', () => {
    const h = createHand(6)
    h.actions.preflop = [
      { pos: 'UTG', type: 'fold' },
      { pos: 'HJ', type: 'fold' },
      { pos: 'CO', type: 'fold' },
      { pos: 'BTN', type: 'call' },
      { pos: 'SB', type: 'call' },
      { pos: 'BB', type: 'check' },
    ]
    const st = stateForStreet(h, 'flop')
    expect(st.toAct).toBe('SB')
  })

  it('detects the street closing after a check-around', () => {
    const h = createHand(6)
    h.actions.preflop = [
      { pos: 'UTG', type: 'fold' },
      { pos: 'HJ', type: 'fold' },
      { pos: 'CO', type: 'fold' },
      { pos: 'BTN', type: 'fold' },
      { pos: 'SB', type: 'call' },
      { pos: 'BB', type: 'check' },
    ]
    h.actions.flop = [
      { pos: 'SB', type: 'check' },
      { pos: 'BB', type: 'check' },
    ]
    const st = stateForStreet(h, 'flop')
    expect(st.closed).toBe(true)
    expect(st.toAct).toBeNull()
  })
})
