// 麻雀 点数計算 公開エントリ（純粋関数、UI非依存）
import type { Meld, Tile, TileKind } from './tiles'
import { enumerateInterpretations } from './parse'
import { countDora, detectYaku } from './yaku'
import type { WinContext, YakuResult } from './yaku'
import { calcFu } from './fu'
import { calcBasePoints, calcPayments } from './score'
import type { LimitName, PointsBreakdown } from './score'

export type { Tile, TileKind, Meld } from './tiles'
export {
  suitOf,
  numberOf,
  isHonor,
  isTerminal,
  isTerminalOrHonor,
  isSimple,
  tileFromString,
  tileToString,
  tileDisplayName,
  doraFromIndicator,
  countsOf,
} from './tiles'
export type { Interpretation, StandardForm, ChiitoiForm, KokushiForm, Mentsu, WaitType } from './parse'
export { enumerateInterpretations } from './parse'
export type { WinContext, YakuResult } from './yaku'
export type { LimitName, PointsBreakdown } from './score'

export interface HandInput {
  concealed: Tile[] // 14 - 3*melds.length 枚、アガリ牌を含む
  melds: Meld[]
  winningTile: Tile
  winType: 'ron' | 'tsumo'
  isDealer: boolean
  riichi: boolean
  doubleRiichi: boolean
  ippatsu: boolean
  roundWind: TileKind
  seatWind: TileKind
  doraIndicators: Tile[]
  uraDoraIndicators: Tile[]
  tenho: boolean
  chiho: boolean
  haitei: boolean
  houtei: boolean
  rinshan: boolean
  chankan: boolean
  honba: number
  kyotaku: number
}

export type ScoreErrorCode = 'not_winning_hand' | 'no_yaku' | 'invalid_input'

export interface ScoreResult {
  success: boolean
  error?: ScoreErrorCode
  errorMessage?: string
  yaku: YakuResult[]
  han: number
  fu: number
  points: PointsBreakdown
  limitName: LimitName
  doraCount: number
  uraDoraCount: number
  akaCount: number
  displayRows: string[]
}

function isMenzenOf(melds: Meld[]): boolean {
  return melds.every((m) => m.type === 'ankan')
}

function validateInput(input: HandInput): string | null {
  const expectedConcealedLen = 14 - 3 * input.melds.length
  if (expectedConcealedLen < 0) return '副露数が不正です'
  if (input.concealed.length !== expectedConcealedLen) {
    return `手牌枚数が不正です（期待${expectedConcealedLen}枚, 実際${input.concealed.length}枚）`
  }

  const allTiles: Tile[] = [...input.concealed, ...input.melds.flatMap((m) => m.tiles)]
  const counts = new Array(34).fill(0)
  for (const t of allTiles) counts[t.kind]++
  if (counts.some((c) => c > 4)) return '同一牌が5枚以上使用されています'

  const redKinds = [4, 13, 22] // 5m, 5p, 5s
  for (const rk of redKinds) {
    const redCount = allTiles.filter((t) => t.kind === rk && t.red).length
    if (redCount > 1) return '赤ドラが同色2枚以上使用されています'
  }

  const matchIdx = input.concealed.findIndex(
    (t) => t.kind === input.winningTile.kind && !!t.red === !!input.winningTile.red
  )
  if (matchIdx === -1) return '和了牌が手牌に含まれていません'

  const isMenzen = isMenzenOf(input.melds)
  if ((input.riichi || input.doubleRiichi) && !isMenzen) return 'リーチは門前でのみ可能です'
  if (input.ippatsu && !(input.riichi || input.doubleRiichi)) return '一発はリーチ時のみ可能です'
  if (input.tenho && !(input.isDealer && input.winType === 'tsumo')) {
    return '天和は親のツモ和了時のみ可能です'
  }
  if (input.chiho && !(!input.isDealer && input.winType === 'tsumo')) {
    return '地和は子のツモ和了時のみ可能です'
  }

  return null
}

interface Candidate {
  yaku: YakuResult[]
  han: number
  fu: number
  points: PointsBreakdown
  limitName: LimitName
  doraCount: number
  uraDoraCount: number
  akaCount: number
}

export function calculateScore(input: HandInput): ScoreResult {
  const validationError = validateInput(input)
  if (validationError) {
    return {
      success: false,
      error: 'invalid_input',
      errorMessage: validationError,
      yaku: [],
      han: 0,
      fu: 0,
      points: { total: 0 },
      limitName: null,
      doraCount: 0,
      uraDoraCount: 0,
      akaCount: 0,
      displayRows: [],
    }
  }

  const isMenzen = isMenzenOf(input.melds)
  const interpretations = enumerateInterpretations(
    input.concealed,
    input.melds,
    input.winningTile.kind,
    input.winType
  )

  if (interpretations.length === 0) {
    return {
      success: false,
      error: 'not_winning_hand',
      errorMessage: 'この牌配列は和了形として成立しません',
      yaku: [],
      han: 0,
      fu: 0,
      points: { total: 0 },
      limitName: null,
      doraCount: 0,
      uraDoraCount: 0,
      akaCount: 0,
      displayRows: [],
    }
  }

  const allTiles: Tile[] = [...input.concealed, ...input.melds.flatMap((m) => m.tiles)]
  const hasRiichi = input.riichi || input.doubleRiichi

  const candidates: Candidate[] = []

  for (const interpretation of interpretations) {
    const ctx: WinContext = {
      interpretation,
      concealed: input.concealed,
      melds: input.melds,
      winTile: input.winningTile,
      winType: input.winType,
      isMenzen,
      riichi: input.riichi,
      doubleRiichi: input.doubleRiichi,
      ippatsu: input.ippatsu,
      roundWind: input.roundWind,
      seatWind: input.seatWind,
      haitei: input.haitei,
      houtei: input.houtei,
      rinshan: input.rinshan,
      chankan: input.chankan,
      tenho: input.tenho,
      chiho: input.chiho,
    }

    const yakuList = detectYaku(ctx)
    if (yakuList.length === 0) continue

    const isYakuman = yakuList.some((y) => y.yakuman)
    const finalYaku: YakuResult[] = [...yakuList]
    let doraCount = 0
    let uraDoraCount = 0
    let akaCount = 0

    if (!isYakuman) {
      const d = countDora(allTiles, input.doraIndicators, input.uraDoraIndicators, hasRiichi)
      doraCount = d.dora
      uraDoraCount = d.ura
      akaCount = d.aka
      if (d.dora > 0) finalYaku.push({ name: 'ドラ', han: d.dora })
      if (d.ura > 0) finalYaku.push({ name: '裏ドラ', han: d.ura })
      if (d.aka > 0) finalYaku.push({ name: '赤ドラ', han: d.aka })
    }

    const fu = calcFu(ctx, yakuList)
    const han = finalYaku.reduce((sum, y) => sum + y.han, 0)
    const yakumanCount = yakuList.reduce(
      (sum, y) => sum + (y.yakuman ? y.yakumanMultiplier ?? 1 : 0),
      0
    )
    const { base, limit } = calcBasePoints(han, fu, yakumanCount)
    const points = calcPayments(base, input.isDealer, input.winType, input.honba, input.kyotaku)

    candidates.push({
      yaku: finalYaku,
      han,
      fu,
      points,
      limitName: limit,
      doraCount,
      uraDoraCount,
      akaCount,
    })
  }

  if (candidates.length === 0) {
    return {
      success: false,
      error: 'no_yaku',
      errorMessage: '役がありません',
      yaku: [],
      han: 0,
      fu: 0,
      points: { total: 0 },
      limitName: null,
      doraCount: 0,
      uraDoraCount: 0,
      akaCount: 0,
      displayRows: [],
    }
  }

  // 高点法: 合計点数降順 → 翻数降順 → 符数降順
  candidates.sort((a, b) => {
    if (b.points.total !== a.points.total) return b.points.total - a.points.total
    if (b.han !== a.han) return b.han - a.han
    return b.fu - a.fu
  })

  const best = candidates[0]
  const displayRows: string[] = []
  if (best.doraCount > 0) displayRows.push(`ドラ ${best.doraCount}`)
  if (best.uraDoraCount > 0) displayRows.push(`裏ドラ ${best.uraDoraCount}`)
  if (best.akaCount > 0) displayRows.push(`赤ドラ ${best.akaCount}`)

  return {
    success: true,
    yaku: best.yaku,
    han: best.han,
    fu: best.fu,
    points: best.points,
    limitName: best.limitName,
    doraCount: best.doraCount,
    uraDoraCount: best.uraDoraCount,
    akaCount: best.akaCount,
    displayRows,
  }
}
