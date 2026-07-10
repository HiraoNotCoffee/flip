import { useEffect, useMemo, useRef, useState } from 'react'
import {
  calculateScore,
  doraFromIndicator,
  tileDisplayName,
  tileFromString,
  type HandInput,
  type ScoreResult,
  type Tile,
  type Meld,
  type TileKind,
  type LimitName,
} from '../utils/mahjong'
import { recognizeMahjongHand, type VisionHandResult } from '../utils/mahjongVision'
import './Mahjong.css'

// ---- Local UI-only types (domain types always come from ../utils/mahjong) ----
type MeldType = Meld['type']
type WinType = HandInput['winType']
// UI keeps a 3-state riichi selector; converted to riichi/doubleRiichi booleans before scoring.
type RiichiState = 'none' | 'riichi' | 'double'
// Winds are represented as TileKind (東=27,南=28,西=29,北=30).
type Wind = TileKind
type PadTarget = 'hand' | 'dora' | 'ura' | 'meld'

interface PendingMeld {
  type: MeldType
  tiles: Tile[]
}

interface MahjongData {
  handTiles: Tile[]
  winningTileIndex: number | null
  melds: Meld[]
  winType: WinType
  riichi: RiichiState
  ippatsu: boolean
  roundWind: Wind
  seatWind: Wind
  doraIndicators: TileKind[]
  uraDoraIndicators: TileKind[]
  tenho: boolean
  chiho: boolean
  haitei: boolean
  houtei: boolean
  rinshan: boolean
  chankan: boolean
  honba: number
  kyotaku: number
}

const STORAGE_KEY = 'mahjong-calc-data'

const defaultData: MahjongData = {
  handTiles: [],
  winningTileIndex: null,
  melds: [],
  winType: 'ron',
  riichi: 'none',
  ippatsu: false,
  roundWind: 27,
  seatWind: 27,
  doraIndicators: [],
  uraDoraIndicators: [],
  tenho: false,
  chiho: false,
  haitei: false,
  houtei: false,
  rinshan: false,
  chankan: false,
  honba: 0,
  kyotaku: 0,
}

function loadData(): MahjongData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...defaultData, ...(JSON.parse(raw) as Partial<MahjongData>) }
  } catch {
    // ignore
  }
  return { ...defaultData }
}

function saveData(data: MahjongData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

const API_KEY_STORAGE = 'anthropic-api-key'

function loadApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

// 画像を長辺 maxEdge に収まるよう縮小し、JPEGのbase64（data URL接頭辞なし）に変換する。
async function fileToResizedBase64(
  file: File,
  maxEdge = 1800
): Promise<{ data: string; mediaType: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.onerror = () => reject(new Error('画像の読み込みに失敗しました'))
    fr.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('画像の読み込みに失敗しました'))
    im.src = dataUrl
  })
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
  const width = Math.max(1, Math.round(img.width * scale))
  const height = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('画像処理に失敗しました')
  ctx.drawImage(img, 0, 0, width, height)
  const jpeg = canvas.toDataURL('image/jpeg', 0.9)
  return { data: jpeg.split(',')[1] ?? '', mediaType: 'image/jpeg' }
}

const WIND_LABELS = ['東', '南', '西', '北']
const HONOR_LABELS = ['東', '南', '西', '北', '白', '發', '中']
const MELD_LABELS: Record<MeldType, string> = {
  chi: 'チー',
  pon: 'ポン',
  minkan: '明槓',
  ankan: '暗槓',
}
const ERROR_MESSAGES: Record<string, string> = {
  no_yaku: '役がありません（ドラのみでは上がれません）',
  not_winning_hand: '手牌が完成形になっていません',
  invalid_input: '入力内容が不正です',
}
const LIMIT_LABELS: Record<Exclude<LimitName, null>, string> = {
  mangan: '満貫',
  haneman: '跳満',
  baiman: '倍満',
  sanbaiman: '三倍満',
  yakuman: '役満',
}

function meldTileCount(type: MeldType): number {
  return type === 'chi' || type === 'pon' ? 3 : 4
}

function isFiveKind(kind: TileKind): boolean {
  return kind === 4 || kind === 13 || kind === 22
}

// ---- Realistic tile faces drawn as inline SVG (viewBox 90x126) ----
const KANJI_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
const CJK_FONT = "'Yu Mincho','Hiragino Mincho ProN','Songti SC','SimSun','MS Mincho',serif"

interface Pip {
  x: number
  y: number
  r?: number
  c?: boolean // colored red (5-pin/5-sou center, 7-sou head)
  big?: boolean // ornate 1-pin
  s?: boolean // small bamboo (3-column layouts)
  t?: boolean // short bamboo (8-sou)
}

const PIN_LAYOUT: Record<number, Pip[]> = {
  1: [{ x: 45, y: 63, r: 27, big: true }],
  2: [{ x: 45, y: 40, r: 15 }, { x: 45, y: 86, r: 15 }],
  3: [{ x: 27, y: 36, r: 13 }, { x: 45, y: 63, r: 13 }, { x: 63, y: 90, r: 13 }],
  4: [{ x: 31, y: 42, r: 14 }, { x: 59, y: 42, r: 14 }, { x: 31, y: 84, r: 14 }, { x: 59, y: 84, r: 14 }],
  5: [{ x: 30, y: 40, r: 12 }, { x: 60, y: 40, r: 12 }, { x: 45, y: 63, r: 12, c: true }, { x: 30, y: 86, r: 12 }, { x: 60, y: 86, r: 12 }],
  6: [{ x: 31, y: 34, r: 12 }, { x: 59, y: 34, r: 12 }, { x: 31, y: 63, r: 12 }, { x: 59, y: 63, r: 12 }, { x: 31, y: 92, r: 12 }, { x: 59, y: 92, r: 12 }],
  7: [{ x: 27, y: 30, r: 10 }, { x: 45, y: 30, r: 10 }, { x: 63, y: 30, r: 10 }, { x: 33, y: 74, r: 12 }, { x: 57, y: 74, r: 12 }, { x: 33, y: 100, r: 12 }, { x: 57, y: 100, r: 12 }],
  8: [{ x: 32, y: 26, r: 10 }, { x: 58, y: 26, r: 10 }, { x: 32, y: 50, r: 10 }, { x: 58, y: 50, r: 10 }, { x: 32, y: 74, r: 10 }, { x: 58, y: 74, r: 10 }, { x: 32, y: 98, r: 10 }, { x: 58, y: 98, r: 10 }],
  9: [{ x: 27, y: 34, r: 12 }, { x: 45, y: 34, r: 12 }, { x: 63, y: 34, r: 12 }, { x: 27, y: 63, r: 12 }, { x: 45, y: 63, r: 12 }, { x: 63, y: 63, r: 12 }, { x: 27, y: 92, r: 12 }, { x: 45, y: 92, r: 12 }, { x: 63, y: 92, r: 12 }],
}

const SOU_LAYOUT: Record<number, Pip[]> = {
  2: [{ x: 45, y: 38 }, { x: 45, y: 88 }],
  3: [{ x: 45, y: 30 }, { x: 31, y: 92 }, { x: 59, y: 92 }],
  4: [{ x: 31, y: 40 }, { x: 59, y: 40 }, { x: 31, y: 86 }, { x: 59, y: 86 }],
  5: [{ x: 30, y: 38 }, { x: 60, y: 38 }, { x: 45, y: 63, c: true }, { x: 30, y: 88 }, { x: 60, y: 88 }],
  6: [{ x: 29, y: 37, s: true }, { x: 45, y: 37, s: true }, { x: 61, y: 37, s: true }, { x: 29, y: 89, s: true }, { x: 45, y: 89, s: true }, { x: 61, y: 89, s: true }],
  7: [{ x: 45, y: 23, c: true }, { x: 29, y: 60, s: true }, { x: 45, y: 60, s: true }, { x: 61, y: 60, s: true }, { x: 29, y: 96, s: true }, { x: 45, y: 96, s: true }, { x: 61, y: 96, s: true }],
  8: [{ x: 31, y: 27, t: true }, { x: 59, y: 27, t: true }, { x: 31, y: 52, t: true }, { x: 59, y: 52, t: true }, { x: 31, y: 77, t: true }, { x: 59, y: 77, t: true }, { x: 31, y: 102, t: true }, { x: 59, y: 102, t: true }],
  9: [{ x: 29, y: 33, s: true }, { x: 45, y: 33, s: true }, { x: 61, y: 33, s: true }, { x: 29, y: 63, s: true }, { x: 45, y: 63, s: true }, { x: 61, y: 63, s: true }, { x: 29, y: 93, s: true }, { x: 45, y: 93, s: true }, { x: 61, y: 93, s: true }],
}

function pinDot(d: Pip): string {
  const r = d.r ?? 12
  if (d.big) {
    return `<g>
      <circle cx="${d.x}" cy="${d.y}" r="${r}" fill="#c0392b"/>
      <circle cx="${d.x}" cy="${d.y}" r="${r * 0.82}" fill="#f3ecd8"/>
      <circle cx="${d.x}" cy="${d.y}" r="${r * 0.64}" fill="#1f6aa8"/>
      <circle cx="${d.x}" cy="${d.y}" r="${r * 0.44}" fill="#f3ecd8"/>
      <circle cx="${d.x}" cy="${d.y}" r="${r * 0.26}" fill="#c0392b"/>
    </g>`
  }
  const center = d.c ? '#c0392b' : '#1f6aa8'
  return `<g>
    <circle cx="${d.x}" cy="${d.y}" r="${r}" fill="${d.c ? '#c0392b' : '#1f6aa8'}"/>
    <circle cx="${d.x}" cy="${d.y}" r="${r * 0.6}" fill="#f6f0df"/>
    <circle cx="${d.x}" cy="${d.y}" r="${r * 0.3}" fill="${center}"/>
  </g>`
}

function souStick(d: Pip): string {
  let w = 13
  let h = 30
  if (d.s) {
    w = 11
    h = 25
  }
  if (d.t) {
    w = 12
    h = 20
  }
  const main = d.c ? '#c0392b' : '#2f8f3e'
  const dark = d.c ? '#8e2a20' : '#1f6e2c'
  const light = d.c ? '#e06455' : '#57a86a'
  const x = d.x - w / 2
  const y = d.y - h / 2
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w / 2}" fill="${main}"/>
    <rect x="${x}" y="${y}" width="${w * 0.4}" height="${h}" rx="${w * 0.2}" fill="${light}" opacity="0.5"/>
    <rect x="${x}" y="${d.y - h * 0.2}" width="${w}" height="2.4" fill="${dark}"/>
    <rect x="${x}" y="${d.y + h * 0.14}" width="${w}" height="2.4" fill="${dark}"/>
  </g>`
}

function birdSvg(): string {
  return `<g>
    <path d="M45 92 Q40 88 44 82" stroke="#b23a2e" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M45 92 Q50 88 46 82" stroke="#b23a2e" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M45 40 C30 44 26 66 40 82 C44 87 46 87 50 82 C64 66 60 44 45 40 Z" fill="#2f8f3e"/>
    <path d="M45 44 C36 48 34 64 43 78 C45 81 46 81 47 79 C41 64 43 52 48 46 Z" fill="#57a86a" opacity="0.65"/>
    <circle cx="45" cy="34" r="10" fill="#2f8f3e"/>
    <circle cx="48" cy="32" r="2.6" fill="#14231d"/>
    <path d="M54 33 L64 30 L55 38 Z" fill="#c0392b"/>
    <path d="M40 26 Q45 14 52 22" stroke="#c0392b" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <path d="M38 84 Q30 96 34 104" stroke="#2f8f3e" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M52 84 Q60 96 56 104" stroke="#c0392b" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M45 84 Q45 98 45 106" stroke="#2f8f3e" stroke-width="3" fill="none" stroke-linecap="round"/>
  </g>`
}

function tileFace(inner: string, red: boolean): string {
  const redTint = red
    ? `<rect x="4" y="3" width="82" height="112" rx="9" fill="#e0503f" opacity="0.07"/>`
    : ''
  const redAura = red
    ? `<rect x="4.5" y="3.5" width="81" height="111" rx="9" fill="none" stroke="#d94b3a" stroke-width="2.4" opacity="0.85"/>`
    : ''
  return `<svg viewBox="0 0 90 126" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mjfc" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fdfaef"/>
        <stop offset="0.55" stop-color="#f3ecd8"/>
        <stop offset="1" stop-color="#e7dcbf"/>
      </linearGradient>
      <linearGradient id="mjside" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#d8cca4"/>
        <stop offset="1" stop-color="#bdb086"/>
      </linearGradient>
    </defs>
    <rect x="1.5" y="2" width="87" height="122" rx="13" fill="url(#mjside)"/>
    <rect x="4" y="3" width="82" height="112" rx="9.5" fill="url(#mjfc)" stroke="#cfc4a0" stroke-width="1"/>
    <rect x="6.5" y="5" width="77" height="107" rx="7.5" fill="none" stroke="#ffffff" stroke-width="1.3" opacity="0.55"/>
    ${redTint}
    ${inner}
    ${redAura}
  </svg>`
}

function tileSVG(kind: TileKind, red: boolean): string {
  let inner: string
  if (kind <= 8) {
    const numColor = red ? '#c0392b' : '#1c2a22'
    inner = `<text x="45" y="52" text-anchor="middle" font-family="${CJK_FONT}" font-size="46" font-weight="600" fill="${numColor}">${KANJI_NUM[kind]}</text>
      <text x="45" y="103" text-anchor="middle" font-family="${CJK_FONT}" font-size="40" font-weight="600" fill="#b3271e">萬</text>`
  } else if (kind <= 17) {
    inner = PIN_LAYOUT[kind - 8].map(pinDot).join('')
  } else if (kind <= 26) {
    const n = kind - 17
    inner = n === 1 ? birdSvg() : SOU_LAYOUT[n].map(souStick).join('')
  } else if (kind === 31) {
    // 白: blue frame
    inner = `<rect x="24" y="26" width="42" height="64" rx="4" fill="none" stroke="#1f6aa8" stroke-width="4"/>
      <rect x="30" y="32" width="30" height="52" rx="2" fill="none" stroke="#1f6aa8" stroke-width="1.6" opacity="0.6"/>`
  } else {
    const color = kind === 32 ? '#2f8f3e' : kind === 33 ? '#c0392b' : '#1c2a22'
    inner = `<text x="45" y="80" text-anchor="middle" font-family="${CJK_FONT}" font-size="58" font-weight="700" fill="${color}">${HONOR_LABELS[kind - 27]}</text>`
  }
  return tileFace(inner, red)
}

function errorMessage(code?: string): string {
  if (!code) return 'エラーが発生しました'
  return ERROR_MESSAGES[code] ?? code
}

// ---- TileView: small CSS-drawn tile (no emoji) ----
function TileView({
  tile,
  size = 40,
  onClick,
  highlighted = false,
  disabled = false,
}: {
  tile: Tile
  size?: number
  onClick?: () => void
  highlighted?: boolean
  disabled?: boolean
}) {
  const clickable = !!onClick && !disabled
  const classNames = [
    'mj-tile',
    tile.red ? 'mj-tile-red' : '',
    highlighted ? 'mj-tile-highlighted' : '',
    disabled ? 'mj-tile-disabled' : '',
    clickable ? 'mj-tile-clickable' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={classNames}
      style={{ width: size, height: Math.round(size * 1.4) }}
      onClick={clickable ? onClick : undefined}
      title={tileDisplayName(tile)}
      dangerouslySetInnerHTML={{ __html: tileSVG(tile.kind, !!tile.red) }}
    />
  )
}

function HandTileSlot({
  tile,
  isWinning,
  onDelete,
  onMarkWinning,
}: {
  tile: Tile
  isWinning: boolean
  onDelete: () => void
  onMarkWinning: () => void
}) {
  return (
    <div className="mj-hand-slot">
      <TileView tile={tile} size={38} onClick={onDelete} highlighted={isWinning} />
      <button
        type="button"
        className={`mj-win-marker ${isWinning ? 'active' : ''}`}
        onClick={onMarkWinning}
      >
        和
      </button>
    </div>
  )
}

export function Mahjong() {
  const [data, setData] = useState<MahjongData>(loadData)
  const [padTarget, setPadTarget] = useState<PadTarget>('hand')
  const [redToggle, setRedToggle] = useState(false)
  const [pendingMeld, setPendingMeld] = useState<PendingMeld | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  // Camera / vision recognition (phase 2)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [apiKey, setApiKey] = useState<string>(loadApiKey)
  const [showKey, setShowKey] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [recognizing, setRecognizing] = useState(false)
  const [visionError, setVisionError] = useState<string | null>(null)
  const [visionNotes, setVisionNotes] = useState<string | null>(null)

  const saveApiKey = (k: string) => {
    setApiKey(k)
    try {
      localStorage.setItem(API_KEY_STORAGE, k)
    } catch {
      // ignore
    }
  }

  // Auto-save
  useEffect(() => {
    saveData(data)
  }, [data])

  const update = (partial: Partial<MahjongData>) => {
    setData(prev => ({ ...prev, ...partial }))
  }

  const isConcealed = data.melds.every(m => m.type === 'ankan')

  // Riichi requires a concealed hand; clear it (and ippatsu) if a call breaks concealment.
  useEffect(() => {
    if (!isConcealed && data.riichi !== 'none') {
      update({ riichi: 'none', ippatsu: false })
    }
  }, [isConcealed])

  // Ura-dora only makes sense with riichi.
  useEffect(() => {
    if (data.riichi === 'none') {
      if (data.uraDoraIndicators.length > 0) update({ uraDoraIndicators: [] })
      if (padTarget === 'ura') setPadTarget('hand')
    }
  }, [data.riichi])

  const maxHandSlots = 14 - 3 * data.melds.length

  const usageCounts = useMemo(() => {
    const counts: Record<number, number> = {}
    const bump = (k: number) => {
      counts[k] = (counts[k] ?? 0) + 1
    }
    data.handTiles.forEach(t => bump(t.kind))
    data.melds.forEach(m => m.tiles.forEach(t => bump(t.kind)))
    data.doraIndicators.forEach(bump)
    data.uraDoraIndicators.forEach(bump)
    if (pendingMeld) pendingMeld.tiles.forEach(t => bump(t.kind))
    return counts
  }, [data, pendingMeld])

  const isKindMaxed = (kind: TileKind) => (usageCounts[kind] ?? 0) >= 4

  const removeHandTile = (idx: number) => {
    setData(prev => {
      const handTiles = prev.handTiles.filter((_, i) => i !== idx)
      let winningTileIndex = prev.winningTileIndex
      if (winningTileIndex === idx) {
        winningTileIndex = handTiles.length > 0 ? handTiles.length - 1 : null
      } else if (winningTileIndex !== null && winningTileIndex > idx) {
        winningTileIndex -= 1
      }
      return { ...prev, handTiles, winningTileIndex }
    })
  }

  const setWinningTile = (idx: number) => {
    update({ winningTileIndex: idx })
  }

  const removeMeld = (idx: number) => {
    setData(prev => ({ ...prev, melds: prev.melds.filter((_, i) => i !== idx) }))
  }

  const startMeld = (type: MeldType) => {
    setPendingMeld({ type, tiles: [] })
    setPadTarget('meld')
  }

  const cancelPendingMeld = () => {
    setPendingMeld(null)
    setPadTarget('hand')
  }

  const removeDoraIndicator = (idx: number) => {
    setData(prev => ({ ...prev, doraIndicators: prev.doraIndicators.filter((_, i) => i !== idx) }))
  }

  const removeUraDoraIndicator = (idx: number) => {
    setData(prev => ({
      ...prev,
      uraDoraIndicators: prev.uraDoraIndicators.filter((_, i) => i !== idx),
    }))
  }

  const handlePadClick = (kind: TileKind) => {
    if (isKindMaxed(kind)) return

    if (padTarget === 'hand') {
      if (data.handTiles.length >= maxHandSlots) return
      const tile: Tile = { kind, red: redToggle && isFiveKind(kind) }
      setData(prev => ({
        ...prev,
        handTiles: [...prev.handTiles, tile],
        winningTileIndex: prev.handTiles.length,
      }))
    } else if (padTarget === 'dora') {
      setData(prev => ({ ...prev, doraIndicators: [...prev.doraIndicators, kind] }))
    } else if (padTarget === 'ura') {
      if (data.riichi === 'none') return
      setData(prev => ({ ...prev, uraDoraIndicators: [...prev.uraDoraIndicators, kind] }))
    } else if (padTarget === 'meld' && pendingMeld) {
      const need = meldTileCount(pendingMeld.type)
      const tile: Tile = { kind, red: redToggle && isFiveKind(kind) }
      const nextTiles = [...pendingMeld.tiles, tile]
      if (nextTiles.length >= need) {
        const meld: Meld = { type: pendingMeld.type, tiles: nextTiles }
        setData(prev => ({ ...prev, melds: [...prev.melds, meld] }))
        setPendingMeld(null)
        setPadTarget('hand')
      } else {
        setPendingMeld({ ...pendingMeld, tiles: nextTiles })
      }
    }
  }

  const winningTile: Tile | undefined =
    data.winningTileIndex !== null
      ? data.handTiles[data.winningTileIndex]
      : data.handTiles[data.handTiles.length - 1]

  const isDealer = data.seatWind === 27

  const result = useMemo<ScoreResult | null>(() => {
    if (data.handTiles.length !== maxHandSlots || !winningTile) return null
    const input: HandInput = {
      concealed: data.handTiles,
      melds: data.melds,
      winningTile,
      winType: data.winType,
      isDealer,
      riichi: data.riichi === 'riichi',
      doubleRiichi: data.riichi === 'double',
      ippatsu: data.ippatsu,
      roundWind: data.roundWind,
      seatWind: data.seatWind,
      doraIndicators: data.doraIndicators.map(kind => ({ kind })),
      uraDoraIndicators: data.uraDoraIndicators.map(kind => ({ kind })),
      tenho: data.tenho,
      chiho: data.chiho,
      haitei: data.haitei,
      houtei: data.houtei,
      rinshan: data.rinshan,
      chankan: data.chankan,
      honba: data.honba,
      kyotaku: data.kyotaku,
    }
    try {
      return calculateScore(input)
    } catch (e) {
      return {
        success: false,
        error: 'invalid_input',
        errorMessage: e instanceof Error ? e.message : String(e),
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
  }, [data, maxHandSlots, winningTile, isDealer])

  const handleReset = () => {
    setData({ ...defaultData })
    setPendingMeld(null)
    setPadTarget('hand')
    setDetailsOpen(false)
    setConfirmReset(false)
  }

  const parseTiles = (arr: string[]): Tile[] => {
    const out: Tile[] = []
    for (const s of arr) {
      try {
        out.push(tileFromString(s.trim()))
      } catch {
        // 認識できない表記はスキップ
      }
    }
    return out
  }

  const applyVisionResult = (r: VisionHandResult) => {
    const melds: Meld[] = []
    for (const m of r.melds ?? []) {
      const tiles = parseTiles(m.tiles)
      if (tiles.length > 0) melds.push({ type: m.type, tiles })
    }
    const maxSlots = 14 - 3 * melds.length
    let hand = parseTiles(r.tiles ?? [])
    if (hand.length > maxSlots) hand = hand.slice(0, maxSlots)

    let winIdx: number | null = hand.length > 0 ? hand.length - 1 : null
    if (r.winningTile) {
      try {
        const w = tileFromString(r.winningTile.trim())
        const idx = hand.findIndex(t => t.kind === w.kind && !!t.red === !!w.red)
        if (idx >= 0) winIdx = idx
      } catch {
        // ignore
      }
    }

    setData(prev => ({ ...prev, handTiles: hand, melds, winningTileIndex: winIdx }))
    setPendingMeld(null)
    setPadTarget('hand')
    setVisionNotes(r.notes ? r.notes : null)
    if (hand.length === 0) setVisionError('牌を認識できませんでした。明るく正面から撮り直してください')
  }

  const handleCameraFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 同じ写真を選び直せるようにする
    if (!file) return
    if (!apiKey) {
      setSettingsOpen(true)
      setVisionError('先にAPIキーを設定してください')
      return
    }
    setRecognizing(true)
    setVisionError(null)
    setVisionNotes(null)
    try {
      const { data, mediaType } = await fileToResizedBase64(file)
      const result = await recognizeMahjongHand(data, mediaType, apiKey)
      applyVisionResult(result)
    } catch (err) {
      setVisionError(err instanceof Error ? err.message : String(err))
    } finally {
      setRecognizing(false)
    }
  }

  return (
    <div className="mahjong-calculator">
      {recognizing && (
        <div className="mj-vision-overlay">
          <div className="mj-vision-msg">画像を認識中…</div>
        </div>
      )}
      {/* ① 手牌エリア */}
      <div className="mahjong-section">
        <div className="mahjong-section-header">
          <h2>手牌</h2>
          <span className="mahjong-count">
            {data.handTiles.length} / {maxHandSlots}
          </span>
        </div>

        <div className="mj-camera-row">
          <button
            type="button"
            className="mj-camera-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={recognizing}
          >
            {recognizing ? '認識中…' : '📷 写真から読み取り'}
          </button>
          <button
            type="button"
            className="mj-camera-settings"
            onClick={() => setSettingsOpen(o => !o)}
          >
            ⚙ APIキー
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleCameraFile}
            style={{ display: 'none' }}
          />
        </div>
        {settingsOpen && (
          <div className="mj-key-settings">
            <label className="mj-key-label">Anthropic APIキー</label>
            <div className="mj-key-input-row">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => saveApiKey(e.target.value)}
                placeholder="sk-ant-..."
                className="mj-key-input"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="mj-key-toggle"
                onClick={() => setShowKey(s => !s)}
              >
                {showKey ? '隠す' : '表示'}
              </button>
            </div>
            <p className="mahjong-hint">
              キーはこの端末にのみ保存され、写真はClaudeへ直接送信されます（従量課金）。
              取得は console.anthropic.com から。
            </p>
          </div>
        )}
        {visionError && <p className="mj-vision-error">{visionError}</p>}
        {visionNotes && <p className="mahjong-hint">認識メモ: {visionNotes}</p>}

        <div className="hand-slots">
          {data.handTiles.map((t, i) => (
            <HandTileSlot
              key={i}
              tile={t}
              isWinning={i === (data.winningTileIndex ?? data.handTiles.length - 1)}
              onDelete={() => removeHandTile(i)}
              onMarkWinning={() => setWinningTile(i)}
            />
          ))}
          {Array.from({ length: Math.max(0, maxHandSlots - data.handTiles.length) }, (_, i) => (
            <div key={`empty-${i}`} className="mj-hand-slot-empty" />
          ))}
        </div>
        <p className="mahjong-hint">牌をタップすると削除、「和」で和了牌を指定できます。</p>
      </div>

      {/* ② 牌選択パッド */}
      <div className="mahjong-section">
        <div className="mahjong-section-header">
          <h2>牌選択</h2>
          <label className="red-toggle">
            <input
              type="checkbox"
              checked={redToggle}
              onChange={e => setRedToggle(e.target.checked)}
            />
            赤5
          </label>
        </div>
        <div className="pad-tabs">
          <button
            type="button"
            className={padTarget === 'hand' ? 'active' : ''}
            onClick={() => setPadTarget('hand')}
          >
            手牌
          </button>
          <button
            type="button"
            className={padTarget === 'dora' ? 'active' : ''}
            onClick={() => setPadTarget('dora')}
          >
            ドラ表示
          </button>
          <button
            type="button"
            className={padTarget === 'ura' ? 'active' : ''}
            disabled={data.riichi === 'none'}
            onClick={() => setPadTarget('ura')}
          >
            裏ドラ表示
          </button>
          {padTarget === 'meld' && pendingMeld && (
            <button type="button" className="active" disabled>
              {MELD_LABELS[pendingMeld.type]}選択中 ({pendingMeld.tiles.length}/
              {meldTileCount(pendingMeld.type)})
            </button>
          )}
        </div>
        <div className="pad-grid">
          {[0, 9, 18].map(base => (
            <div className="pad-row" key={base}>
              {Array.from({ length: 9 }, (_, i) => base + i).map(kind => (
                <TileView
                  key={kind}
                  tile={{ kind, red: redToggle && isFiveKind(kind) }}
                  size={44}
                  onClick={() => handlePadClick(kind)}
                  disabled={
                    isKindMaxed(kind) ||
                    (padTarget === 'hand' && data.handTiles.length >= maxHandSlots)
                  }
                />
              ))}
            </div>
          ))}
          <div className="pad-row pad-row-honor">
            {Array.from({ length: 7 }, (_, i) => 27 + i).map(kind => (
              <TileView
                key={kind}
                tile={{ kind }}
                size={44}
                onClick={() => handlePadClick(kind)}
                disabled={
                  isKindMaxed(kind) ||
                  (padTarget === 'hand' && data.handTiles.length >= maxHandSlots)
                }
              />
            ))}
          </div>
        </div>
      </div>

      {/* ③ 副露エディタ */}
      <div className="mahjong-section">
        <h2>副露</h2>
        {data.melds.length > 0 && (
          <div className="meld-list">
            {data.melds.map((m, i) => (
              <div key={i} className="meld-card">
                <span className="meld-label">{MELD_LABELS[m.type]}</span>
                <div className="meld-tiles">
                  {m.tiles.map((t, ti) => (
                    <TileView key={ti} tile={t} size={30} />
                  ))}
                </div>
                <button type="button" className="meld-remove" onClick={() => removeMeld(i)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {pendingMeld ? (
          <div className="meld-pending">
            <span>
              {MELD_LABELS[pendingMeld.type]}を選択中（{pendingMeld.tiles.length}/
              {meldTileCount(pendingMeld.type)}）
            </span>
            <div className="meld-tiles">
              {pendingMeld.tiles.map((t, ti) => (
                <TileView key={ti} tile={t} size={30} />
              ))}
            </div>
            <button type="button" className="meld-cancel" onClick={cancelPendingMeld}>
              キャンセル
            </button>
          </div>
        ) : (
          <div className="meld-add-row">
            <button type="button" disabled={data.melds.length >= 4} onClick={() => startMeld('chi')}>
              + チー
            </button>
            <button type="button" disabled={data.melds.length >= 4} onClick={() => startMeld('pon')}>
              + ポン
            </button>
            <button type="button" disabled={data.melds.length >= 4} onClick={() => startMeld('minkan')}>
              + 明槓
            </button>
            <button type="button" disabled={data.melds.length >= 4} onClick={() => startMeld('ankan')}>
              + 暗槓
            </button>
          </div>
        )}
      </div>

      {/* ④ 条件トグル */}
      <div className="mahjong-section">
        <h2>条件</h2>
        <div className="condition-row">
          <span className="condition-label">和了方法</span>
          <div className="segmented">
            <button
              type="button"
              className={data.winType === 'tsumo' ? 'active' : ''}
              onClick={() => update({ winType: 'tsumo' })}
            >
              ツモ
            </button>
            <button
              type="button"
              className={data.winType === 'ron' ? 'active' : ''}
              onClick={() => update({ winType: 'ron' })}
            >
              ロン
            </button>
          </div>
        </div>
        <div className="condition-row">
          <span className="condition-label">リーチ</span>
          <div className="segmented">
            <button
              type="button"
              disabled={!isConcealed}
              className={data.riichi === 'none' ? 'active' : ''}
              onClick={() => update({ riichi: 'none', ippatsu: false })}
            >
              なし
            </button>
            <button
              type="button"
              disabled={!isConcealed}
              className={data.riichi === 'riichi' ? 'active' : ''}
              onClick={() => update({ riichi: 'riichi' })}
            >
              リーチ
            </button>
            <button
              type="button"
              disabled={!isConcealed}
              className={data.riichi === 'double' ? 'active' : ''}
              onClick={() => update({ riichi: 'double' })}
            >
              ダブリー
            </button>
          </div>
        </div>
        <label className="condition-checkbox">
          <input
            type="checkbox"
            checked={data.ippatsu}
            disabled={data.riichi === 'none'}
            onChange={e => update({ ippatsu: e.target.checked })}
          />
          一発
        </label>
        <div className="condition-row">
          <span className="condition-label">場風</span>
          <div className="segmented">
            {[27, 28].map(w => (
              <button
                key={w}
                type="button"
                className={data.roundWind === w ? 'active' : ''}
                onClick={() => update({ roundWind: w as Wind })}
              >
                {WIND_LABELS[w - 27]}
              </button>
            ))}
          </div>
        </div>
        <div className="condition-row">
          <span className="condition-label">自風</span>
          <div className="segmented">
            {[27, 28, 29, 30].map(w => (
              <button
                key={w}
                type="button"
                className={data.seatWind === w ? 'active' : ''}
                onClick={() => update({ seatWind: w as Wind })}
              >
                {WIND_LABELS[w - 27]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ⑤ ドラ入力 */}
      <div className="mahjong-section">
        <h2>ドラ</h2>
        <div className="dora-group">
          <span className="condition-label">ドラ表示牌</span>
          <div className="dora-chip-row">
            {data.doraIndicators.map((k, i) => (
              <div key={i} className="dora-chip" onClick={() => removeDoraIndicator(i)}>
                <TileView tile={{ kind: k }} size={28} />
                <span className="dora-arrow">→</span>
                <TileView tile={doraFromIndicator({ kind: k })} size={28} />
              </div>
            ))}
            <button
              type="button"
              className={`pad-target-btn ${padTarget === 'dora' ? 'active' : ''}`}
              onClick={() => setPadTarget('dora')}
            >
              + 追加
            </button>
          </div>
        </div>
        <div className="dora-group">
          <span className="condition-label">
            裏ドラ表示牌{data.riichi === 'none' ? '（リーチ時のみ）' : ''}
          </span>
          <div className="dora-chip-row">
            {data.uraDoraIndicators.map((k, i) => (
              <div key={i} className="dora-chip" onClick={() => removeUraDoraIndicator(i)}>
                <TileView tile={{ kind: k }} size={28} />
                <span className="dora-arrow">→</span>
                <TileView tile={doraFromIndicator({ kind: k })} size={28} />
              </div>
            ))}
            <button
              type="button"
              disabled={data.riichi === 'none'}
              className={`pad-target-btn ${padTarget === 'ura' ? 'active' : ''}`}
              onClick={() => setPadTarget('ura')}
            >
              + 追加
            </button>
          </div>
        </div>
      </div>

      {/* ⑥ 詳細設定 */}
      <div className="mahjong-section">
        <button type="button" className="details-toggle" onClick={() => setDetailsOpen(o => !o)}>
          詳細設定 {detailsOpen ? '▲' : '▼'}
        </button>
        {detailsOpen && (
          <div className="details-body">
            <label className="condition-checkbox">
              <input
                type="checkbox"
                checked={data.tenho}
                onChange={e => update({ tenho: e.target.checked })}
              />
              天和
            </label>
            <label className="condition-checkbox">
              <input
                type="checkbox"
                checked={data.chiho}
                onChange={e => update({ chiho: e.target.checked })}
              />
              地和
            </label>
            <label className="condition-checkbox">
              <input
                type="checkbox"
                checked={data.haitei}
                onChange={e => update({ haitei: e.target.checked })}
              />
              海底摸月
            </label>
            <label className="condition-checkbox">
              <input
                type="checkbox"
                checked={data.houtei}
                onChange={e => update({ houtei: e.target.checked })}
              />
              河底撈魚
            </label>
            <label className="condition-checkbox">
              <input
                type="checkbox"
                checked={data.rinshan}
                onChange={e => update({ rinshan: e.target.checked })}
              />
              嶺上開花
            </label>
            <label className="condition-checkbox">
              <input
                type="checkbox"
                checked={data.chankan}
                onChange={e => update({ chankan: e.target.checked })}
              />
              槍槓
            </label>
            <div className="stepper-row">
              <span className="condition-label">本場</span>
              <div className="stepper">
                <button type="button" onClick={() => update({ honba: Math.max(0, data.honba - 1) })}>
                  −
                </button>
                <span>{data.honba}</span>
                <button type="button" onClick={() => update({ honba: data.honba + 1 })}>
                  +
                </button>
              </div>
            </div>
            <div className="stepper-row">
              <span className="condition-label">供託（本）</span>
              <div className="stepper">
                <button
                  type="button"
                  onClick={() => update({ kyotaku: Math.max(0, data.kyotaku - 1) })}
                >
                  −
                </button>
                <span>{data.kyotaku}</span>
                <button type="button" onClick={() => update({ kyotaku: data.kyotaku + 1 })}>
                  +
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ⑦ 結果パネル */}
      <div className="mahjong-section mahjong-result">
        <h2>結果</h2>
        {data.handTiles.length !== maxHandSlots ? (
          <div className="result-placeholder">
            牌を{maxHandSlots}枚入力してください（現在{data.handTiles.length}枚）
          </div>
        ) : !result ? (
          <div className="result-placeholder">計算中...</div>
        ) : !result.success ? (
          <div className="result-error">{result.errorMessage ?? errorMessage(result.error)}</div>
        ) : (
          <>
            <div className="result-score">
              {result.limitName && (
                <span className="result-limit">{LIMIT_LABELS[result.limitName]}</span>
              )}
              <span className="result-points">{result.points.total.toLocaleString()}点</span>
            </div>
            <div className="result-hanfu">
              {result.fu}符 {result.han}翻
            </div>
            {data.winType === 'ron' && result.points.ronFrom != null && (
              <div className="result-payment">ロン：{result.points.ronFrom.toLocaleString()}点</div>
            )}
            {data.winType === 'tsumo' && isDealer && result.points.tsumoFromEach != null && (
              <div className="result-payment">
                ツモ：{result.points.tsumoFromEach.toLocaleString()}点オール
              </div>
            )}
            {data.winType === 'tsumo' && !isDealer && result.points.tsumoFromDealer != null && (
              <div className="result-payment">
                ツモ：親 {result.points.tsumoFromDealer.toLocaleString()}点 / 子{' '}
                {(result.points.tsumoFromNonDealer ?? 0).toLocaleString()}点
              </div>
            )}
            <ul className="yaku-list">
              {result.yaku.map((y, i) => (
                <li key={i} className="yaku-item">
                  <span className="yaku-name">{y.name}</span>
                  <span className="yaku-han">{y.yakuman ? '役満' : `${y.han}翻`}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* ⑧ リセット */}
      <div className="mahjong-reset-section">
        <button className="mahjong-reset-btn" onClick={() => setConfirmReset(true)}>
          Reset
        </button>
      </div>

      {confirmReset && (
        <div className="confirm-overlay" onClick={() => setConfirmReset(false)}>
          <div className="confirm-modal" onClick={e => e.stopPropagation()}>
            <p>Reset all data?</p>
            <div className="confirm-buttons">
              <button className="confirm-cancel" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
              <button className="confirm-ok" onClick={handleReset}>
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
