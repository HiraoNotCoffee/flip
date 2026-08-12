// 共有ルームの参加者と承認状態。
//
// 注意: これは「入室マナーのゲート」であってセキュリティではない。共有メッセージは
// リンクを持つ人なら誰でも取得できるので、承認前の人に画面を出さないのは
// アプリ側の表示制御にすぎない。

export type MemberStatus = 'pending' | 'approved' | 'denied'

// 共有ドキュメント（Doc）の値として入れるので interface ではなく type で定義する。
// interface だと暗黙のインデックスシグネチャが付かず Doc に代入できない。
export type Member = {
  name: string
  status: MemberStatus
  /** 申請時刻（Date.now()）。承認待ちの並び順に使う。 */
  at: number
}

/** 参加者情報を持つドキュメントの部分型。 */
export interface MemberBook {
  hostId?: string
  members?: Record<string, Member>
}

/** その人がいまルームに対して持っている立場。 */
export type Access = 'host' | 'approved' | 'pending' | 'denied' | 'none'

export function accessOf(book: MemberBook, clientId: string): Access {
  // hostId が無いのは承認機能より前に作られたルーム。締め出さずに全員通す。
  if (!book.hostId) return 'approved'
  if (book.hostId === clientId) return 'host'
  const status = book.members?.[clientId]?.status
  if (status === 'approved') return 'approved'
  if (status === 'pending') return 'pending'
  if (status === 'denied') return 'denied'
  return 'none'
}

/** 画面を見てよいか。 */
export function canView(book: MemberBook, clientId: string): boolean {
  const access = accessOf(book, clientId)
  return access === 'host' || access === 'approved'
}

function entries(book: MemberBook): { id: string; member: Member }[] {
  return Object.entries(book.members ?? {})
    .filter(([, m]) => m && typeof m.name === 'string')
    .map(([id, member]) => ({ id, member }))
}

/** 承認待ちの人（申請が早い順）。 */
export function pendingMembers(book: MemberBook): { id: string; member: Member }[] {
  return entries(book)
    .filter(e => e.member.status === 'pending')
    .sort((a, b) => (a.member.at ?? 0) - (b.member.at ?? 0))
}

/** 参加中の人（ホストを先頭に、あとは承認が早い順）。 */
export function approvedMembers(book: MemberBook): { id: string; member: Member }[] {
  return entries(book)
    .filter(e => e.member.status === 'approved')
    .sort((a, b) => {
      if (a.id === book.hostId) return -1
      if (b.id === book.hostId) return 1
      return (a.member.at ?? 0) - (b.member.at ?? 0)
    })
}

/** 申請/承認/拒否をまとめて反映した members を返す（元は書き換えない）。 */
export function withMember(
  book: MemberBook,
  clientId: string,
  member: Member
): Record<string, Member> {
  return { ...(book.members ?? {}), [clientId]: member }
}

/** その人を members から取り除いた形を返す。 */
export function withoutMember(book: MemberBook, clientId: string): Record<string, Member> {
  const next = { ...(book.members ?? {}) }
  delete next[clientId]
  return next
}
