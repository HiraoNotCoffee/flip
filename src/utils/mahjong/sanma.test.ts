import { describe, expect, test } from 'vitest'
import { calcBasePoints, calcPayments, calcSanmaTsumo } from './score'

const base = (han: number, fu: number) => calcBasePoints(han, fu, 0).base

describe('三人麻雀・ツモ損なし', () => {
  test('満貫は子 3000/5000、親 6000オール（ロンと同じ合計）', () => {
    expect(calcSanmaTsumo(base(5, 30), false)).toEqual({ fromNonDealer: 3000, fromDealer: 5000, total: 8000 })
    expect(calcSanmaTsumo(base(5, 30), true)).toEqual({ fromEach: 6000, total: 12000 })
  })

  test('30符1翻は子 400/600、親 800オール', () => {
    expect(calcSanmaTsumo(base(1, 30), false)).toEqual({ fromNonDealer: 400, fromDealer: 600, total: 1000 })
    expect(calcSanmaTsumo(base(1, 30), true)).toEqual({ fromEach: 800, total: 1600 })
  })

  test('ツモの合計はロンを下回らない（ツモ損なし）', () => {
    for (const fu of [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110]) {
      for (const han of [1, 2, 3, 4, 5, 6, 8, 11, 13]) {
        const b = base(han, fu)
        for (const dealer of [false, true]) {
          const ron = calcPayments(b, dealer, 'ron', 0, 0).ronFrom!
          expect(calcSanmaTsumo(b, dealer).total).toBeGreaterThanOrEqual(ron)
        }
      }
    }
  })
})
