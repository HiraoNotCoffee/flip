import { describe, it, expect } from 'vitest'
import type { Tile } from './tiles'
import { tileFromString } from './tiles'
import { calculateScore } from './index'
import type { HandInput } from './index'

// 文字列（例 '2m3m4m'）をTile[]へ変換するテスト用ヘルパー
function h(str: string): Tile[] {
  const tiles: Tile[] = []
  for (let i = 0; i < str.length; i += 2) {
    tiles.push(tileFromString(str.slice(i, i + 2)))
  }
  return tiles
}

function baseInput(overrides: Partial<HandInput>): HandInput {
  return {
    concealed: [],
    melds: [],
    winningTile: tileFromString('1m'),
    winType: 'ron',
    isDealer: false,
    riichi: false,
    doubleRiichi: false,
    ippatsu: false,
    roundWind: tileFromString('1z').kind,
    seatWind: tileFromString('2z').kind,
    doraIndicators: [],
    uraDoraIndicators: [],
    tenho: false,
    chiho: false,
    haitei: false,
    houtei: false,
    rinshan: false,
    chankan: false,
    honba: 0,
    kyotaku: 0,
    ...overrides,
  }
}

describe('calculateScore: 基本形', () => {
  it('平和ツモ子=400/700(20符2翻)', () => {
    const concealed = h('2m3m4m4p5p6p2s3s4s6s7s8s9p9p')
    const result = calculateScore(
      baseInput({
        concealed,
        winningTile: tileFromString('6s'),
        winType: 'tsumo',
      })
    )
    expect(result.success).toBe(true)
    expect(result.han).toBe(2)
    expect(result.fu).toBe(20)
    expect(result.points.tsumoFromDealer).toBe(700)
    expect(result.points.tsumoFromNonDealer).toBe(400)
    expect(result.points.total).toBe(1500)
  })

  it('平和ロン子=1000(30符1翻)', () => {
    const concealed = h('2m3m4m4p5p6p2s3s4s6s7s8s9p9p')
    const result = calculateScore(
      baseInput({
        concealed,
        winningTile: tileFromString('6s'),
        winType: 'ron',
      })
    )
    expect(result.success).toBe(true)
    expect(result.han).toBe(1)
    expect(result.fu).toBe(30)
    expect(result.points.ronFrom).toBe(1000)
    expect(result.points.total).toBe(1000)
  })

  it('リーチのみ子ロン=1300(40符)', () => {
    const concealed = h('5m5m5m4p5p6p2s3s4s4s5s6s9m9m')
    const result = calculateScore(
      baseInput({
        concealed,
        winningTile: tileFromString('5s'),
        winType: 'ron',
        riichi: true,
      })
    )
    expect(result.success).toBe(true)
    expect(result.han).toBe(1)
    expect(result.fu).toBe(40)
    expect(result.points.total).toBe(1300)
  })

  it('七対子子ロン=1600(25符)', () => {
    const concealed = h('1m1m3m3m5p5p7p7p2s2s8s8s5z5z')
    const result = calculateScore(
      baseInput({
        concealed,
        winningTile: tileFromString('1m'),
        winType: 'ron',
      })
    )
    expect(result.success).toBe(true)
    expect(result.han).toBe(2)
    expect(result.fu).toBe(25)
    expect(result.points.total).toBe(1600)
  })

  it('喰いタン子ロン=1000', () => {
    const concealed = h('4p5p6p5s6s7s3s4s5s7p7p')
    const result = calculateScore(
      baseInput({
        concealed,
        melds: [{ type: 'chi', tiles: h('2m3m4m') }],
        winningTile: tileFromString('3s'),
        winType: 'ron',
      })
    )
    expect(result.success).toBe(true)
    expect(result.yaku.some((y) => y.name === 'タンヤオ')).toBe(true)
    expect(result.fu).toBe(30)
    expect(result.points.total).toBe(1000)
  })

  it('親平和ツモ=700オール', () => {
    const concealed = h('2m3m4m4p5p6p2s3s4s6s7s8s9p9p')
    const result = calculateScore(
      baseInput({
        concealed,
        winningTile: tileFromString('6s'),
        winType: 'tsumo',
        isDealer: true,
        roundWind: tileFromString('1z').kind,
        seatWind: tileFromString('1z').kind,
      })
    )
    expect(result.success).toBe(true)
    expect(result.han).toBe(2)
    expect(result.fu).toBe(20)
    expect(result.points.tsumoFromEach).toBe(700)
    expect(result.points.total).toBe(2100)
  })
})

describe('calculateScore: 符計算の特殊ルール', () => {
  it('喰い平和形は30符固定になる', () => {
    const concealed = h('4p5p6p5s6s7s3s4s5s7p7p')
    const result = calculateScore(
      baseInput({
        concealed,
        melds: [{ type: 'chi', tiles: h('2m3m4m') }],
        winningTile: tileFromString('3s'),
        winType: 'ron',
      })
    )
    expect(result.success).toBe(true)
    expect(result.fu).toBe(30)
  })

  it('連風牌の雀頭は+4符になる（東場東家）', () => {
    const concealed = h('1z1z2m3m4m5m6m7m2p3p4p5s6s7s')
    const result = calculateScore(
      baseInput({
        concealed,
        winningTile: tileFromString('5s'),
        winType: 'tsumo',
        isDealer: true,
        roundWind: tileFromString('1z').kind,
        seatWind: tileFromString('1z').kind,
      })
    )
    expect(result.success).toBe(true)
    expect(result.han).toBe(1) // 門前清自摸和のみ（雀頭が役牌のため平和不成立）
    expect(result.fu).toBe(30) // 20(base) + 2(tsumo) + 4(連風雀頭) = 26 -> 切上30
  })

  it('三暗刻はロンで完成した刻子を暗刻に数えない', () => {
    const concealed = h('1s1s1s9s9s9s2p3p4p5z5z5z6z6z')
    const result = calculateScore(
      baseInput({
        concealed,
        winningTile: tileFromString('5z'),
        winType: 'ron',
      })
    )
    expect(result.success).toBe(true)
    expect(result.yaku.some((y) => y.name === '三暗刻')).toBe(false)
    expect(result.yaku.some((y) => y.name === '役牌:白')).toBe(true)
  })
})

describe('calculateScore: 高い翻数・満貫以上', () => {
  it('リーチ平和三色同順 子ロン=7700(切り上げ満貫なし)', () => {
    const concealed = h('2m3m4m2p3p4p2s3s4s5p6p7p9s9s')
    const result = calculateScore(
      baseInput({
        concealed,
        winningTile: tileFromString('5p'),
        winType: 'ron',
        riichi: true,
      })
    )
    expect(result.success).toBe(true)
    expect(result.han).toBe(4)
    expect(result.fu).toBe(30)
    expect(result.points.total).toBe(7700)
  })

  it('満貫8000（リーチ・平和・ドラ3）', () => {
    const concealed = h('2m3m4m4p5p6p2s3s4s6s7s8s9p9p')
    const result = calculateScore(
      baseInput({
        concealed,
        winningTile: tileFromString('6s'),
        winType: 'ron',
        riichi: true,
        doraIndicators: [tileFromString('1m'), tileFromString('4p'), tileFromString('6s')],
      })
    )
    expect(result.success).toBe(true)
    expect(result.han).toBe(5)
    expect(result.limitName).toBe('mangan')
    expect(result.points.total).toBe(8000)
  })

  it('高点法: 二盃口(4翻7700)が七対子(1600)より優先される', () => {
    const concealed = h('1m2m3m1m2m3m4p5p6p4p5p6p9s9s')
    const result = calculateScore(
      baseInput({
        concealed,
        winningTile: tileFromString('1m'),
        winType: 'ron',
      })
    )
    expect(result.success).toBe(true)
    expect(result.yaku.some((y) => y.name === '二盃口')).toBe(true)
    expect(result.yaku.some((y) => y.name === '七対子')).toBe(false)
    expect(result.han).toBe(4)
    expect(result.fu).toBe(30)
    expect(result.points.total).toBe(7700)
  })

  it('混一色は喰い下がりで2翻になる', () => {
    const concealed = h('5p6p7p1z1z1z3z3z3z9p9p')
    const result = calculateScore(
      baseInput({
        concealed,
        melds: [{ type: 'chi', tiles: h('2p3p4p') }],
        winningTile: tileFromString('5p'),
        winType: 'ron',
        roundWind: tileFromString('2z').kind,
        seatWind: tileFromString('2z').kind,
      })
    )
    expect(result.success).toBe(true)
    const honitsu = result.yaku.find((y) => y.name === '混一色')
    expect(honitsu?.han).toBe(2)
  })

  it('赤ドラ・裏ドラが加算される', () => {
    const concealed = h('2m3m4m4p0p6p2s3s4s6s7s8s9p9p')
    const result = calculateScore(
      baseInput({
        concealed,
        winningTile: tileFromString('6s'),
        winType: 'ron',
        riichi: true,
        uraDoraIndicators: [tileFromString('1m')],
      })
    )
    expect(result.success).toBe(true)
    expect(result.akaCount).toBe(1)
    expect(result.uraDoraCount).toBe(1)
    expect(result.yaku.some((y) => y.name === '赤ドラ')).toBe(true)
    expect(result.yaku.some((y) => y.name === '裏ドラ')).toBe(true)
    expect(result.han).toBe(4) // リーチ+平和+赤1+裏1
  })
})

describe('calculateScore: 役満', () => {
  it('国士無双十三面待ち=64000', () => {
    const concealed = h('1m1m9m1p9p1s9s1z2z3z4z5z6z7z')
    const result = calculateScore(
      baseInput({
        concealed,
        winningTile: tileFromString('1m'),
        winType: 'ron',
      })
    )
    expect(result.success).toBe(true)
    expect(result.yaku.some((y) => y.name === '国士無双十三面待ち')).toBe(true)
    expect(result.points.total).toBe(64000)
  })

  it('四暗刻単騎 親ツモ=32000オール', () => {
    const concealed = h('2m2m2m5p5p5p7s7s7s3z3z3z9p9p')
    const result = calculateScore(
      baseInput({
        concealed,
        winningTile: tileFromString('9p'),
        winType: 'tsumo',
        isDealer: true,
      })
    )
    expect(result.success).toBe(true)
    expect(result.yaku.some((y) => y.name === '四暗刻単騎')).toBe(true)
    expect(result.points.tsumoFromEach).toBe(32000)
    expect(result.points.total).toBe(96000)
  })

  it('役満複合: 大三元+字一色=64000', () => {
    const concealed = h('5z5z5z6z6z6z7z7z7z1z1z1z2z2z')
    const result = calculateScore(
      baseInput({
        concealed,
        winningTile: tileFromString('1z'),
        winType: 'ron',
      })
    )
    expect(result.success).toBe(true)
    expect(result.yaku.some((y) => y.name === '大三元')).toBe(true)
    expect(result.yaku.some((y) => y.name === '字一色')).toBe(true)
    expect(result.points.total).toBe(64000)
  })

  it('純正九蓮宝燈 親ロン=96000', () => {
    const concealed = h('1m1m1m2m3m4m5m5m6m7m8m9m9m9m')
    const result = calculateScore(
      baseInput({
        concealed,
        winningTile: tileFromString('5m'),
        winType: 'ron',
        isDealer: true,
      })
    )
    expect(result.success).toBe(true)
    expect(result.yaku.some((y) => y.name === '純正九蓮宝燈')).toBe(true)
    expect(result.points.total).toBe(96000)
  })
})

describe('calculateScore: エラーケース', () => {
  it('役がない場合はno_yakuエラーになる', () => {
    // 喰いチー(1m2m3m) + 4p5p6p + 7s8s9s + 2s3s4s + 雀頭9m9m
    // タンヤオ(1m,9s,9m有)・役牌・平和(非門前)・三色・一気通貫・チャンタ等いずれも不成立
    const concealed = h('4p5p6p7s8s9s2s3s4s9m9m')
    const result = calculateScore(
      baseInput({
        concealed,
        melds: [{ type: 'chi', tiles: h('1m2m3m') }],
        winningTile: tileFromString('9m'),
        winType: 'ron',
      })
    )
    expect(result.success).toBe(false)
    expect(result.error).toBe('no_yaku')
  })

  it('入力枚数が不正な場合はinvalid_inputエラーになる', () => {
    const concealed = h('2m3m4m4p5p6p2s3s4s6s7s8s9p') // 13枚（本来14枚必要）
    const result = calculateScore(
      baseInput({
        concealed,
        winningTile: tileFromString('6s'),
        winType: 'ron',
      })
    )
    expect(result.success).toBe(false)
    expect(result.error).toBe('invalid_input')
  })
})
