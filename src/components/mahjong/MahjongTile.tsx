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
// 参考の牌のように、色を塗りつぶした大きな玉に、細い明るい線で外輪と桜のような花を描く。
// 色は黒とくすんだ赤（d）。赤い五筒（r）は明るい赤。
type PinColor = 'k' | 'd' | 'r'
const PIN_FILL: Record<PinColor, string> = { k: INK, d: '#8f1d24', r: RED }
const PIN_LINE: Record<PinColor, string> = { k: '#d9d9d4', d: '#f0c9c9', r: '#ffe3e3' }

// 参考の牌のように、牌いっぱいに大きな玉をぎっしり並べる
const P = (x: number, y: number, r: number, c: PinColor) => ({ x, y, r, c })
const PIN_LAYOUT: Record<number, { x: number; y: number; r: number; c: PinColor }[]> = {
  2: [P(45, 34, 21, 'k'), P(45, 92, 21, 'k')],
  3: [P(22, 29, 17, 'k'), P(45, 63, 17, 'd'), P(68, 97, 17, 'k')],
  4: [P(25, 38, 18.5, 'k'), P(65, 38, 18.5, 'd'), P(25, 88, 18.5, 'd'), P(65, 88, 18.5, 'k')],
  5: [P(23, 32, 16, 'k'), P(67, 32, 16, 'k'), P(45, 63, 16, 'd'), P(23, 94, 16, 'k'), P(67, 94, 16, 'k')],
  6: [P(27, 28, 15.5, 'k'), P(63, 28, 15.5, 'k'), P(27, 63, 15.5, 'd'), P(63, 63, 15.5, 'd'), P(27, 98, 15.5, 'd'), P(63, 98, 15.5, 'd')],
  7: [
    P(20, 19, 12, 'k'), P(45, 31, 12, 'k'), P(70, 43, 12, 'k'),
    P(27, 74, 14.5, 'd'), P(63, 74, 14.5, 'd'), P(27, 104, 14.5, 'd'), P(63, 104, 14.5, 'd'),
  ],
  8: [
    P(28, 21, 13, 'k'), P(62, 21, 13, 'k'), P(28, 49, 13, 'k'), P(62, 49, 13, 'k'),
    P(28, 77, 13, 'k'), P(62, 77, 13, 'k'), P(28, 105, 13, 'k'), P(62, 105, 13, 'k'),
  ],
  9: [
    P(19, 30, 12.5, 'k'), P(45, 30, 12.5, 'k'), P(71, 30, 12.5, 'k'),
    P(19, 63, 12.5, 'd'), P(45, 63, 12.5, 'd'), P(71, 63, 12.5, 'd'),
    P(19, 96, 12.5, 'k'), P(45, 96, 12.5, 'k'), P(71, 96, 12.5, 'k'),
  ],
}

/** 円周上に小さな玉を並べる */
function dots(x: number, y: number, radius: number, n: number, size: number, color: string): string {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return `<circle cx="${(x + Math.cos(a) * radius).toFixed(2)}" cy="${(y + Math.sin(a) * radius).toFixed(2)}" r="${size.toFixed(2)}" fill="${color}"/>`
  }).join('')
}

/** 桜のような花（細い線）。花びら n 枚を円で重ね、真ん中に小さな輪 */
function flower(x: number, y: number, r: number, n: number, line: string, width: number): string {
  const petals = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    const cx = (x + Math.cos(a) * r * 0.55).toFixed(2)
    const cy = (y + Math.sin(a) * r * 0.55).toFixed(2)
    return `<circle cx="${cx}" cy="${cy}" r="${(r * 0.42).toFixed(2)}" fill="none" stroke="${line}" stroke-width="${width}"/>`
  }).join('')
  return `${petals}<circle cx="${x}" cy="${y}" r="${(r * 0.2).toFixed(2)}" fill="none" stroke="${line}" stroke-width="${width}"/>`
}

/** 筒子の玉：塗りつぶした玉に、外輪と花を細い明るい線で */
function pinDot(x: number, y: number, r: number, c: PinColor): string {
  const line = PIN_LINE[c]
  const w = Math.max(0.8, r * 0.07)
  return `<g>
    <circle cx="${x}" cy="${y}" r="${r}" fill="${PIN_FILL[c]}"/>
    <circle cx="${x}" cy="${y}" r="${r * 0.84}" fill="none" stroke="${line}" stroke-width="${w}"/>
    ${flower(x, y, r * 0.62, 5, line, w)}
  </g>`
}

/** 白いコンマのような飾り（一筒の外周） */
function commas(x: number, y: number, radius: number, n: number, size: number): string {
  return Array.from({ length: n }, (_, i) => {
    const deg = (i / n) * 360
    return `<g transform="rotate(${deg.toFixed(1)} ${x} ${y}) translate(${x} ${y - radius})">
      <path d="M ${-size} 0 A ${size} ${size} 0 1 1 ${size * 0.2} ${size * 0.9}" fill="none" stroke="${PAPER}" stroke-width="${(size * 0.55).toFixed(2)}" stroke-linecap="round"/>
    </g>`
  }).join('')
}

/** 一筒：黒い大きな円のふちに白い飾り、真ん中に赤い花の円 */
function bigPin(): string {
  const x = 45
  const y = 63
  // 牌いっぱいに見えるよう、少し大きくして置く
  return `<g transform="translate(${x} ${y}) scale(1.15) translate(${-x} ${-y})">
    <circle cx="${x}" cy="${y}" r="33" fill="${INK}"/>
    <circle cx="${x}" cy="${y}" r="31" fill="none" stroke="#d9d9d4" stroke-width="0.9"/>
    ${commas(x, y, 25.5, 16, 2.6)}
    <circle cx="${x}" cy="${y}" r="19.5" fill="none" stroke="#d9d9d4" stroke-width="0.9"/>
    <circle cx="${x}" cy="${y}" r="18" fill="#8f1d24"/>
    ${flower(x, y, 15, 8, '#f0c9c9', 1.1)}
    ${dots(x, y, 10.5, 16, 0.9, '#f0c9c9')}
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
    inner = n === 1 ? bigPin() : PIN_LAYOUT[n].map(p => pinDot(p.x, p.y, p.r, p.c)).join('')
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
