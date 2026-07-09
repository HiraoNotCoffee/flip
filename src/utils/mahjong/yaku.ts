// 麻雀 役判定（純粋関数）
import type { Meld, Tile, TileKind } from './tiles'
import { doraFromIndicator, isSimple, isTerminalOrHonor, numberOf, suitOf } from './tiles'
import type { Interpretation } from './parse'

export interface WinContext {
  interpretation: Interpretation
  concealed: Tile[]
  melds: Meld[]
  winTile: Tile
  winType: 'ron' | 'tsumo'
  isMenzen: boolean // 副露(chi/pon/minkan)が無い（暗槓のみは門前扱い）
  riichi: boolean
  doubleRiichi: boolean
  ippatsu: boolean
  roundWind: TileKind
  seatWind: TileKind
  haitei: boolean
  houtei: boolean
  rinshan: boolean
  chankan: boolean
  tenho: boolean
  chiho: boolean
}

export interface YakuResult {
  name: string
  han: number
  yakuman?: boolean
  yakumanMultiplier?: number // 1 or 2（ダブル役満）
}

function allHandTiles(ctx: WinContext): Tile[] {
  return [...ctx.concealed, ...ctx.melds.flatMap((m) => m.tiles)]
}

function isDragon(kind: TileKind): boolean {
  return kind >= 31 && kind <= 33
}
function isWind(kind: TileKind): boolean {
  return kind >= 27 && kind <= 30
}

// ============ 役満判定 ============

function detectYakuman(ctx: WinContext): YakuResult[] {
  const results: YakuResult[] = []

  if (ctx.tenho) results.push({ name: '天和', han: 0, yakuman: true, yakumanMultiplier: 1 })
  if (ctx.chiho) results.push({ name: '地和', han: 0, yakuman: true, yakumanMultiplier: 1 })

  if (ctx.interpretation.kind === 'kokushi') {
    const k = ctx.interpretation.kokushi!
    results.push({
      name: k.thirteenWait ? '国士無双十三面待ち' : '国士無双',
      han: 0,
      yakuman: true,
      yakumanMultiplier: k.thirteenWait ? 2 : 1,
    })
    return results
  }

  if (ctx.interpretation.kind !== 'standard') return results

  const form = ctx.interpretation.standard!
  const all = allHandTiles(ctx)

  // 四暗刻（単騎=ダブル）
  const ankouCount = form.mentsu.filter(
    (m) => (m.type === 'kotsu' || m.type === 'kantsu') && !m.open && !m.winningRon
  ).length
  if (ankouCount === 4) {
    results.push({
      name: form.wait === 'tanki' ? '四暗刻単騎' : '四暗刻',
      han: 0,
      yakuman: true,
      yakumanMultiplier: form.wait === 'tanki' ? 2 : 1,
    })
  }

  // 大三元
  const dragonGroups = form.mentsu.filter(
    (m) => (m.type === 'kotsu' || m.type === 'kantsu') && isDragon(m.tiles[0].kind)
  )
  if (dragonGroups.length === 3) {
    results.push({ name: '大三元', han: 0, yakuman: true, yakumanMultiplier: 1 })
  }

  // 字一色
  if (all.every((t) => isWind(t.kind) || isDragon(t.kind))) {
    results.push({ name: '字一色', han: 0, yakuman: true, yakumanMultiplier: 1 })
  }

  // 緑一色
  const GREEN_KINDS = new Set([19, 20, 21, 23, 25, 32]) // 2s,3s,4s,6s,8s,發
  if (all.every((t) => GREEN_KINDS.has(t.kind))) {
    results.push({ name: '緑一色', han: 0, yakuman: true, yakumanMultiplier: 1 })
  }

  // 清老頭
  if (all.every((t) => !isWind(t.kind) && !isDragon(t.kind) && (numberOf(t.kind) === 1 || numberOf(t.kind) === 9))) {
    results.push({ name: '清老頭', han: 0, yakuman: true, yakumanMultiplier: 1 })
  }

  // 小四喜・大四喜
  const windGroups = form.mentsu.filter(
    (m) => (m.type === 'kotsu' || m.type === 'kantsu') && isWind(m.tiles[0].kind)
  )
  if (windGroups.length === 4) {
    results.push({ name: '大四喜', han: 0, yakuman: true, yakumanMultiplier: 2 })
  } else if (windGroups.length === 3 && isWind(form.pair[0].kind)) {
    results.push({ name: '小四喜', han: 0, yakuman: true, yakumanMultiplier: 1 })
  }

  // 四槓子
  const kantsuCount = form.mentsu.filter((m) => m.type === 'kantsu').length
  if (kantsuCount === 4) {
    results.push({ name: '四槓子', han: 0, yakuman: true, yakumanMultiplier: 1 })
  }

  // 九蓮宝燈
  const chuuren = checkChuuren(ctx)
  if (chuuren) results.push(chuuren)

  return results
}

function checkChuuren(ctx: WinContext): YakuResult | null {
  if (ctx.melds.length > 0) return null
  if (!ctx.isMenzen) return null
  const all = ctx.concealed
  if (all.length !== 14) return null
  const suits = new Set(all.map((t) => suitOf(t.kind)))
  if (suits.size !== 1) return null
  const suit = [...suits][0]
  if (suit === 'z') return null

  const counts = new Array(9).fill(0)
  for (const t of all) counts[numberOf(t.kind) - 1]++
  if (counts[0] < 3 || counts[8] < 3) return null
  for (let i = 1; i < 8; i++) {
    if (counts[i] < 1) return null
  }

  const wn = numberOf(ctx.winTile.kind) - 1
  const remaining = counts.slice()
  remaining[wn]--
  const pureShape = [3, 1, 1, 1, 1, 1, 1, 1, 3]
  const isPure = remaining.every((c, i) => c === pureShape[i])

  return {
    name: isPure ? '純正九蓮宝燈' : '九蓮宝燈',
    han: 0,
    yakuman: true,
    yakumanMultiplier: isPure ? 2 : 1,
  }
}

// ============ 通常役判定 ============

function tilePurity(tiles: Tile[]) {
  const nonHonorSuits = new Set<string>()
  let honorCount = 0
  let allSimple = true
  let allTerminalOrHonor = true
  for (const t of tiles) {
    const s = suitOf(t.kind)
    if (s === 'z') honorCount++
    else nonHonorSuits.add(s)
    if (!isSimple(t.kind)) allSimple = false
    if (!isTerminalOrHonor(t.kind)) allTerminalOrHonor = false
  }
  return { nonHonorSuitCount: nonHonorSuits.size, honorCount, allSimple, allTerminalOrHonor }
}

function detectChiitoiYaku(ctx: WinContext): YakuResult[] {
  const results: YakuResult[] = [{ name: '七対子', han: 2 }]
  const all = ctx.concealed
  const purity = tilePurity(all)

  if (purity.allSimple) results.push({ name: 'タンヤオ', han: 1 })
  if (purity.allTerminalOrHonor) results.push({ name: '混老頭', han: 2 })

  if (purity.nonHonorSuitCount === 1) {
    if (purity.honorCount === 0) results.push({ name: '清一色', han: ctx.isMenzen ? 6 : 5 })
    else results.push({ name: '混一色', han: ctx.isMenzen ? 3 : 2 })
  }

  return results
}

function detectStandardYaku(ctx: WinContext): YakuResult[] {
  const form = ctx.interpretation.standard!
  const results: YakuResult[] = []
  const all = allHandTiles(ctx)
  const purity = tilePurity(all)

  // リーチ / ダブルリーチ
  if (ctx.doubleRiichi) results.push({ name: 'ダブルリーチ', han: 2 })
  else if (ctx.riichi) results.push({ name: 'リーチ', han: 1 })

  if (ctx.ippatsu) results.push({ name: '一発', han: 1 })

  if (ctx.winType === 'tsumo' && ctx.isMenzen) results.push({ name: '門前清自摸和', han: 1 })

  const allShuntsu = form.mentsu.every((m) => m.type === 'shuntsu')
  const pairIsYakuhai =
    isDragon(form.pair[0].kind) ||
    form.pair[0].kind === ctx.roundWind ||
    form.pair[0].kind === ctx.seatWind
  const isPinfu = ctx.isMenzen && allShuntsu && !pairIsYakuhai && form.wait === 'ryanmen'
  if (isPinfu) results.push({ name: '平和', han: 1 })

  if (purity.allSimple) results.push({ name: 'タンヤオ', han: 1 })

  // 役牌
  for (const m of form.mentsu) {
    if (m.type !== 'kotsu' && m.type !== 'kantsu') continue
    const kind = m.tiles[0].kind
    if (isDragon(kind)) {
      const names: Record<number, string> = { 31: '役牌:白', 32: '役牌:發', 33: '役牌:中' }
      results.push({ name: names[kind], han: 1 })
    }
    if (kind === ctx.roundWind) results.push({ name: '場風牌', han: 1 })
    if (kind === ctx.seatWind) results.push({ name: '自風牌', han: 1 })
  }

  // 一盃口・二盃口（門前限定）
  if (ctx.isMenzen) {
    const shuntsuKeys = form.mentsu
      .filter((m) => m.type === 'shuntsu')
      .map((m) => m.tiles.map((t) => t.kind).join('-'))
    const keyCounts = new Map<string, number>()
    for (const k of shuntsuKeys) keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1)
    let pairSets = 0
    for (const c of keyCounts.values()) pairSets += Math.floor(c / 2)
    if (pairSets === 2) results.push({ name: '二盃口', han: 3 })
    else if (pairSets === 1) results.push({ name: '一盃口', han: 1 })
  }

  // 三色同順
  {
    const shuntsu = form.mentsu.filter((m) => m.type === 'shuntsu')
    const byStart = new Map<number, Set<string>>()
    for (const m of shuntsu) {
      const startNum = numberOf(m.tiles[0].kind)
      const suit = suitOf(m.tiles[0].kind)
      if (!byStart.has(startNum)) byStart.set(startNum, new Set())
      byStart.get(startNum)!.add(suit)
    }
    for (const suits of byStart.values()) {
      if (suits.size === 3) {
        results.push({ name: '三色同順', han: ctx.isMenzen ? 2 : 1 })
        break
      }
    }
  }

  // 三色同刻
  {
    const kotsu = form.mentsu.filter((m) => m.type === 'kotsu' || m.type === 'kantsu')
    const byNum = new Map<number, Set<string>>()
    for (const m of kotsu) {
      const num = numberOf(m.tiles[0].kind)
      const suit = suitOf(m.tiles[0].kind)
      if (suit === 'z') continue
      if (!byNum.has(num)) byNum.set(num, new Set())
      byNum.get(num)!.add(suit)
    }
    for (const suits of byNum.values()) {
      if (suits.size === 3) {
        results.push({ name: '三色同刻', han: 2 })
        break
      }
    }
  }

  // 一気通貫
  {
    const shuntsu = form.mentsu.filter((m) => m.type === 'shuntsu')
    const bySuit = new Map<string, Set<number>>()
    for (const m of shuntsu) {
      const suit = suitOf(m.tiles[0].kind)
      const start = numberOf(m.tiles[0].kind)
      if (!bySuit.has(suit)) bySuit.set(suit, new Set())
      bySuit.get(suit)!.add(start)
    }
    for (const starts of bySuit.values()) {
      if (starts.has(1) && starts.has(4) && starts.has(7)) {
        results.push({ name: '一気通貫', han: ctx.isMenzen ? 2 : 1 })
        break
      }
    }
  }

  // チャンタ・純チャン
  {
    const groupHasTerminalOrHonor = (tiles: Tile[]) => tiles.some((t) => isTerminalOrHonor(t.kind))
    const allGroupsQualify =
      groupHasTerminalOrHonor(form.pair) && form.mentsu.every((m) => groupHasTerminalOrHonor(m.tiles))
    if (allGroupsQualify) {
      const hasHonor =
        isTerminalOrHonor(form.pair[0].kind) &&
        (form.pair.some((t) => suitOf(t.kind) === 'z') ||
          form.mentsu.some((m) => m.tiles.some((t) => suitOf(t.kind) === 'z')))
      if (hasHonor) {
        results.push({ name: 'チャンタ', han: ctx.isMenzen ? 2 : 1 })
      } else {
        results.push({ name: '純全帯幺九', han: ctx.isMenzen ? 3 : 2 })
      }
    }
  }

  // 対々和
  const allTriplet = form.mentsu.every((m) => m.type === 'kotsu' || m.type === 'kantsu')
  if (allTriplet) results.push({ name: '対々和', han: 2 })

  // 三暗刻
  const ankouCount = form.mentsu.filter(
    (m) => (m.type === 'kotsu' || m.type === 'kantsu') && !m.open && !m.winningRon
  ).length
  if (ankouCount === 3) results.push({ name: '三暗刻', han: 2 })

  // 三槓子
  const kantsuCount = form.mentsu.filter((m) => m.type === 'kantsu').length
  if (kantsuCount === 3) results.push({ name: '三槓子', han: 2 })

  // 小三元
  const dragonGroups = form.mentsu.filter(
    (m) => (m.type === 'kotsu' || m.type === 'kantsu') && isDragon(m.tiles[0].kind)
  )
  if (dragonGroups.length === 2 && isDragon(form.pair[0].kind)) {
    results.push({ name: '小三元', han: 2 })
  }

  // 混老頭
  if (purity.allTerminalOrHonor) results.push({ name: '混老頭', han: 2 })

  // 混一色・清一色
  if (purity.nonHonorSuitCount === 1) {
    if (purity.honorCount === 0) results.push({ name: '清一色', han: ctx.isMenzen ? 6 : 5 })
    else results.push({ name: '混一色', han: ctx.isMenzen ? 3 : 2 })
  }

  return results
}

function detectBonusYaku(ctx: WinContext): YakuResult[] {
  const results: YakuResult[] = []
  if (ctx.haitei) results.push({ name: '海底摸月', han: 1 })
  if (ctx.houtei) results.push({ name: '河底撈魚', han: 1 })
  if (ctx.rinshan) results.push({ name: '嶺上開花', han: 1 })
  if (ctx.chankan) results.push({ name: '槍槓', han: 1 })
  return results
}

export function detectYaku(ctx: WinContext): YakuResult[] {
  const yakuman = detectYakuman(ctx)
  if (yakuman.length > 0) return yakuman

  const results: YakuResult[] = []
  if (ctx.interpretation.kind === 'chiitoi') {
    results.push(...detectChiitoiYaku(ctx))
  } else if (ctx.interpretation.kind === 'standard') {
    results.push(...detectStandardYaku(ctx))
  } else {
    return results // kokushiは役満分岐で処理済み（到達しない想定）
  }
  results.push(...detectBonusYaku(ctx))
  return results
}

// ============ ドラ計算 ============

export function countDora(
  allTiles: Tile[],
  indicators: Tile[],
  ura: Tile[],
  hasRiichi: boolean
): { dora: number; ura: number; aka: number } {
  let dora = 0
  for (const ind of indicators) {
    const targetKind = doraFromIndicator(ind).kind
    dora += allTiles.filter((t) => t.kind === targetKind).length
  }

  let uraCount = 0
  if (hasRiichi) {
    for (const ind of ura) {
      const targetKind = doraFromIndicator(ind).kind
      uraCount += allTiles.filter((t) => t.kind === targetKind).length
    }
  }

  const aka = allTiles.filter((t) => t.red).length

  return { dora, ura: uraCount, aka }
}
