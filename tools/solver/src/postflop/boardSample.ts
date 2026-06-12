// Representative flop board sampling.
//
// Strategy:
//   - Enumerate all unique flop textures by canonical form (rank-triple + suit-pattern)
//   - Categorize by texture (paired, monotone, two-tone, rainbow; broadway/middle/low)
//   - Sample N boards proportionally across textures
//
// This is an approximation. For Phase A/B we want ~50 boards that cover the diversity of
// real flops so that averaged EVs are representative.

import { makeCard, cardToString } from './card.js';

type SuitPattern = 'monotone' | 'two-tone' | 'rainbow';

function suitPattern(suits: number[]): SuitPattern {
  const s = new Set(suits);
  if (s.size === 1) return 'monotone';
  if (s.size === 2) return 'two-tone';
  return 'rainbow';
}

type RankTier = 'broadway' | 'mid' | 'low';

function tierOf(rankIdx: number): RankTier {
  // rankIdx: 0=A, 1=K, ... 12=2 (hand.ts convention)
  if (rankIdx <= 3) return 'broadway'; // A, K, Q, J
  if (rankIdx <= 8) return 'mid';      // T..6
  return 'low';                        // 5..2
}

function pairKind(ranks: number[]): 'paired' | 'unpaired' {
  const s = new Set(ranks);
  return s.size < 3 ? 'paired' : 'unpaired';
}

export interface FlopCategory {
  pair: 'paired' | 'unpaired';
  suit: SuitPattern;
  topTier: RankTier;
}

function categorize(cards: number[]): FlopCategory {
  const ranks = cards.map(c => Math.floor(c / 4));
  const suits = cards.map(c => c % 4);
  return {
    pair: pairKind(ranks),
    suit: suitPattern(suits),
    topTier: tierOf(Math.min(...ranks)), // smallest rankIdx = highest rank
  };
}

function categoryKey(cat: FlopCategory): string {
  return `${cat.pair}|${cat.suit}|${cat.topTier}`;
}

// Enumerate all C(52, 3) = 22100 flop boards, but only one canonical representative per
// suit-permutation class. We achieve this by enumerating combinations of (rank, suit-pattern)
// and rejecting suit-isomorphic duplicates via a canonical form.

function canonicalSuitForm(cards: number[]): string {
  // Sort by rank ascending, then within same rank by suit. Then relabel suits in first-seen order.
  const items = cards.map(c => ({ rank: Math.floor(c / 4), suit: c % 4 }));
  items.sort((a, b) => a.rank - b.rank || a.suit - b.suit);
  const suitMap = new Map<number, number>();
  let next = 0;
  for (const it of items) {
    if (!suitMap.has(it.suit)) suitMap.set(it.suit, next++);
  }
  return items.map(it => `${it.rank}.${suitMap.get(it.suit)!}`).join(',');
}

export interface SampledBoard {
  cards: number[]; // 3 card indices
  category: FlopCategory;
}

export function sampleBoards(n: number, seed = 42): SampledBoard[] {
  // Generate all unique flop boards using canonical form
  const seen = new Map<string, number[]>(); // canonical → cards
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++) {
      for (let c = b + 1; c < 52; c++) {
        const cards = [a, b, c];
        const key = canonicalSuitForm(cards);
        if (!seen.has(key)) seen.set(key, cards);
      }
    }
  }
  const unique = Array.from(seen.values()).map(cards => ({ cards, category: categorize(cards) }));

  // Group by category
  const buckets = new Map<string, SampledBoard[]>();
  for (const b of unique) {
    const k = categoryKey(b.category);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(b);
  }

  // Allocate sample sizes proportionally
  const totalUnique = unique.length;
  const allocations = new Map<string, number>();
  let allocated = 0;
  const keys = Array.from(buckets.keys()).sort();
  // When n is small (e.g., n=1), skip the per-bucket minimum-1 floor so we honor n.
  const useFloor = n >= keys.length;
  for (const k of keys) {
    const bucket = buckets.get(k)!;
    const raw = n * bucket.length / totalUnique;
    const share = useFloor ? Math.max(1, Math.round(raw)) : Math.round(raw);
    allocations.set(k, Math.min(share, bucket.length));
    allocated += allocations.get(k)!;
  }
  // Adjust to hit exactly n (greedy: trim or add to largest buckets)
  while (allocated > n) {
    const k = [...allocations.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (allocations.get(k)! <= 1) break;
    allocations.set(k, allocations.get(k)! - 1);
    allocated--;
  }
  while (allocated < n) {
    const k = [...allocations.entries()].sort((a, b) => {
      const bucketLen = buckets.get(b[0])!.length;
      const aLen = buckets.get(a[0])!.length;
      const aRoom = aLen - a[1];
      const bRoom = bucketLen - b[1];
      return bRoom - aRoom;
    })[0][0];
    const bucketLen = buckets.get(k)!.length;
    if (allocations.get(k)! >= bucketLen) break;
    allocations.set(k, allocations.get(k)! + 1);
    allocated++;
  }

  // Deterministic LCG
  let lcgState = seed >>> 0;
  function next(): number {
    lcgState = (lcgState * 1664525 + 1013904223) >>> 0;
    return lcgState / 0x100000000;
  }

  // Sample within each bucket
  const out: SampledBoard[] = [];
  for (const k of keys) {
    const want = allocations.get(k) ?? 0;
    if (want === 0) continue;
    const bucket = buckets.get(k)!.slice();
    // Fisher-Yates
    for (let i = bucket.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [bucket[i], bucket[j]] = [bucket[j], bucket[i]];
    }
    for (let i = 0; i < want; i++) out.push(bucket[i]);
  }
  return out;
}

export function boardToReadableString(cards: number[]): string {
  return cards.map(cardToString).join(' ');
}

// CLI entry: print N sampled boards
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const n = Number(process.argv[2] ?? '50');
  const boards = sampleBoards(n);
  for (const b of boards) {
    console.log(`${boardToReadableString(b.cards).padEnd(12)} | ${b.category.pair}/${b.category.suit}/${b.category.topTier}`);
  }
  console.log(`\ntotal: ${boards.length}`);
  void makeCard;
}
