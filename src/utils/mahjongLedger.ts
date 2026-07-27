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
  /** トビ賞（1000点単位）。飛んだ人（素点マイナス）がトップに支払う。0でなし */
  tobiBonus: number
}

export interface GameEntry {
  memberId: string
  /** 終了時の素点 */
  points: number
  /** 順位（1始まり）。参加者内で重複しない前提 */
  rank: number
  playing: boolean
  /** 飛ばした人（この人を飛ばした相手）。未指定ならトップ扱い */
  tobiBy?: string | null
}

export interface Game {
  id: string
  entries: GameEntry[]
}

export interface EntryResult {
  memberId: string
  rank: number
  points: number
  /** 1000点単位のスコア（ウマ・オカ・トビ賞込み） */
  score: number
  /** 円 */
  yen: number
  /** 飛び（素点がマイナス） */
  tobi: boolean
  /** 飛ばした人（トビ賞の受取人）。飛んでいなければ null */
  tobiBy: string | null
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
        tobi: e.points < 0,
        tobiBy: null,
      })),
      count,
      totalPoints,
      pointsValid: false,
    }
  }

  const uma = umaFor(settings, count)
  const sorted = [...playing].sort((a, b) => a.rank - b.rank)
  const topId = sorted[0].memberId
  const playingIds = new Set(playing.map(e => e.memberId))

  // トップ以外を先に確定させ、トップがその合計を引き受ける（＝オカ）
  const scores = new Map<string, number>()
  let othersTotal = 0
  sorted.forEach((e, idx) => {
    if (idx === 0) return
    const score = roundGosha(e.points - settings.returnPoints) + (uma[idx] ?? 0)
    scores.set(e.memberId, score)
    othersTotal += score
  })
  scores.set(topId, -othersTotal)

  // トビ賞は飛んだ人から飛ばした人へ（未指定ならトップ）
  const tobiBy = new Map<string, string | null>()
  sorted.forEach(e => {
    if (e.points >= 0) return
    const to =
      e.tobiBy && e.tobiBy !== e.memberId && playingIds.has(e.tobiBy) ? e.tobiBy : topId
    tobiBy.set(e.memberId, to === e.memberId ? null : to)
    if (to === e.memberId || settings.tobiBonus <= 0) return
    scores.set(e.memberId, (scores.get(e.memberId) ?? 0) - settings.tobiBonus)
    scores.set(to, (scores.get(to) ?? 0) + settings.tobiBonus)
  })

  return {
    results: sorted.map(e => {
      const score = scores.get(e.memberId) ?? 0
      return {
        memberId: e.memberId,
        rank: e.rank,
        points: e.points,
        score,
        yen: score * settings.rate,
        tobi: e.points < 0,
        tobiBy: tobiBy.get(e.memberId) ?? null,
      }
    }),
    count,
    totalPoints,
    pointsValid,
  }
}

export interface VenueFee {
  /** メンバーIDごとの場所代（円） */
  fees: Record<string, number>
  /** 立て替えた人。null なら各自で支払い（精算に含めない） */
  payerId: string | null
}

/** 場所代の合計（メンバーに残っている人だけ） */
export function venueTotal(fee: VenueFee, memberIds: string[]): number {
  return memberIds.reduce((sum, id) => sum + (fee.fees[id] || 0), 0)
}

/** 総額を人数で等分したときの1人あたり金額（端数は切り上げ） */
export function splitEvenly(total: number, memberCount: number): number {
  if (memberCount <= 0 || total <= 0) return 0
  return Math.ceil(total / memberCount)
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
  { key: '5-10', label: 'ゴットー +10 / +5 / -5 / -10', uma: [10, 5, -5, -10] },
  { key: '10-20', label: 'ワンツー +20 / +10 / -10 / -20', uma: [20, 10, -10, -20] },
  { key: '10-30', label: 'ワンスリー +30 / +10 / -10 / -30', uma: [30, 10, -10, -30] },
  { key: '20-30', label: 'ツースリー +30 / +20 / -20 / -30', uma: [30, 20, -20, -30] },
  { key: 'none', label: 'ウマなし', uma: [0, 0, 0, 0] },
]

// 三人麻雀は2位が±0で、1位と3位がやりとりするのが一般的
export const UMA_PRESETS_3: { key: string; label: string; uma: number[] }[] = [
  { key: '10', label: '+10 / 0 / -10', uma: [10, 0, -10] },
  { key: '20', label: '+20 / 0 / -20', uma: [20, 0, -20] },
  { key: '30', label: '+30 / 0 / -30', uma: [30, 0, -30] },
  { key: '5', label: '+5 / 0 / -5', uma: [5, 0, -5] },
  { key: 'none', label: 'ウマなし', uma: [0, 0, 0] },
]
