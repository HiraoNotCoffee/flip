// 精算の2方式が、どちらも「各自の収支ぴったり」になることを確かめる。
// お金の話なので、合計が合わない計算を出すわけにいかない。
import { describe, it, expect } from 'vitest'
import { hubTransfers, minimalTransfers, type Balance } from './settlement'

type Player = Balance

/** 送金を全部適用した結果、各自がいくら受け取ったことになるか。 */
function netFromRows(rows: { from: string; to: string; amount: number }[]) {
  const net: Record<string, number> = {}
  for (const r of rows) {
    net[r.from] = (net[r.from] ?? 0) - r.amount
    net[r.to] = (net[r.to] ?? 0) + r.amount
  }
  return net
}

const TABLE: Player[] = [
  { name: 'たろう', amount: 12000 },
  { name: 'はなこ', amount: 5000 },
  { name: 'さとう', amount: -7000 },
  { name: 'すずき', amount: -4000 },
  { name: 'いとう', amount: -6000 },
]

describe('Settlement 2 (hub)', () => {
  it('sends every loser to the single biggest winner', () => {
    const { hub, rows } = hubTransfers(TABLE)
    expect(hub).toBe('たろう')
    const toHub = rows.filter(r => r.to === 'たろう')
    expect(toHub.map(r => r.from).sort()).toEqual(['いとう', 'さとう', 'すずき'])
  })

  it('then has the hub pay out the other winners', () => {
    const { rows } = hubTransfers(TABLE)
    const fromHub = rows.filter(r => r.from === 'たろう')
    expect(fromHub).toEqual([{ from: 'たろう', to: 'はなこ', amount: 5000 }])
  })

  it('settles everyone to exactly their own result', () => {
    const net = netFromRows(hubTransfers(TABLE).rows)
    for (const p of TABLE) expect(net[p.name] ?? 0).toBe(p.amount)
  })

  it('everyone except the hub deals with exactly one person', () => {
    const { rows } = hubTransfers(TABLE)
    for (const p of TABLE) {
      if (p.name === 'たろう') continue
      const partners = new Set(
        rows.filter(r => r.from === p.name || r.to === p.name).map(r => (r.from === p.name ? r.to : r.from))
      )
      expect([...partners]).toEqual(['たろう'])
    }
  })

  it('reaches the same net result as the minimal-transfer method', () => {
    const a = netFromRows(minimalTransfers(TABLE))
    const b = netFromRows(hubTransfers(TABLE).rows)
    for (const p of TABLE) expect(b[p.name] ?? 0).toBe(a[p.name] ?? 0)
  })

  it('handles one winner taking from everyone', () => {
    const table = [
      { name: 'A', amount: 9000 },
      { name: 'B', amount: -4000 },
      { name: 'C', amount: -5000 },
    ]
    const { hub, rows } = hubTransfers(table)
    expect(hub).toBe('A')
    expect(rows).toHaveLength(2)
    expect(netFromRows(rows)).toEqual({ A: 9000, B: -4000, C: -5000 })
  })

  it('returns nothing when nobody won or lost', () => {
    expect(hubTransfers([{ name: 'A', amount: 0 }, { name: 'B', amount: 0 }])).toEqual({
      hub: null,
      rows: [],
    })
  })

  it('lets the hub absorb the gap when the chips do not add up', () => {
    // 合計が -1000 ずれている卓（チップが合っていない状態）
    const off = [
      { name: 'A', amount: 5000 },
      { name: 'B', amount: -3000 },
      { name: 'C', amount: -3000 },
    ]
    const net = netFromRows(hubTransfers(off).rows)
    expect(net.B).toBe(-3000)
    expect(net.C).toBe(-3000)
    // 負けた分は全部ハブに集まる。ずれはハブの受取額に出る（本人の収支と一致しない）
    expect(net.A).toBe(6000)
  })
})
