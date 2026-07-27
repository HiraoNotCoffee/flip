import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  calcGame,
  calcSettlements,
  computeRanks,
  UMA_PRESETS_3,
  UMA_PRESETS_4,
  type Game,
  type GameEntry,
  type LedgerSettings,
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
}

const STORAGE_KEY = 'mahjong-ledger-data'

const defaultData: LedgerData = {
  settings: {
    startPoints: 25000,
    returnPoints: 30000,
    uma4: [10, 5, -5, -10],
    uma3: [20, 0, -20],
    rate: 50,
  },
  members: [],
  games: [],
}

function loadData(): LedgerData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as LedgerData
      return {
        settings: { ...defaultData.settings, ...parsed.settings },
        members: parsed.members ?? [],
        games: parsed.games ?? [],
      }
    }
  } catch {
    // ignore
  }
  return { ...defaultData, members: [], games: [] }
}

let nextId = Date.now()
function genId() {
  return String(nextId++)
}

function umaKey(uma: number[], presets: { key: string; uma: number[] }[]) {
  const found = presets.find(p => p.uma.every((v, i) => v === uma[i]))
  return found?.key ?? 'custom'
}

export function MahjongLedger() {
  const [data, setData] = useState<LedgerData>(loadData)
  const [showSettings, setShowSettings] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [data])

  const { settings, members, games } = data

  const updateSettings = useCallback((partial: Partial<LedgerSettings>) => {
    setData(prev => ({ ...prev, settings: { ...prev.settings, ...partial } }))
  }, [])

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
    setData(prev => ({
      ...prev,
      members: prev.members.filter(m => m.id !== id),
      games: prev.games.map(g => ({
        ...g,
        entries: g.entries.filter(e => e.memberId !== id),
      })),
    }))
  }

  /* ---------------- games ---------------- */

  const addGame = () => {
    setData(prev => {
      const entries: GameEntry[] = prev.members.map((m, i) => ({
        memberId: m.id,
        points: prev.settings.startPoints,
        rank: i + 1,
        // 5人以上いる場合は先頭4人（3人打ちなら人数分）を参加にする
        playing: prev.members.length <= 4 ? true : i < 4,
      }))
      return { ...prev, games: [...prev.games, { id: genId(), entries }] }
    })
  }

  const removeGame = (id: string) => {
    setData(prev => ({ ...prev, games: prev.games.filter(g => g.id !== id) }))
  }

  /** 半荘のエントリーを更新し、必要なら順位を振り直す */
  const updateGame = (gameId: string, updater: (entries: GameEntry[]) => GameEntry[]) => {
    setData(prev => ({
      ...prev,
      games: prev.games.map(g => (g.id === gameId ? { ...g, entries: updater(g.entries) } : g)),
    }))
  }

  const setPoints = (gameId: string, memberId: string, points: number) => {
    updateGame(gameId, entries => {
      const next = entries.map(e => (e.memberId === memberId ? { ...e, points } : e))
      return applyAutoRanks(next)
    })
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

  const togglePlaying = (gameId: string, memberId: string) => {
    updateGame(gameId, entries =>
      applyAutoRanks(
        entries.map(e => (e.memberId === memberId ? { ...e, playing: !e.playing } : e))
      )
    )
  }

  /* ---------------- calculation ---------------- */

  const gameResults = useMemo(
    () =>
      games.map(g => {
        // メンバー追加後の半荘には枠がないので補完する
        const entries = members.map<GameEntry>(m => {
          const found = g.entries.find(e => e.memberId === m.id)
          return found ?? { memberId: m.id, points: settings.startPoints, rank: 99, playing: false }
        })
        return calcGame({ ...g, entries }, settings)
      }),
    [games, members, settings]
  )

  const totals = useMemo(() => {
    const map = new Map<string, { games: number; score: number; yen: number; ranks: number[] }>()
    members.forEach(m => map.set(m.id, { games: 0, score: 0, yen: 0, ranks: [] }))
    gameResults.forEach(res => {
      res.results.forEach(r => {
        const t = map.get(r.memberId)
        if (!t) return
        t.games += 1
        t.score += r.score
        t.yen += r.yen
        t.ranks.push(r.rank)
      })
    })
    return members.map(m => {
      const t = map.get(m.id)!
      const avgRank = t.ranks.length
        ? t.ranks.reduce((s, r) => s + r, 0) / t.ranks.length
        : 0
      return { id: m.id, name: m.name, ...t, avgRank }
    })
  }, [members, gameResults])

  const settlements = useMemo(
    () => calcSettlements(totals.map(t => ({ name: t.name, yen: t.yen }))),
    [totals]
  )

  const handleReset = () => {
    setData({ ...defaultData, members: [], games: [] })
    setConfirmReset(false)
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
              <input
                type="number"
                inputMode="numeric"
                value={settings.startPoints || ''}
                onChange={e => updateSettings({ startPoints: Number(e.target.value) || 0 })}
                placeholder="25000"
              />
              <span className="mjl-unit">点</span>
            </div>
            <div className="mjl-setting-row">
              <label>返し点</label>
              <input
                type="number"
                inputMode="numeric"
                value={settings.returnPoints || ''}
                onChange={e => updateSettings({ returnPoints: Number(e.target.value) || 0 })}
                placeholder="30000"
              />
              <span className="mjl-unit">点</span>
            </div>
            <div className="mjl-setting-row">
              <label>レート</label>
              <input
                type="number"
                inputMode="numeric"
                value={settings.rate || ''}
                onChange={e => updateSettings({ rate: Number(e.target.value) || 0 })}
                placeholder="50"
              />
              <span className="mjl-unit">円 / 1000点</span>
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
            <p className="mjl-note">
              オカ（返し点との差）は自動でトップに加算されます。
            </p>
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
        {members.length === 0 && (
          <p className="mjl-empty">まずはメンバーを追加してください</p>
        )}
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
          <button
            className="mjl-add-btn"
            onClick={addGame}
            disabled={members.length < 3}
          >
            + 半荘を追加
          </button>
        </div>
        {members.length < 3 && (
          <p className="mjl-empty">メンバーが3人以上になると半荘を追加できます</p>
        )}

        {games.map((g, gi) => {
          const res = gameResults[gi]
          const resultById = new Map(res.results.map(r => [r.memberId, r]))
          const entries = members.map<GameEntry>(m => {
            const found = g.entries.find(e => e.memberId === m.id)
            return found ?? { memberId: m.id, points: settings.startPoints, rank: 99, playing: false }
          })
          // 入力中に行が動かないよう、並びはメンバー順のまま（不参加だけ末尾へ）
          const sorted = [...entries].sort((a, b) => Number(b.playing) - Number(a.playing))
          const expected = settings.startPoints * res.count

          return (
            <div key={g.id} className="mjl-game">
              <div className="mjl-game-header">
                <span className="mjl-game-title">第{gi + 1}半荘</span>
                <span
                  className={`mjl-game-total ${res.pointsValid ? 'ok' : 'ng'}`}
                >
                  {res.totalPoints.toLocaleString()} / {expected.toLocaleString()}
                </span>
                <button className="mjl-remove-btn" onClick={() => removeGame(g.id)}>
                  ×
                </button>
              </div>

              {members.length > 4 && (
                <p className="mjl-note mjl-note-inline">名前をタップで参加 / 不参加を切替</p>
              )}

              {sorted.map(e => {
                const r = resultById.get(e.memberId)
                return (
                  <div
                    key={e.memberId}
                    className={`mjl-entry ${e.playing ? '' : 'sitting-out'}`}
                  >
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

                    <button
                      className="mjl-entry-name"
                      onClick={() => togglePlaying(g.id, e.memberId)}
                    >
                      {memberName(e.memberId)}
                    </button>

                    {e.playing ? (
                      <input
                        className="mjl-points"
                        type="number"
                        inputMode="numeric"
                        step={100}
                        value={e.points}
                        onChange={ev =>
                          setPoints(g.id, e.memberId, Number(ev.target.value) || 0)
                        }
                      />
                    ) : (
                      <span className="mjl-points-out">不参加</span>
                    )}

                    {e.playing && r && (
                      <span
                        className={`mjl-entry-result ${r.yen > 0 ? 'positive' : r.yen < 0 ? 'negative' : 'zero'}`}
                      >
                        <span className="mjl-entry-score">
                          {r.score >= 0 ? '+' : ''}
                          {r.score}
                        </span>
                        <span className="mjl-entry-yen">
                          {r.yen >= 0 ? '+' : ''}¥{Math.round(r.yen).toLocaleString()}
                        </span>
                      </span>
                    )}
                  </div>
                )
              })}

              {!res.pointsValid && res.count >= 2 && (
                <div className="mjl-warn">
                  素点の合計が {expected.toLocaleString()} 点になっていません
                </div>
              )}
            </div>
          )
        })}
      </div>

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
                .sort((a, b) => b.yen - a.yen)
                .map(t => (
                  <tr key={t.id}>
                    <td className="mjl-td-name">{t.name}</td>
                    <td>{t.games}</td>
                    <td>{t.games ? t.avgRank.toFixed(2) : '-'}</td>
                    <td className={t.score > 0 ? 'positive' : t.score < 0 ? 'negative' : ''}>
                      {t.score >= 0 ? '+' : ''}
                      {t.score}
                    </td>
                    <td
                      className={`mjl-td-yen ${t.yen > 0 ? 'positive' : t.yen < 0 ? 'negative' : ''}`}
                    >
                      {t.yen >= 0 ? '+' : ''}¥{Math.round(t.yen).toLocaleString()}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>

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
