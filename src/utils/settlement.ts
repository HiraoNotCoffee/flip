/*
 * 精算（誰が誰にいくら払うか）。チップ計算と麻雀の点数表で共通。
 * amount は各自の収支（円）。プラスが受け取る人、マイナスが払う人。
 */

export interface Balance {
  name: string
  amount: number
}

export interface Transfer {
  from: string
  to: string
  amount: number
}

/**
 * 送金の回数がいちばん少なくなる組み合わせ。
 * いちばん払う人といちばん受け取る人を順に突き合わせていく。
 */
export function minimalTransfers(balances: Balance[]): Transfer[] {
  const debtors = balances
    .map(b => ({ name: b.name, amount: -b.amount }))
    .filter(b => b.amount > 0)
    .sort((a, b) => b.amount - a.amount)
  const creditors = balances
    .filter(b => b.amount > 0)
    .map(b => ({ ...b }))
    .sort((a, b) => b.amount - a.amount)

  const rows: Transfer[] = []
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

/**
 * 「一番勝った人がまとめる」方式。
 *
 * 負けた人は全員、一番勝った人にだけ払う。そのあと一番勝った人が、他の勝った人へ
 * 配る。1人（＝一番勝った人）とだけやり取りすればいいので、卓上で回しやすい。
 * 収支の合計が 0 になっていない分は、一番勝った人のところで吸収される。
 */
export function hubTransfers(balances: Balance[]): { hub: string | null; rows: Transfer[] } {
  const ranked = balances.filter(b => b.amount !== 0).sort((a, b) => b.amount - a.amount)
  const winners = ranked.filter(b => b.amount > 0)
  const losers = ranked.filter(b => b.amount < 0)
  if (winners.length === 0 || losers.length === 0) return { hub: null, rows: [] }

  const hub = winners[0]
  const rows: Transfer[] = []
  for (const loser of losers) rows.push({ from: loser.name, to: hub.name, amount: -loser.amount })
  for (const winner of winners.slice(1)) {
    rows.push({ from: hub.name, to: winner.name, amount: winner.amount })
  }
  return { hub: hub.name, rows }
}
