// 共有ドキュメントの差分ユーティリティ。
//
// 共有中はドキュメント全体を上書きするのではなく「自分が触った項目だけ」を
// 最新の相手側ドキュメントに載せ直す。こうすると、A さんが Player1 の名前を、
// B さんが Player2 のチップを同時に直しても互いの入力を潰さない。

export type Leaf = string | number | boolean | null
export interface Doc {
  [key: string]: Leaf | Doc | undefined
}

/** ネストしたオブジェクトを "a/b/c" → 値 の平坦なマップにする。 */
export function flatten(doc: Doc, prefix = ''): Record<string, Leaf> {
  const out: Record<string, Leaf> = {}
  for (const [key, value] of Object.entries(doc)) {
    if (value === undefined) continue
    const path = prefix ? `${prefix}/${key}` : key
    if (value !== null && typeof value === 'object') {
      Object.assign(out, flatten(value, path))
    } else {
      out[path] = value
    }
  }
  return out
}

/** flatten の逆。null 値のパスは「無かったこと」として扱う。 */
export function unflatten(flat: Record<string, Leaf>): Doc {
  const out: Doc = {}
  for (const [path, value] of Object.entries(flat)) {
    if (value === null) continue
    const parts = path.split('/')
    let node = out
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i]
      const child = node[key]
      if (child === null || typeof child !== 'object') node[key] = {}
      node = node[key] as Doc
    }
    node[parts[parts.length - 1]] = value
  }
  return out
}

/** prev → next で変化したパスだけを返す。消えたパスは null（＝削除）。 */
export function diffPaths(prev: Doc, next: Doc): Record<string, Leaf> {
  const before = flatten(prev)
  const after = flatten(next)
  const changed: Record<string, Leaf> = {}
  for (const [path, value] of Object.entries(after)) {
    if (before[path] !== value) changed[path] = value
  }
  for (const path of Object.keys(before)) {
    if (!(path in after)) changed[path] = null
  }
  return changed
}

/** base に自分の変更（パス→値、null は削除）を上書きして返す。 */
export function applyPatch(base: Doc, patch: Record<string, Leaf>): Doc {
  const flat = flatten(base)
  for (const [path, value] of Object.entries(patch)) {
    if (value === null) {
      // その枝ごと消す（players/pb を消したら配下も全部消える）
      for (const key of Object.keys(flat)) {
        if (key === path || key.startsWith(`${path}/`)) delete flat[key]
      }
    } else {
      flat[path] = value
    }
  }
  return unflatten(flat)
}
