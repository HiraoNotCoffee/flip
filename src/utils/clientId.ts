// この端末（このブラウザ）を表すID。
//
// ブラウザからは MAC アドレスなどの端末固有IDは取得できないので、初回にランダムな
// IDを作って localStorage に置いている。サイトデータを消したり、別ブラウザ・
// シークレットウィンドウで開くと別IDになる＝別人扱いになる点は避けられない。

const STORAGE_KEY = 'flip-client-id'
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

// 短さが効く: このIDはアドオン1件ごとの確認記録にメンバー分だけ載るので、
// 1文字削るだけで Discord のメッセージ数十文字ぶんの節約になる。
function randomId(): string {
  const bytes = new Uint8Array(5)
  crypto.getRandomValues(bytes)
  let id = 'c'
  for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length]
  return id
}

let cached: string | null = null

export function getClientId(): string {
  if (cached) return cached
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      cached = saved
      return saved
    }
  } catch {
    // localStorage が使えない環境ではセッション内だけ有効なIDにする
  }
  const created = randomId()
  cached = created
  try {
    localStorage.setItem(STORAGE_KEY, created)
  } catch {
    // ignore
  }
  return created
}
