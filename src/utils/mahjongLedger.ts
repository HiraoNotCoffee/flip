/**
 * 麻雀の収支計算（順位＋素点 → スコア → 金額）
 *
 * 一般的なフリー/セット麻雀のルールに従う:
 *   スコア = 五捨六入((素点 - 返し点) / 1000) + ウマ
 *   トップは残り3人（2人）の合計の符号反転を受け取る（＝オカが自動的に乗る）
 */

export interface LedgerSettings {
  /** 配給原点（4人: 25000 / 3人: 35000） */
  startPoints: number
  /** 返し点（4人: 30000 / 3人: 40000） */
  returnPoints: number
  /** 4人打ちのウマ（1位→4位） */
  uma4: number[]
  /** 3人打ちのウマ（1位→3位） */
  uma3: number[]
  /** レート: 1000点あたりの円（点5なら50） */
  rate: number
}

export interface GameEntry {
  memberId: string
  /** 終了時の素点 */
  points: number
  /** 順位（1始まり）。参加者内で重複しない前提 */
  rank: number
  playing: boolean
}

export interface Game {
  id: string
  entries: GameEntry[]
}

export interface EntryResult {
  memberId: string
  rank: number
  points: number
  /** 1000点単位のスコア（ウマ・オカ込み） */
  score: number
  /** 円 */
  yen: number
}

export interface GameResult {
  results: EntryResult[]
  /** 参加人数 */
  count: number
  /** 素点の合計 */
  totalPoints: number
  /** 素点合計が配給原点×人数と一致しているか */
  pointsValid: boolean
}

/** 五捨六入（0.5は切り捨て、0.6から切り上げ）。負数は絶対値で判定する。 */
export function roundGosha(diffPoints: number): number {
  const tenths = Math.round(diffPoints / 100) // 1000点の1/10単位
  const sign = tenths < 0 ? -1 : 1
  const abs = Math.abs(tenths)
  const rounded = Math.ceil((abs - 5) / 10)
  return rounded === 0 ? 0 : sign * rounded
}

/** 素点の多い順に順位を振る。同点は現在の順位→並び順で決める。 */
export function computeRanks(entries: GameEntry[]): number[] {
  const order = entries
    .map((e, i) => ({ i, points: e.points, rank: e.rank }))
    .sort((a, b) => b.points - a.points || a.rank - b.rank || a.i - b.i)
  const ranks = new Array<number>(entries.length).fill(0)
  order.forEach((o, idx) => {
    ranks[o.i] = idx + 1
  })
  return ranks
}

/** 参加人数に応じたウマを返す（人数が合わない場合は0埋め） */
export function umaFor(settings: LedgerSettings, count: number): number[] {
  const table = count === 3 ? settings.uma3 : settings.uma4
  return Array.from({ length: count }, (_, i) => table[i] ?? 0)
}

export function calcGame(game: Game, settings: LedgerSettings): GameResult {
  const playing = game.entries.filter(e => e.playing)
  const count = playing.length
  const totalPoints = playing.reduce((sum, e) => sum + e.points, 0)
  const pointsValid = count > 0 && totalPoints === settings.startPoints * count

  if (count < 2) {
    return {
      results: playing.map(e => ({
        memberId: e.memberId,
        rank: e.rank,
        points: e.points,
        score: 0,
        yen: 0,
      })),
      count,
      totalPoints,
      pointsValid: false,
    }
  }

  const uma = umaFor(settings, count)
  const sorted = [...playing].sort((a, b) => a.rank - b.rank)

  // トップ以外を先に確定させ、トップがその合計を引き受ける（＝オカ）
  const scores = new Map<string, number>()
  let othersTotal = 0
  sorted.forEach((e, idx) => {
    if (idx === 0) return
    const score = roundGosha(e.points - settings.returnPoints) + (uma[idx] ?? 0)
    scores.set(e.memberId, score)
    othersTotal += score
  })
  scores.set(sorted[0].memberId, -othersTotal)

  return {
    results: sorted.map(e => {
      const score = scores.get(e.memberId) ?? 0
      return {
        memberId: e.memberId,
        rank: e.rank,
        points: e.points,
        score,
        yen: score * settings.rate,
      }
    }),
    count,
    totalPoints,
    pointsValid,
  }
}

export interface Settlement {
  from: string
  to: string
  amount: number
}

/** 送金回数が最小になるように精算する（貪欲法: 最大の支払い者と最大の受取り者を突き合わせる） */
export function calcSettlements(totals: { name: string; yen: number }[]): Settlement[] {
  const debtors = totals
    .map(t => ({ name: t.name, amount: -Math.round(t.yen) }))
    .filter(t => t.amount > 0)
    .sort((a, b) => b.amount - a.amount)
  const creditors = totals
    .map(t => ({ name: t.name, amount: Math.round(t.yen) }))
    .filter(t => t.amount > 0)
    .sort((a, b) => b.amount - a.amount)

  const result: Settlement[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount)
    if (pay > 0) {
      result.push({ from: debtors[i].name, to: creditors[j].name, amount: pay })
    }
    debtors[i].amount -= pay
    creditors[j].amount -= pay
    if (debtors[i].amount <= 0) i++
    if (creditors[j].amount <= 0) j++
  }
  return result
}

export const UMA_PRESETS_4: { key: string; label: string; uma: number[] }[] = [
  { key: '5-10', label: 'ゴットー (5-10)', uma: [10, 5, -5, -10] },
  { key: '10-20', label: 'ワンツー (10-20)', uma: [20, 10, -10, -20] },
  { key: '10-30', label: 'ワンスリー (10-30)', uma: [30, 10, -10, -30] },
  { key: '20-30', label: 'ツースリー (20-30)', uma: [30, 20, -20, -30] },
  { key: 'none', label: 'ウマなし', uma: [0, 0, 0, 0] },
]

export const UMA_PRESETS_3: { key: string; label: string; uma: number[] }[] = [
  { key: '10-20', label: '10-20', uma: [20, 0, -20] },
  { key: '5-10', label: '5-10', uma: [10, 0, -10] },
  { key: '10-30', label: '10-30', uma: [30, 0, -30] },
  { key: 'none', label: 'ウマなし', uma: [0, 0, 0] },
]
