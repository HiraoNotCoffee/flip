// 麻雀 面子分解・解釈列挙（純粋関数）
import type { Meld, Tile, TileKind } from './tiles'
import { numberOf, suitOf } from './tiles'

export type WaitType = 'ryanmen' | 'kanchan' | 'penchan' | 'shanpon' | 'tanki'

export interface Mentsu {
  type: 'shuntsu' | 'kotsu' | 'kantsu'
  tiles: Tile[]
  open: boolean // 副露(鳴き)によるオープンか（暗槓はfalse）
  winningRon?: boolean // ロンで完成した刻子（fu/yaku上は明刻扱い）
}

export interface StandardForm {
  pair: Tile[] // 雀頭2枚
  mentsu: Mentsu[] // 4面子
  wait: WaitType
}

export interface ChiitoiForm {
  pairs: Tile[][] // 7対子
}

export interface KokushiForm {
  thirteenWait: boolean // 13面待ちか
  tiles: Tile[] // 手牌14枚
}

export interface Interpretation {
  kind: 'standard' | 'chiitoi' | 'kokushi'
  standard?: StandardForm
  chiitoi?: ChiitoiForm
  kokushi?: KokushiForm
}

const YAOCHU_KINDS: TileKind[] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]

function mkTile(kind: TileKind): Tile {
  return { kind }
}

function meldToMentsu(m: Meld): Mentsu {
  switch (m.type) {
    case 'chi':
      return { type: 'shuntsu', tiles: m.tiles, open: true }
    case 'pon':
      return { type: 'kotsu', tiles: m.tiles, open: true }
    case 'minkan':
      return { type: 'kantsu', tiles: m.tiles, open: true }
    case 'ankan':
      return { type: 'kantsu', tiles: m.tiles, open: false }
  }
}

// 残り牌(kindカウント配列)を刻子/順子に分解する全パターンを列挙する。
// 常に「残っている最小indexの牌」から着手するため、同一分解が重複生成されることはない。
// 戻り値: 各解 = グループ配列（グループ=牌kindの配列 長さ3）
function decompose(counts: number[]): number[][][] {
  let idx = -1
  for (let i = 0; i < 34; i++) {
    if (counts[i] > 0) {
      idx = i
      break
    }
  }
  if (idx === -1) return [[]]

  const results: number[][][] = []
  const suit = suitOf(idx)

  // 刻子
  if (counts[idx] >= 3) {
    counts[idx] -= 3
    const sub = decompose(counts)
    for (const s of sub) results.push([[idx, idx, idx], ...s])
    counts[idx] += 3
  }

  // 順子（数牌のみ、7以下の開始番号）
  if (suit !== 'z') {
    const num = numberOf(idx)
    if (num <= 7 && counts[idx] > 0 && counts[idx + 1] > 0 && counts[idx + 2] > 0) {
      counts[idx]--
      counts[idx + 1]--
      counts[idx + 2]--
      const sub = decompose(counts)
      for (const s of sub) results.push([[idx, idx + 1, idx + 2], ...s])
      counts[idx]++
      counts[idx + 1]++
      counts[idx + 2]++
    }
  }

  return results
}

function classifyShuntsuWait(g: number[], pos: number): WaitType {
  if (pos === 1) return 'kanchan'
  if (pos === 0) {
    // held = g[1],g[2]（上side）。89持ち→7待ちのみpenchan
    return numberOf(g[1]) === 8 && numberOf(g[2]) === 9 ? 'penchan' : 'ryanmen'
  }
  // pos === 2, held = g[0],g[1]。12持ち→3待ちのみpenchan
  return numberOf(g[0]) === 1 && numberOf(g[1]) === 2 ? 'penchan' : 'ryanmen'
}

function buildStandardVariants(
  pairKind: TileKind,
  groups: number[][],
  meldMentsu: Mentsu[],
  winKind: TileKind,
  winType: 'ron' | 'tsumo'
): StandardForm[] {
  const variants: StandardForm[] = []

  const makeConcealedMentsu = (markIndex: number | null): Mentsu[] =>
    groups.map((g, i) => {
      const type: 'kotsu' | 'shuntsu' = g[0] === g[1] ? 'kotsu' : 'shuntsu'
      const m: Mentsu = { type, tiles: g.map(mkTile), open: false }
      if (i === markIndex && type === 'kotsu' && winType === 'ron') {
        m.winningRon = true
      }
      return m
    })

  if (pairKind === winKind) {
    variants.push({
      pair: [mkTile(pairKind), mkTile(pairKind)],
      mentsu: [...makeConcealedMentsu(null), ...meldMentsu],
      wait: 'tanki',
    })
  }

  groups.forEach((g, i) => {
    if (!g.includes(winKind)) return
    const isKotsu = g[0] === g[1]
    const wait: WaitType = isKotsu ? 'shanpon' : classifyShuntsuWait(g, g.indexOf(winKind))
    variants.push({
      pair: [mkTile(pairKind), mkTile(pairKind)],
      mentsu: [...makeConcealedMentsu(i), ...meldMentsu],
      wait,
    })
  })

  return variants
}

function tryStandard(
  concealed: Tile[],
  melds: Meld[],
  winKind: TileKind,
  winType: 'ron' | 'tsumo'
): Interpretation[] {
  const needed = 4 - melds.length
  if (needed < 0) return []
  if (concealed.length !== needed * 3 + 2) return []

  const meldMentsu = melds.map(meldToMentsu)
  const baseCounts = new Array(34).fill(0)
  for (const t of concealed) baseCounts[t.kind]++

  const results: Interpretation[] = []

  for (let pairKind = 0; pairKind < 34; pairKind++) {
    if (baseCounts[pairKind] < 2) continue
    const counts = baseCounts.slice()
    counts[pairKind] -= 2
    const solutions = decompose(counts)
    for (const groups of solutions) {
      if (groups.length !== needed) continue
      const variants = buildStandardVariants(pairKind, groups, meldMentsu, winKind, winType)
      for (const standard of variants) {
        results.push({ kind: 'standard', standard })
      }
    }
  }

  return results
}

function tryChiitoi(concealed: Tile[]): ChiitoiForm | null {
  if (concealed.length !== 14) return null
  const counts = new Array(34).fill(0)
  for (const t of concealed) counts[t.kind]++
  const pairKinds: TileKind[] = []
  for (let k = 0; k < 34; k++) {
    if (counts[k] === 0) continue
    if (counts[k] !== 2) return null
    pairKinds.push(k)
  }
  if (pairKinds.length !== 7) return null
  return { pairs: pairKinds.map((k) => [mkTile(k), mkTile(k)]) }
}

function tryKokushi(concealed: Tile[], winKind: TileKind): KokushiForm | null {
  if (concealed.length !== 14) return null
  const counts = new Array(34).fill(0)
  for (const t of concealed) counts[t.kind]++

  for (const t of concealed) {
    if (!YAOCHU_KINDS.includes(t.kind)) return null
  }

  let pairKind: TileKind | null = null
  for (const k of YAOCHU_KINDS) {
    const c = counts[k]
    if (c === 0) return null // 13種すべて揃っていない
    if (c === 2) {
      if (pairKind !== null) return null // 2枚以上のペアが複数
      pairKind = k
    } else if (c > 2) {
      return null
    }
  }
  if (pairKind === null) return null

  return { thirteenWait: pairKind === winKind, tiles: concealed }
}

export function enumerateInterpretations(
  concealed: Tile[],
  melds: Meld[],
  winKind: TileKind,
  winType: 'ron' | 'tsumo'
): Interpretation[] {
  const results: Interpretation[] = []

  if (melds.length === 0) {
    const kokushi = tryKokushi(concealed, winKind)
    if (kokushi) results.push({ kind: 'kokushi', kokushi })

    const chiitoi = tryChiitoi(concealed)
    if (chiitoi) results.push({ kind: 'chiitoi', chiitoi })
  }

  results.push(...tryStandard(concealed, melds, winKind, winType))

  return results
}
