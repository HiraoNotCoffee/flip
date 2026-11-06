/*
 * チップ計算（ポーカー）の結果を1枚の画像（PNG）にする。LINE や Discord にそのまま貼れるように。
 */

import type { Transfer } from './settlement'
import { COLORS, FONT, color, dateLabel, fit, signed } from './resultImage'

export interface ChipImageInput {
  players: { name: string; buyIns: number; finalChips: number; pnl: number }[]
  chipsPer100BB: number
  buyInYen: number
  rake: number
  totalBuyInChips: number
  totalFinalChips: number
  /** 最終チップ + レーキ − バイインの合計。0 なら合っている */
  chipDiff: number
  /** 精算（送金の回数がいちばん少なくなる組み合わせ） */
  settlement: Transfer[]
}

const PAD = 28
const WIDTH = 600
const ROW_H = 42
const SCALE = 2
/** 列の右端（名前・バイイン・最終チップ・収支） */
const COLS = { name: PAD + 14, buyIns: 300, chips: 440, pnl: WIDTH - PAD - 14 }

function transfersHeight(rows: Transfer[]) {
  return 28 + 24 + Math.max(1, rows.length) * 44
}

export function renderChipImage(input: ChipImageInput, date = new Date()): HTMLCanvasElement {
  const summaryLines = input.rake > 0 ? 4 : 3
  const height =
    PAD + 64 + // タイトル
    ROW_H + // 見出し
    input.players.length * ROW_H + 12 +
    summaryLines * 30 + 44 + // 合計と一致チェック
    transfersHeight(input.settlement) +
    PAD + 24

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH * SCALE
  canvas.height = height * SCALE
  const g = canvas.getContext('2d')!
  g.scale(SCALE, SCALE)
  g.textBaseline = 'middle'
  g.fillStyle = COLORS.bg
  g.fillRect(0, 0, WIDTH, height)

  // タイトル
  let y = PAD
  g.textAlign = 'left'
  g.fillStyle = COLORS.text
  g.font = `bold 26px ${FONT}`
  g.fillText('🃏 チップ計算', PAD, y + 16)
  g.font = `15px ${FONT}`
  g.fillStyle = COLORS.sub
  g.fillText(
    fit(
      g,
      `${dateLabel(date)} ・ 1バイイン(100BB) = ${input.chipsPer100BB.toLocaleString()}チップ = ¥${input.buyInYen.toLocaleString()}`,
      WIDTH - PAD * 2,
    ),
    PAD,
    y + 46,
  )
  y += 64

  // 見出し
  const tableW = WIDTH - PAD * 2
  g.fillStyle = COLORS.panel
  g.fillRect(PAD, y, tableW, ROW_H)
  g.font = `bold 14px ${FONT}`
  g.fillStyle = COLORS.sub
  g.textAlign = 'left'
  g.fillText('名前', COLS.name, y + ROW_H / 2)
  g.textAlign = 'right'
  g.fillText('バイイン', COLS.buyIns, y + ROW_H / 2)
  g.fillText('最終チップ', COLS.chips, y + ROW_H / 2)
  g.fillText('収支', COLS.pnl, y + ROW_H / 2)
  y += ROW_H

  // プレイヤー（勝った人は緑、負けた人は赤の帯）
  input.players.forEach(p => {
    if (p.pnl !== 0) {
      g.fillStyle = p.pnl > 0 ? COLORS.overRow : COLORS.underRow
      g.fillRect(PAD, y, tableW, ROW_H)
    }
    g.textAlign = 'left'
    g.font = `bold 17px ${FONT}`
    g.fillStyle = COLORS.text
    g.fillText(fit(g, p.name, COLS.buyIns - COLS.name - 80), COLS.name, y + ROW_H / 2)
    g.textAlign = 'right'
    g.font = `16px ${FONT}`
    g.fillText(`${p.buyIns}回`, COLS.buyIns, y + ROW_H / 2)
    g.fillText(p.finalChips.toLocaleString(), COLS.chips, y + ROW_H / 2)
    g.font = `bold 18px ${FONT}`
    g.fillStyle = color(p.pnl)
    g.fillText(`${signed(p.pnl)}円`, COLS.pnl, y + ROW_H / 2)
    g.strokeStyle = COLORS.line
    g.beginPath()
    g.moveTo(PAD, y + ROW_H)
    g.lineTo(PAD + tableW, y + ROW_H)
    g.stroke()
    y += ROW_H
  })
  y += 12

  // 合計
  const line = (label: string, value: string) => {
    g.textAlign = 'left'
    g.font = `15px ${FONT}`
    g.fillStyle = COLORS.sub
    g.fillText(label, PAD + 14, y + 15)
    g.textAlign = 'right'
    g.fillStyle = COLORS.text
    g.fillText(value, WIDTH - PAD - 14, y + 15)
    y += 30
  }
  line('バイインの合計', `${input.totalBuyInChips.toLocaleString()} チップ`)
  line('最終チップの合計', `${input.totalFinalChips.toLocaleString()} チップ`)
  if (input.rake > 0) line('レーキ', `${input.rake.toLocaleString()} チップ`)
  line('参加費の合計', `¥${(input.players.reduce((s, p) => s + p.buyIns, 0) * input.buyInYen).toLocaleString()}`)
  const ok = input.chipDiff === 0
  g.fillStyle = ok ? 'rgba(46,204,113,0.15)' : 'rgba(231,76,60,0.2)'
  g.beginPath()
  g.roundRect(PAD, y + 4, tableW, 32, 8)
  g.fill()
  g.textAlign = 'center'
  g.font = `bold 15px ${FONT}`
  g.fillStyle = ok ? COLORS.green : COLORS.red
  g.fillText(ok ? '✓ チップは合っています' : `⚠ チップが ${signed(input.chipDiff)} ずれています`, WIDTH / 2, y + 20)
  y += 44

  // 精算
  const transfers = (title: string, note: string, rows: Transfer[]) => {
    y += 28
    g.textAlign = 'left'
    g.font = `bold 20px ${FONT}`
    g.fillStyle = COLORS.text
    g.fillText(title, PAD, y)
    const titleW = g.measureText(title).width
    g.font = `13px ${FONT}`
    g.fillStyle = COLORS.sub
    g.fillText(fit(g, note, tableW - titleW - 12), PAD + titleW + 12, y + 1)
    y += 24
    if (rows.length === 0) {
      g.font = `16px ${FONT}`
      g.fillStyle = COLORS.sub
      g.fillText('やりとりなし', PAD + 14, y + 20)
      y += 44
      return
    }
    rows.forEach(t => {
      g.fillStyle = COLORS.panel
      g.beginPath()
      g.roundRect(PAD, y, tableW, 38, 8)
      g.fill()
      g.textAlign = 'left'
      g.font = `bold 17px ${FONT}`
      g.fillStyle = COLORS.red
      const from = fit(g, t.from, tableW * 0.32)
      g.fillText(from, PAD + 14, y + 19)
      const fromW = g.measureText(from).width
      g.fillStyle = COLORS.sub
      g.fillText('→', PAD + 22 + fromW, y + 19)
      g.fillStyle = COLORS.green
      g.fillText(fit(g, t.to, tableW * 0.32), PAD + 50 + fromW, y + 19)
      g.textAlign = 'right'
      g.fillStyle = COLORS.text
      g.fillText(`¥${t.amount.toLocaleString()}`, PAD + tableW - 14, y + 19)
      y += 44
    })
  }
  transfers('精算', '送金の回数がいちばん少なくなる組み合わせ', input.settlement)

  g.textAlign = 'right'
  g.font = `12px ${FONT}`
  g.fillStyle = 'rgba(255,255,255,0.3)'
  g.fillText('Flipout チップ計算', WIDTH - PAD, height - PAD / 2 - 4)
  return canvas
}
