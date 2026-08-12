import { describe, it, expect } from 'vitest'
import {
  accessOf,
  approvedMembers,
  canView,
  pendingMembers,
  withMember,
  withoutMember,
  type MemberBook,
} from './roomMembers'

const book: MemberBook = {
  hostId: 'chost',
  members: {
    chost: { name: 'ホスト', status: 'approved', at: 100 },
    capproved: { name: '田中', status: 'approved', at: 300 },
    cearly: { name: '山田', status: 'pending', at: 200 },
    clate: { name: '佐藤', status: 'pending', at: 400 },
    cdenied: { name: '知らない人', status: 'denied', at: 500 },
  },
}

describe('accessOf', () => {
  it('recognises the host', () => {
    expect(accessOf(book, 'chost')).toBe('host')
  })

  it('reports each member status', () => {
    expect(accessOf(book, 'capproved')).toBe('approved')
    expect(accessOf(book, 'cearly')).toBe('pending')
    expect(accessOf(book, 'cdenied')).toBe('denied')
  })

  it('reports someone who has not applied yet', () => {
    expect(accessOf(book, 'cstranger')).toBe('none')
  })

  it('treats pre-approval rooms as open so nobody gets locked out', () => {
    // hostId を持たない＝承認機能より前に作られたルーム
    expect(accessOf({ members: {} }, 'anyone')).toBe('approved')
    expect(accessOf({}, 'anyone')).toBe('approved')
  })

  it('falls back to pending for an unknown status value', () => {
    const odd = { hostId: 'chost', members: { cx: { name: 'x', status: 'weird', at: 1 } } }
    expect(accessOf(odd as unknown as MemberBook, 'cx')).toBe('none')
  })
})

describe('canView', () => {
  it('lets the host and approved members through, and nobody else', () => {
    expect(canView(book, 'chost')).toBe(true)
    expect(canView(book, 'capproved')).toBe(true)
    expect(canView(book, 'cearly')).toBe(false)
    expect(canView(book, 'cdenied')).toBe(false)
    expect(canView(book, 'cstranger')).toBe(false)
  })
})

describe('lists', () => {
  it('orders pending members oldest request first', () => {
    expect(pendingMembers(book).map(e => e.id)).toEqual(['cearly', 'clate'])
  })

  it('puts the host first among approved members', () => {
    expect(approvedMembers(book).map(e => e.id)).toEqual(['chost', 'capproved'])
  })

  it('handles an empty book', () => {
    expect(pendingMembers({})).toEqual([])
    expect(approvedMembers({})).toEqual([])
  })
})

describe('withMember / withoutMember', () => {
  it('adds without touching the original', () => {
    const next = withMember(book, 'cnew', { name: '新人', status: 'pending', at: 900 })
    expect(next.cnew.name).toBe('新人')
    expect(book.members?.cnew).toBeUndefined()
    expect(Object.keys(next)).toHaveLength(6)
  })

  it('approving only changes that one member', () => {
    const current = book.members!.cearly
    const next = withMember(book, 'cearly', { ...current, status: 'approved' })
    expect(next.cearly.status).toBe('approved')
    expect(next.cearly.name).toBe('山田')
    expect(next.clate.status).toBe('pending')
    expect(accessOf({ ...book, members: next }, 'cearly')).toBe('approved')
  })

  it('removes without touching the original', () => {
    const next = withoutMember(book, 'cdenied')
    expect(next.cdenied).toBeUndefined()
    expect(book.members?.cdenied).toBeDefined()
    expect(accessOf({ ...book, members: next }, 'cdenied')).toBe('none')
  })
})
