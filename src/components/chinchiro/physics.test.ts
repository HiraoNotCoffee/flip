import { describe, expect, test } from 'vitest'
import { writeFileSync } from 'node:fs'
import { DicePhysics, HAND_HOME, SETTLE_SECONDS } from './physics'

/** 手の位置から投げて、止まるまで物理演算を回す */
function roll(vx: number, vz: number, vy = 0) {
  const p = new DicePhysics()
  p.placeInHand(HAND_HOME)
  p.launch(vx, vz, vy)
  return settle(p)
}

function shake(strength: number, dirX: number, dirZ: number) {
  const p = new DicePhysics()
  p.throwInto(strength, dirX, dirZ)
  return settle(p)
}

function settle(p: DicePhysics) {
  let still = 0
  let path = 0
  for (let t = 0; t < 15; t += 1 / 60) {
    const before = p.dice.map(b => [b.position.x, b.position.z])
    p.step(1 / 60)
    p.dice.forEach((b, i) => { path += Math.hypot(b.position.x - before[i][0], b.position.z - before[i][1]) / 3 })
    still = p.isStill() ? still + 1 / 60 : 0
    if (still > SETTLE_SECONDS) return { ...p.read(), time: t, path }
  }
  return { ...p.read(), time: Infinity, path }
}

describe('ちんちろの物理演算', () => {
  test('同じ投げ方なら同じ結果になる（アプリの乱数を使っていない）', () => {
    expect(roll(1.5, -8)).toEqual(roll(1.5, -8))
  })

  test('そっと落とせばお椀に収まって止まる', () => {
    for (const [vx, vz] of [[0, 0], [0, -3], [1, -6], [-2, -5]]) {
      const r = roll(vx, vz)
      expect(r.time).toBeLessThan(15)
      expect(r.out).toBe(false)
      expect(r.values.every(v => v >= 1 && v <= 6)).toBe(true)
    }
  })

  test('普通の強さで投げてもションベンにならない', () => {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      expect(shake(0.5, Math.cos(a), Math.sin(a)).out).toBe(false)
    }
  })

  test('思いきり投げると、跳ね返ってションベンになることがある', () => {
    let out = 0
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      if (shake(1, Math.cos(a), Math.sin(a)).out) out++
    }
    expect(out).toBeGreaterThanOrEqual(1)
  })

  test('強さごとのションベン率（調整用の目安を出力）', () => {
    const lines: string[] = []
    for (const speed of [5, 10, 15, 20, 25, 30, 40]) {
      let out = 0
      let times = 0
      const n = 12
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i - n / 2) * 0.06
        const r = roll(Math.cos(a) * speed, Math.sin(a) * speed)
        if (r.out) out++
        times += r.time
      }
      lines.push(`speed ${speed}: ションベン ${out}/${n} 止まるまで平均 ${(times / n).toFixed(1)}秒`)
    }
    for (const strength of [0, 0.25, 0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
      let out = 0
      let times = 0
      let paths = 0
      const n = 16
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        const r = shake(strength, Math.cos(a), Math.sin(a))
        if (r.out) out++
        times += r.time
        paths += r.path
      }
      lines.push(`強さ ${strength}: ションベン ${out}/${n} 止まるまで平均 ${(times / n).toFixed(1)}秒 動いた距離 ${(paths / n).toFixed(1)}`)
    }
    if (process.env.CHINCHIRO_REPORT) writeFileSync(process.env.CHINCHIRO_REPORT, lines.join('\n'))
  }, 60_000)
})
