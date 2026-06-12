// 8デッキ・ディーラーS17（ソフト17でスタンド）・DAS（スプリット後ダブル可）・サレンダーなし基本戦略
// アクション記号:
//   H  = Hit
//   S  = Stand
//   D  = Double（不可ならHit）
//   Ds = Double（不可ならStand）
//   P  = Split
//   Ph = Split可（DASあり）／不可ならHit
// セルは ディーラーアップ A,2,3,4,5,6,7,8,9,10 の順（index 0=A, 1=2, ..., 9=10）

export type Action = 'H' | 'S' | 'D' | 'Ds' | 'P' | 'Ph'

// Hard totals 5〜20（インデックス 0=5, 1=6, ..., 15=20）
// 列順: A, 2, 3, 4, 5, 6, 7, 8, 9, 10
export const HARD_STRATEGY: Action[][] = [
  /*  5 */ ['H','H','H','H','H','H','H','H','H','H'],
  /*  6 */ ['H','H','H','H','H','H','H','H','H','H'],
  /*  7 */ ['H','H','H','H','H','H','H','H','H','H'],
  /*  8 */ ['H','H','H','H','H','H','H','H','H','H'],
  /*  9 */ ['H','H','D','D','D','D','H','H','H','H'],
  /* 10 */ ['H','D','D','D','D','D','D','D','D','H'],
  /* 11 */ ['H','D','D','D','D','D','D','D','D','D'],
  /* 12 */ ['H','H','H','S','S','S','H','H','H','H'],
  /* 13 */ ['H','S','S','S','S','S','H','H','H','H'],
  /* 14 */ ['H','S','S','S','S','S','H','H','H','H'],
  /* 15 */ ['H','S','S','S','S','S','H','H','H','H'],
  /* 16 */ ['H','S','S','S','S','S','H','H','H','H'],
  /* 17 */ ['S','S','S','S','S','S','S','S','S','S'],
  /* 18 */ ['S','S','S','S','S','S','S','S','S','S'],
  /* 19 */ ['S','S','S','S','S','S','S','S','S','S'],
  /* 20 */ ['S','S','S','S','S','S','S','S','S','S'],
]

// Soft totals A,2(13) 〜 A,9(20)（インデックス 0=A2/13, ..., 7=A9/20）
// 列順: A, 2, 3, 4, 5, 6, 7, 8, 9, 10
export const SOFT_STRATEGY: Action[][] = [
  /* A,2 = 13 */ ['H','H','H','H','D','D','H','H','H','H'],
  /* A,3 = 14 */ ['H','H','H','H','D','D','H','H','H','H'],
  /* A,4 = 15 */ ['H','H','H','D','D','D','H','H','H','H'],
  /* A,5 = 16 */ ['H','H','H','D','D','D','H','H','H','H'],
  /* A,6 = 17 */ ['H','H','D','D','D','D','H','H','H','H'],
  /* A,7 = 18 */ ['H','S','Ds','Ds','Ds','Ds','S','S','H','H'],
  /* A,8 = 19 */ ['S','S','S','S','S','S','S','S','S','S'],
  /* A,9 = 20 */ ['S','S','S','S','S','S','S','S','S','S'],
]

// ペア A,A / 2,2 / 3,3 / 4,4 / 5,5 / 6,6 / 7,7 / 8,8 / 9,9 / 10,10
// 列順: A, 2, 3, 4, 5, 6, 7, 8, 9, 10
export const PAIR_STRATEGY: Action[][] = [
  /* A,A  */ ['P','P','P','P','P','P','P','P','P','P'],
  /* 2,2  */ ['H','Ph','Ph','P','P','P','P','H','H','H'],
  /* 3,3  */ ['H','Ph','Ph','P','P','P','P','H','H','H'],
  /* 4,4  */ ['H','H','H','H','Ph','Ph','H','H','H','H'],
  /* 5,5  */ ['H','D','D','D','D','D','D','D','D','H'],   // 5,5 はダブル相当
  /* 6,6  */ ['H','Ph','P','P','P','P','H','H','H','H'],
  /* 7,7  */ ['H','P','P','P','P','P','P','H','H','H'],
  /* 8,8  */ ['P','P','P','P','P','P','P','P','P','P'],
  /* 9,9  */ ['S','P','P','P','P','P','S','P','P','S'],
  /* 10,10*/ ['S','S','S','S','S','S','S','S','S','S'],
]

// プレイヤー/ディーラーのランク文字（表示用）
export const RANK_LABELS = ['A','2','3','4','5','6','7','8','9','10'] as const
export type RankIndex = 0|1|2|3|4|5|6|7|8|9 // 0=A, 1=2, ..., 9=10

// アクション → 表示色
export const ACTION_COLOR: Record<Action, string> = {
  H:  '#d35454', // 赤: Hit
  S:  '#f1c40f', // 黄: Stand
  D:  '#3498db', // 青: Double
  Ds: '#2980b9', // 濃青: Double/Stand
  P:  '#27ae60', // 緑: Split
  Ph: '#16a085', // 青緑: Split/Hit
}

// アクション → 表示ラベル
export const ACTION_LABEL: Record<Action, string> = {
  H:  'H',
  S:  'S',
  D:  'D',
  Ds: 'Ds',
  P:  'P',
  Ph: 'P*',
}

// アクションの意味（ホバー時の説明用）
export const ACTION_DESC: Record<Action, string> = {
  H:  'Hit',
  S:  'Stand',
  D:  'Double (不可ならHit)',
  Ds: 'Double (不可ならStand)',
  P:  'Split',
  Ph: 'Split (DAS) / 不可ならHit',
}

// ─────────── デビエーション（True Count による偏差）───────────
// Illustrious 18 ＋ Fab 4 を簡略化したテーブル。
// True Count（カウント ÷ 残デッキ数）が threshold 以上のとき action を採用、未満なら基本戦略のまま。
// ref に Hi-Lo の標準閾値を載せているが、ユーザのカスタムカウントでも参考になるよう同値で運用。
// （厳密な再計算は Phase 2 で行う）
export interface Deviation {
  kind: 'hard' | 'soft' | 'pair'
  total: number              // hard total, soft total (13-20), or pair rank value(0=A..9=10)
  dealerIdx: RankIndex       // 0=A, 1=2, ..., 9=10
  threshold: number          // True Count >= threshold で発動
  action: Action             // 発動時のアクション
  note?: string
}

export const DEVIATIONS: Deviation[] = [
  // Insurance は別UIで扱う（TC >= 3 で Insurance buy）
  { kind: 'hard', total: 16, dealerIdx: 9, threshold:  0, action: 'S', note: '16 vs 10' },
  { kind: 'hard', total: 15, dealerIdx: 9, threshold:  4, action: 'S', note: '15 vs 10' },
  { kind: 'pair', total: 9,  dealerIdx: 4, threshold:  5, action: 'P', note: '10,10 vs 5 split' },
  { kind: 'pair', total: 9,  dealerIdx: 5, threshold:  4, action: 'P', note: '10,10 vs 6 split' },
  { kind: 'hard', total: 10, dealerIdx: 9, threshold:  4, action: 'D', note: '10 vs 10' },
  { kind: 'hard', total: 12, dealerIdx: 2, threshold:  2, action: 'S', note: '12 vs 3' },
  { kind: 'hard', total: 12, dealerIdx: 1, threshold:  3, action: 'S', note: '12 vs 2' },
  { kind: 'hard', total: 11, dealerIdx: 0, threshold:  1, action: 'D', note: '11 vs A' },
  { kind: 'hard', total:  9, dealerIdx: 1, threshold:  1, action: 'D', note: '9 vs 2' },
  { kind: 'hard', total: 10, dealerIdx: 0, threshold:  4, action: 'D', note: '10 vs A' },
  { kind: 'hard', total:  9, dealerIdx: 6, threshold:  3, action: 'D', note: '9 vs 7' },
  { kind: 'hard', total: 16, dealerIdx: 8, threshold:  5, action: 'S', note: '16 vs 9' },
  { kind: 'hard', total: 13, dealerIdx: 1, threshold: -1, action: 'H', note: '13 vs 2 (low TC)' },
  { kind: 'hard', total: 12, dealerIdx: 3, threshold:  0, action: 'S', note: '12 vs 4' },
  { kind: 'hard', total: 12, dealerIdx: 4, threshold: -2, action: 'H', note: '12 vs 5 (low TC)' },
  { kind: 'hard', total: 12, dealerIdx: 5, threshold: -1, action: 'H', note: '12 vs 6 (low TC)' },
  { kind: 'hard', total: 13, dealerIdx: 2, threshold: -2, action: 'H', note: '13 vs 3 (low TC)' },
  // Fab 4 (surrender): サレンダーありルールでのみ。今回は基本ルール優先で省略。
]

// プレイヤーハンドとディーラーアップから基本戦略アクションを取得
export function basicAction(
  kind: 'hard' | 'soft' | 'pair',
  total: number,
  dealerIdx: RankIndex,
): Action {
  if (kind === 'hard') {
    const idx = Math.min(Math.max(total - 5, 0), HARD_STRATEGY.length - 1)
    return HARD_STRATEGY[idx][dealerIdx]
  } else if (kind === 'soft') {
    // total: 13(A,2) 〜 20(A,9)
    const idx = Math.min(Math.max(total - 13, 0), SOFT_STRATEGY.length - 1)
    return SOFT_STRATEGY[idx][dealerIdx]
  } else {
    // pair: total は ランク値 0(A)〜9(10)
    return PAIR_STRATEGY[total][dealerIdx]
  }
}

// True Count を考慮したアクション（デビエーション発動時はそちらを返す）
export function actionWithDeviation(
  kind: 'hard' | 'soft' | 'pair',
  total: number,
  dealerIdx: RankIndex,
  trueCount: number,
): { action: Action; deviated: boolean; basic: Action } {
  const basic = basicAction(kind, total, dealerIdx)
  // 該当デビエーション検索（同条件複数あれば、threshold が現TCに近いもの優先：単純化のため最初に一致したもの）
  const dev = DEVIATIONS.find(d => {
    if (d.kind !== kind) return false
    if (d.dealerIdx !== dealerIdx) return false
    if (d.total !== total) return false
    // threshold 正の側: TC >= threshold で action 発動
    // threshold 負の側: TC <= threshold で action 発動
    if (d.threshold >= 0) return trueCount >= d.threshold
    return trueCount <= d.threshold
  })
  if (dev) return { action: dev.action, deviated: dev.action !== basic, basic }
  return { action: basic, deviated: false, basic }
}
