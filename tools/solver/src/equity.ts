import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { HAND_NAMES, NUM_HANDS, rankIdxToValue } from './hand.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TABLE_PATH = resolve(__dirname, '../../../src/utils/preflopTable.json');

type Table = Record<string, number>;

let rawTable: Table | null = null;
function loadTable(): Table {
  if (!rawTable) {
    rawTable = JSON.parse(readFileSync(TABLE_PATH, 'utf-8')) as Table;
  }
  return rawTable;
}

function rankCharToIdx(c: string): number {
  return ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'].indexOf(c);
}

function handToKey(handName: string): string {
  const r1 = rankIdxToValue(rankCharToIdx(handName[0]));
  if (handName.length === 2) return `${r1}-${r1}`;
  const r2 = rankIdxToValue(rankCharToIdx(handName[1]));
  return `${r1}-${r2}${handName[2]}`;
}

function rawEquity(sbHand: string, bbHand: string): number {
  const table = loadTable();
  const a = handToKey(sbHand);
  const b = handToKey(bbHand);
  const direct = table[`${a}|${b}`];
  if (direct !== undefined) return direct / 100;
  const reversed = table[`${b}|${a}`];
  if (reversed !== undefined) return (100 - reversed) / 100;
  if (a === b) return 0.5;
  throw new Error(`equity not found: ${sbHand} vs ${bbHand}`);
}

let cachedMatrix: Float64Array | null = null;
export function getEquityMatrix(): Float64Array {
  if (cachedMatrix) return cachedMatrix;
  const m = new Float64Array(NUM_HANDS * NUM_HANDS);
  for (let a = 0; a < NUM_HANDS; a++) {
    for (let b = 0; b < NUM_HANDS; b++) {
      m[a * NUM_HANDS + b] = rawEquity(HAND_NAMES[a], HAND_NAMES[b]);
    }
  }
  cachedMatrix = m;
  return m;
}

export function equity(sbHandIdx: number, bbHandIdx: number): number {
  return getEquityMatrix()[sbHandIdx * NUM_HANDS + bbHandIdx];
}
