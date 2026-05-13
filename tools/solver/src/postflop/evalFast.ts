import { cardRankIdx, cardSuit } from './card.js';
import { eval5 } from './eval.js';

// Cactus Kev style fast eval
//
// Encode each card into a 32-bit integer:
//   bits 16..28 : rank bit (1 << rankPokerIdx). rankPokerIdx: 0=2, 12=A
//   bits 12..15 : suit bit (one of 4)
//   bits 0..7   : prime (2,3,5,7,11,13,17,19,23,29,31,37,41 for ranks 2..A)
// We don't need an explicit rank index field — derivable.

const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41] as const;

export function encodeCard(card: number): number {
  // card uses hand.ts convention: rankIdx 0=A, 12=2; suit 0..3
  const rIdx = cardRankIdx(card);
  const sIdx = cardSuit(card);
  const pokerRank = 12 - rIdx; // 0=2, 12=A
  const rankBit = 1 << pokerRank;
  const suitBit = 1 << sIdx;
  return (rankBit << 16) | (suitBit << 12) | PRIMES[pokerRank];
}

function popcount(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

// We pre-build two tables, keyed by:
//   - rank pattern q (13-bit, popcount = 5 ⇒ no pair / popcount < 5 ⇒ has duplicates)
//   - prime product (for pair/trips/etc combinations)

const flushTable = new Int32Array(8192); // q index, only popcount=5 entries valid
const noFlushTable = new Int32Array(8192); // q index, popcount=5 entries (straights / high card)
const pairsTable = new Map<number, number>(); // prime product → score

function decodeQToRanks(q: number): number[] {
  // q: 13-bit pattern. bit i corresponds to poker rank i (0=2, 12=A)
  // Return rank-idx (hand.ts convention: 0=A, 12=2) ascending sort order doesn't matter here.
  const out: number[] = [];
  for (let pokerRank = 0; pokerRank < 13; pokerRank++) {
    if ((q >>> pokerRank) & 1) {
      const handTsIdx = 12 - pokerRank;
      out.push(handTsIdx);
    }
  }
  return out;
}

function buildFlushAndUniqueTables(): void {
  // For each 13-bit pattern with popcount == 5: build 5 cards (1 suit for flush, all different suits for unique5)
  for (let q = 0; q < 8192; q++) {
    if (popcount(q) !== 5) continue;
    const handTsIdxs = decodeQToRanks(q);
    // Build 5 cards (rankIdx, suit)
    // Flush: all same suit (e.g., suit 0)
    const flushCards: number[] = [];
    const uniqueCards: number[] = [];
    for (let i = 0; i < 5; i++) {
      flushCards.push(handTsIdxs[i] * 4 + 0);
      // 4 distinct suits across cards 0..3, 5th card reuses suit 0 -> not a flush
      uniqueCards.push(handTsIdxs[i] * 4 + (i < 4 ? i : 0));
    }
    flushTable[q] = eval5(flushCards);
    noFlushTable[q] = eval5(uniqueCards);
  }
}

function buildPairsTable(): void {
  // Enumerate all 5-card combos that have at least one duplicate rank.
  // For each, compute prime product and eval5 score.
  // We need: combinations of multiset of 5 ranks where not all distinct.
  // Approach: iterate over count multisets of 13 ranks summing to 5, with at most 4 of each rank.
  const counts = new Array(13).fill(0);
  const recur = (rankPokerIdx: number, remaining: number): void => {
    if (remaining === 0) {
      // Skip all-distinct (no duplicates)
      if (counts.every(c => c <= 1)) return;
      // Build 5 cards
      const cards: number[] = [];
      let suitUsed: number[] = [0, 0, 0, 0, 0]; // dummy
      let suitIdx = 0;
      for (let pokerRank = 0; pokerRank < 13; pokerRank++) {
        const c = counts[pokerRank];
        if (c === 0) continue;
        const handTsIdx = 12 - pokerRank;
        for (let i = 0; i < c; i++) {
          // Use distinct suits per same-rank cards
          cards.push(handTsIdx * 4 + i);
        }
      }
      let prime = 1;
      for (let pokerRank = 0; pokerRank < 13; pokerRank++) {
        for (let i = 0; i < counts[pokerRank]; i++) prime *= PRIMES[pokerRank];
      }
      pairsTable.set(prime, eval5(cards));
      return;
    }
    if (rankPokerIdx === 13) return;
    const maxThisRank = Math.min(4, remaining);
    for (let c = 0; c <= maxThisRank; c++) {
      counts[rankPokerIdx] = c;
      recur(rankPokerIdx + 1, remaining - c);
    }
    counts[rankPokerIdx] = 0;
  };
  recur(0, 5);
}

let tablesBuilt = false;
function ensureTables(): void {
  if (tablesBuilt) return;
  buildFlushAndUniqueTables();
  buildPairsTable();
  tablesBuilt = true;
}

// Build tables eagerly on module import so eval5FastEnc / eval7FastEnc do not need
// to perform a lazy-init check on the hot path.
ensureTables();

export function eval5Fast(c1: number, c2: number, c3: number, c4: number, c5: number): number {
  ensureTables();
  const e1 = encodeCard(c1);
  const e2 = encodeCard(c2);
  const e3 = encodeCard(c3);
  const e4 = encodeCard(c4);
  const e5 = encodeCard(c5);
  return eval5FastEnc(e1, e2, e3, e4, e5);
}

export function eval5FastEnc(e1: number, e2: number, e3: number, e4: number, e5: number): number {
  // q: 13-bit rank pattern
  const q = ((e1 | e2 | e3 | e4 | e5) >>> 16) & 0x1fff;
  // Flush: all suits same → bits 12..15 are same in all cards → AND has at least one bit set
  const isFlush = (e1 & e2 & e3 & e4 & e5 & 0xf000) !== 0;
  if (isFlush) return flushTable[q];
  if (popcount(q) === 5) return noFlushTable[q];
  const prime = (e1 & 0xff) * (e2 & 0xff) * (e3 & 0xff) * (e4 & 0xff) * (e5 & 0xff);
  const v = pairsTable.get(prime);
  if (v === undefined) throw new Error(`pairsTable miss: prime=${prime}`);
  return v;
}

const COMB_INDICES_5OF7: ReadonlyArray<ReadonlyArray<number>> = (() => {
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

export function eval7Fast(cards7: number[]): number {
  ensureTables();
  const enc: number[] = [
    encodeCard(cards7[0]),
    encodeCard(cards7[1]),
    encodeCard(cards7[2]),
    encodeCard(cards7[3]),
    encodeCard(cards7[4]),
    encodeCard(cards7[5]),
    encodeCard(cards7[6]),
  ];
  let best = 0;
  for (const idx of COMB_INDICES_5OF7) {
    const v = eval5FastEnc(enc[idx[0]], enc[idx[1]], enc[idx[2]], enc[idx[3]], enc[idx[4]]);
    if (v > best) best = v;
  }
  return best;
}

export function eval7FastEnc(e1: number, e2: number, e3: number, e4: number, e5: number, e6: number, e7: number): number {
  ensureTables();
  const enc = [e1, e2, e3, e4, e5, e6, e7];
  let best = 0;
  for (const idx of COMB_INDICES_5OF7) {
    const v = eval5FastEnc(enc[idx[0]], enc[idx[1]], enc[idx[2]], enc[idx[3]], enc[idx[4]]);
    if (v > best) best = v;
  }
  return best;
}
