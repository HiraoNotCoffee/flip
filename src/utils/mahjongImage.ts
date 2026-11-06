/*
 * 麻雀点数表を1枚の画像（PNG）にする。LINE や Discord にそのまま貼れるように。
 * 画像ファイルやライブラリは使わず canvas に描く。
 */

import { rowStatus, type Cell } from './mahjongSheet'
import type { Transfer } from './settlement'

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
  rateLabel: string
  transfers: Transfer[]
  settleLabel: string
  /** 合計が合っていないときの注意（無ければ null） */
  warning: string | null
}

const FONT = '-apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", sans-serif'
const COLORS = {
  bg: '#14141f',
  panel: '#1d1d2b',
  line: 'rgba(255,255,255,0.10)',
  text: '#f2f2f2',
  sub: '#9a9aaa',
  green: '#2ecc71',
  red: '#ff6b5e',
  overRow: 'rgba(46,204,113,0.22)',
  underRow: 'rgba(231,76,60,0.25)',
  accent: '#5865f2',
}

const PAD = 28
const NO_COL = 52
const COL = 104
const ROW_H = 40
const SCALE = 2

function signed(n: number) {
  return `${n > 0 ? '+' : ''}${n.toLocaleString()}`
}

function color(n: number) {
  return n > 0 ? COLORS.green : n < 0 ? COLORS.red : COLORS.text
}

/** はみ出す文字は末尾を「…」にして収める */
function fit(g: CanvasRenderingContext2D, text: string, width: number) {
  if (g.measureText(text).width <= width) return text
  let t = text
  while (t.length > 1 && g.measureText(`${t}…`).width > width) t = t.slice(0, -1)
  return `${t}…`
}

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
  if (input.chipYens || input.venue) footRows.push({ label: '収支', values: input.finals, strong: true })

  const settleLines = Math.max(1, input.transfers.length)
  const height =
    PAD + 64 + // タイトル
    ROW_H + // 名前
    rows.length * ROW_H +
    footRows.length * ROW_H + 12 +
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
  const d = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
  g.fillText(`${d} ・ ${input.rateLabel}`, PAD, y + 46)
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

  // 精算
  y += 28
  g.textAlign = 'left'
  g.font = `bold 20px ${FONT}`
  g.fillStyle = COLORS.text
  g.fillText('精算', PAD, y)
  g.font = `14px ${FONT}`
  g.fillStyle = COLORS.sub
  g.fillText(input.settleLabel, PAD + 52, y + 1)
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

/**
 * 画像を保存する。スマホで共有メニューが使えるならそれを開く（LINE などにそのまま送れる）。
 * 使えなければダウンロードする。
 */
export async function saveCanvasImage(canvas: HTMLCanvasElement, filename: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('画像を作れませんでした')
  const file = new File([blob], filename, { type: 'image/png' })
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean }
  if (nav.canShare?.({ files: [file] }) && 'ontouchstart' in window) {
    try {
      await navigator.share({ files: [file], title: '麻雀収支' })
      return 'shared'
    } catch (e) {
      // 共有メニューを閉じただけ
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}
