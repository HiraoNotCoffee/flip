// 精算の2方式が、どちらも「各自の収支ぴったり」になることを確かめる。
// お金の話なので、合計が合わない計算を出すわけにいかない。
import { describe, it, expect } from 'vitest'

type Player = { name: string; pnl: number }

/** 送金回数を最小化する方式（Settlement 1 と同じ考え方）。 */
function minimalTransfers(players: Player[]) {
  const debtors = players
    .map(p => ({ name: p.name, amount: -p.pnl }))
    .filter(p => p.amount > 0)
    .sort((a, b) => b.amount - a.amount)
  const creditors = players
    .map(p => ({ name: p.name, amount: p.pnl }))
    .filter(p => p.amount > 0)
    .sort((a, b) => b.amount - a.amount)

  const rows: { from: string; to: string; amount: number }[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount)
    if (pay > 0) rows.push({ from: debtors[i].name, to: creditors[j].name, amount: pay })
    debtors[i].amount -= pay
    creditors[j].amount -= pay
    if (debtors[i].amount <= 0) i++
    if (creditors[j].amount <= 0) j++
  }
  return rows
}

/** 一番勝った人がまとめる方式（Settlement 2 と同じ考え方）。 */
function hubTransfers(players: Player[]) {
  const ranked = players.filter(p => p.pnl !== 0).sort((a, b) => b.pnl - a.pnl)
  const winners = ranked.filter(p => p.pnl > 0)
  const losers = ranked.filter(p => p.pnl < 0)
  if (winners.length === 0 || losers.length === 0) return { hub: null, rows: [] }

  const hub = winners[0]
  const rows: { from: string; to: string; amount: number }[] = []
  for (const loser of losers) rows.push({ from: loser.name, to: hub.name, amount: -loser.pnl })
  for (const winner of winners.slice(1)) {
    rows.push({ from: hub.name, to: winner.name, amount: winner.pnl })
  }
  return { hub: hub.name, rows }
}

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
  { name: 'たろう', pnl: 12000 },
  { name: 'はなこ', pnl: 5000 },
  { name: 'さとう', pnl: -7000 },
  { name: 'すずき', pnl: -4000 },
  { name: 'いとう', pnl: -6000 },
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
    for (const p of TABLE) expect(net[p.name] ?? 0).toBe(p.pnl)
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
      { name: 'A', pnl: 9000 },
      { name: 'B', pnl: -4000 },
      { name: 'C', pnl: -5000 },
    ]
    const { hub, rows } = hubTransfers(table)
    expect(hub).toBe('A')
    expect(rows).toHaveLength(2)
    expect(netFromRows(rows)).toEqual({ A: 9000, B: -4000, C: -5000 })
  })

  it('returns nothing when nobody won or lost', () => {
    expect(hubTransfers([{ name: 'A', pnl: 0 }, { name: 'B', pnl: 0 }])).toEqual({
      hub: null,
      rows: [],
    })
  })

  it('lets the hub absorb the gap when the chips do not add up', () => {
    // 合計が -1000 ずれている卓（チップが合っていない状態）
    const off = [
      { name: 'A', pnl: 5000 },
      { name: 'B', pnl: -3000 },
      { name: 'C', pnl: -3000 },
    ]
    const net = netFromRows(hubTransfers(off).rows)
    expect(net.B).toBe(-3000)
    expect(net.C).toBe(-3000)
    // 負けた分は全部ハブに集まる。ずれはハブの受取額に出る（本人の収支と一致しない）
    expect(net.A).toBe(6000)
  })
})
