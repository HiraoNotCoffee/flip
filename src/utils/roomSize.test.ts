// Discord のメッセージは2000文字までしかない。アドオン履歴は増え続けるので、
// 現実的な卓が本当に収まるのかを機械的に見張る。
import { describe, it, expect } from 'vitest'
import { embedState, MESSAGE_LIMIT } from './discordSync'
import { boxToWire, deriveKey, generateCode, randomSalt, seal, open } from './roomCrypto'
import { createAddon, newAddonId, withConfirm, MAX_ADDONS, type Addon } from './addons'

/** ヘッダーと参加リンクで使う分。これを引いた残りが同期データの取り分。 */
const READABLE = [
  '## 🃏 チップ計算',
  '🔒 中身はコードを知っている人だけが開けます。',
  '',
  '-# 更新 <t:1786554157:T>',
  '▶ アプリで開く: https://hiraonotcoffee.github.io/flip/#dc=' + 'M'.repeat(180),
  '-# 開いたあと、ホストから聞いたコードを入力してください。',
].join('\n')

function buildRoom(playerCount: number, addonCount: number) {
  const players: Record<string, unknown> = {}
  const members: Record<string, unknown> = {}
  const playerIds: string[] = []
  const clientIds: string[] = []

  for (let i = 0; i < playerCount; i++) {
    const pid = `p${i.toString(36)}${((i * 7) % 1296).toString(36)}`
    const cid = `cab${i.toString(36)}de`
    playerIds.push(pid)
    clientIds.push(cid)
    players[pid] = {
      name: `プレイヤー${i + 1}`,
      rebuyCount: 2.5,
      finalChips: 47500,
      order: i,
    }
    members[cid] = {
      name: `プレイヤー${i + 1}`,
      status: 'approved',
      at: 1786554157000 + i * 1000,
      playerId: pid,
    }
  }

  // 全員がすべての行を確認済み＝いちばん重い状態
  let book: { addons?: Record<string, Addon> } = {}
  for (let i = 0; i < addonCount; i++) {
    const at = 1786554157000 + i * 60000
    const id = newAddonId() + i.toString(36)
    book = {
      addons: {
        ...(book.addons ?? {}),
        [id]: createAddon(playerIds[i % playerCount], clientIds[i % playerCount], 0.5, at),
      },
    }
    for (const cid of clientIds) book = { addons: withConfirm(book, id, cid, at + 120000) }
  }

  return {
    chipsPer100BB: 30000,
    buyInYen: 3000,
    rake: 0,
    hostId: clientIds[0],
    players,
    members,
    addons: book.addons,
  }
}

async function messageLengthFor(doc: unknown): Promise<number> {
  const salt = randomSalt()
  const key = await deriveKey(generateCode(), salt)
  const box = await seal(doc, key, salt)
  return embedState(READABLE, boxToWire(box)).length
}

describe('Discord message budget', () => {
  it('fits a full 8-player table with a full add-on log', async () => {
    const length = await messageLengthFor(buildRoom(8, MAX_ADDONS))
    // 収まらないと同期そのものが壊れるので、ここは落ちてもらわないと困る
    expect(length).toBeLessThanOrEqual(MESSAGE_LIMIT)
  })

  it('fits a typical 6-player night', async () => {
    const length = await messageLengthFor(buildRoom(6, 24))
    expect(length).toBeLessThanOrEqual(MESSAGE_LIMIT)
  })

  it('compression is what makes it fit (and it round-trips)', async () => {
    const doc = buildRoom(8, MAX_ADDONS)
    const salt = randomSalt()
    const code = generateCode()
    const key = await deriveKey(code, salt)
    const box = await seal(doc, key, salt)

    expect(box.z).toBe(1)
    const rawJsonLength = JSON.stringify(doc).length
    const packedLength = box.c.length
    expect(packedLength).toBeLessThan(rawJsonLength)

    expect(await open(box, key)).toEqual(doc)
  })

  it('trims the oldest rows once the log is full', async () => {
    const { withAddon, createAddon } = await import('./addons')
    let book: { addons?: Record<string, ReturnType<typeof createAddon>> } = {}
    for (let i = 0; i < MAX_ADDONS + 10; i++) {
      book = { addons: withAddon(book, `a${i}`, createAddon('p1', 'c1', 0.5, 1000 + i)) }
    }
    const ids = Object.keys(book.addons ?? {})
    expect(ids).toHaveLength(MAX_ADDONS)
    expect(ids).not.toContain('a0') // いちばん古いものが落ちている
    expect(ids).toContain(`a${MAX_ADDONS + 9}`) // 最新は残っている
  })
})
