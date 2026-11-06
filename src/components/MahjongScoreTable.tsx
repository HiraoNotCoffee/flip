import { useEffect, useState } from 'react'
import { calcBasePoints, calcPayments } from '../utils/mahjong/score'
import './MahjongScoreTable.css'

// 麻雀 点数表（符と翻から点数を引く早見表）。計算は点数計算と同じ関数を使う。

const STORAGE_KEY = 'mahjong-score-table'
const FU_LIST = [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110]
const HAN_LIST = [1, 2, 3, 4]
const LIMITS: { label: string; han: string; hanValue: number }[] = [
  { label: '満貫', han: '5翻', hanValue: 5 },
  { label: '跳満', han: '6〜7翻', hanValue: 6 },
  { label: '倍満', han: '8〜10翻', hanValue: 8 },
  { label: '三倍満', han: '11〜12翻', hanValue: 11 },
  { label: '役満', han: '13翻〜', hanValue: 13 },
]

interface Settings {
  dealer: boolean
  /** 三人麻雀（下の固定の点数表） */
  sanma: boolean
  /** 切り上げ満貫（30符4翻・60符3翻を満貫にする） */
  kiriage: boolean
}

function loadSettings(): Settings {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>
    return { dealer: parsed.dealer === true, sanma: parsed.sanma === true, kiriage: parsed.kiriage === true }
  } catch {
    return { dealer: false, sanma: false, kiriage: false }
  }
}

interface Cell {
  ron: string
  tsumo: string
  mangan: boolean
}

/**
 * 3人打ちの点数表（符計算なし・翻だけで決まる。ツモ損なし）。
 * ツモは [子の支払い, 親の支払い]（親のツモは2人とも同じ額）。
 */
const SANMA_TABLE: { label: string; dealer: { ron: number; tsumo: number }; child: { ron: number; tsumo: [number, number] } }[] = [
  { label: '1翻', dealer: { ron: 2000, tsumo: 1000 }, child: { ron: 1000, tsumo: [1000, 1000] } },
  { label: '2翻', dealer: { ron: 3000, tsumo: 2000 }, child: { ron: 2000, tsumo: [1000, 1000] } },
  { label: '3翻', dealer: { ron: 6000, tsumo: 3000 }, child: { ron: 4000, tsumo: [1000, 3000] } },
  { label: '満貫', dealer: { ron: 12000, tsumo: 6000 }, child: { ron: 8000, tsumo: [3000, 5000] } },
  { label: '跳満', dealer: { ron: 18000, tsumo: 9000 }, child: { ron: 12000, tsumo: [4000, 8000] } },
  { label: '倍満', dealer: { ron: 24000, tsumo: 12000 }, child: { ron: 16000, tsumo: [6000, 10000] } },
  { label: '三倍満', dealer: { ron: 36000, tsumo: 18000 }, child: { ron: 24000, tsumo: [8000, 16000] } },
  { label: '役満', dealer: { ron: 48000, tsumo: 24000 }, child: { ron: 32000, tsumo: [12000, 20000] } },
]

function SanmaTable() {
  return (
    <>
      <p className="mjt-legend">上：ロン ／ 下：ツモ（子は「子の支払い/親の支払い」）</p>
      <table className="mjt-table mjt-sanma">
        <thead>
          <tr>
            <th className="mjt-sanma-dealer">親</th>
            <th className="mjt-sanma-han" />
            <th className="mjt-sanma-child">子</th>
          </tr>
        </thead>
        <tbody>
          {SANMA_TABLE.map(row => {
            const [fromChild, fromDealer] = row.child.tsumo
            return (
              <tr key={row.label}>
                <td>
                  <span className="mjt-ron">{row.dealer.ron.toLocaleString()}</span>
                  <span className="mjt-tsumo">{row.dealer.tsumo.toLocaleString()}オール</span>
                </td>
                <th className="mjt-sanma-han">{row.label}</th>
                <td>
                  <span className="mjt-ron">{row.child.ron.toLocaleString()}</span>
                  <span className="mjt-tsumo">
                    {fromChild === fromDealer
                      ? `${fromChild.toLocaleString()}オール`
                      : `${fromChild.toLocaleString()}/${fromDealer.toLocaleString()}`}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mjt-note">3人打ちは符計算なし・翻だけで決まる点数です（ツモ損なし）。</p>
    </>
  )
}

/** ツモの表記。子は「子の支払い/親の支払い」、親は「○オール」 */
function tsumoLabel(base: number, dealer: boolean): string {
  const t = calcPayments(base, dealer, 'tsumo', 0, 0)
  return dealer
    ? `${t.tsumoFromEach!.toLocaleString()}オール`
    : `${t.tsumoFromNonDealer!.toLocaleString()}/${t.tsumoFromDealer!.toLocaleString()}`
}

/** 符・翻の点数。存在しない組み合わせ（20符ロン、20符・25符の1翻）は '—' */
function cellFor(fu: number, han: number, dealer: boolean, kiriage: boolean): Cell | null {
  if ((fu === 20 || fu === 25) && han === 1) return null
  let { base } = calcBasePoints(han, fu, 0)
  if (kiriage && base >= 1920) base = 2000
  const mangan = base >= 2000
  const ron = fu === 20 ? '—' : calcPayments(base, dealer, 'ron', 0, 0).ronFrom!.toLocaleString()
  // 25符（七対子）の2翻ツモは、ルールにより無いこともあるがよく使われるので出す
  return { ron, tsumo: tsumoLabel(base, dealer), mangan }
}

export function MahjongScoreTable() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const { dealer, kiriage, sanma } = settings

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // ignore
    }
  }, [settings])

  return (
    <div className="mjt">
      <div className="mjt-tabs mjt-players">
        <button className={!sanma ? 'active' : ''} onClick={() => setSettings(s => ({ ...s, sanma: false }))}>
          4人
        </button>
        <button className={sanma ? 'active' : ''} onClick={() => setSettings(s => ({ ...s, sanma: true }))}>
          3人
        </button>
      </div>
      {sanma ? (
        <SanmaTable />
      ) : (
        <>
          <div className="mjt-tabs">
            <button className={!dealer ? 'active' : ''} onClick={() => setSettings(s => ({ ...s, dealer: false }))}>
              子
            </button>
            <button className={dealer ? 'active' : ''} onClick={() => setSettings(s => ({ ...s, dealer: true }))}>
              親
            </button>
          </div>
          <p className="mjt-legend">
            上：ロン ／ 下：ツモ（{dealer ? '3人それぞれが払う' : '子の支払い/親の支払い'}）
          </p>

          <table className="mjt-table">
            <thead>
              <tr>
                <th className="mjt-fu-head">符＼翻</th>
                {HAN_LIST.map(h => (
                  <th key={h}>{h}翻</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FU_LIST.map(fu => (
                <tr key={fu}>
                  <th className="mjt-fu">{fu}符</th>
                  {HAN_LIST.map(han => {
                    const cell = cellFor(fu, han, dealer, kiriage)
                    if (!cell) {
                      return (
                        <td key={han} className="mjt-none">
                          —
                        </td>
                      )
                    }
                    return (
                      <td key={han} className={cell.mangan ? 'mjt-mangan' : ''}>
                        {cell.mangan ? (
                          <span className="mjt-mangan-label">満貫</span>
                        ) : (
                          <>
                            <span className="mjt-ron">{cell.ron}</span>
                            <span className="mjt-tsumo">{cell.tsumo}</span>
                          </>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <table className="mjt-table mjt-limits">
            <thead>
              <tr>
                <th />
                <th>翻</th>
                <th>ロン</th>
                <th>ツモ</th>
              </tr>
            </thead>
            <tbody>
              {LIMITS.map(l => {
                const { base } = calcBasePoints(l.hanValue, 30, 0)
                const ron = calcPayments(base, dealer, 'ron', 0, 0).ronFrom!
                return (
                  <tr key={l.label}>
                    <th className="mjt-limit-name">{l.label}</th>
                    <td className="mjt-limit-han">{l.han}</td>
                    <td className="mjt-limit-ron">{ron.toLocaleString()}</td>
                    <td className="mjt-limit-tsumo">{tsumoLabel(base, dealer)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <label className="mjt-kiriage">
            <input
              type="checkbox"
              checked={kiriage}
              onChange={e => setSettings(s => ({ ...s, kiriage: e.target.checked }))}
            />
            切り上げ満貫（30符4翻・60符3翻を満貫にする）
          </label>
          <p className="mjt-note">
            満貫は {dealer ? '12,000' : '8,000'} 点。1本場ごとにロンは +300、ツモは1人 +100。
            20符はツモのみ（平和ツモ）、25符は七対子です。
          </p>
        </>
      )}
    </div>
  )
}
