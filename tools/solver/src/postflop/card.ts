// Card representation
// card index: 0..51
//   rank index (high-to-low): 0=A, 1=K, 2=Q, 3=J, 4=T, 5=9, ..., 12=2  (matches hand.ts)
//   suit index: 0=s, 1=h, 2=d, 3=c
//   card = rank * 4 + suit
//
// For evaluation we convert to value 2..14 (A=14).

const RANK_CHARS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const;
const SUIT_CHARS = ['s', 'h', 'd', 'c'] as const;

export function makeCard(rankIdx: number, suitIdx: number): number {
  return rankIdx * 4 + suitIdx;
}

export function cardRankIdx(card: number): number {
  return Math.floor(card / 4);
}

export function cardSuit(card: number): number {
  return card % 4;
}

export function cardRankValue(card: number): number {
  return 14 - cardRankIdx(card);
}

export function cardToString(card: number): string {
  return RANK_CHARS[cardRankIdx(card)] + SUIT_CHARS[cardSuit(card)];
}

export function parseCard(s: string): number {
  if (s.length !== 2) throw new Error(`bad card: ${s}`);
  const r = RANK_CHARS.indexOf(s[0] as (typeof RANK_CHARS)[number]);
  const su = SUIT_CHARS.indexOf(s[1] as (typeof SUIT_CHARS)[number]);
  if (r < 0 || su < 0) throw new Error(`bad card: ${s}`);
  return makeCard(r, su);
}

export function parseBoard(s: string): number[] {
  return s.split(',').map(x => parseCard(x.trim()));
}

export function boardToString(cards: number[]): string {
  return cards.map(cardToString).join(',');
}
