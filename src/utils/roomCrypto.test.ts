import { describe, it, expect } from 'vitest'
import {
  CODE_LENGTH,
  deriveKey,
  formatCode,
  generateCode,
  normalizeCode,
  open,
  randomSalt,
  saltOf,
  seal,
  WrongCodeError,
} from './roomCrypto'

describe('code', () => {
  it('generates codes of the right length from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode()
      expect(code).toHaveLength(CODE_LENGTH)
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/)
    }
  })

  it('does not repeat itself', () => {
    const codes = new Set(Array.from({ length: 300 }, () => generateCode()))
    expect(codes.size).toBe(300)
  })

  it('accepts what a human would actually type', () => {
    expect(normalizeCode('abcd-efgh')).toBe('ABCDEFGH')
    expect(normalizeCode(' ABCD EFGH ')).toBe('ABCDEFGH')
    expect(normalizeCode('ABCDEFGHIJK')).toBe('ABCDEFGH')
  })

  it('shows the code in readable halves', () => {
    expect(formatCode('K7M2QX9F')).toBe('K7M2-QX9F')
  })
})

describe('seal / open', () => {
  const doc = {
    chipsPer100BB: 30000,
    players: { pa: { name: '田中さん', finalChips: 42000 } },
  }

  it('round-trips with the right code', async () => {
    const code = generateCode()
    const salt = randomSalt()
    const key = await deriveKey(code, salt)
    const box = await seal(doc, key, salt)
    expect(await open(box, key)).toEqual(doc)
  })

  it('hides the contents from anyone reading the message', async () => {
    const salt = randomSalt()
    const key = await deriveKey(generateCode(), salt)
    const box = await seal(doc, key, salt)
    const wire = JSON.stringify(box)
    expect(wire).not.toContain('田中')
    expect(wire).not.toContain('42000')
    expect(wire).not.toContain('chipsPer100BB')
  })

  it('rejects the wrong code', async () => {
    const salt = randomSalt()
    const box = await seal(doc, await deriveKey('ABCDEFGH', salt), salt)
    const wrongKey = await deriveKey('ABCDEFGJ', salt)
    await expect(open(box, wrongKey)).rejects.toThrow(WrongCodeError)
  })

  it('rejects a tampered ciphertext', async () => {
    const code = generateCode()
    const salt = randomSalt()
    const key = await deriveKey(code, salt)
    const box = await seal(doc, key, salt)
    const flipped = box.c.slice(0, -2) + (box.c.endsWith('A') ? 'BB' : 'AA')
    await expect(open({ ...box, c: flipped }, key)).rejects.toThrow(WrongCodeError)
  })

  it('is case- and hyphen-insensitive about the code', async () => {
    const salt = randomSalt()
    const box = await seal(doc, await deriveKey('K7M2QX9F', salt), salt)
    const typed = await deriveKey('k7m2-qx9f', salt)
    expect(await open(box, typed)).toEqual(doc)
  })

  it('carries its own salt so a joiner can rebuild the key from the code alone', async () => {
    const code = generateCode()
    const salt = randomSalt()
    const box = await seal(doc, await deriveKey(code, salt), salt)

    // 参加者はメッセージの箱だけを持っている状態から鍵を作り直す
    const rebuilt = await deriveKey(code, saltOf(box))
    expect(await open(box, rebuilt)).toEqual(doc)
  })

  it('uses a fresh iv per write, so identical data does not produce identical ciphertext', async () => {
    const salt = randomSalt()
    const key = await deriveKey(generateCode(), salt)
    const a = await seal(doc, key, salt)
    const b = await seal(doc, key, salt)
    expect(a.i).not.toBe(b.i)
    expect(a.c).not.toBe(b.c)
    expect(await open(b, key)).toEqual(doc)
  })

  it('does not let a different room key open this box', async () => {
    const code = generateCode()
    const saltA = randomSalt()
    const box = await seal(doc, await deriveKey(code, saltA), saltA)
    // 同じコードでも salt が違えば別の鍵になる
    const otherRoomKey = await deriveKey(code, randomSalt())
    await expect(open(box, otherRoomKey)).rejects.toThrow(WrongCodeError)
  })
})
