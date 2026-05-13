import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NUM_HANDS } from '../hand.js';
import type { BoardEquity } from './boardEquity.js';

async function runPool<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHILD_SCRIPT = resolve(__dirname, 'boardEquityChild.ts');
const SOLVER_DIR = resolve(__dirname, '../../');

export interface ParallelOptions {
  workers?: number;
}

interface SliceResult {
  totalWin: Float64Array;
  totalCombos: Float64Array;
}

function runChild(boardCards: number[], sbStart: number, sbEnd: number): Promise<SliceResult> {
  return new Promise((resolveP, rejectP) => {
    const task = JSON.stringify({ boardCards, sbStart, sbEnd });
    const taskB64 = Buffer.from(task, 'utf-8').toString('base64');

    const child = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['tsx', CHILD_SCRIPT, taskB64],
      { cwd: SOLVER_DIR, windowsHide: true, shell: process.platform === 'win32' },
    );

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', d => stdoutChunks.push(d));
    child.stderr.on('data', d => stderrChunks.push(d));
    child.on('error', rejectP);
    child.on('close', code => {
      if (code !== 0) {
        rejectP(new Error(`child exited ${code}\nstderr: ${Buffer.concat(stderrChunks).toString('utf-8')}`));
        return;
      }
      try {
        const raw = Buffer.concat(stdoutChunks).toString('utf-8');
        const j = JSON.parse(raw) as { win: string; combos: string };
        const totalWin = new Float64Array(Buffer.from(j.win, 'base64').buffer.slice(
          Buffer.from(j.win, 'base64').byteOffset,
          Buffer.from(j.win, 'base64').byteOffset + Buffer.from(j.win, 'base64').byteLength,
        ));
        const totalCombos = new Float64Array(Buffer.from(j.combos, 'base64').buffer.slice(
          Buffer.from(j.combos, 'base64').byteOffset,
          Buffer.from(j.combos, 'base64').byteOffset + Buffer.from(j.combos, 'base64').byteLength,
        ));
        resolveP({ totalWin, totalCombos });
      } catch (err) {
        rejectP(err as Error);
      }
    });
  });
}

export async function buildBoardEquityParallel(
  boardCards: number[],
  options?: ParallelOptions,
): Promise<BoardEquity> {
  const numWorkers = options?.workers ?? 8;
  const perWorker = Math.ceil(NUM_HANDS / numWorkers);
  const tasks: Array<{ start: number; end: number }> = [];
  for (let start = 0; start < NUM_HANDS; start += perWorker) {
    const end = Math.min(start + perWorker, NUM_HANDS);
    tasks.push({ start, end });
  }

  const results = await Promise.all(
    tasks.map(t => runChild(boardCards, t.start, t.end)),
  );

  const totalWin = new Float64Array(NUM_HANDS * NUM_HANDS);
  const totalCombos = new Float64Array(NUM_HANDS * NUM_HANDS);
  for (let i = 0; i < tasks.length; i++) {
    const { start, end } = tasks[i];
    const sliceSize = end - start;
    const r = results[i];
    for (let row = 0; row < sliceSize; row++) {
      const srcOffset = row * NUM_HANDS;
      const dstOffset = (start + row) * NUM_HANDS;
      for (let col = 0; col < NUM_HANDS; col++) {
        totalWin[dstOffset + col] = r.totalWin[srcOffset + col];
        totalCombos[dstOffset + col] = r.totalCombos[srcOffset + col];
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

// One child per board (board computed serially within the child).
// Use a process pool with `concurrency` parallel children.
async function computeBoardEquitySingleChild(boardCards: number[]): Promise<BoardEquity> {
  const r = await runChild(boardCards, 0, NUM_HANDS);
  const meanEquity = new Float64Array(NUM_HANDS * NUM_HANDS);
  for (let i = 0; i < NUM_HANDS * NUM_HANDS; i++) {
    if (r.totalCombos[i] > 0) meanEquity[i] = r.totalWin[i] / r.totalCombos[i];
    else meanEquity[i] = 0.5;
  }
  return { totalWin: r.totalWin, totalCombos: r.totalCombos, meanEquity };
}

export interface PrecomputeTurnOptions {
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

// Precompute turn equities for all (52 - 3) = 49 possible turn cards in parallel.
export async function precomputeTurnEquities(
  flopBoard: number[],
  options?: PrecomputeTurnOptions,
): Promise<Array<BoardEquity | null>> {
  if (flopBoard.length !== 3) throw new Error('flopBoard must have 3 cards');
  const flopSet = new Uint8Array(52);
  for (const c of flopBoard) flopSet[c] = 1;

  const cards: number[] = [];
  for (let c = 0; c < 52; c++) if (!flopSet[c]) cards.push(c);

  let doneCount = 0;
  const tasks = cards.map(c => async () => {
    const eq = await computeBoardEquitySingleChild([...flopBoard, c]);
    doneCount++;
    options?.onProgress?.(doneCount, cards.length);
    return { card: c, eq };
  });

  const concurrency = options?.concurrency ?? 16;
  const results = await runPool(tasks, concurrency);

  const out: Array<BoardEquity | null> = new Array(52).fill(null);
  for (const { card, eq } of results) out[card] = eq;
  return out;
}
