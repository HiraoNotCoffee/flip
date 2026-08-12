import { describe, it, expect } from 'vitest'
import { applyPatch, diffPaths, flatten, unflatten, type Doc } from './docDiff'

describe('flatten / unflatten', () => {
  const doc: Doc = {
    chipsPer100BB: 30000,
    rake: 0,
    players: {
      pa: { name: '田中', rebuyCount: 1.5, finalChips: 42000, order: 0 },
      pb: { name: '', rebuyCount: 1, finalChips: 0, order: 1 },
    },
  }

  it('round-trips', () => {
    expect(unflatten(flatten(doc))).toEqual(doc)
  })

  it('produces slash-joined paths', () => {
    expect(flatten(doc)['players/pa/finalChips']).toBe(42000)
  })

  it('drops null values when rebuilding', () => {
    expect(unflatten({ a: 1, 'b/c': null })).toEqual({ a: 1 })
  })
})

describe('diffPaths', () => {
  const base: Doc = {
    rake: 0,
    players: { pa: { name: 'A', finalChips: 100 }, pb: { name: 'B', finalChips: 200 } },
  }

  it('returns only the changed leaves', () => {
    const next: Doc = {
      rake: 0,
      players: { pa: { name: 'A', finalChips: 150 }, pb: { name: 'B', finalChips: 200 } },
    }
    expect(diffPaths(base, next)).toEqual({ 'players/pa/finalChips': 150 })
  })

  it('returns nothing when nothing changed', () => {
    expect(diffPaths(base, structuredClone(base))).toEqual({})
  })

  it('nulls out every leaf of a removed player', () => {
    const next: Doc = { rake: 0, players: { pa: { name: 'A', finalChips: 100 } } }
    expect(diffPaths(base, next)).toEqual({
      'players/pb/name': null,
      'players/pb/finalChips': null,
    })
  })

  it('writes every leaf of an added player', () => {
    const next: Doc = {
      rake: 0,
      players: {
        pa: { name: 'A', finalChips: 100 },
        pb: { name: 'B', finalChips: 200 },
        pc: { name: 'C', finalChips: 0 },
      },
    }
    expect(diffPaths(base, next)).toEqual({
      'players/pc/name': 'C',
      'players/pc/finalChips': 0,
    })
  })
})

describe('applyPatch', () => {
  const remote: Doc = {
    rake: 0,
    players: { pa: { name: 'A', finalChips: 100 }, pb: { name: 'B', finalChips: 200 } },
  }

  it('keeps the other side edits and only overwrites my paths', () => {
    // 相手が pb のチップを直した状態に、自分の pa の名前変更を載せる
    const theirs = applyPatch(remote, { 'players/pb/finalChips': 555 })
    const merged = applyPatch(theirs, { 'players/pa/name': 'あきら' })
    expect(merged).toEqual({
      rake: 0,
      players: {
        pa: { name: 'あきら', finalChips: 100 },
        pb: { name: 'B', finalChips: 555 },
      },
    })
  })

  it('removes a whole branch when a parent path is nulled', () => {
    expect(applyPatch(remote, { 'players/pb': null })).toEqual({
      rake: 0,
      players: { pa: { name: 'A', finalChips: 100 } },
    })
  })

  it('removes leaves one by one', () => {
    const patch = { 'players/pb/name': null, 'players/pb/finalChips': null }
    expect(applyPatch(remote, patch)).toEqual({
      rake: 0,
      players: { pa: { name: 'A', finalChips: 100 } },
    })
  })

  it('round-trips a diff: applying the diff to prev reproduces next', () => {
    const next: Doc = {
      rake: 12,
      players: { pa: { name: 'A2', finalChips: 100 }, pc: { name: 'C', finalChips: 7 } },
    }
    expect(applyPatch(remote, diffPaths(remote, next))).toEqual(next)
  })
})
