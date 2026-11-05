/**
 * 麻雀の点数表（紙の成績表のように、半荘ごとに各自のスコアを書いていく）。
 * スコアは 1000点単位の ±（例: +45, -12.3）。1行の合計は 0 になるはず。
 */

export type Rate = 'tenpin' | 'tengo' | 'custom'
export type PresetRate = Exclude<Rate, 'custom'>

/** 1000点（1pt）あたりの円 */
export const RATE_YEN: Record<PresetRate, number> = { tenpin: 100, tengo: 50 }
export const RATE_LABEL: Record<Rate, string> = { tenpin: 'テンピン', tengo: 'テンゴ', custom: '自由' }

/** 1pt あたりの円。「自由」のときは入力された金額 */
export function yenPerPoint(rate: Rate, customYen: number): number {
  return rate === 'custom' ? customYen : RATE_YEN[rate]
}

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

/** pt を円に（yen は 1pt あたりの円）。端数（小数のpt）は円未満を四捨五入 */
export function toYen(points: number, yen: number): number {
  return Math.round(points * yen)
}

/**
 * 場代を按分するときの各自の重み（いた時間）。
 * 空欄の人は全体の時間いた扱い。全体の時間も空欄なら、入っている中で一番長い時間を使う。
 * 誰の時間も入っていなければ全員同じ（＝均等割り）。
 */
export function venueWeights(hours: Cell[], fullHours: Cell): number[] {
  const entered = hours.filter((h): h is number => h !== null)
  const fill = fullHours ?? (entered.length > 0 ? Math.max(...entered) : 1)
  return hours.map(h => h ?? fill)
}

/**
 * 場代の按分。合計を重み（いた時間）の比率で割る。1円単位で割り切れない分は、
 * 端数の大きい人から1円ずつ足す（全員の負担の合計がぴったり場代の合計になるように）。
 * 重みが全員 0 なら均等割りにする。
 */
export function venueShares(total: number, weights: number[]): number[] {
  if (weights.length === 0) return []
  // 1.5時間のような小数でも誤差が出ないよう、整数にしてから計算する
  const scaled = weights.map(w => Math.max(0, Math.round(w * 100)))
  const units = scaled.some(w => w > 0) ? scaled : scaled.map(() => 1)
  const sum = units.reduce((a, b) => a + b, 0)
  const shares = units.map(w => Math.floor((total * w) / sum))
  const rest = total - shares.reduce((a, b) => a + b, 0)
  units
    .map((w, i) => ({ i, remainder: (total * w) % sum }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i)
    .slice(0, rest)
    .forEach(({ i }) => shares[i]++)
  return shares
}

/** 場代で各自がいくら得をしたか（払った額 − 負担）。立て替えた人がプラスになる */
export function venueBalance(paid: number[], weights: number[] = paid.map(() => 1)): number[] {
  const total = paid.reduce((s, v) => s + v, 0)
  const shares = venueShares(total, weights)
  return paid.map((p, i) => p - shares[i])
}
