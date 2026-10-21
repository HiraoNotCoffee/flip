import { describe, expect, test } from 'vitest'
import { columnTotals, rowStatus, rowSum, toYen } from './mahjongSheet'

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
