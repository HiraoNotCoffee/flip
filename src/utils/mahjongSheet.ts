/**
 * 麻雀の点数表（紙の成績表のように、半荘ごとに各自のスコアを書いていく）。
 * スコアは 1000点単位の ±（例: +45, -12.3）。1行の合計は 0 になるはず。
 */

export type Rate = 'tenpin' | 'tengo'

/** 1000点（1pt）あたりの円 */
export const RATE_YEN: Record<Rate, number> = { tenpin: 100, tengo: 50 }
export const RATE_LABEL: Record<Rate, string> = { tenpin: 'テンピン', tengo: 'テンゴ' }

export type Cell = number | null

/**
 * 小数（12.3 など）を足すと 0.1 + 0.2 のような誤差が出るので、
 * 0.1 単位の整数にしてから足す。
 */
function sum(values: Cell[]): number {
  const tenths = values.reduce<number>((s, v) => s + (v === null ? 0 : Math.round(v * 10)), 0)
  return tenths / 10
}

export type RowStatus = 'empty' | 'zero' | 'over' | 'under'

/** 行の合計。何も入っていなければ null */
export function rowSum(row: Cell[]): number | null {
  return row.every(v => v === null) ? null : sum(row)
}

/** 行の合計が 0 か、多い（over）か、少ない（under）か */
export function rowStatus(row: Cell[]): RowStatus {
  const s = rowSum(row)
  if (s === null) return 'empty'
  if (s > 0) return 'over'
  if (s < 0) return 'under'
  return 'zero'
}

/** 列（人）ごとの合計 */
export function columnTotals(rows: Cell[][], columns: number): number[] {
  return Array.from({ length: columns }, (_, c) => sum(rows.map(r => r[c] ?? null)))
}

/** pt を円に。端数（小数のpt）は円未満を四捨五入 */
export function toYen(points: number, rate: Rate): number {
  return Math.round(points * RATE_YEN[rate])
}
