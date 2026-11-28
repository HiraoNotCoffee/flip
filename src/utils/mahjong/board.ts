// 麻雀点数管理（3人打ち。卓に置きっぱなしにする点棒の代わり）の計算。
// 席の番号は 0=手前 1=右 2=左（反時計回りに打つ順）。

export const WINDS = ['東', '南', '西', '北'] as const
export const PLAYERS = 3

export interface BoardState {
  names: string[]
  points: number[]
  startPoints: number
  /** 今の親の席 */
  dealer: number
  /** 場風 0=東 1=南 2=西 3=北 */
  roundWind: number
  /** 何局目（1〜3） */
  kyoku: number
  honba: number
  /** 供託のリーチ棒の本数 */
  kyotaku: number
  /** この局のリーチ 0=なし 1=リーチ 2=ダブリー */
  riichi: number[]
}

const fill = <T,>(v: T) => Array.from({ length: PLAYERS }, () => v)

export function newBoard(startPoints = 35000, names: string[] = fill('')): BoardState {
  return {
    names: [...names],
    points: fill(startPoints),
    startPoints,
    dealer: 0,
    roundWind: 0,
    kyoku: 1,
    honba: 0,
    kyotaku: 0,
    riichi: fill(0),
  }
}

/** その席の自風（0=東 1=南 2=西） */
export function seatWind(state: BoardState, seat: number): number {
  return (seat - state.dealer + PLAYERS) % PLAYERS
}

export function roundLabel(state: BoardState): string {
  return `${WINDS[state.roundWind]}${state.kyoku}局`
}

/** 親が続く（連荘）か、次の局に進むか。リーチはどちらでも解く */
function finishHand(state: BoardState, dealerKeeps: boolean, honbaUp: boolean): BoardState {
  const riichi = fill(0)
  if (dealerKeeps) return { ...state, riichi, honba: state.honba + 1 }
  let kyoku = state.kyoku + 1
  let roundWind = state.roundWind
  if (kyoku > PLAYERS) {
    kyoku = 1
    roundWind = (roundWind + 1) % 4
  }
  return {
    ...state,
    riichi,
    dealer: (state.dealer + 1) % PLAYERS,
    kyoku,
    roundWind,
    honba: honbaUp ? state.honba + 1 : 0,
  }
}

/** リーチ → ダブリー → 取り消し、の順に切り替える。棒はどちらも 1000点 */
export function toggleRiichi(state: BoardState, seat: number): BoardState {
  const now = state.riichi[seat]
  const next = (now + 1) % 3
  const delta = now === 0 ? -1000 : next === 0 ? 1000 : 0
  return {
    ...state,
    riichi: state.riichi.map((r, i) => (i === seat ? next : r)),
    points: state.points.map((p, i) => (i === seat ? p + delta : p)),
    kyotaku: Math.max(0, state.kyotaku - delta / 1000),
  }
}

/** ロン。amount は本場を含まない点数（例: 8000）。本場は 1本につき 300 */
export function applyRon(state: BoardState, winner: number, loser: number, amount: number): BoardState {
  const pay = amount + state.honba * 300
  const points = state.points.map((p, i) =>
    i === winner ? p + pay + state.kyotaku * 1000 : i === loser ? p - pay : p,
  )
  return finishHand({ ...state, points, kyotaku: 0 }, winner === state.dealer, false)
}

/**
 * ツモ。本場を含まない払い。本場は払う人ごとに 1本につき 100。
 * 子のツモ: fromChild=もう1人の子の払い, fromDealer=親の払い。親のツモ: fromChild=1人の払い（オール）
 */
export function applyTsumo(
  state: BoardState,
  winner: number,
  fromChild: number,
  fromDealer: number,
): BoardState {
  const dealerWins = winner === state.dealer
  let total = 0
  const points = state.points.map((p, i) => {
    if (i === winner) return p
    const pay = (dealerWins || i !== state.dealer ? fromChild : fromDealer) + state.honba * 100
    total += pay
    return p - pay
  })
  points[winner] += total + state.kyotaku * 1000
  return finishHand({ ...state, points, kyotaku: 0 }, dealerWins, false)
}

/** 流局。ノーテン罰符は全部で 3000点。親がテンパイなら連荘 */
export function applyDraw(state: BoardState, tenpai: boolean[]): BoardState {
  const n = tenpai.filter(Boolean).length
  const points =
    n === 0 || n === PLAYERS
      ? state.points
      : state.points.map((p, i) => (tenpai[i] ? p + 3000 / n : p - 3000 / (PLAYERS - n)))
  return finishHand({ ...state, points }, tenpai[state.dealer], true)
}

/** 点数を手で直す */
export function adjustPoints(state: BoardState, seat: number, delta: number): BoardState {
  return { ...state, points: state.points.map((p, i) => (i === seat ? p + delta : p)) }
}
