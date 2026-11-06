import { describe, expect, test } from 'vitest'
import { findTenpaiDiscards, findWaits, isComplete } from './waits'

/** '123m456p789s11z' のような書き方から枚数の配列を作る（z は 1=東 … 7=中） */
function hand(s: string): number[] {
  const c = new Array(34).fill(0)
  let digits: number[] = []
  for (const ch of s) {
    if (/\d/.test(ch)) digits.push(Number(ch))
    else {
      const base = { m: 0, p: 9, s: 18, z: 27 }[ch as 'm' | 'p' | 's' | 'z']
      digits.forEach(d => c[base + d - 1]++)
      digits = []
    }
  }
  return c
}

/** 待ちを '14m' のような文字列にして比べやすくする */
function waitsOf(s: string) {
  return findWaits(hand(s)).map(w => {
    const suit = 'mpsz'[Math.floor(w.kind / 9)]
    return `${(w.kind % 9) + 1}${suit}`
  })
}

describe('あがりの形', () => {
  test('4面子1雀頭', () => {
    expect(isComplete(hand('123m456p789s11122z'))).toBe(true)
    expect(isComplete(hand('123m456p789s11123z'))).toBe(false)
  })
  test('七対子と国士無双', () => {
    expect(isComplete(hand('1199m2288p3377s11z'))).toBe(true)
    expect(isComplete(hand('19m19p19s12345677z'))).toBe(true)
  })
})

describe('待ち', () => {
  test('両面・カンチャン・単騎', () => {
    expect(waitsOf('23m456p789s111z22z')).toEqual(['1m', '4m'])
    expect(waitsOf('13m456p789s111z22z')).toEqual(['2m'])
    expect(waitsOf('123m456p789s111z2z')).toEqual(['2z'])
  })

  test('純正九蓮宝燈は9面張', () => {
    expect(waitsOf('1112345678999m')).toEqual(['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m'])
  })

  test('多面張（2345678m の 3面張、3334567m の 5面張）', () => {
    expect(waitsOf('2345678m456p111z')).toEqual(['2m', '5m', '8m'])
    expect(waitsOf('3334567m456p111z')).toEqual(['2m', '4m', '5m', '7m', '8m'])
  })

  test('国士無双13面待ち', () => {
    expect(findWaits(hand('19m19p19s1234567z'))).toHaveLength(13)
  })

  test('自分で4枚使っている牌は待ちにならない', () => {
    // 1111m は 1m を使い切っているので 1m では待てない
    expect(waitsOf('1111m234p567p789s')).not.toContain('1m')
  })

  test('残り枚数は 4 − 手にある枚数', () => {
    const w = findWaits(hand('23m456p789s111z22z'))
    expect(w.map(x => x.remaining)).toEqual([4, 4])
    const w2 = findWaits(hand('1112345678999m'))
    expect(w2.find(x => x.kind === 0)?.remaining).toBe(1)
  })

  test('鳴いて手の内が少ないときも判定できる', () => {
    expect(waitsOf('23m22z')).toEqual(['1m', '4m'])
    expect(waitsOf('5z')).toEqual(['5z'])
  })

  test('ノーテンなら空', () => {
    expect(findWaits(hand('139m258p147s1234z'))).toEqual([])
  })
})

describe('14枚のとき何を切ればテンパイか', () => {
  test('切ればテンパイになる牌と待ちを出す', () => {
    const options = findTenpaiDiscards(hand('23m456p789s111z22z7z'))
    expect(options.map(o => o.discard)).toContain(33) // 中を切れば 1-4m 待ち
    const chun = options.find(o => o.discard === 33)!
    expect(chun.waits.map(w => w.kind)).toEqual([0, 3])
    expect(chun.totalRemaining).toBe(8)
  })

  test('残り枚数の多い順に並ぶ', () => {
    const options = findTenpaiDiscards(hand('2345678m456p111z9s'))
    for (let i = 1; i < options.length; i++) {
      expect(options[i - 1].totalRemaining).toBeGreaterThanOrEqual(options[i].totalRemaining)
    }
  })
})
