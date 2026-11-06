import { tileDisplayName, type Tile, type TileKind } from '../../utils/mahjong/tiles'
import './MahjongTile.css'

// 本物の意匠に寄せた牌の絵（麻雀の各ページで共通）

const HONOR_LABELS = ['東', '南', '西', '北', '白', '發', '中']

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

// ---- TileView: small CSS-drawn tile (no emoji) ----
export function TileView({
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
