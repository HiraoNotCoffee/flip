import { useEffect, useMemo, useState } from 'react'
import { TileView } from './mahjong/MahjongTile'
import { findTenpaiDiscards, findWaits, isComplete, type Wait } from '../utils/mahjong/waits'
import './MahjongWaits.css'

// 麻雀 多面張チェッカー：手牌を入れると待ち牌（何面張か・残り何枚か）を出す。
// 14枚なら、何を切ればテンパイになるかを出す。

const STORAGE_KEY = 'mahjong-waits-hand'
const MAX_TILES = 14
const ROWS: { label: string; kinds: number[] }[] = [
  { label: '萬子', kinds: Array.from({ length: 9 }, (_, i) => i) },
  { label: '筒子', kinds: Array.from({ length: 9 }, (_, i) => 9 + i) },
  { label: '索子', kinds: Array.from({ length: 9 }, (_, i) => 18 + i) },
  { label: '字牌', kinds: Array.from({ length: 7 }, (_, i) => 27 + i) },
]

function loadHand(): number[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    if (Array.isArray(parsed)) {
      return parsed.filter((k): k is number => Number.isInteger(k) && k >= 0 && k < 34).slice(0, MAX_TILES)
    }
  } catch {
    // ignore
  }
  return []
}

function countsOf(hand: number[]): number[] {
  const c = new Array<number>(34).fill(0)
  hand.forEach(k => c[k]++)
  return c
}

function WaitTiles({ waits, size }: { waits: Wait[]; size: number }) {
  return (
    <div className="mjw-wait-tiles">
      {waits.map(w => (
        <div key={w.kind} className={`mjw-wait ${w.remaining === 0 ? 'empty' : ''}`}>
          <TileView tile={{ kind: w.kind }} size={size} />
          <span className="mjw-wait-left">残{w.remaining}</span>
        </div>
      ))}
    </div>
  )
}

export function MahjongWaits() {
  const [hand, setHand] = useState<number[]>(loadHand)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(hand))
    } catch {
      // ignore
    }
  }, [hand])

  const sorted = useMemo(() => [...hand].sort((a, b) => a - b), [hand])
  const counts = useMemo(() => countsOf(hand), [hand])
  const total = hand.length

  const add = (kind: number) => {
    if (total >= MAX_TILES || counts[kind] >= 4) return
    setHand(prev => [...prev, kind])
  }

  /** 並べ替えた順の index の牌を1枚外す */
  const removeAt = (sortedIndex: number) => {
    const kind = sorted[sortedIndex]
    setHand(prev => {
      const i = prev.lastIndexOf(kind)
      return i < 0 ? prev : [...prev.slice(0, i), ...prev.slice(i + 1)]
    })
  }

  const mode = total % 3 === 1 ? 'waits' : total % 3 === 2 ? 'discard' : 'short'
  const waits = mode === 'waits' ? findWaits(counts) : []
  const complete = mode === 'discard' && isComplete(counts)
  const discards = mode === 'discard' ? findTenpaiDiscards(counts) : []
  const remainingTotal = waits.reduce((s, w) => s + w.remaining, 0)

  return (
    <div className="mjw">
      <div className="mjw-hand-block">
        <div className="mjw-hand-header">
          <span className="mjw-count">{total}枚</span>
          <span className="mjw-hint">牌をタップで外す ・ 鳴いていれば手の内だけ（10・7・4・1枚）</span>
          <button className="mjw-clear" onClick={() => setHand([])} disabled={total === 0}>
            クリア
          </button>
        </div>
        {/* 卓の上に14枚分の枠を1列に並べる（空いている枠は点線） */}
        <div className="mjw-rack">
          {Array.from({ length: MAX_TILES }, (_, i) =>
            i < sorted.length ? (
              <div key={i} className="mjw-rack-slot">
                <TileView tile={{ kind: sorted[i] }} size={40} onClick={() => removeAt(i)} />
              </div>
            ) : (
              <div key={i} className="mjw-rack-slot empty" />
            ),
          )}
        </div>
        {sorted.length === 0 && <p className="mjw-empty">下の牌をタップして手牌を入れてください</p>}
      </div>

      <div className="mjw-pad">
        {ROWS.map(row => (
          <div key={row.label} className="mjw-pad-row">
            {row.kinds.map(kind => (
              <TileView
                key={kind}
                tile={{ kind }}
                size={36}
                onClick={() => add(kind)}
                disabled={total >= MAX_TILES || counts[kind] >= 4}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="mjw-result">
        {mode === 'short' && total > 0 && (
          <p className="mjw-note">あと1枚入れると待ちを判定できます（13枚・10枚など）。</p>
        )}
        {mode === 'waits' &&
          (waits.length === 0 ? (
            <div className="mjw-noten">ノーテン（待ちがありません）</div>
          ) : (
            <>
              <div className="mjw-headline">
                <strong>{waits.length}面張</strong>
                <span>残り {remainingTotal}枚</span>
              </div>
              <WaitTiles waits={waits} size={40} />
              {waits.some(w => w.remaining === 0) && (
                <p className="mjw-note">残0 の牌は、自分の手で4枚使っているか、もう見えていない牌です。</p>
              )}
            </>
          ))}
        {mode === 'discard' && (
          <>
            {complete && <div className="mjw-complete">🀄 あがりの形です</div>}
            {discards.length === 0 ? (
              !complete && <div className="mjw-noten">何を切ってもテンパイになりません</div>
            ) : (
              <>
                <div className="mjw-subhead">切るとテンパイになる牌（残り枚数の多い順）</div>
                <ul className="mjw-discards">
                  {discards.map(d => (
                    <li key={d.discard}>
                      <div className="mjw-discard-tile">
                        <TileView tile={{ kind: d.discard }} size={34} />
                        <span>切り</span>
                      </div>
                      <div className="mjw-discard-body">
                        <div className="mjw-discard-head">
                          {d.waits.length}面張 ・ 残り {d.totalRemaining}枚
                        </div>
                        <WaitTiles waits={d.waits} size={26} />
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>

    </div>
  )
}
