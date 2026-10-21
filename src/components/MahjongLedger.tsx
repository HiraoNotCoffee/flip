import { useEffect, useState } from 'react'
import {
  columnTotals,
  RATE_LABEL,
  RATE_YEN,
  rowStatus,
  rowSum,
  toYen,
  venueBalance,
  venueShares,
  type Cell,
  type Rate,
} from '../utils/mahjongSheet'
import { hubTransfers, minimalTransfers } from '../utils/settlement'
import './MahjongLedger.css'

interface SheetData {
  names: string[]
  rows: Cell[][]
  rate: Rate
  /** 場代を各自がいくら払ったか（円）。合計を全員で割り勘する */
  venuePaid: number[]
}

const STORAGE_KEY = 'mahjong-sheet-data'
const DEFAULT_PLAYERS = 4
const MIN_PLAYERS = 3
const MAX_PLAYERS = 8
const DEFAULT_ROWS = 8

function emptyRow(columns: number): Cell[] {
  return Array.from({ length: columns }, () => null)
}

function freshData(rate: Rate = 'tenpin'): SheetData {
  return {
    names: Array.from({ length: DEFAULT_PLAYERS }, () => ''),
    rows: Array.from({ length: DEFAULT_ROWS }, () => emptyRow(DEFAULT_PLAYERS)),
    rate,
    venuePaid: Array.from({ length: DEFAULT_PLAYERS }, () => 0),
  }
}

function loadData(): SheetData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SheetData>
      if (Array.isArray(parsed.names) && Array.isArray(parsed.rows)) {
        const columns = parsed.names.length
        return {
          names: parsed.names.map(n => String(n ?? '')),
          rows: parsed.rows.map(r =>
            Array.from({ length: columns }, (_, c) => (typeof r?.[c] === 'number' ? r[c] : null)),
          ),
          rate: parsed.rate === 'tengo' ? 'tengo' : 'tenpin',
          venuePaid: Array.from({ length: columns }, (_, c) => {
            const v = parsed.venuePaid?.[c]
            return typeof v === 'number' && v > 0 ? v : 0
          }),
        }
      }
    }
  } catch {
    // 壊れていたら作り直す
  }
  return freshData()
}

function signed(n: number) {
  return `${n > 0 ? '+' : ''}${n.toLocaleString()}`
}

/**
 * スコアの入力欄。iPhone の数字キーボードにはマイナスが無いので、
 * 横の「±」で符号を反転できるようにしてある。
 */
function ScoreCell({ value, onChange }: { value: Cell; onChange: (v: Cell) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const display = draft ?? (value === null ? '' : String(value))

  return (
    <div className={`mjs-cell ${value !== null && value < 0 ? 'negative' : ''}`}>
      <button
        className="mjs-sign"
        onClick={() => {
          if (value === null || value === 0) return
          onChange(-value)
          setDraft(null)
        }}
        tabIndex={-1}
        aria-label="符号を反転"
      >
        ±
      </button>
      <input
        type="text"
        inputMode="decimal"
        value={display}
        onFocus={e => {
          setDraft(display)
          e.currentTarget.select()
        }}
        onChange={e => {
          const raw = e.target.value.replace(/[^0-9.-]/g, '')
          setDraft(raw)
          const n = Number(raw)
          onChange(raw === '' || raw === '-' || raw === '.' || Number.isNaN(n) ? null : n)
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  )
}

/** 円の入力欄（0 は空欄で見せる） */
function YenField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const display = draft ?? (value === 0 ? '' : String(value))
  return (
    <input
      className="mjs-yen-input"
      type="text"
      inputMode="numeric"
      placeholder="0"
      value={display}
      onFocus={e => {
        setDraft(display)
        e.currentTarget.select()
      }}
      onChange={e => {
        const raw = e.target.value.replace(/[^0-9]/g, '')
        setDraft(raw)
        onChange(raw === '' ? 0 : Number(raw))
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

export function MahjongLedger() {
  const [data, setData] = useState<SheetData>(loadData)
  const [method, setMethod] = useState<'minimal' | 'hub'>('minimal')
  const [confirm, setConfirm] = useState<{ kind: 'reset' } | { kind: 'row'; index: number } | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      // 保存できなくても使える
    }
  }, [data])

  const { names, rows, rate, venuePaid } = data
  const columns = names.length
  const totals = columnTotals(rows, columns)
  const displayName = (c: number) => names[c].trim() || `名前${c + 1}`
  const venueTotal = venuePaid.reduce((a, b) => a + b, 0)
  const shares = venueShares(venueTotal, columns)
  const venue = venueBalance(venuePaid)
  // 点数の金額に場代（払った額 − 割り勘の負担）を足したものが最終的な収支
  const finals = totals.map((t, c) => toYen(t, rate) + venue[c])
  const balances = finals.map((amount, c) => ({ name: displayName(c), amount }))
  const yenGap = balances.reduce((sum, b) => sum + b.amount, 0)
  const transfers =
    method === 'minimal' ? minimalTransfers(balances) : hubTransfers(balances).rows

  const setName = (c: number, name: string) =>
    setData(prev => ({ ...prev, names: prev.names.map((n, i) => (i === c ? name : n)) }))

  const setCell = (r: number, c: number, v: Cell) =>
    setData(prev => {
      const next = prev.rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row))
      // いちばん下の行に書き始めたら、次の行を足しておく
      if (r === next.length - 1 && v !== null) next.push(emptyRow(prev.names.length))
      return { ...prev, rows: next }
    })

  const addPlayer = () =>
    setData(prev =>
      prev.names.length >= MAX_PLAYERS
        ? prev
        : {
            ...prev,
            names: [...prev.names, ''],
            rows: prev.rows.map(r => [...r, null]),
            venuePaid: [...prev.venuePaid, 0],
          },
    )

  const removePlayer = () =>
    setData(prev =>
      prev.names.length <= MIN_PLAYERS
        ? prev
        : {
            ...prev,
            names: prev.names.slice(0, -1),
            rows: prev.rows.map(r => r.slice(0, -1)),
            venuePaid: prev.venuePaid.slice(0, -1),
          },
    )

  const setVenuePaid = (c: number, yen: number) =>
    setData(prev => ({ ...prev, venuePaid: prev.venuePaid.map((v, i) => (i === c ? yen : v)) }))

  const addRow = () => setData(prev => ({ ...prev, rows: [...prev.rows, emptyRow(prev.names.length)] }))

  const removeRow = (index: number) =>
    setData(prev => {
      const next = prev.rows.filter((_, i) => i !== index)
      return { ...prev, rows: next.length ? next : [emptyRow(prev.names.length)] }
    })

  const hasContent =
    names.some(n => n !== '') || rows.some(r => r.some(v => v !== null)) || venueTotal > 0

  return (
    <div className="mjs">
      <div className="mjs-toolbar">
        <span className="mjs-toolbar-label">人数</span>
        <button className="mjs-tool-btn" onClick={removePlayer} disabled={columns <= MIN_PLAYERS}>
          −
        </button>
        <span className="mjs-count">{columns}人</span>
        <button className="mjs-tool-btn" onClick={addPlayer} disabled={columns >= MAX_PLAYERS}>
          ＋
        </button>
        <span className="mjs-toolbar-hint">スコアは 1000点単位（±で符号）</span>
      </div>

      <div className="mjs-table-wrap">
        <table className="mjs-table" style={{ minWidth: columns > 4 ? columns * 78 + 80 : undefined }}>
          <thead>
            <tr>
              <th className="mjs-th-no">#</th>
              {names.map((name, c) => (
                <th key={c}>
                  <input
                    className="mjs-name"
                    value={name}
                    placeholder={`名前${c + 1}`}
                    onChange={e => setName(c, e.target.value)}
                  />
                </th>
              ))}
              <th className="mjs-th-sum">計</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const status = rowStatus(row)
              const s = rowSum(row)
              return (
                <tr key={r} className={`mjs-row ${status}`}>
                  <td className="mjs-no">
                    <button
                      className="mjs-no-btn"
                      onClick={() => setConfirm({ kind: 'row', index: r })}
                      disabled={status === 'empty' && rows.length === 1}
                    >
                      {r + 1}
                    </button>
                  </td>
                  {row.map((v, c) => (
                    <td key={c}>
                      <ScoreCell value={v} onChange={nv => setCell(r, c, nv)} />
                    </td>
                  ))}
                  <td className="mjs-sum">{s === null ? '' : s === 0 ? '0' : signed(s)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="mjs-total-row">
              <th className="mjs-th-no">計</th>
              {totals.map((t, c) => (
                <td key={c} className={t > 0 ? 'positive' : t < 0 ? 'negative' : ''}>
                  {signed(t)}
                </td>
              ))}
              <td className="mjs-sum">{signed(rowSum(totals) ?? 0)}</td>
            </tr>
            <tr className="mjs-yen-row">
              <th className="mjs-th-no">円</th>
              {totals.map((t, c) => {
                const yen = toYen(t, rate)
                return (
                  <td key={c} className={yen > 0 ? 'positive' : yen < 0 ? 'negative' : ''}>
                    {signed(yen)}
                  </td>
                )
              })}
              <td className="mjs-sum" />
            </tr>
            {venueTotal > 0 && (
              <>
                <tr className="mjs-venue-row">
                  <th className="mjs-th-no">場代</th>
                  {venue.map((v, c) => (
                    <td key={c} className={v > 0 ? 'positive' : v < 0 ? 'negative' : ''}>
                      {signed(v)}
                    </td>
                  ))}
                  <td className="mjs-sum" />
                </tr>
                <tr className="mjs-final-row">
                  <th className="mjs-th-no">収支</th>
                  {finals.map((v, c) => (
                    <td key={c} className={v > 0 ? 'positive' : v < 0 ? 'negative' : ''}>
                      {signed(v)}
                    </td>
                  ))}
                  <td className="mjs-sum" />
                </tr>
              </>
            )}
          </tfoot>
        </table>
      </div>

      <div className="mjs-footer">
        <button className="mjs-add-row" onClick={addRow}>
          ＋ 半荘を追加
        </button>
        <div className="mjs-rate">
          {(['tenpin', 'tengo'] as Rate[]).map(key => (
            <button
              key={key}
              className={`mjs-rate-btn ${rate === key ? 'active' : ''}`}
              onClick={() => setData(prev => ({ ...prev, rate: key }))}
            >
              {RATE_LABEL[key]}
              <span className="mjs-rate-sub">1pt = {RATE_YEN[key]}円</span>
            </button>
          ))}
        </div>
        <div className="mjs-venue">
          <div className="mjs-venue-header">
            <h3>場代</h3>
            {venueTotal > 0 && (
              <span className="mjs-venue-summary">
                合計 ¥{venueTotal.toLocaleString()} / 1人 ¥
                {shares[0] === shares[columns - 1]
                  ? shares[0].toLocaleString()
                  : `${shares[columns - 1].toLocaleString()}〜${shares[0].toLocaleString()}`}
              </span>
            )}
          </div>
          <p className="mjs-settle-how">払った人の欄に、払った金額を入れてください。合計を全員で割り勘して精算に含めます。</p>
          {names.map((_, c) => (
            <div key={c} className="mjs-venue-line">
              <span className="mjs-venue-name">{displayName(c)}</span>
              <YenField value={venuePaid[c]} onChange={v => setVenuePaid(c, v)} />
              <span className="mjs-venue-unit">円</span>
            </div>
          ))}
        </div>

        <div className="mjs-settle">
          <div className="mjs-settle-header">
            <h3>精算</h3>
            <div className="mjs-settle-tabs">
              <button
                className={method === 'minimal' ? 'active' : ''}
                onClick={() => setMethod('minimal')}
              >
                回数が少ない
              </button>
              <button className={method === 'hub' ? 'active' : ''} onClick={() => setMethod('hub')}>
                トップにまとめる
              </button>
            </div>
          </div>
          <p className="mjs-settle-how">
            {method === 'minimal'
              ? '送金の回数がいちばん少なくなる組み合わせ'
              : '負けた人はみんなトップに払い、トップが他の勝った人に配る'}
          </p>
          {transfers.length === 0 ? (
            <div className="mjs-settle-empty">やりとりなし</div>
          ) : (
            <ul className="mjs-settle-list">
              {transfers.map((t, i) => (
                <li key={i}>
                  <span className="mjs-settle-from">{t.from}</span>
                  <span className="mjs-settle-arrow">→</span>
                  <span className="mjs-settle-to">{t.to}</span>
                  <span className="mjs-settle-amount">¥{t.amount.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
          {yenGap !== 0 && (
            <p className="mjs-settle-warn">
              点数の合計が 0 になっていないので、精算が {signed(yenGap)}円 合いません。色の付いた行を確かめてください。
            </p>
          )}
        </div>

        <p className="mjs-note">
          行の合計が 0 でなければ色が付きます（多い = 緑、少ない = 赤）。半荘の番号をタップすると、その行を消せます。
        </p>
      </div>

      <div className="chip-reset-section">
        <button
          className="chip-reset-btn"
          onClick={() => setConfirm({ kind: 'reset' })}
          disabled={!hasContent}
        >
          リセット
        </button>
      </div>

      {confirm && (
        <div className="confirm-overlay" onClick={() => setConfirm(null)}>
          <div className="confirm-modal" onClick={e => e.stopPropagation()}>
            <p>
              {confirm.kind === 'reset'
                ? '名前・全ての点数・場代を消しますか？'
                : `第${confirm.index + 1}半荘の行を消しますか？`}
            </p>
            <div className="confirm-buttons">
              <button className="confirm-cancel" onClick={() => setConfirm(null)}>
                キャンセル
              </button>
              <button
                className="confirm-ok"
                onClick={() => {
                  if (confirm.kind === 'reset') setData(freshData(rate))
                  else removeRow(confirm.index)
                  setConfirm(null)
                }}
              >
                消す
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
