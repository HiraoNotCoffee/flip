// ブラックジャック カードカウンティング 共通ロジック
// インデックス: 0=A(1), 1=2, 2=3, ..., 8=9, 9=10(10,J,Q,K)

export const NUM_RANKS = 10
export const RANKS_PER_DECK = [4, 4, 4, 4, 4, 4, 4, 4, 4, 16] // 1枚デッキ分の各ランク枚数

export function initialRemaining(decks: number): number[] {
  return RANKS_PER_DECK.map(n => n * decks)
}

export function totalRemaining(remaining: number[]): number {
  let s = 0
  for (const n of remaining) s += n
  return s
}

export function remainingDecks(remaining: number[]): number {
  return totalRemaining(remaining) / 52
}

// 生確率（各ランクが次に出る確率）
export function probabilities(remaining: number[]): number[] {
  const total = totalRemaining(remaining)
  if (total === 0) return remaining.map(() => 0)
  return remaining.map(n => n / total)
}

// 条件付き確率（excludeIdx を除いた集合での各ランクの確率）
// 例: excludeIdx=9 → 10抜き、excludeIdx=0 → A抜き
export function conditionalProbabilities(
  remaining: number[],
  excludeIdx: number,
): number[] {
  const total = totalRemaining(remaining) - remaining[excludeIdx]
  if (total <= 0) return remaining.map(() => 0)
  return remaining.map((n, i) => (i === excludeIdx ? 0 : n / total))
}

// カウント計算：seen = (initial - remaining)、count = Σ(seen × weight)
export function runningCount(
  initial: number[],
  remaining: number[],
  weights: number[],
): number {
  let s = 0
  for (let i = 0; i < NUM_RANKS; i++) {
    const seen = initial[i] - remaining[i]
    s += seen * weights[i]
  }
  return s
}

// True Count = Running Count / 残りデッキ数
export function trueCount(running: number, remDecks: number): number {
  if (remDecks <= 0) return 0
  return running / remDecks
}

// スプレッドシート由来のデフォルト重み（カスタム系統）
export const DEFAULT_WEIGHTS = [-1, 0.5, 1, 1, 1.5, 1, 0.5, 0, -0.5, -1]

// Hi-Lo 重み（参考）
export const HI_LO_WEIGHTS = [-1, 1, 1, 1, 1, 1, 0, 0, 0, -1]

// プリセット
export const WEIGHT_PRESETS: { name: string; weights: number[] }[] = [
  { name: 'Spreadsheet', weights: DEFAULT_WEIGHTS },
  { name: 'Hi-Lo',       weights: HI_LO_WEIGHTS },
  { name: 'KO',          weights: [-1, 1, 1, 1, 1, 1, 1, 0, 0, -1] },
  { name: 'Wong Halves', weights: [-1, 0.5, 1, 1, 1.5, 1, 0.5, 0, -0.5, -1] }, // Spreadsheetと実質同じ
]
