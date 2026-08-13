// チップの追加（アドオン）の記録と、みんなによる確認。
//
// 「自分の分しか増やせない」「増やしたら他の人に知らせる」「あとから誰がいくつ
// 足したか追える」ようにするための台帳。1行＝1回のアドオンで、他の人がその行に
// チェックを入れると確認済みになる。

// Discord のメッセージ2000文字に収めるため、記録はできるだけ小さくする。
// いちばん効くのが時刻で、素の Date.now() は13桁ある。これが「1件 × 人数」ぶん
// 載るので、確認時刻は「その行から何分後か」という小さい数にしている。
export type Addon = {
  /** どのプレイヤーの分か（ChipPlayer.id） */
  player: string
  /** 誰が足したか（clientId） */
  by: string
  /** 足したバイイン数（0.5 単位） */
  delta: number
  /** 足した時刻（UNIX秒。ミリ秒だと3桁むだになる） */
  at: number
  /** 確認した人 clientId → その行から何分後に確認したか */
  confirms?: Record<string, number>
}

/** Date.now() を記録用の秒に。 */
export function toStamp(ms: number): number {
  return Math.floor(ms / 1000)
}

/** 記録用の秒を表示用のミリ秒に。 */
export function stampToMs(stamp: number): number {
  return stamp * 1000
}

export interface AddonBook {
  addons?: Record<string, Addon>
}

/**
 * 履歴の上限。Discord のメッセージ2000文字に収める必要があるため、超えたら
 * 古いものから落とす。実測では8人が全員確認済みの状態で
 * 40件=1699文字 / 50件=約1850文字 / 60件=2016文字（超過）だったので 50 にしている。
 * 上限に達したかどうかは画面に出す（黙って消えないように）。
 */
export const MAX_ADDONS = 50

let counter = 0

/**
 * 端末をまたいでぶつからないIDを作る。短くしたいが、別々の端末が同じ瞬間に
 * 足しても衝突しないだけの幅は要るので、秒＋乱数＋連番にしている。
 */
export function newAddonId(): string {
  counter = (counter + 1) % 36
  const random = Math.floor(Math.random() * 46656).toString(36)
  return `a${(Math.floor(Date.now() / 1000) % 1679616).toString(36)}${random}${counter.toString(36)}`
}

/** 追加した本人は自動で確認済みにする（自分がやったことは自分が知っている）。 */
export function createAddon(player: string, by: string, delta: number, atMs: number): Addon {
  return { player, by, delta, at: toStamp(atMs), confirms: { [by]: 0 } }
}

/** 新しい行を足しつつ、古すぎる行を落とした addons を返す。 */
export function withAddon(
  book: AddonBook,
  id: string,
  addon: Addon
): Record<string, Addon> {
  const next: Record<string, Addon> = { ...(book.addons ?? {}), [id]: addon }
  const ids = Object.keys(next)
  if (ids.length > MAX_ADDONS) {
    const oldestFirst = ids.sort((a, b) => (next[a].at ?? 0) - (next[b].at ?? 0))
    for (const old of oldestFirst.slice(0, ids.length - MAX_ADDONS)) delete next[old]
  }
  return next
}

/** その行に自分の確認チェックを入れた addons を返す。 */
export function withConfirm(
  book: AddonBook,
  id: string,
  clientId: string,
  atMs: number
): Record<string, Addon> {
  const addons = book.addons ?? {}
  const target = addons[id]
  if (!target) return addons
  const minutesAfter = Math.max(0, Math.round((toStamp(atMs) - target.at) / 60))
  return {
    ...addons,
    [id]: { ...target, confirms: { ...(target.confirms ?? {}), [clientId]: minutesAfter } },
  }
}

/** 行を取り消した addons を返す（自分が足した分だけ消せる想定）。 */
export function withoutAddon(book: AddonBook, id: string): Record<string, Addon> {
  const next = { ...(book.addons ?? {}) }
  delete next[id]
  return next
}

function entries(book: AddonBook): { id: string; addon: Addon }[] {
  return Object.entries(book.addons ?? {})
    .filter(([, a]) => a && typeof a.player === 'string' && typeof a.delta === 'number')
    .map(([id, addon]) => ({ id, addon }))
}

/** 新しい順に並べた全履歴。 */
export function addonHistory(book: AddonBook): { id: string; addon: Addon }[] {
  return entries(book).sort((a, b) => (b.addon.at ?? 0) - (a.addon.at ?? 0))
}

/** そのプレイヤーの履歴（新しい順）。 */
export function addonsFor(book: AddonBook, playerId: string): { id: string; addon: Addon }[] {
  return addonHistory(book).filter(e => e.addon.player === playerId)
}

/**
 * その人がこの行を確認済みか。
 * 確認時刻は「何分後か」なので即座に確認すると 0 になる。真偽値で見ると
 * 0 が未確認扱いになってしまうため、キーの有無で判定する。
 */
export function hasConfirmed(addon: Addon, clientId: string): boolean {
  return !!addon.confirms && Object.prototype.hasOwnProperty.call(addon.confirms, clientId)
}

/** 自分がまだ確認していない行（自分が足した分は除く）。 */
export function unconfirmedFor(book: AddonBook, clientId: string): { id: string; addon: Addon }[] {
  return addonHistory(book).filter(e => e.addon.by !== clientId && !hasConfirmed(e.addon, clientId))
}

/** そのプレイヤーに、自分がまだ確認していない行があるか。 */
export function hasUnconfirmed(book: AddonBook, playerId: string, clientId: string): boolean {
  return unconfirmedFor(book, clientId).some(e => e.addon.player === playerId)
}

/** その行を確認した人の一覧（確認が早い順）。at は表示用のミリ秒に戻してある。 */
export function confirmedBy(addon: Addon): { clientId: string; at: number }[] {
  return Object.entries(addon.confirms ?? {})
    .map(([clientId, minutesAfter]) => ({
      clientId,
      at: stampToMs(addon.at + Number(minutesAfter) * 60),
    }))
    .sort((a, b) => a.at - b.at)
}
