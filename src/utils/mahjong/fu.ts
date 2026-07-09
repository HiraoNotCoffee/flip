// 麻雀 符計算（純粋関数）
import { isTerminalOrHonor } from './tiles'
import type { WinContext, YakuResult } from './yaku'

function ceilTo10(n: number): number {
  return Math.ceil(n / 10) * 10
}

export function calcFu(ctx: WinContext, yakuList: YakuResult[]): number {
  if (ctx.interpretation.kind === 'kokushi') return 0
  if (ctx.interpretation.kind === 'chiitoi') return 25

  const form = ctx.interpretation.standard!
  let fu = 20

  const isMenzenRon = ctx.isMenzen && ctx.winType === 'ron'
  if (isMenzenRon) fu += 10

  const hasPinfu = yakuList.some((y) => y.name === '平和')
  if (ctx.winType === 'tsumo' && !hasPinfu) fu += 2

  // 雀頭符
  const pairKind = form.pair[0].kind
  if (pairKind >= 31 && pairKind <= 33) fu += 2 // 三元牌
  if (pairKind === ctx.roundWind) fu += 2 // 場風（連風なら両方加算され+4）
  if (pairKind === ctx.seatWind) fu += 2 // 自風

  // 面子符
  for (const m of form.mentsu) {
    if (m.type === 'shuntsu') continue
    const isTH = isTerminalOrHonor(m.tiles[0].kind)
    if (m.type === 'kotsu') {
      const isAnkou = !m.open && !m.winningRon
      fu += isAnkou ? (isTH ? 8 : 4) : isTH ? 4 : 2
    } else {
      // kantsu
      const isAnkan = !m.open
      fu += isAnkan ? (isTH ? 32 : 16) : isTH ? 16 : 8
    }
  }

  // 待ち符
  if (form.wait === 'kanchan' || form.wait === 'penchan' || form.wait === 'tanki') fu += 2

  fu = ceilTo10(fu)

  // 喰い平和形補正: 切上後20符かつ門前ツモでない場合は30符固定
  if (fu === 20 && !(ctx.isMenzen && ctx.winType === 'tsumo')) fu = 30

  return fu
}
