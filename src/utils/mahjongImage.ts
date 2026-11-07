/*
 * 麻雀点数表を1枚の画像（PNG）にする。LINE や Discord にそのまま貼れるように。
 */

import { rowStatus, type Cell } from './mahjongSheet'
import type { Transfer } from './settlement'
import { COLORS, FONT, color, dateLabel, fit, signed } from './resultImage'

export interface SheetImageInput {
  names: string[]
  rows: Cell[][]
  /** 各自の合計（pt） */
  totals: number[]
  /** 点数の金額（円） */
  pointYens: number[]
  /** ご祝儀の金額（円）。無ければ null */
  chipYens: number[] | null
  /** 場代（払った額 − 負担）。無ければ null */
  venue: number[] | null
  /** 最終的な収支（円） */
  finals: number[]
  /** 100円単位に四捨五入した精算額（差はトップへ）。丸めていなければ null */
  settleAmounts: number[] | null
  rateLabel: string
  transfers: Transfer[]
  settleLabel: string
  /** 合計が合っていないときの注意（無ければ null） */
  warning: string | null
  /** ご祝儀の内訳（枚数と1枚の金額）。無ければ null */
  chipDetail: { counts: number[]; yenPerChip: number } | null
  /** 個別の注文（お会計に含まれていて、頼んだ人だけが負担する）。無ければ null */
  orderDetail: {
    /** 注文で各自が負担する額 */
    charges: number[]
    items: { label: string; yen: number; mode: 'each' | 'split'; eaters: string }[]
  } | null
  /** 場代の内訳。無ければ null */
  venueDetail: {
    total: number
    /** 各自が払った額 */
    paid: number[]
    /** 各自のいた時間（時間で按分していなければ null） */
    hours: number[] | null
    fullHours: number | null
    /** 各自の負担 */
    shares: number[]
  } | null
}

const PAD = 28
const NO_COL = 52
const COL = 104
const ROW_H = 40
const SCALE = 2




export function renderSheetImage(input: SheetImageInput, date = new Date()): HTMLCanvasElement {
  const cols = input.names.length
  const rows = input.rows.filter(r => rowStatus(r) !== 'empty')
  const tableW = NO_COL + cols * COL
  const width = Math.max(560, PAD * 2 + tableW)
  const left = (width - tableW) / 2

  const footRows: { label: string; values: number[]; strong?: boolean }[] = [
    { label: '合計', values: input.totals },
    { label: '円', values: input.pointYens },
  ]
  if (input.chipYens) footRows.push({ label: '祝儀', values: input.chipYens })
  if (input.venue) footRows.push({ label: '場代', values: input.venue })
  if (input.chipYens || input.venue) {
    footRows.push({ label: '収支', values: input.finals, strong: !input.settleAmounts })
  }
  if (input.settleAmounts) footRows.push({ label: '精算', values: input.settleAmounts, strong: true })

  // 内訳（ご祝儀の枚数、場代を誰がいくら払ったか・いた時間・負担）
  type DetailRow = { label: string; cells: string[]; colors?: string[] }
  const detailRows: DetailRow[] = []
  const detailNotes: string[] = []
  if (input.chipDetail) {
    const { counts, yenPerChip } = input.chipDetail
    detailRows.push({
      label: '祝儀',
      cells: counts.map(n => (n === 0 ? '0枚' : `${signed(n)}枚`)),
      colors: counts.map(color),
    })
    detailNotes.push(`ご祝儀 1枚 ${yenPerChip.toLocaleString()}円`)
  }
  if (input.venueDetail) {
    const v = input.venueDetail
    detailRows.push({ label: '払った', cells: v.paid.map(p => (p === 0 ? '-' : `¥${p.toLocaleString()}`)) })
    if (v.hours) detailRows.push({ label: '時間', cells: v.hours.map(h => `${h}h`) })
    if (input.orderDetail) {
      detailRows.push({
        label: 'うち注文',
        cells: input.orderDetail.charges.map(c => (c === 0 ? '-' : `¥${c.toLocaleString()}`)),
      })
    }
    detailRows.push({ label: '負担', cells: v.shares.map(s => `¥${s.toLocaleString()}`) })
    detailNotes.push(
      `場代 合計 ¥${v.total.toLocaleString()}` +
        (v.hours ? `（${v.fullHours !== null ? `全体${v.fullHours}時間・` : ''}いた時間で按分）` : '（均等割り）'),
    )
  }
  const orderItems = input.orderDetail?.items ?? []
  if (orderItems.length > 0) {
    // 1人1つずつの注文は 金額 × 人数 になるので、各自の負担を足して合計を出す
    const ordersTotal = input.orderDetail!.charges.reduce((sum, c) => sum + c, 0)
    detailNotes.push(`注文 合計 ¥${ordersTotal.toLocaleString()}`)
  }
  const detailH =
    detailRows.length > 0 || orderItems.length > 0
      ? 28 + 26 + (detailRows.length > 0 ? (detailRows.length + 1) * ROW_H : 0) + orderItems.length * 30 + 12
      : 0

  const settleLines = Math.max(1, input.transfers.length)
  const height =
    PAD + 64 + // タイトル
    ROW_H + // 名前
    rows.length * ROW_H +
    footRows.length * ROW_H + 12 +
    detailH +
    28 + 44 + settleLines * 44 + // 精算
    (input.warning ? 40 : 0) +
    PAD + 20

  const canvas = document.createElement('canvas')
  canvas.width = width * SCALE
  canvas.height = height * SCALE
  const g = canvas.getContext('2d')!
  g.scale(SCALE, SCALE)
  g.textBaseline = 'middle'

  g.fillStyle = COLORS.bg
  g.fillRect(0, 0, width, height)

  // タイトル
  let y = PAD
  g.fillStyle = COLORS.text
  g.font = `bold 26px ${FONT}`
  g.textAlign = 'left'
  g.fillText('🀄 麻雀収支', PAD, y + 16)
  g.font = `15px ${FONT}`
  g.fillStyle = COLORS.sub
  g.fillText(`${dateLabel(date)} ・ ${input.rateLabel}`, PAD, y + 46)
  y += 64

  const cellX = (c: number) => left + NO_COL + c * COL

  // 名前
  g.fillStyle = COLORS.panel
  g.fillRect(left, y, tableW, ROW_H)
  g.font = `bold 16px ${FONT}`
  g.fillStyle = COLORS.text
  g.textAlign = 'center'
  input.names.forEach((name, c) => g.fillText(fit(g, name, COL - 10), cellX(c) + COL / 2, y + ROW_H / 2))
  y += ROW_H

  // 半荘ごとの点数（合計が 0 でない行は緑・赤）
  rows.forEach((row, i) => {
    const status = rowStatus(row)
    if (status === 'over' || status === 'under') {
      g.fillStyle = status === 'over' ? COLORS.overRow : COLORS.underRow
      g.fillRect(left, y, tableW, ROW_H)
    } else if (i % 2 === 1) {
      g.fillStyle = 'rgba(255,255,255,0.03)'
      g.fillRect(left, y, tableW, ROW_H)
    }
    g.font = `14px ${FONT}`
    g.fillStyle = COLORS.sub
    g.textAlign = 'center'
    g.fillText(String(i + 1), left + NO_COL / 2, y + ROW_H / 2)
    g.font = `17px ${FONT}`
    g.textAlign = 'right'
    row.forEach((v, c) => {
      if (v === null) return
      g.fillStyle = v < 0 ? COLORS.red : COLORS.text
      g.fillText(signed(v), cellX(c) + COL - 14, y + ROW_H / 2)
    })
    g.strokeStyle = COLORS.line
    g.beginPath()
    g.moveTo(left, y + ROW_H)
    g.lineTo(left + tableW, y + ROW_H)
    g.stroke()
    y += ROW_H
  })

  // 合計・金額・祝儀・場代・収支
  g.strokeStyle = 'rgba(255,255,255,0.35)'
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(left, y)
  g.lineTo(left + tableW, y)
  g.stroke()
  g.lineWidth = 1
  footRows.forEach(({ label, values, strong }) => {
    if (strong) {
      g.fillStyle = 'rgba(255,255,255,0.07)'
      g.fillRect(left, y, tableW, ROW_H)
    }
    g.font = `bold 14px ${FONT}`
    g.fillStyle = COLORS.sub
    g.textAlign = 'center'
    g.fillText(label, left + NO_COL / 2, y + ROW_H / 2)
    g.font = `bold ${strong ? 19 : 17}px ${FONT}`
    g.textAlign = 'right'
    values.forEach((v, c) => {
      g.fillStyle = color(v)
      g.fillText(signed(v), cellX(c) + COL - 14, y + ROW_H / 2)
    })
    y += ROW_H
  })
  y += 12

  if (detailRows.length > 0 || orderItems.length > 0) {
    y += 28
    g.textAlign = 'left'
    g.font = `bold 20px ${FONT}`
    g.fillStyle = COLORS.text
    g.fillText('内訳', PAD, y)
    g.font = `14px ${FONT}`
    g.fillStyle = COLORS.sub
    g.fillText(fit(g, detailNotes.join(' ・ '), width - PAD * 2 - 52), PAD + 52, y + 1)
    y += 26
    if (detailRows.length > 0) {
      // 列は点数表と同じ位置にそろえる
      g.fillStyle = COLORS.panel
      g.fillRect(left, y, tableW, ROW_H)
      g.font = `bold 14px ${FONT}`
      g.fillStyle = COLORS.text
      g.textAlign = 'center'
      input.names.forEach((name, c) => g.fillText(fit(g, name, COL - 10), cellX(c) + COL / 2, y + ROW_H / 2))
      y += ROW_H
      detailRows.forEach(({ label, cells, colors }, i) => {
        if (i % 2 === 1) {
          g.fillStyle = 'rgba(255,255,255,0.03)'
          g.fillRect(left, y, tableW, ROW_H)
        }
        g.font = `bold 13px ${FONT}`
        g.fillStyle = COLORS.sub
        g.textAlign = 'center'
        g.fillText(label, left + NO_COL / 2, y + ROW_H / 2)
        g.font = `16px ${FONT}`
        g.textAlign = 'right'
        cells.forEach((text, c) => {
          g.fillStyle = colors?.[c] ?? COLORS.text
          g.fillText(fit(g, text, COL - 16), cellX(c) + COL - 14, y + ROW_H / 2)
        })
        y += ROW_H
      })
    }
    // 個別の注文（品名・金額・食べた人・払った人）
    orderItems.forEach(item => {
      g.textAlign = 'left'
      g.font = `15px ${FONT}`
      g.fillStyle = COLORS.text
      const head = `${item.label} ¥${item.yen.toLocaleString()}`
      g.fillText(fit(g, head, 200), PAD + 4, y + 15)
      g.fillStyle = COLORS.sub
      g.font = `13px ${FONT}`
      g.fillText(
        fit(g, `${item.eaters}${item.mode === 'each' ? ' が1つずつ' : ' で割る'}`, width - PAD * 2 - 220),
        PAD + 214,
        y + 15,
      )
      y += 30
    })
    y += 12
  }

  // 精算
  y += 28
  g.textAlign = 'left'
  g.font = `bold 20px ${FONT}`
  g.fillStyle = COLORS.text
  g.fillText('精算', PAD, y)
  g.font = `14px ${FONT}`
  g.fillStyle = COLORS.sub
  g.fillText(input.settleAmounts ? `${input.settleLabel} ・ 100円単位（四捨五入）` : input.settleLabel, PAD + 52, y + 1)
  y += 26
  const boxW = width - PAD * 2
  if (input.transfers.length === 0) {
    g.font = `16px ${FONT}`
    g.fillStyle = COLORS.sub
    g.fillText('やりとりなし', PAD + 14, y + 20)
    y += 44
  }
  input.transfers.forEach(t => {
    g.fillStyle = COLORS.panel
    g.beginPath()
    g.roundRect(PAD, y, boxW, 38, 8)
    g.fill()
    g.font = `bold 17px ${FONT}`
    g.textAlign = 'left'
    g.fillStyle = COLORS.red
    const from = fit(g, t.from, boxW * 0.32)
    g.fillText(from, PAD + 14, y + 19)
    const fromW = g.measureText(from).width
    g.fillStyle = COLORS.sub
    g.fillText('→', PAD + 22 + fromW, y + 19)
    g.fillStyle = COLORS.green
    g.fillText(fit(g, t.to, boxW * 0.32), PAD + 50 + fromW, y + 19)
    g.textAlign = 'right'
    g.fillStyle = COLORS.text
    g.fillText(`¥${t.amount.toLocaleString()}`, PAD + boxW - 14, y + 19)
    y += 44
  })

  if (input.warning) {
    g.textAlign = 'left'
    g.font = `14px ${FONT}`
    g.fillStyle = COLORS.red
    g.fillText(fit(g, `⚠ ${input.warning}`, boxW), PAD, y + 16)
    y += 40
  }

  g.textAlign = 'right'
  g.font = `12px ${FONT}`
  g.fillStyle = 'rgba(255,255,255,0.3)'
  g.fillText('Flipout 麻雀収支', width - PAD, height - PAD / 2 - 4)
  return canvas
}
