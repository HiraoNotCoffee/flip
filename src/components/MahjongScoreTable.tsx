import { useEffect, useState } from 'react'
import { calcBasePoints, calcPayments, calcSanmaTsumo } from '../utils/mahjong/score'
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
  /** 三人麻雀（ツモ損なし） */
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

/** ツモの表記。子は「子の支払い/親の支払い」、親は「○オール」。三麻はツモ損なし */
function tsumoLabel(base: number, dealer: boolean, sanma: boolean): string {
  if (sanma) {
    const t = calcSanmaTsumo(base, dealer)
    return dealer
      ? `${t.fromEach!.toLocaleString()}オール`
      : `${t.fromNonDealer!.toLocaleString()}/${t.fromDealer!.toLocaleString()}`
  }
  const t = calcPayments(base, dealer, 'tsumo', 0, 0)
  return dealer
    ? `${t.tsumoFromEach!.toLocaleString()}オール`
    : `${t.tsumoFromNonDealer!.toLocaleString()}/${t.tsumoFromDealer!.toLocaleString()}`
}

/** 符・翻の点数。存在しない組み合わせ（20符ロン、20符・25符の1翻）は '—' */
function cellFor(fu: number, han: number, dealer: boolean, kiriage: boolean, sanma: boolean): Cell | null {
  if ((fu === 20 || fu === 25) && han === 1) return null
  let { base } = calcBasePoints(han, fu, 0)
  if (kiriage && base >= 1920) base = 2000
  const mangan = base >= 2000
  const ron = fu === 20 ? '—' : calcPayments(base, dealer, 'ron', 0, 0).ronFrom!.toLocaleString()
  // 25符（七対子）の2翻ツモは、ルールにより無いこともあるがよく使われるので出す
  return { ron, tsumo: tsumoLabel(base, dealer, sanma), mangan }
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
          3人（ツモ損なし）
        </button>
      </div>
      <div className="mjt-tabs">
        <button className={!dealer ? 'active' : ''} onClick={() => setSettings(s => ({ ...s, dealer: false }))}>
          子
        </button>
        <button className={dealer ? 'active' : ''} onClick={() => setSettings(s => ({ ...s, dealer: true }))}>
          親
        </button>
      </div>
      <p className="mjt-legend">
        上：ロン ／ 下：ツモ（{dealer ? `${sanma ? '2' : '3'}人それぞれが払う` : '子の支払い/親の支払い'}）
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
                const cell = cellFor(fu, han, dealer, kiriage, sanma)
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
                <td className="mjt-limit-tsumo">{tsumoLabel(base, dealer, sanma)}</td>
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
        {sanma && ' 3人のツモは、北家が払うはずの分を残りの2人で折半して払います（ツモ損なし・100点未満切り上げ）。'}
      </p>
    </div>
  )
}
