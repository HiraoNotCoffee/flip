import { tileDisplayName, type Tile, type TileKind } from '../../utils/mahjong/tiles'
import './MahjongTile.css'

// 本物の意匠に寄せた牌の絵（麻雀の各ページで共通）

const HONOR_LABELS = ['東', '南', '西', '北', '白', '發', '中']

// ---- 牌の絵（viewBox 90x126）----
// 本物の牌のように、アイボリーの面・白い厚み・緑の背の三層で立体にし、絵柄は彫り込んで
// 色を入れたように見せる（明るいふちと影を付けるフィルター）。

const KANJI_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
const CJK_FONT = "'Yu Mincho','Hiragino Mincho ProN','Songti SC','SimSun','MS Mincho',serif"

const C = {
  red: '#c8242c',
  redDark: '#8e141a',
  blue: '#1d4fae',
  green: '#11804a',
  greenDark: '#0a5530',
  greenLight: '#3db37a',
  ink: '#16181c',
  ivory: '#fffcf3',
}

type PinColor = 'b' | 'g' | 'r'
const PIN_FILL: Record<PinColor, string> = { b: C.blue, g: C.green, r: C.red }

// 筒子の並びと色（本物の配色: 2筒は緑と青、9筒は上から青・赤・緑 など）
const PIN_LAYOUT: Record<number, { x: number; y: number; r: number; c: PinColor }[]> = {
  2: [
    { x: 45, y: 40, r: 15, c: 'g' },
    { x: 45, y: 86, r: 15, c: 'b' },
  ],
  3: [
    { x: 26, y: 35, r: 13, c: 'b' },
    { x: 45, y: 63, r: 13, c: 'r' },
    { x: 64, y: 91, r: 13, c: 'g' },
  ],
  4: [
    { x: 30, y: 42, r: 14, c: 'b' },
    { x: 60, y: 42, r: 14, c: 'g' },
    { x: 30, y: 84, r: 14, c: 'g' },
    { x: 60, y: 84, r: 14, c: 'b' },
  ],
  5: [
    { x: 28, y: 38, r: 12.5, c: 'b' },
    { x: 62, y: 38, r: 12.5, c: 'g' },
    { x: 45, y: 63, r: 12.5, c: 'r' },
    { x: 28, y: 88, r: 12.5, c: 'g' },
    { x: 62, y: 88, r: 12.5, c: 'b' },
  ],
  6: [
    { x: 31, y: 32, r: 12, c: 'g' },
    { x: 59, y: 32, r: 12, c: 'g' },
    { x: 31, y: 64, r: 12, c: 'r' },
    { x: 59, y: 64, r: 12, c: 'r' },
    { x: 31, y: 94, r: 12, c: 'r' },
    { x: 59, y: 94, r: 12, c: 'r' },
  ],
  7: [
    { x: 25, y: 24, r: 9.5, c: 'g' },
    { x: 45, y: 33, r: 9.5, c: 'g' },
    { x: 65, y: 42, r: 9.5, c: 'g' },
    { x: 32, y: 70, r: 11, c: 'r' },
    { x: 58, y: 70, r: 11, c: 'r' },
    { x: 32, y: 97, r: 11, c: 'r' },
    { x: 58, y: 97, r: 11, c: 'r' },
  ],
  8: [
    { x: 32, y: 24, r: 10, c: 'b' },
    { x: 58, y: 24, r: 10, c: 'b' },
    { x: 32, y: 50, r: 10, c: 'b' },
    { x: 58, y: 50, r: 10, c: 'b' },
    { x: 32, y: 76, r: 10, c: 'b' },
    { x: 58, y: 76, r: 10, c: 'b' },
    { x: 32, y: 102, r: 10, c: 'b' },
    { x: 58, y: 102, r: 10, c: 'b' },
  ],
  9: [
    { x: 25, y: 33, r: 11.5, c: 'b' },
    { x: 45, y: 33, r: 11.5, c: 'b' },
    { x: 65, y: 33, r: 11.5, c: 'b' },
    { x: 25, y: 63, r: 11.5, c: 'r' },
    { x: 45, y: 63, r: 11.5, c: 'r' },
    { x: 65, y: 63, r: 11.5, c: 'r' },
    { x: 25, y: 93, r: 11.5, c: 'g' },
    { x: 45, y: 93, r: 11.5, c: 'g' },
    { x: 65, y: 93, r: 11.5, c: 'g' },
  ],
}

/** 円周上に小さな玉を並べる（筒子の花びら・一筒の模様） */
function ring(x: number, y: number, radius: number, n: number, size: number, color: string): string {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    const cx = (x + Math.cos(a) * radius).toFixed(2)
    const cy = (y + Math.sin(a) * radius).toFixed(2)
    return `<circle cx="${cx}" cy="${cy}" r="${size.toFixed(2)}" fill="${color}"/>`
  }).join('')
}

/** 筒子の玉：外輪・白い輪・色の輪・花びら・中心 */
function pinDot(x: number, y: number, r: number, color: string): string {
  return `<g>
    <circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>
    <circle cx="${x}" cy="${y}" r="${r * 0.82}" fill="${C.ivory}"/>
    <circle cx="${x}" cy="${y}" r="${r * 0.7}" fill="${color}"/>
    ${ring(x, y, r * 0.45, 8, r * 0.12, C.ivory)}
    <circle cx="${x}" cy="${y}" r="${r * 0.2}" fill="${C.ivory}"/>
    <circle cx="${x}" cy="${y}" r="${r * 0.1}" fill="${color}"/>
  </g>`
}

/** 一筒：大きな花の玉 */
function bigPin(): string {
  const x = 45
  const y = 63
  return `<g>
    <circle cx="${x}" cy="${y}" r="31" fill="${C.green}"/>
    <circle cx="${x}" cy="${y}" r="28" fill="${C.ivory}"/>
    ${ring(x, y, 24.5, 16, 2.6, C.green)}
    <circle cx="${x}" cy="${y}" r="20" fill="${C.red}"/>
    <circle cx="${x}" cy="${y}" r="17.5" fill="${C.ivory}"/>
    ${ring(x, y, 13, 12, 3.4, C.blue)}
    <circle cx="${x}" cy="${y}" r="7.5" fill="${C.red}"/>
    <circle cx="${x}" cy="${y}" r="3.6" fill="${C.ivory}"/>
    <circle cx="${x}" cy="${y}" r="1.8" fill="${C.red}"/>
  </g>`
}

// 索子の並び（red: 赤い竹。5索の真ん中、7索の上、9索の真ん中の列）
const SOU_LAYOUT: Record<number, { x: number; y: number; h?: number; red?: boolean }[]> = {
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
    { x: 27, y: 38 },
    { x: 63, y: 38 },
    { x: 45, y: 63, red: true },
    { x: 27, y: 88 },
    { x: 63, y: 88 },
  ],
  6: [
    { x: 27, y: 38 },
    { x: 45, y: 38 },
    { x: 63, y: 38 },
    { x: 27, y: 88 },
    { x: 45, y: 88 },
    { x: 63, y: 88 },
  ],
  7: [
    { x: 45, y: 26, h: 22, red: true },
    { x: 27, y: 64, h: 24 },
    { x: 45, y: 64, h: 24 },
    { x: 63, y: 64, h: 24 },
    { x: 27, y: 96, h: 24 },
    { x: 45, y: 96, h: 24 },
    { x: 63, y: 96, h: 24 },
  ],
  8: [
    { x: 27, y: 38 },
    { x: 45, y: 38 },
    { x: 63, y: 38 },
    { x: 36, y: 63, h: 18 },
    { x: 54, y: 63, h: 18 },
    { x: 27, y: 88 },
    { x: 45, y: 88 },
    { x: 63, y: 88 },
  ],
  9: [
    { x: 27, y: 32, h: 24 },
    { x: 45, y: 32, h: 24, red: true },
    { x: 63, y: 32, h: 24 },
    { x: 27, y: 63, h: 24 },
    { x: 45, y: 63, h: 24, red: true },
    { x: 63, y: 63, h: 24 },
    { x: 27, y: 94, h: 24 },
    { x: 45, y: 94, h: 24, red: true },
    { x: 63, y: 94, h: 24 },
  ],
}

/** 索子の竹：丸みのある筒に、節と影 */
function souStick(x: number, y: number, h = 30, red = false): string {
  const w = 10
  const main = red ? C.red : C.green
  const dark = red ? C.redDark : C.greenDark
  const light = red ? '#e86a70' : C.greenLight
  const left = x - w / 2
  const top = y - h / 2
  return `<g>
    <rect x="${left}" y="${top}" width="${w}" height="${h}" rx="${w / 2}" fill="${main}"/>
    <rect x="${left + 1.4}" y="${top + 2}" width="${w * 0.28}" height="${h - 4}" rx="1.4" fill="${light}" opacity="0.75"/>
    <rect x="${left + w * 0.66}" y="${top + 2}" width="${w * 0.2}" height="${h - 4}" rx="1" fill="${dark}" opacity="0.45"/>
    <rect x="${left - 0.6}" y="${y - 1.2}" width="${w + 1.2}" height="2.4" rx="1.2" fill="${dark}"/>
    <rect x="${left - 0.3}" y="${top + 1.2}" width="${w + 0.6}" height="1.8" rx="0.9" fill="${dark}" opacity="0.8"/>
    <rect x="${left - 0.3}" y="${top + h - 3}" width="${w + 0.6}" height="1.8" rx="0.9" fill="${dark}" opacity="0.8"/>
  </g>`
}

/** 一索：孔雀のような鳥 */
function birdSvg(): string {
  return `<g>
    <path d="M45 74 C30 80 20 96 22 108 C30 100 38 92 45 88 Z" fill="${C.blue}"/>
    <path d="M45 74 C60 80 70 96 68 108 C60 100 52 92 45 88 Z" fill="${C.blue}"/>
    <path d="M45 76 C36 86 32 100 36 110 C41 102 44 94 45 88 Z" fill="${C.green}"/>
    <path d="M45 76 C54 86 58 100 54 110 C49 102 46 94 45 88 Z" fill="${C.green}"/>
    <circle cx="27" cy="104" r="2.6" fill="${C.red}"/>
    <circle cx="63" cy="104" r="2.6" fill="${C.red}"/>
    <circle cx="38" cy="108" r="2.4" fill="${C.red}"/>
    <circle cx="52" cy="108" r="2.4" fill="${C.red}"/>
    <path d="M45 34 C33 38 29 58 37 74 C41 82 49 82 53 74 C61 58 57 38 45 34 Z" fill="${C.green}"/>
    <path d="M44 40 C37 46 36 60 41 72 C43 75 45 75 46 73 C42 62 42 50 47 42 Z" fill="${C.greenLight}" opacity="0.8"/>
    <path d="M47 46 C52 52 53 62 50 70" stroke="${C.greenDark}" stroke-width="1.4" fill="none"/>
    <circle cx="45" cy="28" r="9" fill="${C.green}"/>
    <circle cx="48" cy="26" r="2.4" fill="${C.ivory}"/>
    <circle cx="48.4" cy="26" r="1.3" fill="${C.ink}"/>
    <path d="M53 27 L63 25 L54 32 Z" fill="${C.red}"/>
    <path d="M40 21 Q42 10 46 14 Q48 8 51 15" stroke="${C.red}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <circle cx="46" cy="11" r="2.2" fill="${C.red}"/>
  </g>`
}

/**
 * 牌の土台。下から緑の背・白い厚み・アイボリーの面を重ねて立体にする。
 * 中の絵は面の高さ（y=1〜111）に収まるよう少し縮めて置く。
 */
function tileFace(inner: string, red: boolean): string {
  const redRing = red
    ? `<rect x="4" y="4" width="82" height="103" rx="9" fill="none" stroke="${C.red}" stroke-width="2.4" opacity="0.9"/>`
    : ''
  return `<svg viewBox="0 0 90 126" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mjBack" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1c8d5f"/>
        <stop offset="1" stop-color="#0a4f33"/>
      </linearGradient>
      <linearGradient id="mjBone" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f4efe2"/>
        <stop offset="1" stop-color="#d9d1bd"/>
      </linearGradient>
      <radialGradient id="mjFace" cx="0.35" cy="0.25" r="0.95">
        <stop offset="0" stop-color="#fffefa"/>
        <stop offset="0.6" stop-color="#f8f4ea"/>
        <stop offset="1" stop-color="#ebe4d3"/>
      </radialGradient>
      <filter id="mjCarve" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0.6" dy="0.8" stdDeviation="0.25" flood-color="#ffffff" flood-opacity="0.9"/>
        <feDropShadow dx="-0.4" dy="-0.5" stdDeviation="0.3" flood-color="#000000" flood-opacity="0.28"/>
      </filter>
    </defs>
    <rect x="1" y="12" width="88" height="113" rx="12" fill="url(#mjBack)"/>
    <rect x="1" y="6" width="88" height="111" rx="12" fill="url(#mjBone)"/>
    <rect x="1" y="1" width="88" height="110" rx="12" fill="url(#mjFace)"/>
    <path d="M13 1.8 H77 Q88.2 1.8 88.2 13" stroke="#ffffff" stroke-width="1.6" fill="none" opacity="0.95"/>
    <path d="M1.8 13 V99 Q1.8 110 13 110" stroke="#ffffff" stroke-width="1.2" fill="none" opacity="0.7"/>
    <path d="M88.2 20 V99 Q88.2 110 77 110 H20" stroke="#000000" stroke-width="1" fill="none" opacity="0.12"/>
    <g filter="url(#mjCarve)" transform="translate(45 56) scale(0.9) translate(-45 -63)">${inner}</g>
    ${redRing}
  </svg>`
}

function tileSVG(kind: TileKind, red: boolean): string {
  let inner: string
  if (kind <= 8) {
    const numColor = red ? C.red : C.ink
    inner = `<text x="45" y="54" text-anchor="middle" font-family="${CJK_FONT}" font-size="48" font-weight="800" fill="${numColor}" stroke="${numColor}" stroke-width="1.2">${KANJI_NUM[kind]}</text>
      <text x="45" y="106" text-anchor="middle" font-family="${CJK_FONT}" font-size="44" font-weight="800" fill="${C.red}" stroke="${C.red}" stroke-width="1">萬</text>`
  } else if (kind <= 17) {
    const n = kind - 8
    inner = n === 1 ? bigPin() : PIN_LAYOUT[n].map(p => pinDot(p.x, p.y, p.r, PIN_FILL[p.c])).join('')
  } else if (kind <= 26) {
    const n = kind - 17
    inner = n === 1 ? birdSvg() : SOU_LAYOUT[n].map(p => souStick(p.x, p.y, p.h, p.red)).join('')
  } else if (kind === 31) {
    // 白：青い枠
    inner = `<rect x="22" y="24" width="46" height="78" rx="5" fill="none" stroke="${C.blue}" stroke-width="4.5"/>
      <rect x="29" y="31" width="32" height="64" rx="3" fill="none" stroke="${C.blue}" stroke-width="1.6" opacity="0.6"/>`
  } else {
    const color = kind === 32 ? C.green : kind === 33 ? C.red : C.ink
    inner = `<text x="45" y="84" text-anchor="middle" font-family="${CJK_FONT}" font-size="62" font-weight="800" fill="${color}" stroke="${color}" stroke-width="1.6">${HONOR_LABELS[kind - 27]}</text>`
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
