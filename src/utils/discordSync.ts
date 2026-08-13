// Discord を「共有データベース」として使うための薄いラッパー。
//
// 仕組み: チャンネルの Webhook で1通メッセージを投稿し、それを状態の保存先にする。
// 各端末はそのメッセージを数秒おきに読み（GET）、自分の変更を書き戻す（PATCH）。
// サーバーもアカウントも要らず、Discord のチャンネルにも常に最新の収支が出る。
//
// Webhook のメッセージ操作エンドポイントは Webhook トークンだけで叩けて、
// discord.com/api は CORS を許可しているのでブラウザから直接呼べる。

const API_BASE = 'https://discord.com/api/v10'

/** メッセージ末尾に忍ばせる機械可読な状態行の目印。 */
const STATE_PREFIX = '-# ⟨sync⟩ '
/** v1 = 平文（コード導入前）、v2 = コードで暗号化。書き込みは常に v2。 */
const STATE_VERSION = 'v2'
const READABLE_VERSIONS = ['v1', 'v2'] as const
export type StateVersion = (typeof READABLE_VERSIONS)[number]

/** Discord のメッセージ本文の上限。 */
export const MESSAGE_LIMIT = 2000

export interface WebhookRef {
  id: string
  token: string
}

export interface RoomRef extends WebhookRef {
  messageId: string
}

export class DiscordSyncError extends Error {
  kind: 'network' | 'rate-limit' | 'not-found' | 'unauthorized' | 'too-long' | 'other'
  retryAfterMs: number

  constructor(
    message: string,
    kind: DiscordSyncError['kind'] = 'other',
    retryAfterMs = 0
  ) {
    super(message)
    this.name = 'DiscordSyncError'
    this.kind = kind
    this.retryAfterMs = retryAfterMs
  }
}

// ------------------------------------------------------------- webhook URL

/**
 * Discord からコピーしたウェブフックURLを id / token に分解する。
 * 例: https://discord.com/api/webhooks/123456789/abcdef...
 */
export function parseWebhookUrl(input: string): WebhookRef | null {
  const match = /(?:discord|discordapp)\.com\/api(?:\/v\d+)?\/webhooks\/(\d+)\/([\w-]+)/.exec(
    input.trim()
  )
  if (!match) return null
  return { id: match[1], token: match[2] }
}

// ------------------------------------------------------------ base64url

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

// -------------------------------------------------------------- share link

/**
 * 参加リンクに載せる形（webhook id / token / message id / 任意でコード）。
 *
 * コードを入れるとタップだけで参加できるが、そのリンクを見られる人は中身も
 * 見られるということでもある。コードなしのリンクも作れるようにしてある。
 */
export function encodeRoomRef(ref: RoomRef, code?: string): string {
  const parts = [ref.id, ref.token, ref.messageId]
  if (code) parts.push(code)
  return b64urlEncode(parts.join('.'))
}

export function decodeRoomRef(encoded: string): (RoomRef & { code?: string }) | null {
  try {
    const parts = b64urlDecode(encoded).split('.')
    if (parts.length < 3 || parts.length > 4) return null
    const [id, token, messageId, code] = parts
    if (!/^\d+$/.test(id) || !token || !/^\d+$/.test(messageId)) return null
    return code ? { id, token, messageId, code } : { id, token, messageId }
  } catch {
    return null
  }
}

export function buildJoinUrl(ref: RoomRef, code?: string): string {
  const base = `${window.location.origin}${window.location.pathname}`
  return `${base}#dc=${encodeRoomRef(ref, code)}`
}

/** URL のハッシュから参加情報を取り出す。コード入りならそれも返す。 */
export function roomRefFromHash(hash: string): (RoomRef & { code?: string }) | null {
  const match = /[#&]dc=([A-Za-z0-9_-]+)/.exec(hash)
  return match ? decodeRoomRef(match[1]) : null
}

// ------------------------------------------------------- 状態の埋め込み

/**
 * 人が読む本文の末尾に、機械可読な状態を1行だけ足す。
 * payload は改行を含まない不透明な文字列（v2 なら暗号化済みの箱の電文）。
 * ここでは中身を解釈しない。
 */
export function embedState(readable: string, payload: string): string {
  const line = `${STATE_PREFIX}${STATE_VERSION}.${payload}`
  const body = `${readable.trimEnd()}\n${line}`
  if (body.length <= MESSAGE_LIMIT) return body
  // 読み物部分を削ってでも状態は必ず載せる（状態が欠けると同期できないため）
  if (line.length > MESSAGE_LIMIT) {
    throw new DiscordSyncError(
      '人数が多すぎて Discord の1メッセージに収まりません',
      'too-long'
    )
  }
  const room = MESSAGE_LIMIT - line.length - 2
  return `${readable.slice(0, room).trimEnd()}\n${line}`
}

/** メッセージ本文から状態の電文を取り出す。見つからなければ null。 */
export function extractState(content: string): { version: StateVersion; payload: string } | null {
  const index = content.lastIndexOf(STATE_PREFIX)
  if (index < 0) return null
  const rest = content.slice(index + STATE_PREFIX.length).trim()
  const dot = rest.indexOf('.')
  if (dot < 0) return null
  const version = rest.slice(0, dot)
  if (!READABLE_VERSIONS.includes(version as StateVersion)) return null
  const payload = rest.slice(dot + 1)
  if (!payload) return null
  return { version: version as StateVersion, payload }
}

/** v1（暗号化前）のメッセージに入っていた平文をほどく。 */
export function decodeLegacyState<T>(payload: string): T | null {
  try {
    return JSON.parse(b64urlDecode(payload)) as T
  } catch {
    return null
  }
}

// ------------------------------------------------------------------- REST

interface DiscordMessage {
  id: string
  content: string
}

async function request(
  url: string,
  init: RequestInit,
  notFoundMessage: string
): Promise<DiscordMessage> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new DiscordSyncError('Discord に接続できませんでした（通信を確認してください）', 'network')
  }

  if (response.ok) {
    return (await response.json()) as DiscordMessage
  }

  if (response.status === 429) {
    const body = (await response.json().catch(() => ({}))) as { retry_after?: number }
    const retryAfterMs = Math.ceil((body.retry_after ?? 1) * 1000)
    throw new DiscordSyncError('Discord の制限中です（自動で再開します）', 'rate-limit', retryAfterMs)
  }
  if (response.status === 404) {
    throw new DiscordSyncError(notFoundMessage, 'not-found')
  }
  if (response.status === 401 || response.status === 403) {
    throw new DiscordSyncError(
      'ウェブフックが拒否されました（URLが違うか、削除された可能性）',
      'unauthorized'
    )
  }
  throw new DiscordSyncError(`Discord エラー (${response.status})`, 'other')
}

const WEBHOOK_GONE = 'このウェブフックが見つかりません（URLが違うか、Discord 側で削除された可能性）'
const MESSAGE_GONE = '共有メッセージが見つかりません（Discord 側で削除された可能性）'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** 状態を入れるメッセージを新規投稿し、そのメッセージIDを返す。 */
export async function createRoomMessage(hook: WebhookRef, content: string): Promise<string> {
  const message = await request(`${API_BASE}/webhooks/${hook.id}/${hook.token}?wait=true`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      content,
      username: 'チップ計算',
      allowed_mentions: { parse: [] },
    }),
  }, WEBHOOK_GONE)
  return message.id
}

export async function readRoomMessage(ref: RoomRef): Promise<string> {
  const message = await request(
    `${API_BASE}/webhooks/${ref.id}/${ref.token}/messages/${ref.messageId}`,
    { method: 'GET' },
    MESSAGE_GONE
  )
  return message.content
}

export async function writeRoomMessage(ref: RoomRef, content: string): Promise<void> {
  await request(`${API_BASE}/webhooks/${ref.id}/${ref.token}/messages/${ref.messageId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  }, MESSAGE_GONE)
}
