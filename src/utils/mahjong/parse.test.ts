import { describe, it, expect } from 'vitest'
import type { Tile } from './tiles'
import { tileFromString } from './tiles'
import { enumerateInterpretations } from './parse'

// 文字列（例 '1m2m3m'）をTile[]へ変換するテスト用ヘルパー
function hs(str: string): Tile[] {
  const tiles: Tile[] = []
  for (let i = 0; i < str.length; i += 2) {
    tiles.push(tileFromString(str.slice(i, i + 2)))
  }
  return tiles
}

describe('enumerateInterpretations: 標準形の複数解釈（111222333型）', () => {
  it('刻子分岐と順子分岐の両方を列挙する', () => {
    // 111222333p + 456m + 44s（雀頭）、和了牌=1p（ロン）
    const concealed = hs('1p1p1p2p2p2p3p3p3p4m5m6m4s4s')
    const results = enumerateInterpretations(concealed, [], tileFromString('1p').kind, 'ron')
    const standardForms = results.filter((r) => r.kind === 'standard').map((r) => r.standard!)
    expect(standardForms.length).toBeGreaterThan(0)

    const hasKotsuBranch = standardForms.some((f) =>
      f.mentsu.some((m) => m.type === 'kotsu' && m.tiles[0].kind === tileFromString('1p').kind)
    )
    const hasShuntsuBranch = standardForms.some((f) =>
      f.mentsu.some(
        (m) => m.type === 'shuntsu' && m.tiles.some((t) => t.kind === tileFromString('1p').kind)
      )
    )
    expect(hasKotsuBranch).toBe(true)
    expect(hasShuntsuBranch).toBe(true)
  })
})

describe('enumerateInterpretations: 待ち種判定', () => {
  const filler = () => hs('5z5z5z6z6z6z7z7z7z') // 固定の刻子2〜3個分（曖昧さなし）

  it('両面待ち(ryanmen)を判定する', () => {
    const concealed = [...filler(), ...hs('9s9s'), ...hs('2m3m4m')]
    const win = tileFromString('2m').kind
    const results = enumerateInterpretations(concealed, [], win, 'ron')
    const waits = results.filter((r) => r.kind === 'standard').map((r) => r.standard!.wait)
    expect(waits).toContain('ryanmen')
  })

  it('嵌張待ち(kanchan)を判定する', () => {
    const concealed = [...filler(), ...hs('9s9s'), ...hs('4m5m6m')]
    const win = tileFromString('5m').kind
    const results = enumerateInterpretations(concealed, [], win, 'ron')
    const waits = results.filter((r) => r.kind === 'standard').map((r) => r.standard!.wait)
    expect(waits).toContain('kanchan')
  })

  it('辺張待ち(penchan)を判定する（12待ち3）', () => {
    const concealed = [...filler(), ...hs('9s9s'), ...hs('1m2m3m')]
    const win = tileFromString('3m').kind
    const results = enumerateInterpretations(concealed, [], win, 'ron')
    const waits = results.filter((r) => r.kind === 'standard').map((r) => r.standard!.wait)
    expect(waits).toContain('penchan')
  })

  it('辺張待ち(penchan)を判定する（89待ち7）', () => {
    const concealed = [...filler(), ...hs('9s9s'), ...hs('7m8m9m')]
    const win = tileFromString('7m').kind
    const results = enumerateInterpretations(concealed, [], win, 'ron')
    const waits = results.filter((r) => r.kind === 'standard').map((r) => r.standard!.wait)
    expect(waits).toContain('penchan')
  })

  it('シャンポン待ち(shanpon)を判定する', () => {
    const concealed = hs('5z5z5z6z6z6z4p5p6p3s3s3s8s8s')
    const win = tileFromString('3s').kind
    const results = enumerateInterpretations(concealed, [], win, 'ron')
    const standardForms = results.filter((r) => r.kind === 'standard').map((r) => r.standard!)
    expect(standardForms.some((f) => f.wait === 'shanpon')).toBe(true)
    // シャンポンで完成した刻子はロン=明刻扱い(winningRon=true)であること
    const shanponForm = standardForms.find((f) => f.wait === 'shanpon')!
    const winningKotsu = shanponForm.mentsu.find(
      (m) => m.type === 'kotsu' && m.tiles[0].kind === win
    )
    expect(winningKotsu?.winningRon).toBe(true)
  })

  it('単騎待ち(tanki)を判定する', () => {
    const concealed = [...filler(), ...hs('4p5p6p'), ...hs('9s9s')]
    const win = tileFromString('9s').kind
    const results = enumerateInterpretations(concealed, [], win, 'tsumo')
    const waits = results.filter((r) => r.kind === 'standard').map((r) => r.standard!.wait)
    expect(waits).toContain('tanki')
  })
})

describe('enumerateInterpretations: 七対子検出', () => {
  it('7種2枚ずつなら七対子として検出される', () => {
    const concealed = hs('1m1m2m2m3m3m4p4p5p5p6s6s7z7z')
    const win = tileFromString('7z').kind
    const results = enumerateInterpretations(concealed, [], win, 'ron')
    expect(results.some((r) => r.kind === 'chiitoi')).toBe(true)
    const chiitoi = results.find((r) => r.kind === 'chiitoi')!.chiitoi!
    expect(chiitoi.pairs.length).toBe(7)
  })

  it('同種4枚を含む場合は七対子として検出されない', () => {
    const concealed = hs('1m1m1m1m2m2m3m3m4p4p5p5p6s6s')
    const win = tileFromString('6s').kind
    const results = enumerateInterpretations(concealed, [], win, 'ron')
    expect(results.some((r) => r.kind === 'chiitoi')).toBe(false)
  })
})

describe('enumerateInterpretations: 国士無双検出', () => {
  it('13面待ち（雀頭=和了牌）を検出する', () => {
    const concealed = hs('1m1m9m1p9p1s9s1z2z3z4z5z6z7z')
    const win = tileFromString('1m').kind
    const results = enumerateInterpretations(concealed, [], win, 'ron')
    expect(results.some((r) => r.kind === 'kokushi')).toBe(true)
    const kokushi = results.find((r) => r.kind === 'kokushi')!.kokushi!
    expect(kokushi.thirteenWait).toBe(true)
  })

  it('単騎待ち（雀頭≠和了牌）は13面待ちにならない', () => {
    const concealed = hs('1m9m9m1p9p1s9s1z2z3z4z5z6z7z')
    const win = tileFromString('7z').kind
    const results = enumerateInterpretations(concealed, [], win, 'ron')
    expect(results.some((r) => r.kind === 'kokushi')).toBe(true)
    const kokushi = results.find((r) => r.kind === 'kokushi')!.kokushi!
    expect(kokushi.thirteenWait).toBe(false)
  })

  it('幺九牌が13種揃っていない場合は国士無双として検出されない', () => {
    const concealed = hs('1m1m9m1p9p1s9s1z2z3z4z5z6z6z') // 7zがなく6zが重複
    const win = tileFromString('6z').kind
    const results = enumerateInterpretations(concealed, [], win, 'ron')
    expect(results.some((r) => r.kind === 'kokushi')).toBe(false)
  })
})
