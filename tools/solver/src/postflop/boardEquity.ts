import { NUM_HANDS } from '../hand.js';
import { enumCombos } from '../hand.js';
import { encodeCard, eval5FastEnc } from './evalFast.js';

const COMB_5OF7: ReadonlyArray<[number, number, number, number, number]> = (() => {
  const out: [number, number, number, number, number][] = [];
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

function best5Enc(enc: number[]): number {
  let best = 0;
  for (let i = 0; i < COMB_5OF7.length; i++) {
    const idx = COMB_5OF7[i];
    const v = eval5FastEnc(enc[idx[0]], enc[idx[1]], enc[idx[2]], enc[idx[3]], enc[idx[4]]);
    if (v > best) best = v;
  }
  return best;
}

export interface BoardEquity {
  // For each (sbBucketIdx, bbBucketIdx): EV[sbWins + 0.5 * tie] per joint specific-combo pair, accumulated
  // and the count of joint combos used.
  totalWin: Float64Array; // sum over specific pairs of (sbWinProb + 0.5 * tieProb)
  totalCombos: Float64Array; // count of valid specific (sb, bb) combo pairs (after card removal)
  meanEquity: Float64Array; // totalWin / totalCombos (set to 0.5 when totalCombos == 0)
}

// Build a 169x169 equity matrix for a given flop board.
// "Equity" = SB's expected share = P(SB best) + 0.5 * P(tie), averaged over remaining turn/river cards
// and over all specific 2-card combos consistent with the (bucket, board) constraints.
// 52-bit card masks: use a 52-element Uint8Array as a bitset, plus a helper to combine masks.
// JS bitwise shifts are 32-bit, so `1 << card` is broken for card >= 32. We use boolean arrays.

function bitset(): Uint8Array {
  return new Uint8Array(52);
}
function bitsetWith(...cards: number[]): Uint8Array {
  const s = new Uint8Array(52);
  for (const c of cards) s[c] = 1;
  return s;
}
function bitsetOverlap(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < 52; i++) if (a[i] !== 0 && b[i] !== 0) return true;
  return false;
}

// Supports 3 (flop), 4 (turn), or 5 (river) board cards. The remaining 2 / 1 / 0
// runout cards are fully enumerated.
export function buildBoardEquity(boardCards: number[]): BoardEquity {
  if (boardCards.length < 3 || boardCards.length > 5) {
    throw new Error(`board must have 3..5 cards, got ${boardCards.length}`);
  }
  const boardSet = bitsetWith(...boardCards);
  const boardEnc = boardCards.map(encodeCard);
  const runoutCount = 5 - boardCards.length; // 2 (flop), 1 (turn), 0 (river)

  // Precompute all 1326 specific 2-card combos, with the bucket index for each
  // and their bitmask.
  // For each bucket, build the list of valid specific combos given the board (no overlap with board).
  const combosPerBucket: Array<Array<{ a: number; b: number; set: Uint8Array; eA: number; eB: number }>> = [];
  for (let h = 0; h < NUM_HANDS; h++) {
    const arr = enumCombos(h);
    const valid: Array<{ a: number; b: number; set: Uint8Array; eA: number; eB: number }> = [];
    for (const [a, b] of arr) {
      if (boardSet[a] || boardSet[b]) continue;
      valid.push({ a, b, set: bitsetWith(a, b), eA: encodeCard(a), eB: encodeCard(b) });
    }
    combosPerBucket.push(valid);
  }

  const totalWin = new Float64Array(NUM_HANDS * NUM_HANDS);
  const totalCombos = new Float64Array(NUM_HANDS * NUM_HANDS);

  // Precompute remaining cards (49) for enumerating turn/river
  const remaining: number[] = [];
  for (let c = 0; c < 52; c++) if (!boardSet[c]) remaining.push(c);
  const remainingEnc = remaining.map(encodeCard);
  void bitset;
  void bitsetOverlap;

  // buf7 layout: [hole_a, hole_b, board_cards..., runout_card_slots...]
  const buf7: number[] = new Array(7).fill(0);
  for (let i = 0; i < boardEnc.length; i++) buf7[2 + i] = boardEnc[i];
  // Runout slots start at index 2 + boardCards.length (5 / 6 / —).
  const slot0 = 2 + boardCards.length; // first runout slot (or 7 if no runout)
  const slot1 = slot0 + 1;             // second runout slot

  for (let sbBucket = 0; sbBucket < NUM_HANDS; sbBucket++) {
    const sbCombos = combosPerBucket[sbBucket];
    if (sbCombos.length === 0) continue;
    for (const sb of sbCombos) {
      for (let bbBucket = 0; bbBucket < NUM_HANDS; bbBucket++) {
        const bbCombos = combosPerBucket[bbBucket];
        if (bbCombos.length === 0) continue;
        for (const bb of bbCombos) {
          if (sb.set[bb.a] || sb.set[bb.b]) continue; // shared cards
          let win = 0;
          let tie = 0;
          let total = 0;

          if (runoutCount === 0) {
            // Direct showdown — board has all 5 cards already
            buf7[0] = sb.eA; buf7[1] = sb.eB;
            const sbScore = best5Enc(buf7);
            buf7[0] = bb.eA; buf7[1] = bb.eB;
            const bbScore = best5Enc(buf7);
            if (sbScore > bbScore) win++;
            else if (sbScore === bbScore) tie++;
            total = 1;
          } else if (runoutCount === 1) {
            for (let ti = 0; ti < remaining.length; ti++) {
              const tcard = remaining[ti];
              if (sb.set[tcard] || bb.set[tcard]) continue;
              buf7[slot0] = remainingEnc[ti];
              buf7[0] = sb.eA; buf7[1] = sb.eB;
              const sbScore = best5Enc(buf7);
              buf7[0] = bb.eA; buf7[1] = bb.eB;
              const bbScore = best5Enc(buf7);
              if (sbScore > bbScore) win++;
              else if (sbScore === bbScore) tie++;
              total++;
            }
          } else {
            for (let ti = 0; ti < remaining.length; ti++) {
              const tcard = remaining[ti];
              if (sb.set[tcard] || bb.set[tcard]) continue;
              const tEnc = remainingEnc[ti];
              for (let ri = ti + 1; ri < remaining.length; ri++) {
                const rcard = remaining[ri];
                if (sb.set[rcard] || bb.set[rcard]) continue;
                const rEnc = remainingEnc[ri];
                buf7[slot0] = tEnc;
                buf7[slot1] = rEnc;
                buf7[0] = sb.eA;
                buf7[1] = sb.eB;
                const sbScore = best5Enc(buf7);
                buf7[0] = bb.eA;
                buf7[1] = bb.eB;
                const bbScore = best5Enc(buf7);
                if (sbScore > bbScore) win++;
                else if (sbScore === bbScore) tie++;
                total++;
              }
            }
          }
          if (total === 0) continue;
          const share = (win + 0.5 * tie) / total;
          const idx = sbBucket * NUM_HANDS + bbBucket;
          totalWin[idx] += share;
          totalCombos[idx] += 1;
        }
      }
    }
  }

  const meanEquity = new Float64Array(NUM_HANDS * NUM_HANDS);
  for (let i = 0; i < NUM_HANDS * NUM_HANDS; i++) {
    if (totalCombos[i] > 0) meanEquity[i] = totalWin[i] / totalCombos[i];
    else meanEquity[i] = 0.5;
  }

  return { totalWin, totalCombos, meanEquity };
}
