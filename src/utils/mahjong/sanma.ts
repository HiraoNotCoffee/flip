/**
 * 3人打ちの点数表（符計算なし・翻だけで決まる。ツモ損なし）。
 * ツモは [子の支払い, 親の支払い]（親のツモは2人とも同じ額）。
 */
export interface SanmaRow {
  label: string
  dealer: { ron: number; tsumo: number }
  child: { ron: number; tsumo: [number, number] }
}

export const SANMA_TABLE: SanmaRow[] = [
  { label: '1翻', dealer: { ron: 2000, tsumo: 1000 }, child: { ron: 1000, tsumo: [1000, 1000] } },
  { label: '2翻', dealer: { ron: 3000, tsumo: 2000 }, child: { ron: 2000, tsumo: [1000, 1000] } },
  { label: '3翻', dealer: { ron: 6000, tsumo: 3000 }, child: { ron: 4000, tsumo: [1000, 3000] } },
  { label: '満貫', dealer: { ron: 12000, tsumo: 6000 }, child: { ron: 8000, tsumo: [3000, 5000] } },
  { label: '跳満', dealer: { ron: 18000, tsumo: 9000 }, child: { ron: 12000, tsumo: [4000, 8000] } },
  { label: '倍満', dealer: { ron: 24000, tsumo: 12000 }, child: { ron: 16000, tsumo: [6000, 10000] } },
  { label: '三倍満', dealer: { ron: 36000, tsumo: 18000 }, child: { ron: 24000, tsumo: [8000, 16000] } },
  { label: '役満', dealer: { ron: 48000, tsumo: 24000 }, child: { ron: 32000, tsumo: [12000, 20000] } },
]
