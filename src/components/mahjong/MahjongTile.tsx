import { tileDisplayName, type Tile, type TileKind } from '../../utils/mahjong/tiles'
import './MahjongTile.css'

// 牌の絵（麻雀の各ページで共通）。昔ながらの日本の牌のように、白い面に黒と赤の2色で、
// 萬子・字牌は筆文字、筒子は花の玉、索子は両端のふくらんだ竹で描く。

const HONOR_LABELS = ['東', '南', '西', '北', '白', '發', '中']
const KANJI_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九']

// 筆文字は Google Fonts の「Yuji Syuku」を、牌に使う字だけ読み込む（軽い）。
// 読み込めないとき（オフラインなど）は明朝体で表示される。
const BRUSH_FONT_URL =
  'https://fonts.googleapis.com/css2?family=Yuji+Syuku&display=swap&text=' +
  encodeURIComponent('一二三四五六七八九萬東南西北發中')
if (typeof document !== 'undefined' && !document.querySelector('link[data-mj-font]')) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = BRUSH_FONT_URL
  link.dataset.mjFont = '1'
  document.head.appendChild(link)
}
const BRUSH = "'Yuji Syuku','Yu Mincho','Hiragino Mincho ProN','Songti SC','SimSun','MS Mincho',serif"

const INK = '#141414'
const RED = '#cc1620'
const PAPER = '#ffffff'

// ---- 筒子 ----
type PinColor = 'k' | 'r'
const PIN_FILL: Record<PinColor, string> = { k: INK, r: RED }

const PIN_LAYOUT: Record<number, { x: number; y: number; r: number; c: PinColor }[]> = {
  2: [
    { x: 45, y: 38, r: 16, c: 'k' },
    { x: 45, y: 88, r: 16, c: 'k' },
  ],
  3: [
    { x: 25, y: 33, r: 13.5, c: 'k' },
    { x: 45, y: 63, r: 13.5, c: 'r' },
    { x: 65, y: 93, r: 13.5, c: 'k' },
  ],
  4: [
    { x: 29, y: 40, r: 14, c: 'k' },
    { x: 61, y: 40, r: 14, c: 'k' },
    { x: 29, y: 86, r: 14, c: 'k' },
    { x: 61, y: 86, r: 14, c: 'k' },
  ],
  5: [
    { x: 27, y: 36, r: 12.5, c: 'k' },
    { x: 63, y: 36, r: 12.5, c: 'k' },
    { x: 45, y: 63, r: 12.5, c: 'r' },
    { x: 27, y: 90, r: 12.5, c: 'k' },
    { x: 63, y: 90, r: 12.5, c: 'k' },
  ],
  6: [
    { x: 30, y: 30, r: 12, c: 'k' },
    { x: 60, y: 30, r: 12, c: 'k' },
    { x: 30, y: 64, r: 12, c: 'r' },
    { x: 60, y: 64, r: 12, c: 'r' },
    { x: 30, y: 96, r: 12, c: 'r' },
    { x: 60, y: 96, r: 12, c: 'r' },
  ],
  7: [
    { x: 24, y: 22, r: 9.5, c: 'k' },
    { x: 45, y: 31, r: 9.5, c: 'k' },
    { x: 66, y: 40, r: 9.5, c: 'k' },
    { x: 31, y: 70, r: 11, c: 'r' },
    { x: 59, y: 70, r: 11, c: 'r' },
    { x: 31, y: 98, r: 11, c: 'r' },
    { x: 59, y: 98, r: 11, c: 'r' },
  ],
  8: [
    { x: 31, y: 23, r: 10.5, c: 'k' },
    { x: 59, y: 23, r: 10.5, c: 'k' },
    { x: 31, y: 49, r: 10.5, c: 'k' },
    { x: 59, y: 49, r: 10.5, c: 'k' },
    { x: 31, y: 77, r: 10.5, c: 'k' },
    { x: 59, y: 77, r: 10.5, c: 'k' },
    { x: 31, y: 103, r: 10.5, c: 'k' },
    { x: 59, y: 103, r: 10.5, c: 'k' },
  ],
  9: [
    { x: 24, y: 32, r: 11.5, c: 'k' },
    { x: 45, y: 32, r: 11.5, c: 'k' },
    { x: 66, y: 32, r: 11.5, c: 'k' },
    { x: 24, y: 63, r: 11.5, c: 'r' },
    { x: 45, y: 63, r: 11.5, c: 'r' },
    { x: 66, y: 63, r: 11.5, c: 'r' },
    { x: 24, y: 94, r: 11.5, c: 'k' },
    { x: 45, y: 94, r: 11.5, c: 'k' },
    { x: 66, y: 94, r: 11.5, c: 'k' },
  ],
}

/** 円周上に小さな玉を並べる */
function dots(x: number, y: number, radius: number, n: number, size: number, color: string): string {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return `<circle cx="${(x + Math.cos(a) * radius).toFixed(2)}" cy="${(y + Math.sin(a) * radius).toFixed(2)}" r="${size.toFixed(2)}" fill="${color}"/>`
  }).join('')
}

/** 円周上に放射状の線を並べる（一筒の模様） */
function spokes(x: number, y: number, r1: number, r2: number, n: number, width: number, color: string): string {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    const x1 = (x + Math.cos(a) * r1).toFixed(2)
    const y1 = (y + Math.sin(a) * r1).toFixed(2)
    const x2 = (x + Math.cos(a) * r2).toFixed(2)
    const y2 = (y + Math.sin(a) * r2).toFixed(2)
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`
  }).join('')
}

/** 筒子の玉：外輪・白い輪・花びら・中心 */
function pinDot(x: number, y: number, r: number, color: string): string {
  const center = color === RED ? INK : RED
  return `<g>
    <circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>
    <circle cx="${x}" cy="${y}" r="${r * 0.8}" fill="${PAPER}"/>
    <circle cx="${x}" cy="${y}" r="${r * 0.66}" fill="${color}"/>
    ${dots(x, y, r * 0.42, 8, r * 0.13, PAPER)}
    <circle cx="${x}" cy="${y}" r="${r * 0.17}" fill="${center}"/>
  </g>`
}

/** 一筒：大きな飾り玉 */
function bigPin(): string {
  const x = 45
  const y = 63
  return `<g>
    <circle cx="${x}" cy="${y}" r="32" fill="${INK}"/>
    <circle cx="${x}" cy="${y}" r="28.5" fill="${PAPER}"/>
    <circle cx="${x}" cy="${y}" r="26" fill="${INK}"/>
    ${spokes(x, y, 15, 24, 24, 1.6, PAPER)}
    <circle cx="${x}" cy="${y}" r="14" fill="${PAPER}"/>
    <circle cx="${x}" cy="${y}" r="12" fill="${RED}"/>
    ${dots(x, y, 7.5, 8, 1.8, PAPER)}
    <circle cx="${x}" cy="${y}" r="4" fill="${INK}"/>
    <circle cx="${x}" cy="${y}" r="1.6" fill="${PAPER}"/>
  </g>`
}

// ---- 索子 ----
// red: 赤い竹（5索の真ん中、7索の上、9索の真ん中の列）。a: 傾き（8索の W・M）
const SOU_LAYOUT: Record<number, { x: number; y: number; h?: number; red?: boolean; a?: number }[]> = {
  2: [
    { x: 45, y: 38 },
    { x: 45, y: 88 },
  ],
  3: [
    { x: 45, y: 38 },
    { x: 31, y: 88 },
    { x: 59, y: 88 },
  ],
  4: [
    { x: 31, y: 38 },
    { x: 59, y: 38 },
    { x: 31, y: 88 },
    { x: 59, y: 88 },
  ],
  5: [
    { x: 26, y: 38 },
    { x: 64, y: 38 },
    { x: 45, y: 63, red: true },
    { x: 26, y: 88 },
    { x: 64, y: 88 },
  ],
  6: [
    { x: 26, y: 38 },
    { x: 45, y: 38 },
    { x: 64, y: 38 },
    { x: 26, y: 88, red: true },
    { x: 45, y: 88, red: true },
    { x: 64, y: 88, red: true },
  ],
  7: [
    { x: 45, y: 25, h: 24, red: true },
    { x: 26, y: 64, h: 25 },
    { x: 45, y: 64, h: 25 },
    { x: 64, y: 64, h: 25 },
    { x: 26, y: 97, h: 25 },
    { x: 45, y: 97, h: 25 },
    { x: 64, y: 97, h: 25 },
  ],
  // 8索は上が W、下が M の形
  8: [
    { x: 22, y: 38, a: -18 },
    { x: 36, y: 38, a: 18 },
    { x: 54, y: 38, a: -18 },
    { x: 68, y: 38, a: 18 },
    { x: 22, y: 88, a: 18 },
    { x: 36, y: 88, a: -18 },
    { x: 54, y: 88, a: 18 },
    { x: 68, y: 88, a: -18 },
  ],
  9: [
    { x: 26, y: 31, h: 25 },
    { x: 45, y: 31, h: 25, red: true },
    { x: 64, y: 31, h: 25 },
    { x: 26, y: 63, h: 25 },
    { x: 45, y: 63, h: 25, red: true },
    { x: 64, y: 63, h: 25 },
    { x: 26, y: 95, h: 25 },
    { x: 45, y: 95, h: 25, red: true },
    { x: 64, y: 95, h: 25 },
  ],
}

/** 索子の竹：両端がふくらんだ骨のような形に、真ん中の節と白い筋 */
function souStick(x: number, y: number, h = 32, red = false, angle = 0): string {
  const color = red ? RED : INK
  const top = y - h / 2
  const bottom = y + h / 2
  return `<g transform="rotate(${angle} ${x} ${y})">
    <rect x="${x - 2.6}" y="${top + 2}" width="5.2" height="${h - 4}" rx="2" fill="${color}"/>
    <ellipse cx="${x}" cy="${top + 2.4}" rx="4.6" ry="2.6" fill="${color}"/>
    <ellipse cx="${x}" cy="${bottom - 2.4}" rx="4.6" ry="2.6" fill="${color}"/>
    <ellipse cx="${x}" cy="${y}" rx="4.2" ry="2.2" fill="${color}"/>
    <line x1="${x}" y1="${top + 5}" x2="${x}" y2="${y - 3.2}" stroke="${PAPER}" stroke-width="1"/>
    <line x1="${x}" y1="${y + 3.2}" x2="${x}" y2="${bottom - 5}" stroke="${PAPER}" stroke-width="1"/>
  </g>`
}

/** 一索：黒と赤の孔雀 */
function birdSvg(): string {
  return `<g>
    <path d="M45 66 C26 70 14 90 18 110 C28 98 37 88 45 84 Z" fill="${INK}"/>
    <path d="M45 66 C64 70 76 90 72 110 C62 98 53 88 45 84 Z" fill="${INK}"/>
    <path d="M45 70 C36 84 34 100 40 112 C43 100 45 92 45 84 Z" fill="${RED}"/>
    <path d="M45 70 C54 84 56 100 50 112 C47 100 45 92 45 84 Z" fill="${RED}"/>
    ${[22, 32, 58, 68].map((cx, i) => `<circle cx="${cx}" cy="${[100, 108, 108, 100][i]}" r="3" fill="${PAPER}" stroke="${INK}" stroke-width="1.2"/><circle cx="${cx}" cy="${[100, 108, 108, 100][i]}" r="1.2" fill="${RED}"/>`).join('')}
    <path d="M45 30 C32 34 28 54 36 70 C40 78 50 78 54 70 C62 54 58 34 45 30 Z" fill="${INK}"/>
    <path d="M40 40 C36 50 37 60 42 68" stroke="${PAPER}" stroke-width="1.4" fill="none"/>
    <path d="M47 40 C51 48 52 58 49 66" stroke="${PAPER}" stroke-width="1" fill="none" opacity="0.8"/>
    <circle cx="45" cy="24" r="8.5" fill="${INK}"/>
    <circle cx="48" cy="22" r="2.4" fill="${PAPER}"/>
    <circle cx="48.4" cy="22" r="1.2" fill="${RED}"/>
    <path d="M52.5 23 L62 21 L53 28 Z" fill="${RED}"/>
    <path d="M41 17 Q42 7 46 11 Q48 5 51 12" stroke="${RED}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <circle cx="46" cy="7" r="2" fill="${RED}"/>
  </g>`
}

/**
 * 牌の土台。真っ白な面に、うっすら灰色のふちと、下にわずかな厚み。
 * 中の絵は面（y=1〜117）に収まるよう少し縮めて置く。
 */
function tileFace(inner: string, red: boolean): string {
  const redRing = red
    ? `<rect x="4" y="4" width="82" height="110" rx="8" fill="none" stroke="${RED}" stroke-width="2.2" opacity="0.85"/>`
    : ''
  return `<svg viewBox="0 0 90 126" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mjFace" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stop-color="#ffffff"/>
        <stop offset="0.75" stop-color="#fbfbf9"/>
        <stop offset="1" stop-color="#eeeeea"/>
      </linearGradient>
    </defs>
    <rect x="1" y="5" width="88" height="120" rx="10" fill="#cfcfc8"/>
    <rect x="1" y="1" width="88" height="118" rx="10" fill="url(#mjFace)" stroke="#c8c8c2" stroke-width="1"/>
    <path d="M11 2 H79 Q88 2 88 11" stroke="#ffffff" stroke-width="1.4" fill="none"/>
    <g transform="translate(45 60) scale(0.92) translate(-45 -63)">${inner}</g>
    ${redRing}
  </svg>`
}

function tileSVG(kind: TileKind, red: boolean): string {
  let inner: string
  if (kind <= 8) {
    const numColor = red ? RED : INK
    inner = `<text x="45" y="53" text-anchor="middle" font-family="${BRUSH}" font-size="52" fill="${numColor}">${KANJI_NUM[kind]}</text>
      <text x="45" y="108" text-anchor="middle" font-family="${BRUSH}" font-size="54" fill="${RED}">萬</text>`
  } else if (kind <= 17) {
    const n = kind - 8
    inner = n === 1 ? bigPin() : PIN_LAYOUT[n].map(p => pinDot(p.x, p.y, p.r, PIN_FILL[p.c])).join('')
  } else if (kind <= 26) {
    const n = kind - 17
    inner = n === 1 ? birdSvg() : SOU_LAYOUT[n].map(p => souStick(p.x, p.y, p.h, p.red, p.a)).join('')
  } else if (kind === 31) {
    // 白：日本の牌は無地。空き枠と見分けられるよう、ごく薄い枠だけ
    inner = `<rect x="20" y="22" width="50" height="82" rx="5" fill="none" stroke="#e2e2dc" stroke-width="2"/>`
  } else {
    const color = kind === 33 ? RED : INK
    inner = `<text x="45" y="86" text-anchor="middle" font-family="${BRUSH}" font-size="66" fill="${color}">${HONOR_LABELS[kind - 27]}</text>`
  }
  return tileFace(inner, red)
}

// ---- TileView ----
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
