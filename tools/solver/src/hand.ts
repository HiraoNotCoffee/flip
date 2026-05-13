export const RANK_CHARS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const;
export const NUM_HANDS = 169;

function rankIdx(c: string): number {
  return RANK_CHARS.indexOf(c as (typeof RANK_CHARS)[number]);
}

export function rankIdxToValue(i: number): number {
  return 14 - i;
}

export const HAND_NAMES: string[] = (() => {
  const names: string[] = [];
  for (let i = 0; i < 13; i++) names.push(RANK_CHARS[i] + RANK_CHARS[i]);
  for (let i = 0; i < 13; i++) {
    for (let j = i + 1; j < 13; j++) names.push(RANK_CHARS[i] + RANK_CHARS[j] + 's');
  }
  for (let i = 0; i < 13; i++) {
    for (let j = i + 1; j < 13; j++) names.push(RANK_CHARS[i] + RANK_CHARS[j] + 'o');
  }
  return names;
})();

export const HAND_INDEX: Record<string, number> = Object.fromEntries(
  HAND_NAMES.map((n, i) => [n, i]),
);

export function makeCard(rIdx: number, sIdx: number): number {
  return rIdx * 4 + sIdx;
}

export function enumCombos(handIdx: number): [number, number][] {
  const name = HAND_NAMES[handIdx];
  const r1 = rankIdx(name[0]);
  if (name.length === 2) {
    const out: [number, number][] = [];
    for (let s1 = 0; s1 < 4; s1++) {
      for (let s2 = s1 + 1; s2 < 4; s2++) {
        out.push([makeCard(r1, s1), makeCard(r1, s2)]);
      }
    }
    return out;
  }
  const r2 = rankIdx(name[1]);
  const suit = name[2];
  const out: [number, number][] = [];
  if (suit === 's') {
    for (let s = 0; s < 4; s++) out.push([makeCard(r1, s), makeCard(r2, s)]);
    return out;
  }
  for (let s1 = 0; s1 < 4; s1++) {
    for (let s2 = 0; s2 < 4; s2++) {
      if (s1 !== s2) out.push([makeCard(r1, s1), makeCard(r2, s2)]);
    }
  }
  return out;
}

export function comboCount(handIdx: number): number {
  const name = HAND_NAMES[handIdx];
  if (name.length === 2) return 6;
  return name[2] === 's' ? 4 : 12;
}

export function buildJointCombosMatrix(): Float64Array {
  const matrix = new Float64Array(NUM_HANDS * NUM_HANDS);
  const combos = HAND_NAMES.map((_, i) => enumCombos(i));
  for (let a = 0; a < NUM_HANDS; a++) {
    const ca = combos[a];
    for (let b = 0; b < NUM_HANDS; b++) {
      const cb = combos[b];
      let count = 0;
      for (const [a1, a2] of ca) {
        for (const [b1, b2] of cb) {
          if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
          count++;
        }
      }
      matrix[a * NUM_HANDS + b] = count;
    }
  }
  return matrix;
}
