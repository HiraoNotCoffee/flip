// 麻雀 牌モデル（純粋関数）
// TileKind: 0..33
//   0-8  = 1m..9m
//   9-17 = 1p..9p
//   18-26 = 1s..9s
//   27-33 = 東南西北白發中 (1z..7z)

export type TileKind = number

export interface Tile {
  kind: TileKind
  red?: boolean // 赤ドラ（5m/5p/5sのみ有効）
}

export type Suit = 'm' | 'p' | 's' | 'z'

export interface Meld {
  type: 'chi' | 'pon' | 'minkan' | 'ankan'
  tiles: Tile[]
}

const HONOR_NAMES = ['東', '南', '西', '北', '白', '發', '中']
const SUIT_KANJI: Record<Suit, string> = { m: '萬', p: '筒', s: '索', z: '' }
const NUM_KANJI = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

export function suitOf(kind: TileKind): Suit {
  if (kind < 9) return 'm'
  if (kind < 18) return 'p'
  if (kind < 27) return 's'
  return 'z'
}

export function numberOf(kind: TileKind): number {
  if (kind < 9) return kind + 1
  if (kind < 18) return kind - 9 + 1
  if (kind < 27) return kind - 18 + 1
  return kind - 27 + 1
}

export function isHonor(kind: TileKind): boolean {
  return kind >= 27
}

export function isTerminal(kind: TileKind): boolean {
  if (isHonor(kind)) return false
  const n = numberOf(kind)
  return n === 1 || n === 9
}

export function isTerminalOrHonor(kind: TileKind): boolean {
  return isHonor(kind) || isTerminal(kind)
}

export function isSimple(kind: TileKind): boolean {
  return !isTerminalOrHonor(kind)
}

// 牌の種類ごとの表記からTileへ変換。'5m'等は通常牌、'0m'/'0p'/'0s'は赤5。
export function tileFromString(s: string): Tile {
  if (s.length !== 2) throw new Error(`invalid tile string: ${s}`)
  const numChar = s[0]
  const suitChar = s[1] as Suit
  const num = Number(numChar)
  if (Number.isNaN(num)) throw new Error(`invalid tile string: ${s}`)

  if (suitChar === 'z') {
    if (num < 1 || num > 7) throw new Error(`invalid honor tile: ${s}`)
    return { kind: 27 + (num - 1) }
  }

  if (suitChar !== 'm' && suitChar !== 'p' && suitChar !== 's') {
    throw new Error(`invalid tile string: ${s}`)
  }

  const base = suitChar === 'm' ? 0 : suitChar === 'p' ? 9 : 18
  if (num === 0) {
    // 赤5
    return { kind: base + 4, red: true }
  }
  if (num < 1 || num > 9) throw new Error(`invalid tile string: ${s}`)
  return { kind: base + (num - 1) }
}

export function tileToString(t: Tile): string {
  const suit = suitOf(t.kind)
  const num = numberOf(t.kind)
  if (suit === 'z') return `${num}z`
  if (t.red && num === 5) return `0${suit}`
  return `${num}${suit}`
}

// 表示用の日本語名（例: '五萬', '東', '五萬(赤)')
export function tileDisplayName(t: Tile): string {
  const suit = suitOf(t.kind)
  const num = numberOf(t.kind)
  if (suit === 'z') return HONOR_NAMES[num - 1]
  const base = `${NUM_KANJI[num]}${SUIT_KANJI[suit]}`
  return t.red ? `${base}(赤)` : base
}

// ドラ表示牌から実際のドラ牌を算出（数牌は+1循環、風牌は東南西北循環、三元牌は白發中循環）
export function doraFromIndicator(indicator: Tile): Tile {
  const suit = suitOf(indicator.kind)
  if (suit === 'z') {
    const num = numberOf(indicator.kind) // 1..7
    if (num <= 4) {
      // 風牌: 東(1)→南(2)→西(3)→北(4)→東(1)
      const next = (num % 4) + 1
      return { kind: 27 + (next - 1) }
    } else {
      // 三元牌: 白(5)→發(6)→中(7)→白(5)
      const local = num - 5 // 0,1,2
      const next = (local + 1) % 3
      return { kind: 31 + next }
    }
  }
  const base = suit === 'm' ? 0 : suit === 'p' ? 9 : 18
  const num = numberOf(indicator.kind)
  const next = num === 9 ? 1 : num + 1
  return { kind: base + (next - 1) }
}

// 牌配列を34種のカウント配列へ変換
export function countsOf(tiles: Tile[]): number[] {
  const counts = new Array(34).fill(0)
  for (const t of tiles) counts[t.kind]++
  return counts
}
