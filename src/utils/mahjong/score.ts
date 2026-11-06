// 麻雀 点数計算（純粋関数）

export type LimitName = 'mangan' | 'haneman' | 'baiman' | 'sanbaiman' | 'yakuman' | null

export function ceil100(n: number): number {
  return Math.ceil(n / 100) * 100
}

export function calcBasePoints(
  han: number,
  fu: number,
  yakumanCount: number
): { base: number; limit: LimitName } {
  if (yakumanCount > 0) return { base: 8000 * yakumanCount, limit: 'yakuman' }
  if (han >= 13) return { base: 8000, limit: 'yakuman' } // 数え役満
  if (han >= 11) return { base: 6000, limit: 'sanbaiman' }
  if (han >= 8) return { base: 4000, limit: 'baiman' }
  if (han >= 6) return { base: 3000, limit: 'haneman' }

  const base = fu * Math.pow(2, 2 + han)
  if (base > 2000) return { base: 2000, limit: 'mangan' }
  return { base, limit: null }
}

export interface PointsBreakdown {
  total: number // 和了者が受け取る合計点（本場・供託込み）
  ronFrom?: number // ロン: 放銃者の支払額（本場込み）
  tsumoFromDealer?: number // ツモ（和了者が子）: 親の支払額
  tsumoFromNonDealer?: number // ツモ（和了者が子）: 子（他家）1人あたりの支払額
  tsumoFromEach?: number // ツモ（和了者が親）: 3人それぞれの支払額
}

export function calcPayments(
  base: number,
  isDealer: boolean,
  winType: 'ron' | 'tsumo',
  honba: number,
  kyotaku: number
): PointsBreakdown {
  const kyotakuBonus = kyotaku * 1000

  if (winType === 'ron') {
    const raw = base * (isDealer ? 6 : 4)
    const ronFrom = ceil100(raw) + honba * 300
    return { total: ronFrom + kyotakuBonus, ronFrom }
  }

  if (isDealer) {
    const each = ceil100(base * 2) + honba * 100
    return { total: each * 3 + kyotakuBonus, tsumoFromEach: each }
  }

  const tsumoFromDealer = ceil100(base * 2) + honba * 100
  const tsumoFromNonDealer = ceil100(base * 1) + honba * 100
  return {
    total: tsumoFromDealer + tsumoFromNonDealer * 2 + kyotakuBonus,
    tsumoFromDealer,
    tsumoFromNonDealer,
  }
}

/**
 * 三人麻雀・ツモ損なしのツモの支払い。
 * 4人なら北家が払う分を、残りの2人で折半して上乗せする（100点未満は切り上げ）。
 * 子のツモ: 子 1.5倍・親 2.5倍（基本点に対して）、親のツモ: 2人がそれぞれ 3倍。
 */
export function calcSanmaTsumo(
  base: number,
  isDealer: boolean
): { fromNonDealer?: number; fromDealer?: number; fromEach?: number; total: number } {
  if (isDealer) {
    const each = ceil100(base * 3)
    return { fromEach: each, total: each * 2 }
  }
  const fromNonDealer = ceil100(base * 1.5)
  const fromDealer = ceil100(base * 2.5)
  return { fromNonDealer, fromDealer, total: fromNonDealer + fromDealer }
}
