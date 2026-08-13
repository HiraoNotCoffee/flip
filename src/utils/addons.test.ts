import { describe, it, expect } from 'vitest'
import {
  addonHistory,
  addonsFor,
  confirmedBy,
  createAddon,
  hasConfirmed,
  hasUnconfirmed,
  MAX_ADDONS,
  newAddonId,
  stampToMs,
  toStamp,
  unconfirmedFor,
  withAddon,
  withConfirm,
  withoutAddon,
  type Addon,
} from './addons'

const T = 1786615177000

function book(...rows: [string, Addon][]) {
  return { addons: Object.fromEntries(rows) }
}

describe('createAddon', () => {
  it('records seconds, not milliseconds, to keep the message small', () => {
    const addon = createAddon('p1', 'chost', 0.5, T)
    expect(addon.at).toBe(toStamp(T))
    expect(String(addon.at)).toHaveLength(10)
  })

  it('counts the person who added it as already having confirmed', () => {
    const addon = createAddon('p1', 'chost', 0.5, T)
    expect(hasConfirmed(addon, 'chost')).toBe(true)
    expect(hasConfirmed(addon, 'cother')).toBe(false)
  })
})

describe('hasConfirmed', () => {
  it('treats an immediate confirmation (0 minutes later) as confirmed', () => {
    // 確認時刻は「何分後か」なので即確認は 0 になる。真偽値で見ると未確認扱いになる
    const addon = createAddon('p1', 'chost', 0.5, T)
    const confirmed = withConfirm(book(['a1', addon]), 'a1', 'cother', T + 5_000).a1
    expect(confirmed.confirms?.cother).toBe(0)
    expect(hasConfirmed(confirmed, 'cother')).toBe(true)
  })
})

describe('unconfirmed', () => {
  const mine = createAddon('p1', 'cme', 0.5, T)
  const theirs = createAddon('p2', 'cyou', 1, T + 60_000)
  const base = book(['a1', mine], ['a2', theirs])

  it('does not ask me to confirm my own additions', () => {
    expect(unconfirmedFor(base, 'cme').map(e => e.id)).toEqual(['a2'])
  })

  it('flags the player who has an unconfirmed row', () => {
    expect(hasUnconfirmed(base, 'p2', 'cme')).toBe(true)
    expect(hasUnconfirmed(base, 'p1', 'cme')).toBe(false)
  })

  it('clears once I confirm', () => {
    const after = { addons: withConfirm(base, 'a2', 'cme', T + 120_000) }
    expect(unconfirmedFor(after, 'cme')).toEqual([])
    expect(hasUnconfirmed(after, 'p2', 'cme')).toBe(false)
  })

  it('is per person — my confirmation does not clear it for someone else', () => {
    const after = { addons: withConfirm(base, 'a2', 'cme', T + 120_000) }
    expect(unconfirmedFor(after, 'cthird').map(e => e.id)).toEqual(['a2', 'a1'])
  })
})

describe('confirmedBy', () => {
  it('rebuilds real times from the stored minute offsets', () => {
    const addon = createAddon('p1', 'cme', 0.5, T)
    const after = withConfirm(book(['a1', addon]), 'a1', 'cyou', T + 3 * 60_000)
    const checks = confirmedBy(after.a1)
    expect(checks.map(c => c.clientId)).toEqual(['cme', 'cyou'])
    expect(checks[1].at).toBe(stampToMs(toStamp(T) + 180))
  })
})

describe('history order', () => {
  it('shows newest first, and filters per player', () => {
    const b = book(
      ['a1', createAddon('p1', 'cme', 0.5, T)],
      ['a2', createAddon('p2', 'cyou', 0.5, T + 60_000)],
      ['a3', createAddon('p1', 'cme', 1, T + 120_000)]
    )
    expect(addonHistory(b).map(e => e.id)).toEqual(['a3', 'a2', 'a1'])
    expect(addonsFor(b, 'p1').map(e => e.id)).toEqual(['a3', 'a1'])
  })
})

describe('withAddon / withoutAddon', () => {
  it('drops the oldest rows once the log is full', () => {
    let b: { addons?: Record<string, Addon> } = {}
    for (let i = 0; i < MAX_ADDONS + 5; i++) {
      b = { addons: withAddon(b, `a${i}`, createAddon('p1', 'cme', 0.5, T + i * 1000)) }
    }
    const ids = Object.keys(b.addons ?? {})
    expect(ids).toHaveLength(MAX_ADDONS)
    expect(ids).not.toContain('a0')
    expect(ids).toContain(`a${MAX_ADDONS + 4}`)
  })

  it('removes a single row without touching the rest', () => {
    const b = book(['a1', createAddon('p1', 'cme', 0.5, T)], ['a2', createAddon('p1', 'cme', 1, T)])
    const after = withoutAddon(b, 'a1')
    expect(Object.keys(after)).toEqual(['a2'])
    expect(Object.keys(b.addons)).toHaveLength(2)
  })
})

describe('newAddonId', () => {
  it('does not collide when rows are created back to back', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newAddonId()))
    expect(ids.size).toBe(500)
  })
})
