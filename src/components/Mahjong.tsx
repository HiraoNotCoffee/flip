import { useEffect, useMemo, useState } from 'react'
import {
  calculateScore,
  doraFromIndicator,
  tileDisplayName,
  isHonor,
  numberOf,
  type HandInput,
  type ScoreResult,
  type Tile,
  type Meld,
  type TileKind,
  type LimitName,
} from '../utils/mahjong'
import './Mahjong.css'

// ---- Local UI-only types (domain types always come from ../utils/mahjong) ----
type MeldType = Meld['type']
type WinType = HandInput['winType']
// UI keeps a 3-state riichi selector; converted to riichi/doubleRiichi booleans before scoring.
type RiichiState = 'none' | 'riichi' | 'double'
// Winds are represented as TileKind (東=27,南=28,西=29,北=30).
type Wind = TileKind
type PadTarget = 'hand' | 'dora' | 'ura' | 'meld'

interface PendingMeld {
  type: MeldType
  tiles: Tile[]
}

interface MahjongData {
  handTiles: Tile[]
  winningTileIndex: number | null
  melds: Meld[]
  winType: WinType
  riichi: RiichiState
  ippatsu: boolean
  roundWind: Wind
  seatWind: Wind
  doraIndicators: TileKind[]
  uraDoraIndicators: TileKind[]
  tenho: boolean
  chiho: boolean
  haitei: boolean
  houtei: boolean
  rinshan: boolean
  chankan: boolean
  honba: number
  kyotaku: number
}

const STORAGE_KEY = 'mahjong-calc-data'

const defaultData: MahjongData = {
  handTiles: [],
  winningTileIndex: null,
  melds: [],
  winType: 'ron',
  riichi: 'none',
  ippatsu: false,
  roundWind: 27,
  seatWind: 27,
  doraIndicators: [],
  uraDoraIndicators: [],
  tenho: false,
  chiho: false,
  haitei: false,
  houtei: false,
  rinshan: false,
  chankan: false,
  honba: 0,
  kyotaku: 0,
}

function loadData(): MahjongData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...defaultData, ...(JSON.parse(raw) as Partial<MahjongData>) }
  } catch {
    // ignore
  }
  return { ...defaultData }
}

function saveData(data: MahjongData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

const WIND_LABELS = ['東', '南', '西', '北']
const HONOR_LABELS = ['東', '南', '西', '北', '白', '發', '中']
const MELD_LABELS: Record<MeldType, string> = {
  chi: 'チー',
  pon: 'ポン',
  minkan: '明槓',
  ankan: '暗槓',
}
const ERROR_MESSAGES: Record<string, string> = {
  no_yaku: '役がありません（ドラのみでは上がれません）',
  not_winning_hand: '手牌が完成形になっていません',
  invalid_input: '入力内容が不正です',
}
const LIMIT_LABELS: Record<Exclude<LimitName, null>, string> = {
  mangan: '満貫',
  haneman: '跳満',
  baiman: '倍満',
  sanbaiman: '三倍満',
  yakuman: '役満',
}

function meldTileCount(type: MeldType): number {
  return type === 'chi' || type === 'pon' ? 3 : 4
}

function isFiveKind(kind: TileKind): boolean {
  return kind === 4 || kind === 13 || kind === 22
}

function tileGlyph(kind: TileKind): string {
  if (isHonor(kind)) return HONOR_LABELS[kind - 27] ?? '?'
  return String(numberOf(kind))
}

function tileColorClass(kind: TileKind): string {
  if (isHonor(kind)) {
    if (kind === 32) return 'tile-green'
    if (kind === 33) return 'tile-crimson'
    return 'tile-honor'
  }
  if (kind <= 8) return 'tile-man'
  if (kind <= 17) return 'tile-pin'
  return 'tile-sou'
}

function errorMessage(code?: string): string {
  if (!code) return 'エラーが発生しました'
  return ERROR_MESSAGES[code] ?? code
}

// ---- TileView: small CSS-drawn tile (no emoji) ----
function TileView({
  tile,
  size = 40,
  onClick,
  highlighted = false,
  disabled = false,
}: {
  tile: Tile
  size?: number
  onClick?: () => void
  highlighted?: boolean
  disabled?: boolean
}) {
  const clickable = !!onClick && !disabled
  const classNames = [
    'mj-tile',
    tileColorClass(tile.kind),
    tile.red ? 'mj-tile-red' : '',
    highlighted ? 'mj-tile-highlighted' : '',
    disabled ? 'mj-tile-disabled' : '',
    clickable ? 'mj-tile-clickable' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={classNames}
      style={{ width: size, height: Math.round(size * 1.4) }}
      onClick={clickable ? onClick : undefined}
      title={tileDisplayName(tile)}
    >
      {tileGlyph(tile.kind)}
    </div>
  )
}

function HandTileSlot({
  tile,
  isWinning,
  onDelete,
  onMarkWinning,
}: {
  tile: Tile
  isWinning: boolean
  onDelete: () => void
  onMarkWinning: () => void
}) {
  return (
    <div className="mj-hand-slot">
      <TileView tile={tile} size={38} onClick={onDelete} highlighted={isWinning} />
      <button
        type="button"
        className={`mj-win-marker ${isWinning ? 'active' : ''}`}
        onClick={onMarkWinning}
      >
        和
      </button>
    </div>
  )
}

export function Mahjong() {
  const [data, setData] = useState<MahjongData>(loadData)
  const [padTarget, setPadTarget] = useState<PadTarget>('hand')
  const [redToggle, setRedToggle] = useState(false)
  const [pendingMeld, setPendingMeld] = useState<PendingMeld | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  // Auto-save
  useEffect(() => {
    saveData(data)
  }, [data])

  const update = (partial: Partial<MahjongData>) => {
    setData(prev => ({ ...prev, ...partial }))
  }

  const isConcealed = data.melds.every(m => m.type === 'ankan')

  // Riichi requires a concealed hand; clear it (and ippatsu) if a call breaks concealment.
  useEffect(() => {
    if (!isConcealed && data.riichi !== 'none') {
      update({ riichi: 'none', ippatsu: false })
    }
  }, [isConcealed])

  // Ura-dora only makes sense with riichi.
  useEffect(() => {
    if (data.riichi === 'none') {
      if (data.uraDoraIndicators.length > 0) update({ uraDoraIndicators: [] })
      if (padTarget === 'ura') setPadTarget('hand')
    }
  }, [data.riichi])

  const maxHandSlots = 14 - 3 * data.melds.length

  const usageCounts = useMemo(() => {
    const counts: Record<number, number> = {}
    const bump = (k: number) => {
      counts[k] = (counts[k] ?? 0) + 1
    }
    data.handTiles.forEach(t => bump(t.kind))
    data.melds.forEach(m => m.tiles.forEach(t => bump(t.kind)))
    data.doraIndicators.forEach(bump)
    data.uraDoraIndicators.forEach(bump)
    if (pendingMeld) pendingMeld.tiles.forEach(t => bump(t.kind))
    return counts
  }, [data, pendingMeld])

  const isKindMaxed = (kind: TileKind) => (usageCounts[kind] ?? 0) >= 4

  const removeHandTile = (idx: number) => {
    setData(prev => {
      const handTiles = prev.handTiles.filter((_, i) => i !== idx)
      let winningTileIndex = prev.winningTileIndex
      if (winningTileIndex === idx) {
        winningTileIndex = handTiles.length > 0 ? handTiles.length - 1 : null
      } else if (winningTileIndex !== null && winningTileIndex > idx) {
        winningTileIndex -= 1
      }
      return { ...prev, handTiles, winningTileIndex }
    })
  }

  const setWinningTile = (idx: number) => {
    update({ winningTileIndex: idx })
  }

  const removeMeld = (idx: number) => {
    setData(prev => ({ ...prev, melds: prev.melds.filter((_, i) => i !== idx) }))
  }

  const startMeld = (type: MeldType) => {
    setPendingMeld({ type, tiles: [] })
    setPadTarget('meld')
  }

  const cancelPendingMeld = () => {
    setPendingMeld(null)
    setPadTarget('hand')
  }

  const removeDoraIndicator = (idx: number) => {
    setData(prev => ({ ...prev, doraIndicators: prev.doraIndicators.filter((_, i) => i !== idx) }))
  }

  const removeUraDoraIndicator = (idx: number) => {
    setData(prev => ({
      ...prev,
      uraDoraIndicators: prev.uraDoraIndicators.filter((_, i) => i !== idx),
    }))
  }

  const handlePadClick = (kind: TileKind) => {
    if (isKindMaxed(kind)) return

    if (padTarget === 'hand') {
      if (data.handTiles.length >= maxHandSlots) return
      const tile: Tile = { kind, red: redToggle && isFiveKind(kind) }
      setData(prev => ({
        ...prev,
        handTiles: [...prev.handTiles, tile],
        winningTileIndex: prev.handTiles.length,
      }))
    } else if (padTarget === 'dora') {
      setData(prev => ({ ...prev, doraIndicators: [...prev.doraIndicators, kind] }))
    } else if (padTarget === 'ura') {
      if (data.riichi === 'none') return
      setData(prev => ({ ...prev, uraDoraIndicators: [...prev.uraDoraIndicators, kind] }))
    } else if (padTarget === 'meld' && pendingMeld) {
      const need = meldTileCount(pendingMeld.type)
      const tile: Tile = { kind, red: redToggle && isFiveKind(kind) }
      const nextTiles = [...pendingMeld.tiles, tile]
      if (nextTiles.length >= need) {
        const meld: Meld = { type: pendingMeld.type, tiles: nextTiles }
        setData(prev => ({ ...prev, melds: [...prev.melds, meld] }))
        setPendingMeld(null)
        setPadTarget('hand')
      } else {
        setPendingMeld({ ...pendingMeld, tiles: nextTiles })
      }
    }
  }

  const winningTile: Tile | undefined =
    data.winningTileIndex !== null
      ? data.handTiles[data.winningTileIndex]
      : data.handTiles[data.handTiles.length - 1]

  const isDealer = data.seatWind === 27

  const result = useMemo<ScoreResult | null>(() => {
    if (data.handTiles.length !== maxHandSlots || !winningTile) return null
    const input: HandInput = {
      concealed: data.handTiles,
      melds: data.melds,
      winningTile,
      winType: data.winType,
      isDealer,
      riichi: data.riichi === 'riichi',
      doubleRiichi: data.riichi === 'double',
      ippatsu: data.ippatsu,
      roundWind: data.roundWind,
      seatWind: data.seatWind,
      doraIndicators: data.doraIndicators.map(kind => ({ kind })),
      uraDoraIndicators: data.uraDoraIndicators.map(kind => ({ kind })),
      tenho: data.tenho,
      chiho: data.chiho,
      haitei: data.haitei,
      houtei: data.houtei,
      rinshan: data.rinshan,
      chankan: data.chankan,
      honba: data.honba,
      kyotaku: data.kyotaku,
    }
    try {
      return calculateScore(input)
    } catch (e) {
      return {
        success: false,
        error: 'invalid_input',
        errorMessage: e instanceof Error ? e.message : String(e),
        yaku: [],
        han: 0,
        fu: 0,
        points: { total: 0 },
        limitName: null,
        doraCount: 0,
        uraDoraCount: 0,
        akaCount: 0,
        displayRows: [],
      }
    }
  }, [data, maxHandSlots, winningTile, isDealer])

  const handleReset = () => {
    setData({ ...defaultData })
    setPendingMeld(null)
    setPadTarget('hand')
    setDetailsOpen(false)
    setConfirmReset(false)
  }

  return (
    <div className="mahjong-calculator">
      {/* ① 手牌エリア */}
      <div className="mahjong-section">
        <div className="mahjong-section-header">
          <h2>手牌</h2>
          <span className="mahjong-count">
            {data.handTiles.length} / {maxHandSlots}
          </span>
        </div>
        <div className="hand-slots">
          {data.handTiles.map((t, i) => (
            <HandTileSlot
              key={i}
              tile={t}
              isWinning={i === (data.winningTileIndex ?? data.handTiles.length - 1)}
              onDelete={() => removeHandTile(i)}
              onMarkWinning={() => setWinningTile(i)}
            />
          ))}
          {Array.from({ length: Math.max(0, maxHandSlots - data.handTiles.length) }, (_, i) => (
            <div key={`empty-${i}`} className="mj-hand-slot-empty" />
          ))}
        </div>
        <p className="mahjong-hint">牌をタップすると削除、「和」で和了牌を指定できます。</p>
      </div>

      {/* ② 牌選択パッド */}
      <div className="mahjong-section">
        <div className="mahjong-section-header">
          <h2>牌選択</h2>
          <label className="red-toggle">
            <input
              type="checkbox"
              checked={redToggle}
              onChange={e => setRedToggle(e.target.checked)}
            />
            赤5
          </label>
        </div>
        <div className="pad-tabs">
          <button
            type="button"
            className={padTarget === 'hand' ? 'active' : ''}
            onClick={() => setPadTarget('hand')}
          >
            手牌
          </button>
          <button
            type="button"
            className={padTarget === 'dora' ? 'active' : ''}
            onClick={() => setPadTarget('dora')}
          >
            ドラ表示
          </button>
          <button
            type="button"
            className={padTarget === 'ura' ? 'active' : ''}
            disabled={data.riichi === 'none'}
            onClick={() => setPadTarget('ura')}
          >
            裏ドラ表示
          </button>
          {padTarget === 'meld' && pendingMeld && (
            <button type="button" className="active" disabled>
              {MELD_LABELS[pendingMeld.type]}選択中 ({pendingMeld.tiles.length}/
              {meldTileCount(pendingMeld.type)})
            </button>
          )}
        </div>
        <div className="pad-grid">
          {[0, 9, 18].map(base => (
            <div className="pad-row" key={base}>
              {Array.from({ length: 9 }, (_, i) => base + i).map(kind => (
                <TileView
                  key={kind}
                  tile={{ kind, red: redToggle && isFiveKind(kind) }}
                  size={44}
                  onClick={() => handlePadClick(kind)}
                  disabled={
                    isKindMaxed(kind) ||
                    (padTarget === 'hand' && data.handTiles.length >= maxHandSlots)
                  }
                />
              ))}
            </div>
          ))}
          <div className="pad-row pad-row-honor">
            {Array.from({ length: 7 }, (_, i) => 27 + i).map(kind => (
              <TileView
                key={kind}
                tile={{ kind }}
                size={44}
                onClick={() => handlePadClick(kind)}
                disabled={
                  isKindMaxed(kind) ||
                  (padTarget === 'hand' && data.handTiles.length >= maxHandSlots)
                }
              />
            ))}
          </div>
        </div>
      </div>

      {/* ③ 副露エディタ */}
      <div className="mahjong-section">
        <h2>副露</h2>
        {data.melds.length > 0 && (
          <div className="meld-list">
            {data.melds.map((m, i) => (
              <div key={i} className="meld-card">
                <span className="meld-label">{MELD_LABELS[m.type]}</span>
                <div className="meld-tiles">
                  {m.tiles.map((t, ti) => (
                    <TileView key={ti} tile={t} size={30} />
                  ))}
                </div>
                <button type="button" className="meld-remove" onClick={() => removeMeld(i)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {pendingMeld ? (
          <div className="meld-pending">
            <span>
              {MELD_LABELS[pendingMeld.type]}を選択中（{pendingMeld.tiles.length}/
              {meldTileCount(pendingMeld.type)}）
            </span>
            <div className="meld-tiles">
              {pendingMeld.tiles.map((t, ti) => (
                <TileView key={ti} tile={t} size={30} />
              ))}
            </div>
            <button type="button" className="meld-cancel" onClick={cancelPendingMeld}>
              キャンセル
            </button>
          </div>
        ) : (
          <div className="meld-add-row">
            <button type="button" disabled={data.melds.length >= 4} onClick={() => startMeld('chi')}>
              + チー
            </button>
            <button type="button" disabled={data.melds.length >= 4} onClick={() => startMeld('pon')}>
              + ポン
            </button>
            <button type="button" disabled={data.melds.length >= 4} onClick={() => startMeld('minkan')}>
              + 明槓
            </button>
            <button type="button" disabled={data.melds.length >= 4} onClick={() => startMeld('ankan')}>
              + 暗槓
            </button>
          </div>
        )}
      </div>

      {/* ④ 条件トグル */}
      <div className="mahjong-section">
        <h2>条件</h2>
        <div className="condition-row">
          <span className="condition-label">和了方法</span>
          <div className="segmented">
            <button
              type="button"
              className={data.winType === 'tsumo' ? 'active' : ''}
              onClick={() => update({ winType: 'tsumo' })}
            >
              ツモ
            </button>
            <button
              type="button"
              className={data.winType === 'ron' ? 'active' : ''}
              onClick={() => update({ winType: 'ron' })}
            >
              ロン
            </button>
          </div>
        </div>
        <div className="condition-row">
          <span className="condition-label">リーチ</span>
          <div className="segmented">
            <button
              type="button"
              disabled={!isConcealed}
              className={data.riichi === 'none' ? 'active' : ''}
              onClick={() => update({ riichi: 'none', ippatsu: false })}
            >
              なし
            </button>
            <button
              type="button"
              disabled={!isConcealed}
              className={data.riichi === 'riichi' ? 'active' : ''}
              onClick={() => update({ riichi: 'riichi' })}
            >
              リーチ
            </button>
            <button
              type="button"
              disabled={!isConcealed}
              className={data.riichi === 'double' ? 'active' : ''}
              onClick={() => update({ riichi: 'double' })}
            >
              ダブリー
            </button>
          </div>
        </div>
        <label className="condition-checkbox">
          <input
            type="checkbox"
            checked={data.ippatsu}
            disabled={data.riichi === 'none'}
            onChange={e => update({ ippatsu: e.target.checked })}
          />
          一発
        </label>
        <div className="condition-row">
          <span className="condition-label">場風</span>
          <div className="segmented">
            {[27, 28].map(w => (
              <button
                key={w}
                type="button"
                className={data.roundWind === w ? 'active' : ''}
                onClick={() => update({ roundWind: w as Wind })}
              >
                {WIND_LABELS[w - 27]}
              </button>
            ))}
          </div>
        </div>
        <div className="condition-row">
          <span className="condition-label">自風</span>
          <div className="segmented">
            {[27, 28, 29, 30].map(w => (
              <button
                key={w}
                type="button"
                className={data.seatWind === w ? 'active' : ''}
                onClick={() => update({ seatWind: w as Wind })}
              >
                {WIND_LABELS[w - 27]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ⑤ ドラ入力 */}
      <div className="mahjong-section">
        <h2>ドラ</h2>
        <div className="dora-group">
          <span className="condition-label">ドラ表示牌</span>
          <div className="dora-chip-row">
            {data.doraIndicators.map((k, i) => (
              <div key={i} className="dora-chip" onClick={() => removeDoraIndicator(i)}>
                <TileView tile={{ kind: k }} size={28} />
                <span className="dora-arrow">→</span>
                <TileView tile={doraFromIndicator({ kind: k })} size={28} />
              </div>
            ))}
            <button
              type="button"
              className={`pad-target-btn ${padTarget === 'dora' ? 'active' : ''}`}
              onClick={() => setPadTarget('dora')}
            >
              + 追加
            </button>
          </div>
        </div>
        <div className="dora-group">
          <span className="condition-label">
            裏ドラ表示牌{data.riichi === 'none' ? '（リーチ時のみ）' : ''}
          </span>
          <div className="dora-chip-row">
            {data.uraDoraIndicators.map((k, i) => (
              <div key={i} className="dora-chip" onClick={() => removeUraDoraIndicator(i)}>
                <TileView tile={{ kind: k }} size={28} />
                <span className="dora-arrow">→</span>
                <TileView tile={doraFromIndicator({ kind: k })} size={28} />
              </div>
            ))}
            <button
              type="button"
              disabled={data.riichi === 'none'}
              className={`pad-target-btn ${padTarget === 'ura' ? 'active' : ''}`}
              onClick={() => setPadTarget('ura')}
            >
              + 追加
            </button>
          </div>
        </div>
      </div>

      {/* ⑥ 詳細設定 */}
      <div className="mahjong-section">
        <button type="button" className="details-toggle" onClick={() => setDetailsOpen(o => !o)}>
          詳細設定 {detailsOpen ? '▲' : '▼'}
        </button>
        {detailsOpen && (
          <div className="details-body">
            <label className="condition-checkbox">
              <input
                type="checkbox"
                checked={data.tenho}
                onChange={e => update({ tenho: e.target.checked })}
              />
              天和
            </label>
            <label className="condition-checkbox">
              <input
                type="checkbox"
                checked={data.chiho}
                onChange={e => update({ chiho: e.target.checked })}
              />
              地和
            </label>
            <label className="condition-checkbox">
              <input
                type="checkbox"
                checked={data.haitei}
                onChange={e => update({ haitei: e.target.checked })}
              />
              海底摸月
            </label>
            <label className="condition-checkbox">
              <input
                type="checkbox"
                checked={data.houtei}
                onChange={e => update({ houtei: e.target.checked })}
              />
              河底撈魚
            </label>
            <label className="condition-checkbox">
              <input
                type="checkbox"
                checked={data.rinshan}
                onChange={e => update({ rinshan: e.target.checked })}
              />
              嶺上開花
            </label>
            <label className="condition-checkbox">
              <input
                type="checkbox"
                checked={data.chankan}
                onChange={e => update({ chankan: e.target.checked })}
              />
              槍槓
            </label>
            <div className="stepper-row">
              <span className="condition-label">本場</span>
              <div className="stepper">
                <button type="button" onClick={() => update({ honba: Math.max(0, data.honba - 1) })}>
                  −
                </button>
                <span>{data.honba}</span>
                <button type="button" onClick={() => update({ honba: data.honba + 1 })}>
                  +
                </button>
              </div>
            </div>
            <div className="stepper-row">
              <span className="condition-label">供託（本）</span>
              <div className="stepper">
                <button
                  type="button"
                  onClick={() => update({ kyotaku: Math.max(0, data.kyotaku - 1) })}
                >
                  −
                </button>
                <span>{data.kyotaku}</span>
                <button type="button" onClick={() => update({ kyotaku: data.kyotaku + 1 })}>
                  +
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ⑦ 結果パネル */}
      <div className="mahjong-section mahjong-result">
        <h2>結果</h2>
        {data.handTiles.length !== maxHandSlots ? (
          <div className="result-placeholder">
            牌を{maxHandSlots}枚入力してください（現在{data.handTiles.length}枚）
          </div>
        ) : !result ? (
          <div className="result-placeholder">計算中...</div>
        ) : !result.success ? (
          <div className="result-error">{result.errorMessage ?? errorMessage(result.error)}</div>
        ) : (
          <>
            <div className="result-score">
              {result.limitName && (
                <span className="result-limit">{LIMIT_LABELS[result.limitName]}</span>
              )}
              <span className="result-points">{result.points.total.toLocaleString()}点</span>
            </div>
            <div className="result-hanfu">
              {result.fu}符 {result.han}翻
            </div>
            {data.winType === 'ron' && result.points.ronFrom != null && (
              <div className="result-payment">ロン：{result.points.ronFrom.toLocaleString()}点</div>
            )}
            {data.winType === 'tsumo' && isDealer && result.points.tsumoFromEach != null && (
              <div className="result-payment">
                ツモ：{result.points.tsumoFromEach.toLocaleString()}点オール
              </div>
            )}
            {data.winType === 'tsumo' && !isDealer && result.points.tsumoFromDealer != null && (
              <div className="result-payment">
                ツモ：親 {result.points.tsumoFromDealer.toLocaleString()}点 / 子{' '}
                {(result.points.tsumoFromNonDealer ?? 0).toLocaleString()}点
              </div>
            )}
            <ul className="yaku-list">
              {result.yaku.map((y, i) => (
                <li key={i} className="yaku-item">
                  <span className="yaku-name">{y.name}</span>
                  <span className="yaku-han">{y.yakuman ? '役満' : `${y.han}翻`}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* ⑧ リセット */}
      <div className="mahjong-reset-section">
        <button className="mahjong-reset-btn" onClick={() => setConfirmReset(true)}>
          Reset
        </button>
      </div>

      {confirmReset && (
        <div className="confirm-overlay" onClick={() => setConfirmReset(false)}>
          <div className="confirm-modal" onClick={e => e.stopPropagation()}>
            <p>Reset all data?</p>
            <div className="confirm-buttons">
              <button className="confirm-cancel" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
              <button className="confirm-ok" onClick={handleReset}>
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
