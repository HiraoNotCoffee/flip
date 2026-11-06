/*
 * 結果を1枚の画像（PNG）にするときの共通部品（麻雀点数表・チップ計算）。
 * 画像ファイルやライブラリは使わず canvas に描く。
 */

export const FONT = '-apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", sans-serif'
export const COLORS = {
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

export function signed(n: number) {
  return `${n > 0 ? '+' : ''}${n.toLocaleString()}`
}

export function color(n: number) {
  return n > 0 ? COLORS.green : n < 0 ? COLORS.red : COLORS.text
}

/** はみ出す文字は末尾を「…」にして収める */
export function fit(g: CanvasRenderingContext2D, text: string, width: number) {
  if (g.measureText(text).width <= width) return text
  let t = text
  while (t.length > 1 && g.measureText(`${t}…`).width > width) t = t.slice(0, -1)
  return `${t}…`
}

export function dateLabel(date: Date) {
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

/** ファイル名用の日付（20261107） */
export function dateStamp(date = new Date()) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
}

/**
 * 画像を保存する。スマホで共有メニューが使えるならそれを開く（LINE などにそのまま送れる）。
 * 使えなければダウンロードする。
 */
export async function saveCanvasImage(
  canvas: HTMLCanvasElement,
  filename: string,
  title: string,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('画像を作れませんでした')
  const file = new File([blob], filename, { type: 'image/png' })
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean }
  if (nav.canShare?.({ files: [file] }) && 'ontouchstart' in window) {
    try {
      await navigator.share({ files: [file], title })
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
