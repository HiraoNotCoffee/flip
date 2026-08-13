// 共有ルームの中身をコード（合言葉）で暗号化する。
//
// 招待リンクには「どのメッセージか」しか入っていない。中身を読むには別途コードが要る。
// リンクを転送されただけの人や、チャンネルを眺めているだけの人には暗号文しか見えない。
//
// WebCrypto だけで完結する（ライブラリ不要）。
//   コード --PBKDF2(SHA-256, 30万回, salt)--> 鍵 --AES-GCM--> 暗号文

/** 見間違えやすい I / O / 0 / 1 を除いた32文字。 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
/** 8文字＝40ビット。PBKDF2 の30万回と合わせて、総当たりは現実的でない。 */
export const CODE_LENGTH = 8
const PBKDF2_ITERATIONS = 300_000
const SALT_BYTES = 16
const IV_BYTES = 12

export class WrongCodeError extends Error {
  constructor() {
    super('コードが違います')
    this.name = 'WrongCodeError'
  }
}

/** ランダムなコードを作る。剰余のかたよりが出ないよう、範囲外の値は引き直す。 */
export function generateCode(): string {
  const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length
  let code = ''
  const buffer = new Uint8Array(CODE_LENGTH * 2)
  while (code.length < CODE_LENGTH) {
    crypto.getRandomValues(buffer)
    for (const byte of buffer) {
      if (byte >= limit) continue
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
      if (code.length === CODE_LENGTH) break
    }
  }
  return code
}

/** 入力されたコードを正規化する（小文字・空白・ハイフンを吸収）。 */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH)
}

/** 読み上げやすいように4文字ずつ区切る。 */
export function formatCode(code: string): string {
  const normalized = normalizeCode(code)
  return normalized.length > 4
    ? `${normalized.slice(0, 4)}-${normalized.slice(4)}`
    : normalized
}

// ---------------------------------------------------------------- base64url

export function bytesToB64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, ch => ch.charCodeAt(0))
}

// -------------------------------------------------------------------- 鍵と箱

export function randomSalt(): Uint8Array {
  const salt = new Uint8Array(SALT_BYTES)
  crypto.getRandomValues(salt)
  return salt
}

/** コードから鍵を作る。重い処理なので呼び出し側で使い回すこと。 */
export async function deriveKey(code: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(normalizeCode(code)),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

// ------------------------------------------------------------------- 圧縮
// Discord のメッセージは2000文字までしかない。JSON はキー名が繰り返されるので
// よく縮む（アドオン履歴が伸びても収まるようにするために要る）。

function hasCompression(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'
}

async function streamBytes(
  bytes: Uint8Array,
  stream: ReadableWritablePair
): Promise<Uint8Array<ArrayBuffer>> {
  const blob = new Blob([bytes as unknown as BlobPart])
  const buffer = await new Response(blob.stream().pipeThrough(stream)).arrayBuffer()
  return new Uint8Array(buffer)
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return streamBytes(bytes, new CompressionStream('deflate-raw'))
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return streamBytes(bytes, new DecompressionStream('deflate-raw'))
}

/** 暗号文とその復号に要る情報をまとめた入れ物。メッセージにはこれを載せる。 */
export interface SealedBox {
  /** salt（base64url）。鍵を作り直すのに要るのでメッセージに残す。 */
  s: string
  /** 初期化ベクトル（base64url）。書き込むたびに変える。 */
  i: string
  /** 暗号文（base64url） */
  c: string
  /** 1 なら中身は deflate-raw で圧縮されている。 */
  z?: 1
}

export async function seal(value: unknown, key: CryptoKey, salt: Uint8Array): Promise<SealedBox> {
  const iv = new Uint8Array(IV_BYTES)
  crypto.getRandomValues(iv)

  let plaintext = new TextEncoder().encode(JSON.stringify(value))
  let compressed = false
  if (hasCompression()) {
    const packed = await deflate(plaintext)
    // まれに圧縮で増えることがあるので、小さくなったときだけ使う
    if (packed.length < plaintext.length) {
      plaintext = packed
      compressed = true
    }
  }

  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    plaintext as unknown as BufferSource
  )
  const box: SealedBox = {
    s: bytesToB64url(salt),
    i: bytesToB64url(iv),
    c: bytesToB64url(new Uint8Array(cipher)),
  }
  if (compressed) box.z = 1
  return box
}

/** 復号する。コードが違えば WrongCodeError（AES-GCM の認証タグが合わない）。 */
export async function open<T>(box: SealedBox, key: CryptoKey): Promise<T> {
  let plaintext: Uint8Array
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64urlToBytes(box.i) as unknown as BufferSource },
      key,
      b64urlToBytes(box.c) as unknown as BufferSource
    )
    plaintext = new Uint8Array(decrypted)
  } catch {
    throw new WrongCodeError()
  }
  try {
    if (box.z === 1) plaintext = await inflate(plaintext)
    return JSON.parse(new TextDecoder().decode(plaintext)) as T
  } catch {
    throw new WrongCodeError()
  }
}

/** メッセージに載っている箱から salt を取り出す。 */
export function saltOf(box: SealedBox): Uint8Array {
  return b64urlToBytes(box.s)
}

// ------------------------------------------------------------- 電文の形
// 箱の中身はすでに base64url なので、JSON にしてから base64 に掛け直すと
// それだけで33%太る。区切り文字でつないだ1本の文字列にしておく。

export function boxToWire(box: SealedBox): string {
  return `${box.z ?? 0}.${box.s}.${box.i}.${box.c}`
}

export function wireToBox(wire: string): SealedBox | null {
  const parts = wire.split('.')
  if (parts.length !== 4) return null
  const [z, s, i, c] = parts
  if (!s || !i || !c) return null
  const box: SealedBox = { s, i, c }
  if (z === '1') box.z = 1
  return box
}
