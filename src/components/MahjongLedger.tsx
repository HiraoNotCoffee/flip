import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  calcGame,
  calcSettlements,
  splitEvenly,
  venueTotal,
  computeRanks,
  UMA_PRESETS_3,
  UMA_PRESETS_4,
  type Game,
  type GameEntry,
  type LedgerSettings,
  type VenueFee,
} from '../utils/mahjongLedger'
import './MahjongLedger.css'

interface Member {
  id: string
  name: string
}

interface LedgerData {
  settings: LedgerSettings
  members: Member[]
  games: Game[]
  venue: VenueFee
}

const STORAGE_KEY = 'mahjong-ledger-data'

const defaultData: LedgerData = {
  settings: {
    startPoints: 25000,
    returnPoints: 30000,
    uma4: [10, 5, -5, -10],
    uma3: [10, 0, -10],
    rate: 50,
    tobiBonus: 0,
  },
  members: [],
  games: [],
  venue: { fees: {}, payerId: null },
}

/** 旧形式（総額 or 1人あたり）の場所代をメンバーごとの金額に変換する */
function migrateVenue(venue: unknown, members: Member[]): VenueFee {
  const v = venue as Partial<VenueFee> & { mode?: string; amount?: number }
  if (!v) return { fees: {}, payerId: null }
  if (v.fees) return { fees: v.fees, payerId: v.payerId ?? null }
  const perPerson =
    v.mode === 'each' ? (v.amount ?? 0) : splitEvenly(v.amount ?? 0, members.length)
  const fees: Record<string, number> = {}
  if (perPerson > 0) members.forEach(m => (fees[m.id] = perPerson))
  return { fees, payerId: v.payerId ?? null }
}

function loadData(): LedgerData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LedgerData>
      const members = parsed.members ?? []
      return {
        settings: { ...defaultData.settings, ...parsed.settings },
        members,
        games: parsed.games ?? [],
        venue: migrateVenue(parsed.venue, members),
      }
    }
  } catch {
    // ignore
  }
  return { ...defaultData, members: [], games: [], venue: { fees: {}, payerId: null } }
}

let nextId = Date.now()
function genId() {
  return String(nextId++)
}

function umaKey(uma: number[], presets: { key: string; uma: number[] }[]) {
  const found = presets.find(p => p.uma.every((v, i) => v === uma[i]))
  return found?.key ?? 'custom'
}

/** 入力中は文字列を保持し、フォーカス時に全選択する数値入力（先頭に0が残らない） */
function NumberField({
  value,
  onChange,
  className,
  placeholder,
  emptyWhenZero = false,
}: {
  value: number
  onChange: (v: number) => void
  className?: string
  placeholder?: string
  emptyWhenZero?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const display = draft ?? (emptyWhenZero && value === 0 ? '' : String(value))

  return (
    <input
      className={className}
      type="text"
      inputMode="numeric"
      value={display}
      placeholder={placeholder}
      onFocus={e => {
        setDraft(display)
        e.currentTarget.select()
      }}
      onChange={e => {
        const raw = e.target.value.replace(/[^0-9-]/g, '')
        setDraft(raw)
        const n = Number(raw)
        onChange(raw === '' || raw === '-' || Number.isNaN(n) ? 0 : n)
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

export function MahjongLedger() {
  const [data, setData] = useState<LedgerData>(loadData)
  const [showSettings, setShowSettings] = useState(false)
  const [openGameId, setOpenGameId] = useState<string | null>(null)
  const [bulkFee, setBulkFee] = useState(0)
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [data])

  const { settings, members, games, venue } = data

  const updateSettings = useCallback((partial: Partial<LedgerSettings>) => {
    setData(prev => ({ ...prev, settings: { ...prev.settings, ...partial } }))
  }, [])

  const updateVenue = useCallback((partial: Partial<VenueFee>) => {
    setData(prev => ({ ...prev, venue: { ...prev.venue, ...partial } }))
  }, [])

  const setVenueFee = useCallback((memberId: string, amount: number) => {
    setData(prev => ({
      ...prev,
      venue: { ...prev.venue, fees: { ...prev.venue.fees, [memberId]: amount } },
    }))
  }, [])

  /** 全員に同じ金額を入れる（split: 総額として等分する） */
  const setVenueForAll = (amount: number, split: boolean) => {
    setData(prev => {
      const per = split ? splitEvenly(amount, prev.members.length) : amount
      const fees: Record<string, number> = {}
      prev.members.forEach(m => (fees[m.id] = per))
      return { ...prev, venue: { ...prev.venue, fees } }
    })
  }

  /* ---------------- members ---------------- */

  const addMember = () => {
    setData(prev => {
      const member = { id: genId(), name: `プレイヤー${prev.members.length + 1}` }
      return {
        ...prev,
        members: [...prev.members, member],
        // 既存の半荘には不参加の枠として足す
        games: prev.games.map(g => ({
          ...g,
          entries: [
            ...g.entries,
            {
              memberId: member.id,
              points: prev.settings.startPoints,
              rank: g.entries.length + 1,
              playing: false,
            },
          ],
        })),
      }
    })
  }

  const renameMember = (id: string, name: string) => {
    setData(prev => ({
      ...prev,
      members: prev.members.map(m => (m.id === id ? { ...m, name } : m)),
    }))
  }

  const removeMember = (id: string) => {
    setData(prev => {
      const fees = { ...prev.venue.fees }
      delete fees[id]
      return {
        ...prev,
        members: prev.members.filter(m => m.id !== id),
        games: prev.games.map(g => ({
          ...g,
          entries: g.entries
            .filter(e => e.memberId !== id)
            .map(e => (e.tobiBy === id ? { ...e, tobiBy: null } : e)),
        })),
        venue: { fees, payerId: prev.venue.payerId === id ? null : prev.venue.payerId },
      }
    })
  }

  /* ---------------- games ---------------- */

  const addGame = () => {
    const id = genId()
    setData(prev => {
      const entries: GameEntry[] = prev.members.map((m, i) => ({
        memberId: m.id,
        points: prev.settings.startPoints,
        rank: i + 1,
        // デフォルトは先頭4人（3人しかいなければ3人）
        playing: i < 4,
      }))
      return { ...prev, games: [...prev.games, { id, entries }] }
    })
    setOpenGameId(id)
  }

  const removeGame = (id: string) => {
    setData(prev => ({ ...prev, games: prev.games.filter(g => g.id !== id) }))
    setOpenGameId(prev => (prev === id ? null : prev))
  }

  const updateGame = (gameId: string, updater: (entries: GameEntry[]) => GameEntry[]) => {
    setData(prev => ({
      ...prev,
      games: prev.games.map(g => (g.id === gameId ? { ...g, entries: updater(g.entries) } : g)),
    }))
  }

  /** 参加者だけで素点順に順位を振り直す（不参加は末尾） */
  const applyAutoRanks = (entries: GameEntry[]): GameEntry[] => {
    const playing = entries.filter(e => e.playing)
    const ranks = computeRanks(playing)
    const rankById = new Map(playing.map((e, i) => [e.memberId, ranks[i]]))
    let rest = playing.length
    return entries.map(e =>
      e.playing ? { ...e, rank: rankById.get(e.memberId) ?? e.rank } : { ...e, rank: ++rest }
    )
  }

  const setPoints = (gameId: string, memberId: string, points: number) => {
    updateGame(gameId, entries =>
      applyAutoRanks(entries.map(e => (e.memberId === memberId ? { ...e, points } : e)))
    )
  }

  /** 順位を手動で入れ替える（入れ替え先の相手と交換） */
  const setRank = (gameId: string, memberId: string, rank: number) => {
    updateGame(gameId, entries => {
      const target = entries.find(e => e.memberId === memberId)
      if (!target) return entries
      const oldRank = target.rank
      return entries.map(e => {
        if (e.memberId === memberId) return { ...e, rank }
        if (e.playing && e.rank === rank) return { ...e, rank: oldRank }
        return e
      })
    })
  }

  const setTobiBy = (gameId: string, memberId: string, tobiBy: string | null) => {
    updateGame(gameId, entries =>
      entries.map(e => (e.memberId === memberId ? { ...e, tobiBy } : e))
    )
  }

  const togglePlaying = (gameId: string, memberId: string) => {
    updateGame(gameId, entries =>
      applyAutoRanks(
        entries.map(e => (e.memberId === memberId ? { ...e, playing: !e.playing } : e))
      )
    )
  }

  /* ---------------- calculation ---------------- */

  /** メンバー追加後の半荘には枠がないので補完する */
  const entriesOf = useCallback(
    (g: Game): GameEntry[] =>
      members.map(m => {
        const found = g.entries.find(e => e.memberId === m.id)
        return found ?? { memberId: m.id, points: settings.startPoints, rank: 99, playing: false }
      }),
    [members, settings.startPoints]
  )

  const gameResults = useMemo(
    () => games.map(g => calcGame({ ...g, entries: entriesOf(g) }, settings)),
    [games, entriesOf, settings]
  )

  const venueSum = venueTotal(venue, members.map(m => m.id))

  const totals = useMemo(() => {
    const map = new Map<string, { games: number; score: number; yen: number; ranks: number[]; tobi: number }>()
    members.forEach(m => map.set(m.id, { games: 0, score: 0, yen: 0, ranks: [], tobi: 0 }))
    gameResults.forEach(res => {
      res.results.forEach(r => {
        const t = map.get(r.memberId)
        if (!t) return
        t.games += 1
        t.score += r.score
        t.yen += r.yen
        t.ranks.push(r.rank)
        if (r.tobi) t.tobi += 1
      })
    })
    return members.map(m => {
      const t = map.get(m.id)!
      const avgRank = t.ranks.length ? t.ranks.reduce((s, r) => s + r, 0) / t.ranks.length : 0
      const fee = venue.fees[m.id] || 0
      return {
        id: m.id,
        name: m.name,
        ...t,
        avgRank,
        fee,
        // 場所代を引いた最終的な収支
        finalYen: t.yen - fee,
      }
    })
  }, [members, gameResults, venue.fees])

  const settlements = useMemo(() => {
    const balances = totals.map(t => ({
      name: t.name,
      // 立替者がいる場合は集めた分を戻す（＝みんなが立替者に払う）
      yen: venue.payerId
        ? t.finalYen + (venue.payerId === t.id ? venueSum : 0)
        : t.yen,
    }))
    return calcSettlements(balances)
  }, [totals, venue.payerId, venueSum])

  const handleReset = () => {
    setData({ ...defaultData, members: [], games: [], venue: { fees: {}, payerId: null } })
    setConfirmReset(false)
    setOpenGameId(null)
  }

  const memberName = (id: string) => members.find(m => m.id === id)?.name ?? '?'

  /* ---------------- render ---------------- */

  return (
    <div className="mjl">
      {/* 設定 */}
      <div className="mjl-block">
        <button className="mjl-block-toggle" onClick={() => setShowSettings(s => !s)}>
          <h2>ルール設定</h2>
          <span className="mjl-rule-summary">
            {settings.startPoints.toLocaleString()}点持ち
            {settings.returnPoints.toLocaleString()}点返し / {settings.rate}円
          </span>
          <span className="mjl-caret">{showSettings ? '▲' : '▼'}</span>
        </button>

        {showSettings && (
          <div className="mjl-settings">
            <div className="mjl-setting-row">
              <label>配給原点</label>
              <NumberField
                value={settings.startPoints}
                onChange={v => updateSettings({ startPoints: v })}
                placeholder="25000"
                emptyWhenZero
              />
              <span className="mjl-unit">点</span>
            </div>
            <div className="mjl-setting-row">
              <label>返し点</label>
              <NumberField
                value={settings.returnPoints}
                onChange={v => updateSettings({ returnPoints: v })}
                placeholder="30000"
                emptyWhenZero
              />
              <span className="mjl-unit">点</span>
            </div>
            <div className="mjl-setting-row">
              <label>レート</label>
              <NumberField
                value={settings.rate}
                onChange={v => updateSettings({ rate: v })}
                placeholder="50"
                emptyWhenZero
              />
              <span className="mjl-unit">円 / 1000点</span>
            </div>
            <div className="mjl-setting-row">
              <label>トビ賞</label>
              <NumberField
                value={settings.tobiBonus}
                onChange={v => updateSettings({ tobiBonus: v })}
                placeholder="0"
                emptyWhenZero
              />
              <span className="mjl-unit">pt（飛んだ人→トップ）</span>
            </div>
            <div className="mjl-setting-row">
              <label>ウマ (4人)</label>
              <select
                value={umaKey(settings.uma4, UMA_PRESETS_4)}
                onChange={e => {
                  const p = UMA_PRESETS_4.find(x => x.key === e.target.value)
                  if (p) updateSettings({ uma4: p.uma })
                }}
              >
                {UMA_PRESETS_4.map(p => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="mjl-setting-row">
              <label>ウマ (3人)</label>
              <select
                value={umaKey(settings.uma3, UMA_PRESETS_3)}
                onChange={e => {
                  const p = UMA_PRESETS_3.find(x => x.key === e.target.value)
                  if (p) updateSettings({ uma3: p.uma })
                }}
              >
                {UMA_PRESETS_3.map(p => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="mjl-note">オカ（返し点との差）は自動でトップに加算されます。</p>
          </div>
        )}
      </div>

      {/* メンバー */}
      <div className="mjl-block">
        <div className="mjl-block-header">
          <h2>メンバー</h2>
          <button className="mjl-add-btn" onClick={addMember}>
            + 追加
          </button>
        </div>
        {members.length === 0 && <p className="mjl-empty">まずはメンバーを追加してください</p>}
        <div className="mjl-member-list">
          {members.map(m => (
            <div key={m.id} className="mjl-member-row">
              <input
                className="mjl-member-name"
                value={m.name}
                onChange={e => renameMember(m.id, e.target.value)}
              />
              <button className="mjl-remove-btn" onClick={() => removeMember(m.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 半荘 */}
      <div className="mjl-block">
        <div className="mjl-block-header">
          <h2>半荘</h2>
          <button className="mjl-add-btn" onClick={addGame} disabled={members.length < 3}>
            + 半荘を追加
          </button>
        </div>
        {members.length < 3 && (
          <p className="mjl-empty">メンバーが3人以上になると半荘を追加できます</p>
        )}

        {games.map((g, gi) => {
          const res = gameResults[gi]
          const resultById = new Map(res.results.map(r => [r.memberId, r]))
          // 入力中に行が動かないよう、並びはメンバー順のまま（不参加だけ末尾へ）
          const entries = [...entriesOf(g)].sort((a, b) => Number(b.playing) - Number(a.playing))
          const expected = settings.startPoints * res.count
          const open = openGameId === g.id
          const summary = [...res.results].sort((a, b) => a.rank - b.rank)

          return (
            <div key={g.id} className={`mjl-game ${open ? 'open' : ''}`}>
              <div className="mjl-game-header">
                <button
                  className="mjl-game-toggle"
                  onClick={() => setOpenGameId(open ? null : g.id)}
                >
                  <span className="mjl-caret">{open ? '▲' : '▼'}</span>
                  <span className="mjl-game-title">第{gi + 1}半荘</span>
                  <span className="mjl-game-count">{res.count}人</span>
                  <span className={`mjl-game-total ${res.pointsValid ? 'ok' : 'ng'}`}>
                    {res.totalPoints.toLocaleString()} / {expected.toLocaleString()}
                  </span>
                </button>
                <button className="mjl-remove-btn" onClick={() => removeGame(g.id)}>
                  ×
                </button>
              </div>

              {!open && summary.length > 0 && (
                <div className="mjl-game-summary">
                  {summary.map(r => (
                    <span key={r.memberId} className="mjl-summary-chip">
                      <span className={`mjl-summary-rank rank-${r.rank}`}>{r.rank}</span>
                      <span className="mjl-summary-name">{memberName(r.memberId)}</span>
                      <span
                        className={`mjl-summary-yen ${r.yen > 0 ? 'positive' : r.yen < 0 ? 'negative' : ''}`}
                      >
                        {r.yen >= 0 ? '+' : ''}
                        {Math.round(r.yen).toLocaleString()}
                      </span>
                    </span>
                  ))}
                </div>
              )}

              {open && (
                <>
                  <p className="mjl-note mjl-note-inline">
                    チェックで参加者を選択（デフォルト4人）。素点は「±」でマイナス（飛び）にできます。
                  </p>

                  {entries.map(e => {
                    const r = resultById.get(e.memberId)
                    const tobi = e.playing && e.points < 0
                    return (
                      <div
                        key={e.memberId}
                        className={`mjl-entry ${e.playing ? '' : 'sitting-out'} ${tobi ? 'tobi' : ''}`}
                      >
                        <div className="mjl-entry-top">
                          <button
                            className={`mjl-check ${e.playing ? 'on' : ''}`}
                            onClick={() => togglePlaying(g.id, e.memberId)}
                            aria-label="参加"
                          >
                            {e.playing ? '✓' : ''}
                          </button>
                          {e.playing ? (
                            <select
                              className={`mjl-rank rank-${e.rank}`}
                              value={e.rank}
                              onChange={ev => setRank(g.id, e.memberId, Number(ev.target.value))}
                            >
                              {Array.from({ length: res.count }, (_, i) => i + 1).map(n => (
                                <option key={n} value={n}>
                                  {n}位
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="mjl-rank out">－</span>
                          )}
                          <span className="mjl-entry-name">{memberName(e.memberId)}</span>
                          {tobi && <span className="mjl-tobi-badge">飛び</span>}
                          {e.playing && r && (
                            <span
                              className={`mjl-entry-yen ${r.yen > 0 ? 'positive' : r.yen < 0 ? 'negative' : 'zero'}`}
                            >
                              {r.yen >= 0 ? '+' : ''}¥{Math.round(r.yen).toLocaleString()}
                            </span>
                          )}
                        </div>

                        {e.playing && (
                          <div className="mjl-entry-bottom">
                            <button
                              className="mjl-sign-btn"
                              onClick={() => setPoints(g.id, e.memberId, -e.points)}
                            >
                              ±
                            </button>
                            <NumberField
                              className="mjl-points"
                              value={e.points}
                              onChange={v => setPoints(g.id, e.memberId, v)}
                            />
                            <span className="mjl-unit">点</span>
                            {r && (
                              <span className="mjl-entry-score">
                                {r.score >= 0 ? '+' : ''}
                                {r.score}
                              </span>
                            )}
                          </div>
                        )}

                        {tobi && (
                          <div className="mjl-entry-bottom">
                            <span className="mjl-tobi-label">飛ばした人</span>
                            <select
                              className="mjl-tobi-select"
                              value={r?.tobiBy ?? ''}
                              onChange={ev =>
                                setTobiBy(g.id, e.memberId, ev.target.value || null)
                              }
                            >
                              {entries
                                .filter(o => o.playing && o.memberId !== e.memberId)
                                .map(o => (
                                  <option key={o.memberId} value={o.memberId}>
                                    {memberName(o.memberId)}
                                  </option>
                                ))}
                            </select>
                            {settings.tobiBonus > 0 && (
                              <span className="mjl-entry-score">
                                トビ賞 {settings.tobiBonus}pt
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {!res.pointsValid && res.count >= 2 && (
                    <div className="mjl-warn">
                      素点の合計が {expected.toLocaleString()} 点になっていません
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* 場所代 */}
      {members.length > 0 && (
        <div className="mjl-block">
          <div className="mjl-block-header">
            <h2>場所代</h2>
          </div>
          {members.map(m => (
            <div key={m.id} className="mjl-venue-row">
              <span className="mjl-venue-name">{m.name}</span>
              <NumberField
                className="mjl-venue-input"
                value={venue.fees[m.id] || 0}
                onChange={v => setVenueFee(m.id, v)}
                placeholder="0"
                emptyWhenZero
              />
              <span className="mjl-unit">円</span>
            </div>
          ))}

          <div className="mjl-venue-bulk">
            <NumberField
              className="mjl-venue-input"
              value={bulkFee}
              onChange={setBulkFee}
              placeholder="0"
              emptyWhenZero
            />
            <button className="mjl-bulk-btn" onClick={() => setVenueForAll(bulkFee, false)}>
              全員に
            </button>
            <button className="mjl-bulk-btn" onClick={() => setVenueForAll(bulkFee, true)}>
              総額を等分
            </button>
          </div>

          <div className="mjl-setting-row">
            <label>立替えた人</label>
            <select
              value={venue.payerId ?? ''}
              onChange={e => updateVenue({ payerId: e.target.value || null })}
            >
              <option value="">各自で支払い</option>
              {members.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          {venueSum > 0 && (
            <p className="mjl-note">
              合計 ¥{venueSum.toLocaleString()}
              {venue.payerId
                ? ` / ${memberName(venue.payerId)}さんが立替え → 精算に含みます`
                : ' / 各自で支払い（精算には含めません）'}
            </p>
          )}
        </div>
      )}

      {/* 集計 */}
      {games.length > 0 && (
        <div className="mjl-block">
          <div className="mjl-block-header">
            <h2>集計</h2>
          </div>
          <table className="mjl-totals">
            <thead>
              <tr>
                <th>名前</th>
                <th>半荘</th>
                <th>平均順位</th>
                <th>スコア</th>
                <th>収支</th>
              </tr>
            </thead>
            <tbody>
              {[...totals]
                .sort((a, b) => b.finalYen - a.finalYen)
                .map(t => (
                  <tr key={t.id}>
                    <td className="mjl-td-name">
                      {t.name}
                      {t.tobi > 0 && <span className="mjl-tobi-count">飛{t.tobi}</span>}
                    </td>
                    <td>{t.games}</td>
                    <td>{t.games ? t.avgRank.toFixed(2) : '-'}</td>
                    <td className={t.score > 0 ? 'positive' : t.score < 0 ? 'negative' : ''}>
                      {t.score >= 0 ? '+' : ''}
                      {t.score}
                    </td>
                    <td
                      className={`mjl-td-yen ${t.finalYen > 0 ? 'positive' : t.finalYen < 0 ? 'negative' : ''}`}
                    >
                      {t.finalYen >= 0 ? '+' : ''}¥{Math.round(t.finalYen).toLocaleString()}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {venueSum > 0 && (
            <p className="mjl-note">
              収支は場所代（合計 ¥{venueSum.toLocaleString()}）を引いた金額です。
            </p>
          )}

          <div className="mjl-settlement">
            <h3>精算</h3>
            {settlements.length === 0 ? (
              <div className="mjl-settlement-empty">やりとりなし</div>
            ) : (
              <ul className="mjl-settlement-list">
                {settlements.map((s, i) => (
                  <li key={i} className="mjl-settlement-item">
                    <span className="mjl-from">{s.from}</span>
                    <span className="mjl-arrow">→</span>
                    <span className="mjl-to">{s.to}</span>
                    <span className="mjl-amount">¥{s.amount.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="chip-reset-section">
        <button className="chip-reset-btn" onClick={() => setConfirmReset(true)}>
          リセット
        </button>
      </div>

      {confirmReset && (
        <div className="confirm-overlay" onClick={() => setConfirmReset(false)}>
          <div className="confirm-modal" onClick={e => e.stopPropagation()}>
            <p>メンバーと全ての半荘を削除しますか？</p>
            <div className="confirm-buttons">
              <button className="confirm-cancel" onClick={() => setConfirmReset(false)}>
                キャンセル
              </button>
              <button className="confirm-ok" onClick={handleReset}>
                リセット
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
