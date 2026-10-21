import { describe, expect, test } from 'vitest'
import { columnTotals, rowStatus, rowSum, toYen, venueBalance, venueShares } from './mahjongSheet'

describe('点数表', () => {
  test('行の合計が 0 かどうか', () => {
    expect(rowStatus([45, 5, -15, -35])).toBe('zero')
    expect(rowStatus([45, 5, -15, -30])).toBe('over')
    expect(rowStatus([45, 5, -15, -40])).toBe('under')
    expect(rowStatus([null, null, null, null])).toBe('empty')
  })

  test('途中まで入れた行も、入っている分で判定する', () => {
    expect(rowSum([30, null, null, null])).toBe(30)
    expect(rowStatus([30, -30, null, null])).toBe('zero')
  })

  test('小数を足しても誤差が出ない', () => {
    expect(rowSum([0.1, 0.2, -0.3, 0])).toBe(0)
    expect(rowStatus([12.3, 4.5, -6.7, -10.1])).toBe('zero')
  })

  test('列ごとの合計と金額', () => {
    const rows = [
      [45, 5, -15, -35],
      [-20, 30, 10, -20],
      [null, null, null, null],
    ]
    expect(columnTotals(rows, 4)).toEqual([25, 35, -5, -55])
    expect(toYen(25, 'tenpin')).toBe(2500)
    expect(toYen(25, 'tengo')).toBe(1250)
    expect(toYen(-5.5, 'tengo')).toBe(-275)
  })
})

describe('場代', () => {
  test('割り切れるときは均等', () => {
    expect(venueShares(8000, 4)).toEqual([2000, 2000, 2000, 2000])
  })

  test('割り切れない分は前の人から1円ずつ。合計はぴったり', () => {
    const shares = venueShares(7000, 3)
    expect(shares).toEqual([2334, 2333, 2333])
    expect(shares.reduce((a, b) => a + b, 0)).toBe(7000)
  })

  test('立て替えた人がプラス、ほかの人がマイナスになり、合計は 0', () => {
    expect(venueBalance([8000, 0, 0, 0])).toEqual([6000, -2000, -2000, -2000])
    const b = venueBalance([3000, 2000, 0, 0])
    expect(b).toEqual([1750, 750, -1250, -1250])
    expect(b.reduce((x, y) => x + y, 0)).toBe(0)
  })

  test('だれも払っていなければ 0', () => {
    expect(venueBalance([0, 0, 0])).toEqual([0, 0, 0])
  })
})
