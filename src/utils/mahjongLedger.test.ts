import { describe, it, expect } from 'vitest'
import {
  roundGosha,
  computeRanks,
  calcGame,
  calcSettlements,
  venueTotal,
  splitEvenly,
  type Game,
  type GameEntry,
  type LedgerSettings,
} from './mahjongLedger'

const settings: LedgerSettings = {
  startPoints: 25000,
  returnPoints: 30000,
  uma4: [20, 10, -10, -20],
  uma3: [20, 0, -20],
  rate: 50,
  tobiBonus: 0,
}

function game(rows: [string, number, number][]): Game {
  const entries: GameEntry[] = rows.map(([memberId, points, rank]) => ({
    memberId,
    points,
    rank,
    playing: true,
  }))
  return { id: 'g1', entries }
}

describe('roundGosha', () => {
  it('0.5は切り捨て、0.6から切り上げ', () => {
    expect(roundGosha(11500)).toBe(11)
    expect(roundGosha(11600)).toBe(12)
    expect(roundGosha(11400)).toBe(11)
    expect(roundGosha(11000)).toBe(11)
  })

  it('負の値は絶対値で判定する', () => {
    expect(roundGosha(-11500)).toBe(-11)
    expect(roundGosha(-11600)).toBe(-12)
    expect(roundGosha(-500)).toBe(0)
    expect(roundGosha(-600)).toBe(-1)
  })

  it('0は0', () => {
    expect(roundGosha(0)).toBe(0)
  })
})

describe('computeRanks', () => {
  it('素点の多い順に順位を振る', () => {
    const g = game([
      ['a', 20000, 1],
      ['b', 45000, 2],
      ['c', 25000, 3],
      ['d', 10000, 4],
    ])
    expect(computeRanks(g.entries)).toEqual([3, 1, 2, 4])
  })

  it('同点は現在の順位を優先する', () => {
    const g = game([
      ['a', 25000, 3],
      ['b', 25000, 1],
      ['c', 25000, 2],
      ['d', 25000, 4],
    ])
    expect(computeRanks(g.entries)).toEqual([3, 1, 2, 4])
  })
})

describe('calcGame', () => {
  it('4人打ち: ウマとオカが乗り、合計は0になる', () => {
    const result = calcGame(
      game([
        ['a', 45000, 1],
        ['b', 30000, 2],
        ['c', 15000, 3],
        ['d', 10000, 4],
      ]),
      settings
    )
    // b: 0 + 10 = 10 / c: -15 - 10 = -25 / d: -20 - 20 = -40
    // a: -(10 - 25 - 40) = 55  （素点15 + ウマ20 + オカ20）
    const byId = Object.fromEntries(result.results.map(r => [r.memberId, r.score]))
    expect(byId).toEqual({ a: 55, b: 10, c: -25, d: -40 })
    expect(result.results.reduce((s, r) => s + r.score, 0)).toBe(0)
    expect(result.pointsValid).toBe(true)
  })

  it('金額はレート（1000点あたりの円）を掛けたもの', () => {
    const result = calcGame(
      game([
        ['a', 45000, 1],
        ['b', 30000, 2],
        ['c', 15000, 3],
        ['d', 10000, 4],
      ]),
      settings
    )
    const byId = Object.fromEntries(result.results.map(r => [r.memberId, r.yen]))
    expect(byId).toEqual({ a: 2750, b: 500, c: -1250, d: -2000 })
    expect(result.results.reduce((s, r) => s + r.yen, 0)).toBe(0)
  })

  it('端数は五捨六入され、トップが差分を吸収する', () => {
    const result = calcGame(
      game([
        ['a', 40500, 1],
        ['b', 32400, 2],
        ['c', 17600, 3],
        ['d', 9500, 4],
      ]),
      settings
    )
    // b: 2 + 10 = 12 / c: -12 - 10 = -22 / d: -20.5→-20 - 20 = -40
    const byId = Object.fromEntries(result.results.map(r => [r.memberId, r.score]))
    expect(byId).toEqual({ a: 50, b: 12, c: -22, d: -40 })
    expect(result.results.reduce((s, r) => s + r.score, 0)).toBe(0)
  })

  it('3人打ちは3人用のウマを使う', () => {
    const three: LedgerSettings = { ...settings, startPoints: 35000, returnPoints: 40000 }
    const result = calcGame(
      game([
        ['a', 50000, 1],
        ['b', 35000, 2],
        ['c', 20000, 3],
      ]),
      three
    )
    // b: -5 + 0 = -5 / c: -20 - 20 = -40 / a: 45
    const byId = Object.fromEntries(result.results.map(r => [r.memberId, r.score]))
    expect(byId).toEqual({ a: 45, b: -5, c: -40 })
    expect(result.results.reduce((s, r) => s + r.score, 0)).toBe(0)
  })

  it('不参加のメンバーは計算に含めない', () => {
    const g = game([
      ['a', 45000, 1],
      ['b', 30000, 2],
      ['c', 15000, 3],
      ['d', 10000, 4],
    ])
    g.entries.push({ memberId: 'e', points: 0, rank: 5, playing: false })
    const result = calcGame(g, settings)
    expect(result.count).toBe(4)
    expect(result.results.some(r => r.memberId === 'e')).toBe(false)
    expect(result.pointsValid).toBe(true)
  })

  it('素点合計が配給原点×人数と合わない場合は不一致を返す', () => {
    const result = calcGame(
      game([
        ['a', 45000, 1],
        ['b', 30000, 2],
        ['c', 15000, 3],
        ['d', 20000, 4],
      ]),
      settings
    )
    expect(result.pointsValid).toBe(false)
    expect(result.totalPoints).toBe(110000)
  })
})

describe('飛び', () => {
  it('素点がマイナスの人にはtobiフラグが立つ', () => {
    const result = calcGame(
      game([
        ['a', 60000, 1],
        ['b', 30000, 2],
        ['c', 15000, 3],
        ['d', -5000, 4],
      ]),
      settings
    )
    const tobi = result.results.filter(r => r.tobi).map(r => r.memberId)
    expect(tobi).toEqual(['d'])
  })

  it('飛ばした人が未指定ならトビ賞はトップへ渡り、合計は0のまま', () => {
    const withTobi: LedgerSettings = { ...settings, tobiBonus: 10 }
    const rows: [string, number, number][] = [
      ['a', 60000, 1],
      ['b', 30000, 2],
      ['c', 15000, 3],
      ['d', -5000, 4],
    ]
    const base = calcGame(game(rows), settings)
    const bonus = calcGame(game(rows), withTobi)
    const scoreOf = (r: typeof base, id: string) =>
      r.results.find(x => x.memberId === id)!.score

    expect(scoreOf(bonus, 'd')).toBe(scoreOf(base, 'd') - 10)
    expect(scoreOf(bonus, 'a')).toBe(scoreOf(base, 'a') + 10)
    expect(scoreOf(bonus, 'b')).toBe(scoreOf(base, 'b'))
    expect(bonus.results.reduce((s, r) => s + r.score, 0)).toBe(0)
    expect(bonus.results.find(r => r.memberId === 'd')!.tobiBy).toBe('a')
  })

  it('飛ばした人を指定するとその人がトビ賞を受け取る', () => {
    const withTobi: LedgerSettings = { ...settings, tobiBonus: 10 }
    const rows: [string, number, number][] = [
      ['a', 60000, 1],
      ['b', 30000, 2],
      ['c', 15000, 3],
      ['d', -5000, 4],
    ]
    const g = game(rows)
    g.entries.find(e => e.memberId === 'd')!.tobiBy = 'b'
    const base = calcGame(game(rows), settings)
    const bonus = calcGame(g, withTobi)
    const scoreOf = (r: typeof base, id: string) =>
      r.results.find(x => x.memberId === id)!.score

    expect(scoreOf(bonus, 'd')).toBe(scoreOf(base, 'd') - 10)
    expect(scoreOf(bonus, 'b')).toBe(scoreOf(base, 'b') + 10)
    expect(scoreOf(bonus, 'a')).toBe(scoreOf(base, 'a'))
    expect(bonus.results.reduce((s, r) => s + r.score, 0)).toBe(0)
    expect(bonus.results.find(r => r.memberId === 'd')!.tobiBy).toBe('b')
  })

  it('参加していない人を指定した場合はトップに戻す', () => {
    const withTobi: LedgerSettings = { ...settings, tobiBonus: 10 }
    const g = game([
      ['a', 60000, 1],
      ['b', 30000, 2],
      ['c', 15000, 3],
      ['d', -5000, 4],
    ])
    g.entries.find(e => e.memberId === 'd')!.tobiBy = 'zzz'
    const bonus = calcGame(g, withTobi)
    expect(bonus.results.find(r => r.memberId === 'd')!.tobiBy).toBe('a')
    expect(bonus.results.reduce((s, r) => s + r.score, 0)).toBe(0)
  })

  it('2人が飛んだ場合もそれぞれの相手へ渡る', () => {
    const withTobi: LedgerSettings = { ...settings, tobiBonus: 10 }
    const g = game([
      ['a', 70000, 1],
      ['b', 35000, 2],
      ['c', -2000, 3],
      ['d', -3000, 4],
    ])
    g.entries.find(e => e.memberId === 'c')!.tobiBy = 'b'
    const base = calcGame(
      game([
        ['a', 70000, 1],
        ['b', 35000, 2],
        ['c', -2000, 3],
        ['d', -3000, 4],
      ]),
      settings
    )
    const bonus = calcGame(g, withTobi)
    const scoreOf = (r: typeof base, id: string) =>
      r.results.find(x => x.memberId === id)!.score

    expect(scoreOf(bonus, 'c')).toBe(scoreOf(base, 'c') - 10)
    expect(scoreOf(bonus, 'd')).toBe(scoreOf(base, 'd') - 10)
    expect(scoreOf(bonus, 'b')).toBe(scoreOf(base, 'b') + 10) // cを飛ばした
    expect(scoreOf(bonus, 'a')).toBe(scoreOf(base, 'a') + 10) // dを飛ばした（未指定→トップ）
    expect(bonus.results.reduce((s, r) => s + r.score, 0)).toBe(0)
  })
})

describe('場所代', () => {
  it('メンバーごとの金額を合計する（削除済みメンバーは無視）', () => {
    const fee = { fees: { a: 1000, b: 500, c: 0, zzz: 9999 }, payerId: null }
    expect(venueTotal(fee, ['a', 'b', 'c', 'd'])).toBe(1500)
  })

  it('総額の等分は切り上げ', () => {
    expect(splitEvenly(4000, 4)).toBe(1000)
    expect(splitEvenly(1000, 3)).toBe(334)
    expect(splitEvenly(0, 4)).toBe(0)
    expect(splitEvenly(4000, 0)).toBe(0)
  })
})

describe('calcSettlements', () => {
  it('最小の送金回数で精算する', () => {
    const s = calcSettlements([
      { name: 'a', yen: 2750 },
      { name: 'b', yen: 500 },
      { name: 'c', yen: -1250 },
      { name: 'd', yen: -2000 },
    ])
    expect(s).toEqual([
      { from: 'd', to: 'a', amount: 2000 },
      { from: 'c', to: 'a', amount: 750 },
      { from: 'c', to: 'b', amount: 500 },
    ])
  })

  it('全員±0なら送金なし', () => {
    expect(calcSettlements([{ name: 'a', yen: 0 }, { name: 'b', yen: 0 }])).toEqual([])
  })
})
