// 麻雀 待ち牌の判定（多面張チェッカー用・純粋関数）
//
// 手牌は牌の種類ごとの枚数（長さ34の配列、countsOf で作る）で受け取る。
// 鳴いている場合は、手の内の枚数が 13 → 10 → 7 → 4 → 1 と減るだけなので同じように扱える。

const KINDS = 34

/** 面子（順子・刻子）だけで全部使い切れるか */
function allMentsu(c: number[], from = 0): boolean {
  let i = from
  while (i < KINDS && c[i] === 0) i++
  if (i === KINDS) return true
  // 刻子
  if (c[i] >= 3) {
    c[i] -= 3
    const ok = allMentsu(c, i)
    c[i] += 3
    if (ok) return true
  }
  // 順子（字牌と、8・9 から始まるものは無い）
  if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--
    c[i + 1]--
    c[i + 2]--
    const ok = allMentsu(c, i)
    c[i]++
    c[i + 1]++
    c[i + 2]++
    if (ok) return true
  }
  return false
}

/** 4面子1雀頭の形か（手の内が 14, 11, 8, 5, 2 枚） */
function isStandardComplete(c: number[]): boolean {
  for (let i = 0; i < KINDS; i++) {
    if (c[i] < 2) continue
    c[i] -= 2
    const ok = allMentsu(c)
    c[i] += 2
    if (ok) return true
  }
  return false
}

function isChiitoi(c: number[]): boolean {
  return c.filter(n => n === 2).length === 7
}

const YAOCHU = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]

function isKokushi(c: number[]): boolean {
  if (YAOCHU.some(k => c[k] === 0)) return false
  return YAOCHU.reduce((s, k) => s + c[k], 0) === 14
}

/** あがりの形か（七対子・国士無双は門前14枚のときだけ） */
export function isComplete(counts: number[]): boolean {
  const total = counts.reduce((a, b) => a + b, 0)
  if (total % 3 !== 2) return false
  const c = [...counts]
  if (isStandardComplete(c)) return true
  return total === 14 && (isChiitoi(c) || isKokushi(c))
}

export interface Wait {
  kind: number
  /** 山や他家に残っている可能性がある枚数（4 − 自分の手にある枚数） */
  remaining: number
}

/**
 * 待ち牌を返す（手の内が 13, 10, 7, 4, 1 枚のとき）。
 * 自分の手で4枚使っている牌は、引いてもあがれないので待ちに含めない。
 */
export function findWaits(counts: number[]): Wait[] {
  const total = counts.reduce((a, b) => a + b, 0)
  if (total % 3 !== 1) return []
  const waits: Wait[] = []
  const c = [...counts]
  for (let k = 0; k < KINDS; k++) {
    if (c[k] >= 4) continue
    c[k]++
    if (isComplete(c)) waits.push({ kind: k, remaining: 4 - counts[k] })
    c[k]--
  }
  return waits
}

export interface DiscardOption {
  discard: number
  waits: Wait[]
  /** 待ちの残り枚数の合計 */
  totalRemaining: number
}

/**
 * 14枚（手の内が 14, 11, 8, 5, 2 枚）のとき、何を切ればテンパイになるか。
 * 残り枚数の多い順（同じなら待ちの種類が多い順）に並べる。
 */
export function findTenpaiDiscards(counts: number[]): DiscardOption[] {
  const total = counts.reduce((a, b) => a + b, 0)
  if (total % 3 !== 2) return []
  const options: DiscardOption[] = []
  const c = [...counts]
  for (let k = 0; k < KINDS; k++) {
    if (c[k] === 0) continue
    c[k]--
    const waits = findWaits(c)
    if (waits.length > 0) {
      options.push({ discard: k, waits, totalRemaining: waits.reduce((s, w) => s + w.remaining, 0) })
    }
    c[k]++
  }
  return options.sort(
    (a, b) => b.totalRemaining - a.totalRemaining || b.waits.length - a.waits.length || a.discard - b.discard,
  )
}
