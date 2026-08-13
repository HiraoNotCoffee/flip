import { describe, it, expect } from 'vitest'
import {
  decodeLegacyState,
  decodeRoomRef,
  DiscordSyncError,
  embedState,
  encodeRoomRef,
  extractState,
  MESSAGE_LIMIT,
  parseWebhookUrl,
  roomRefFromHash,
  type RoomRef,
} from './discordSync'

const REF: RoomRef = {
  id: '1234567890123456789',
  token: 'aBcDeF-_0123456789abcdefghijklmnopqrstuvwxyz',
  messageId: '9876543210987654321',
}

describe('parseWebhookUrl', () => {
  it('accepts the URL Discord gives you', () => {
    expect(parseWebhookUrl(`https://discord.com/api/webhooks/${REF.id}/${REF.token}`)).toEqual({
      id: REF.id,
      token: REF.token,
    })
  })

  it('accepts versioned and legacy hosts, and stray whitespace', () => {
    expect(parseWebhookUrl(`  https://discord.com/api/v10/webhooks/${REF.id}/${REF.token}  `))
      .toEqual({ id: REF.id, token: REF.token })
    expect(parseWebhookUrl(`https://discordapp.com/api/webhooks/${REF.id}/${REF.token}`))
      .toEqual({ id: REF.id, token: REF.token })
  })

  it('rejects anything else', () => {
    expect(parseWebhookUrl('')).toBeNull()
    expect(parseWebhookUrl('https://example.com/api/webhooks/1/abc')).toBeNull()
    expect(parseWebhookUrl('https://discord.com/api/webhooks/notanid/abc')).toBeNull()
  })
})

describe('share link', () => {
  it('round-trips a room reference', () => {
    expect(decodeRoomRef(encodeRoomRef(REF))).toEqual(REF)
  })

  it('produces a URL-safe payload', () => {
    expect(encodeRoomRef(REF)).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('reads the reference back out of a hash', () => {
    expect(roomRefFromHash(`#dc=${encodeRoomRef(REF)}`)).toEqual(REF)
    expect(roomRefFromHash(`#page=chip&dc=${encodeRoomRef(REF)}`)).toEqual(REF)
  })

  it('returns null for junk', () => {
    expect(roomRefFromHash('#dc=!!!!')).toBeNull()
    expect(roomRefFromHash('#nothing')).toBeNull()
    expect(decodeRoomRef('bm90LWEtcmVm')).toBeNull()
  })
})

describe('embedState / extractState', () => {
  const payload = '1.c2FsdA.aXY.Y2lwaGVydGV4dA'

  it('round-trips through a Discord message body', () => {
    const message = embedState('🃏 チップ計算\n🔒 コードが要ります', payload)
    expect(message).toContain('🃏 チップ計算')
    expect(extractState(message)).toEqual({ version: 'v2', payload })
  })

  it('survives multi-byte text and newlines in the readable part', () => {
    const readable = '🔒 中身はコードを知っている人だけ\n▶ アプリで開く: https://example.com/#dc=abc'
    expect(extractState(embedState(readable, payload))?.payload).toBe(payload)
  })

  it('does not waste room by encoding the payload a second time', () => {
    // 箱の中身はすでに base64 なので、そのまま載る（太らない）ことを確かめる
    expect(embedState('x', payload)).toContain(payload)
  })

  it('keeps the message within the Discord limit by trimming the readable part', () => {
    const message = embedState('あ'.repeat(5000), payload)
    expect(message.length).toBeLessThanOrEqual(MESSAGE_LIMIT)
    expect(extractState(message)?.payload).toBe(payload)
  })

  it('throws when even the payload alone would not fit', () => {
    expect(() => embedState('x', 'A'.repeat(MESSAGE_LIMIT + 1))).toThrow(DiscordSyncError)
  })

  it('returns null when the message has no state', () => {
    expect(extractState('ただのメッセージ')).toBeNull()
    expect(extractState('-# ⟨sync⟩ v9.abc')).toBeNull()
    expect(extractState('-# ⟨sync⟩ v2.')).toBeNull()
  })

  it('reads the last state line when someone quotes an older one', () => {
    const older = embedState('古い', '1.a.b.OLD')
    const newer = embedState(`${older}
引用`, '1.a.b.NEW')
    expect(extractState(newer)?.payload).toBe('1.a.b.NEW')
  })
})

describe('state version', () => {
  it('still reads pre-encryption (v1) messages so old rooms keep working', () => {
    const json = JSON.stringify({ rake: 7 })
    const b64 = Buffer.from(json, 'utf-8').toString('base64url')
    const legacy = `## 古いメッセージ
-# ⟨sync⟩ v1.${b64}`
    const found = extractState(legacy)
    expect(found?.version).toBe('v1')
    expect(decodeLegacyState(found!.payload)).toEqual({ rake: 7 })
  })

  it('writes v2 (encrypted) even for a room that was read as v1', () => {
    expect(extractState(embedState('x', '1.a.b.c'))?.version).toBe('v2')
  })
})
