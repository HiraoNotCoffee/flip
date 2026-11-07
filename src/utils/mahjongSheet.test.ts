import { describe, expect, test } from 'vitest'
import {
  columnTotals,
  rowStatus,
  rowSum,
  toYen,
  orderCharges,
  venueBill,
  venueBalance,
  venueWeights,
  venueShares,
  yenPerPoint,
} from './mahjongSheet'

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
    expect(toYen(25, yenPerPoint('tenpin', 0))).toBe(2500)
    expect(toYen(25, yenPerPoint('tengo', 0))).toBe(1250)
    expect(toYen(-5.5, yenPerPoint('tengo', 0))).toBe(-275)
  })

  test('自由入力のレート（テンサン = 1pt 30円 など）', () => {
    expect(yenPerPoint('custom', 30)).toBe(30)
    expect(toYen(25, yenPerPoint('custom', 30))).toBe(750)
    expect(toYen(-12.3, yenPerPoint('custom', 30))).toBe(-369)
    // 自由を選んでいないときは入力値を使わない
    expect(yenPerPoint('tenpin', 30)).toBe(100)
  })
})

describe('場代', () => {
  test('割り切れるときは均等', () => {
    expect(venueShares(8000, [1, 1, 1, 1])).toEqual([2000, 2000, 2000, 2000])
  })

  test('割り切れない分は前の人から1円ずつ。合計はぴったり', () => {
    const shares = venueShares(7000, [1, 1, 1])
    expect(shares).toEqual([2334, 2333, 2333])
    expect(shares.reduce((a, b) => a + b, 0)).toBe(7000)
  })

  test('立て替えた人がプラス、ほかの人がマイナスになり、合計は 0', () => {
    expect(venueBalance([8000, 0, 0, 0])).toEqual([6000, -2000, -2000, -2000])
    const b = venueBalance([3000, 2000, 0, 0])
    expect(b).toEqual([1750, 750, -1250, -1250])
    expect(b.reduce((x, y) => x + y, 0)).toBe(0)
  })

  test('いた時間の比率で按分する', () => {
    // 6時間ずっといた人と3時間の人は 2:1
    expect(venueShares(9000, [6, 3])).toEqual([6000, 3000])
    expect(venueShares(12000, [6, 6, 6, 3, 3])).toEqual([3000, 3000, 3000, 1500, 1500])
    expect(venueBalance([12000, 0, 0, 0, 0], [6, 6, 6, 3, 3])).toEqual([9000, -3000, -3000, -1500, -1500])
  })

  test('割り切れなくても、小数の時間でも、合計はぴったり', () => {
    for (const [total, weights] of [
      [10000, [5, 3.5, 2.25, 1]],
      [7001, [1.5, 1.5, 1.5]],
      [1, [3, 2, 1]],
      [9999, [0.1, 0.2, 0.3, 7]],
    ] as [number, number[]][]) {
      const shares = venueShares(total, weights)
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total)
      shares.forEach(v => expect(Number.isInteger(v)).toBe(true))
    }
  })

  test('0時間の人は負担 0。全員 0 なら均等割り', () => {
    expect(venueShares(6000, [3, 3, 0])).toEqual([3000, 3000, 0])
    expect(venueShares(6000, [0, 0, 0])).toEqual([2000, 2000, 2000])
  })

  test('空欄の人は全体の時間いた扱い', () => {
    expect(venueWeights([null, 3, null], 6)).toEqual([6, 3, 6])
    // 全体の時間が空欄なら、入っている中で一番長い時間
    expect(venueWeights([null, 3, 5], null)).toEqual([5, 3, 5])
    // 0時間と入れた人は空欄と区別する
    expect(venueWeights([0, null], 4)).toEqual([0, 4])
    // 何も入っていなければ均等
    expect(venueWeights([null, null], null)).toEqual([1, 1])
  })

  test('だれも払っていなければ 0', () => {
    expect(venueBalance([0, 0, 0])).toEqual([0, 0, 0])
  })
})

describe('お会計と個別の注文', () => {
  const equal = [1, 1, 1, 1]

  test('合計2万円のうち A と B がレッドブル500円', () => {
    const bill = venueBill([20000, 0, 0, 0], equal, [
      { label: 'レッドブル', yen: 500, eaters: [0, 1], mode: 'each' },
    ])
    expect(bill.shares).toEqual([5250, 5250, 4750, 4750])
    expect(bill.shares.reduce((a, b) => a + b, 0)).toBe(20000)
    expect(bill.balance).toEqual([14750, -5250, -4750, -4750])
    expect(bill.over).toBe(false)
  })

  test('みんなで割る注文は、頼んだ人で割り勘', () => {
    expect(orderCharges([{ label: 'ピザ', yen: 1000, eaters: [0, 1, 2], mode: 'split' }], 4)).toEqual([334, 333, 333, 0])
  })

  test('いた時間で按分する場合も、注文は頼んだ人に足す', () => {
    const bill = venueBill([0, 10000, 0, 0], [4, 4, 2, 2], [{ label: '焼きそば', yen: 800, eaters: [3], mode: 'each' }])
    // (10000 − 800) を 4:4:2:2 で割る → 3067, 3067, 1533, 1533（端数は合計ぴったり）+ 焼きそば
    expect(bill.shares.reduce((a, b) => a + b, 0)).toBe(10000)
    expect(bill.shares[3] - bill.shares[2]).toBe(800)
  })

  test('注文の合計がお会計より多ければ over', () => {
    const bill = venueBill([500, 0, 0], [1, 1, 1], [{ label: 'x', yen: 400, eaters: [0, 1], mode: 'each' }])
    expect(bill.over).toBe(true)
  })

  test('頼んだ人がいない・金額 0 の注文は無視', () => {
    expect(orderCharges([{ label: '', yen: 0, eaters: [1], mode: 'each' }, { label: 'y', yen: 300, eaters: [], mode: 'each' }], 3)).toEqual([0, 0, 0])
  })
})
