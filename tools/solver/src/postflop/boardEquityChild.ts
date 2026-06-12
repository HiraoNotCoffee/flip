// Child-process worker for buildBoardEquity slice.
// Usage: npx tsx boardEquityChild.ts <jsonTaskBase64>
// Returns: JSON to stdout containing { totalWin, totalCombos } as base64-encoded Float64Array buffers.

import { NUM_HANDS, enumCombos } from '../hand.js';
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

interface Task {
  boardCards: number[];
  sbStart: number;
  sbEnd: number;
}

function computeSlice(task: Task): { totalWin: Float64Array; totalCombos: Float64Array } {
  const { boardCards, sbStart, sbEnd } = task;
  const boardSet = new Uint8Array(52);
  for (const c of boardCards) boardSet[c] = 1;
  const boardEnc = boardCards.map(encodeCard);
  const runoutCount = 5 - boardCards.length;

  const combosPerBucket: Array<Array<{ a: number; b: number; set: Uint8Array; eA: number; eB: number }>> = [];
  for (let h = 0; h < NUM_HANDS; h++) {
    const arr = enumCombos(h);
    const valid: Array<{ a: number; b: number; set: Uint8Array; eA: number; eB: number }> = [];
    for (const [a, b] of arr) {
      if (boardSet[a] || boardSet[b]) continue;
      const set = new Uint8Array(52);
      set[a] = 1; set[b] = 1;
      valid.push({ a, b, set, eA: encodeCard(a), eB: encodeCard(b) });
    }
    combosPerBucket.push(valid);
  }

  const sliceSize = sbEnd - sbStart;
  const totalWin = new Float64Array(sliceSize * NUM_HANDS);
  const totalCombos = new Float64Array(sliceSize * NUM_HANDS);

  const remaining: number[] = [];
  for (let c = 0; c < 52; c++) if (!boardSet[c]) remaining.push(c);
  const remainingEnc = remaining.map(encodeCard);

  const buf7: number[] = new Array(7).fill(0);
  for (let i = 0; i < boardEnc.length; i++) buf7[2 + i] = boardEnc[i];
  const slot0 = 2 + boardCards.length;
  const slot1 = slot0 + 1;

  for (let sbBucket = sbStart; sbBucket < sbEnd; sbBucket++) {
    const sbCombos = combosPerBucket[sbBucket];
    if (sbCombos.length === 0) continue;
    const rowOffset = (sbBucket - sbStart) * NUM_HANDS;
    for (const sb of sbCombos) {
      for (let bbBucket = 0; bbBucket < NUM_HANDS; bbBucket++) {
        const bbCombos = combosPerBucket[bbBucket];
        if (bbCombos.length === 0) continue;
        for (const bb of bbCombos) {
          if (sb.set[bb.a] || sb.set[bb.b]) continue;
          let win = 0;
          let tie = 0;
          let total = 0;

          if (runoutCount === 0) {
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
          const idx = rowOffset + bbBucket;
          totalWin[idx] += share;
          totalCombos[idx] += 1;
        }
      }
    }
  }

  return { totalWin, totalCombos };
}

const taskJson = process.argv[2];
if (!taskJson) {
  console.error('missing task arg');
  process.exit(1);
}
const task = JSON.parse(Buffer.from(taskJson, 'base64').toString('utf-8')) as Task;
const { totalWin, totalCombos } = computeSlice(task);

const out = {
  win: Buffer.from(totalWin.buffer).toString('base64'),
  combos: Buffer.from(totalCombos.buffer).toString('base64'),
};
process.stdout.write(JSON.stringify(out));
