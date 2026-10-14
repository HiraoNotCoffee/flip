/*
 * お椀の絵付け（染付風）。画像ファイルは使わずに canvas で描く。
 * 回転体の UV は「横 = ぐるっと一周、縦 = 断面に沿って下→上」なので、
 * 横方向は継ぎ目が出ないように繰り返せる柄にしてある。
 */

export const GLAZE = '#f6f7f3'
const INDIGO = '#1d3474'
const INDIGO_LIGHT = 'rgba(29, 52, 116, 0.55)'

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.fillStyle = GLAZE
  g.fillRect(0, 0, w, h)
  return { c, g }
}

/** 呉須がにじんだ感じに少しだけぼかす */
function bleed(g: CanvasRenderingContext2D) {
  g.filter = 'blur(0.7px)'
}

function lines(g: CanvasRenderingContext2D, w: number, ys: number[], width: number) {
  g.strokeStyle = INDIGO
  g.lineWidth = width
  for (const y of ys) {
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(w, y)
    g.stroke()
  }
}

/**
 * 外側：一面の青海波。上に無地の帯と二本線、下にも二本線。
 * 横に repeat して使う（1枚で青海波4つ分）。
 */
export function drawOuter(): HTMLCanvasElement {
  const w = 512
  const h = 512
  const { c, g } = canvas(w, h)
  bleed(g)

  const r = w / 8
  const top = 90
  const bottom = h - 60
  g.save()
  g.beginPath()
  g.rect(0, top, w, bottom - top)
  g.clip()
  // 奥の段から描いて、手前の段の半円で重ねていく
  let row = 0
  for (let y = top - r / 2; y < bottom + r; y += r / 2, row++) {
    const offset = row % 2 === 0 ? 0 : r
    for (let x = -2 * r + offset; x <= w + 2 * r; x += 2 * r) {
      for (let k = 0; k < 4; k++) {
        const rr = r * (1 - k * 0.24)
        g.beginPath()
        g.arc(x, y + r / 2, rr, Math.PI, 0)
        g.closePath()
        g.fillStyle = k % 2 === 0 ? INDIGO : GLAZE
        g.fill()
      }
      g.beginPath()
      g.arc(x, y + r / 2, r * 0.18, Math.PI, 0)
      g.fillStyle = GLAZE
      g.fill()
    }
  }
  g.restore()

  lines(g, w, [top - 14, top - 4], 4)
  lines(g, w, [bottom + 6, bottom + 16], 4)
  return c
}

/** 内側：縁のすぐ下に雷文の帯。あとは無地 */
export function drawInner(): HTMLCanvasElement {
  const w = 512
  const h = 512
  const { c, g } = canvas(w, h)
  bleed(g)

  const bandTop = 18
  const cell = 32
  lines(g, w, [bandTop, bandTop + cell + 16], 3)
  g.strokeStyle = INDIGO
  g.lineWidth = 3.2
  for (let x = 0; x < w; x += cell) {
    keyFret(g, x + 4, bandTop + 8, cell - 8)
  }
  // 下のほうに細い一本線
  g.strokeStyle = INDIGO_LIGHT
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(0, h - 30)
  g.lineTo(w, h - 30)
  g.stroke()
  return c
}

/** 四角い渦巻き（雷文）をひとつ */
function keyFret(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const step = s / 6
  const pts: [number, number][] = [
    [0, s], [0, 0], [s, 0], [s, s - step], [step, s - step],
    [step, step], [s - step, step], [s - step, s - 2 * step],
    [2 * step, s - 2 * step], [2 * step, 2 * step], [s - 2 * step, 2 * step],
  ]
  g.beginPath()
  pts.forEach(([px, py], i) => (i === 0 ? g.moveTo(x + px, y + py) : g.lineTo(x + px, y + py)))
  g.stroke()
}

/** 見込み（内側の底）：二重の円と「福」 */
export function drawBottom(): HTMLCanvasElement {
  const s = 512
  const { c, g } = canvas(s, s)
  bleed(g)
  const m = s / 2
  g.strokeStyle = INDIGO
  g.lineWidth = 6
  g.beginPath()
  g.arc(m, m, s * 0.44, 0, Math.PI * 2)
  g.stroke()
  g.lineWidth = 3
  g.beginPath()
  g.arc(m, m, s * 0.4, 0, Math.PI * 2)
  g.stroke()

  g.fillStyle = INDIGO
  g.font = `bold ${s * 0.42}px "Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "Noto Serif JP", serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('福', m, m + s * 0.02)
  return c
}
