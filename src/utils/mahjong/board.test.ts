import { describe, expect, it } from 'vitest'
import { applyDraw, applyRon, applyTsumo, newBoard, roundLabel, seatWind, toggleRiichi } from './board'

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)

describe('麻雀点数管理（3人打ち）', () => {
  it('子のロンで親が流れる', () => {
    const s = applyRon(newBoard(), 1, 2, 4000)
    expect(s.points).toEqual([35000, 39000, 31000])
    expect(s.dealer).toBe(1)
    expect(roundLabel(s)).toBe('東2局')
    expect(s.honba).toBe(0)
    expect(seatWind(s, 1)).toBe(0)
    expect(seatWind(s, 2)).toBe(1)
    expect(seatWind(s, 0)).toBe(2)
  })

  it('親のロンは連荘で本場が積まれ、次のロンで本場とリーチ棒が付く', () => {
    let s = applyRon(newBoard(), 0, 1, 2000)
    expect(s.dealer).toBe(0)
    expect(s.honba).toBe(1)
    s = toggleRiichi(s, 2)
    expect(s.points[2]).toBe(34000)
    expect(s.kyotaku).toBe(1)
    s = applyRon(s, 1, 2, 1000)
    // 1000 + 300 を払い、和了者はリーチ棒 1000 も貰う
    expect(s.points[2]).toBe(32700)
    expect(s.points[1]).toBe(33000 + 1300 + 1000)
    expect(s.kyotaku).toBe(0)
    expect(s.riichi).toEqual([0, 0, 0])
    expect(sum(s.points)).toBe(105000)
  })

  it('子のツモと親のツモ（本場込み）', () => {
    let s = { ...newBoard(), honba: 2 }
    s = applyTsumo(s, 1, 3000, 5000)
    // 子 3000+200、親 5000+200
    expect(s.points).toEqual([29800, 43400, 31800])
    s = { ...newBoard(), honba: 1 }
    s = applyTsumo(s, 0, 6000, 0)
    expect(s.points).toEqual([47200, 28900, 28900])
    expect(s.dealer).toBe(0)
    expect(s.honba).toBe(2)
  })

  it('流局のノーテン罰符と親の移動', () => {
    let s = applyDraw(newBoard(), [false, true, false])
    expect(s.points).toEqual([33500, 38000, 33500])
    expect(s.dealer).toBe(1)
    expect(s.honba).toBe(1)
    s = applyDraw(s, [true, true, false])
    expect(s.points).toEqual([35000, 39500, 30500])
    expect(s.dealer).toBe(1)
    expect(s.honba).toBe(2)
  })

  it('リーチ → ダブリー → 取り消し', () => {
    let s = toggleRiichi(newBoard(), 0)
    expect([s.riichi[0], s.points[0], s.kyotaku]).toEqual([1, 34000, 1])
    s = toggleRiichi(s, 0)
    expect([s.riichi[0], s.points[0], s.kyotaku]).toEqual([2, 34000, 1])
    s = toggleRiichi(s, 0)
    expect([s.riichi[0], s.points[0], s.kyotaku]).toEqual([0, 35000, 0])
  })

  it('東3局のあとは南1局', () => {
    let s = newBoard()
    for (let i = 0; i < 3; i++) s = applyRon(s, (s.dealer + 1) % 3, s.dealer, 1000)
    expect(roundLabel(s)).toBe('南1局')
    expect(s.dealer).toBe(0)
  })
})
