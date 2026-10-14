/** ちんちろの役。強い順。 */
export type ChinchiroHand =
  | { kind: 'pinzoro' }
  | { kind: 'zorome'; value: number }
  | { kind: 'shigoro' }
  | { kind: 'me'; value: number }
  | { kind: 'menashi' }
  | { kind: 'hifumi' }
  | { kind: 'shonben' }

/** 目なしのときに振り直せる回数（1投目を含む） */
export const MAX_THROWS = 3

/**
 * 3つの出目から役を出す。
 * out はお椀の外に出たさいころがあるかどうか（あればションベン）。
 */
export function judgeChinchiro(dice: number[], out = false): ChinchiroHand {
  if (out) return { kind: 'shonben' }
  const [a, b, c] = [...dice].sort((x, y) => x - y)
  if (a === b && b === c) return a === 1 ? { kind: 'pinzoro' } : { kind: 'zorome', value: a }
  if (a === 4 && b === 5 && c === 6) return { kind: 'shigoro' }
  if (a === 1 && b === 2 && c === 3) return { kind: 'hifumi' }
  if (a === b) return { kind: 'me', value: c }
  if (b === c) return { kind: 'me', value: a }
  return { kind: 'menashi' }
}

/** この役で手番が終わるか（目なしだけは振り直せる） */
export function isFinalHand(hand: ChinchiroHand, throwCount: number): boolean {
  return hand.kind !== 'menashi' || throwCount >= MAX_THROWS
}

export function handLabel(hand: ChinchiroHand): string {
  switch (hand.kind) {
    case 'pinzoro': return 'ピンゾロ'
    case 'zorome': return `${hand.value}のゾロ目`
    case 'shigoro': return 'シゴロ'
    case 'me': return `${hand.value}の目`
    case 'menashi': return '目なし'
    case 'hifumi': return 'ヒフミ'
    case 'shonben': return 'ションベン'
  }
}
