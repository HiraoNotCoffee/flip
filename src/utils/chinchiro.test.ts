import { describe, expect, test } from 'vitest'
import { isFinalHand, judgeChinchiro } from './chinchiro'

describe('judgeChinchiro', () => {
  test.each([
    [[1, 1, 1], { kind: 'pinzoro' }],
    [[3, 3, 3], { kind: 'zorome', value: 3 }],
    [[6, 4, 5], { kind: 'shigoro' }],
    [[3, 1, 2], { kind: 'hifumi' }],
    [[2, 5, 2], { kind: 'me', value: 5 }],
    [[6, 1, 6], { kind: 'me', value: 1 }],
    [[1, 4, 6], { kind: 'menashi' }],
  ])('%j', (dice, expected) => {
    expect(judgeChinchiro(dice)).toEqual(expected)
  })

  test('お椀の外に出たら出目に関係なくションベン', () => {
    expect(judgeChinchiro([1, 1, 1], true)).toEqual({ kind: 'shonben' })
  })

  test('目なしだけは3投目まで振り直せる', () => {
    expect(isFinalHand({ kind: 'menashi' }, 1)).toBe(false)
    expect(isFinalHand({ kind: 'menashi' }, 3)).toBe(true)
    expect(isFinalHand({ kind: 'me', value: 2 }, 1)).toBe(true)
    expect(isFinalHand({ kind: 'shonben' }, 1)).toBe(true)
  })
})
