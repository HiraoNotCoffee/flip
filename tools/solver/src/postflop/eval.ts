import { cardRankValue, cardSuit } from './card.js';

const BASE = 16;
const CAT = {
  HIGH: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
} as const;

function encode(category: number, vals: number[]): number {
  let v = category * BASE ** 5;
  for (let i = 0; i < 5; i++) v += (vals[i] ?? 0) * BASE ** (4 - i);
  return v;
}

function detectStraight(ranksDesc: number[]): number {
  // ranksDesc: sorted descending unique ranks
  // Returns high rank of straight, or 0 if no straight
  // Need 5 consecutive ranks
  if (ranksDesc.length < 5) return 0;
  for (let i = 0; i + 4 < ranksDesc.length; i++) {
    if (ranksDesc[i] - ranksDesc[i + 4] === 4) return ranksDesc[i];
  }
  // Wheel: A-2-3-4-5
  if (
    ranksDesc.includes(14) &&
    ranksDesc.includes(5) &&
    ranksDesc.includes(4) &&
    ranksDesc.includes(3) &&
    ranksDesc.includes(2)
  ) {
    return 5;
  }
  return 0;
}

export function eval5(cards5: number[]): number {
  const ranks: number[] = [];
  const suits: number[] = [];
  for (const c of cards5) {
    ranks.push(cardRankValue(c));
    suits.push(cardSuit(c));
  }
  ranks.sort((a, b) => b - a);

  const isFlush = suits[0] === suits[1] && suits[1] === suits[2] && suits[2] === suits[3] && suits[3] === suits[4];
  const uniqRanks = Array.from(new Set(ranks)).sort((a, b) => b - a);
  const straightHigh = detectStraight(uniqRanks);
  const isStraight = straightHigh > 0;

  if (isStraight && isFlush) {
    let high = straightHigh;
    // wheel under flush: ranks contain A but straightHigh = 5
    if (high === 5) {
      // verify suits all match (they do since isFlush is true)
      // straight-flush wheel
    }
    return encode(CAT.STRAIGHT_FLUSH, [high]);
  }

  // Count occurrences
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const buckets = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  const pattern = buckets.map(([_, c]) => c).join('');

  if (pattern === '41') {
    return encode(CAT.QUADS, [buckets[0][0], buckets[1][0]]);
  }
  if (pattern === '32') {
    return encode(CAT.FULL_HOUSE, [buckets[0][0], buckets[1][0]]);
  }
  if (isFlush) {
    return encode(CAT.FLUSH, ranks);
  }
  if (isStraight) {
    return encode(CAT.STRAIGHT, [straightHigh]);
  }
  if (pattern === '311') {
    return encode(CAT.TRIPS, [buckets[0][0], buckets[1][0], buckets[2][0]]);
  }
  if (pattern === '221') {
    return encode(CAT.TWO_PAIR, [buckets[0][0], buckets[1][0], buckets[2][0]]);
  }
  if (pattern === '2111') {
    return encode(CAT.PAIR, [
      buckets[0][0],
      buckets[1][0],
      buckets[2][0],
      buckets[3][0],
    ]);
  }
  return encode(CAT.HIGH, ranks);
}

const COMB_INDICES: ReadonlyArray<ReadonlyArray<number>> = (() => {
  // C(7, 5) = 21 combinations of indices to use
  const out: number[][] = [];
  for (let a = 0; a < 7; a++) {
    for (let b = a + 1; b < 7; b++) {
      for (let c = b + 1; c < 7; c++) {
        for (let d = c + 1; d < 7; d++) {
          for (let e = d + 1; e < 7; e++) {
            out.push([a, b, c, d, e]);
          }
        }
      }
    }
  }
  return out;
})();

export function eval7(cards7: number[]): number {
  let best = 0;
  const buf: number[] = [0, 0, 0, 0, 0];
  for (const idx of COMB_INDICES) {
    buf[0] = cards7[idx[0]];
    buf[1] = cards7[idx[1]];
    buf[2] = cards7[idx[2]];
    buf[3] = cards7[idx[3]];
    buf[4] = cards7[idx[4]];
    const v = eval5(buf);
    if (v > best) best = v;
  }
  return best;
}

export const HAND_CATEGORY = CAT;

export function categoryOf(score: number): number {
  return Math.floor(score / BASE ** 5);
}
