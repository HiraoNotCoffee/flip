import { describe, it, expect } from 'vitest'
import {
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
  const state = { c: 30000, players: { pa: { name: '田中さん', chips: 42000 } } }

  it('round-trips through a Discord message body', () => {
    const message = embedState('🃏 チップ計算\n田中さん +¥12,000', state)
    expect(message).toContain('🃏 チップ計算')
    expect(extractState(message)?.state).toEqual(state)
  })

  it('survives multi-byte text and newlines in the readable part', () => {
    const readable = '精算\n山田 → 田中 ¥5,000\n▶ アプリで開く: https://example.com/#dc=abc'
    expect(extractState(embedState(readable, state))?.state).toEqual(state)
  })

  it('keeps the message within the Discord limit by trimming the readable part', () => {
    const message = embedState('あ'.repeat(5000), state)
    expect(message.length).toBeLessThanOrEqual(MESSAGE_LIMIT)
    expect(extractState(message)?.state).toEqual(state)
  })

  it('throws when even the state alone would not fit', () => {
    const huge = { players: Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [`p${i}`, { name: `プレイヤー${i}`, chips: i }])
    ) }
    expect(() => embedState('x', huge)).toThrow(DiscordSyncError)
  })

  it('returns null when the message has no state', () => {
    expect(extractState('ただのメッセージ')).toBeNull()
    expect(extractState('-# ⟨sync⟩ v9.abc')).toBeNull()
    expect(extractState('-# ⟨sync⟩ v2.!!!not-base64!!!')).toBeNull()
  })

  it('reads the last state line when someone quotes an older one', () => {
    const older = embedState('古い', { c: 1 })
    const newer = embedState(`${older}\n引用`, { c: 2 })
    expect(extractState(newer)?.state).toEqual({ c: 2 })
  })
})

describe('state version', () => {
  it('still reads pre-encryption (v1) messages so old rooms keep working', () => {
    const json = JSON.stringify({ rake: 7 })
    const b64 = Buffer.from(json, 'utf-8').toString('base64url')
    const legacy = `## 古いメッセージ\n-# ⟨sync⟩ v1.${b64}`
    expect(extractState(legacy)).toEqual({ version: 'v1', state: { rake: 7 } })
  })
})
