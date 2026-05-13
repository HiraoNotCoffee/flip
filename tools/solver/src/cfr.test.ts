import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve } from './cfr.js';
import { DEFAULT_V1_CONFIG } from './types.js';
import { HAND_INDEX } from './hand.js';

test('AA always opens (root)', () => {
  const result = solve({ ...DEFAULT_V1_CONFIG, rakeCapBb: 5 }, 500);
  const root = result.strategies.get('root')!;
  const aa = HAND_INDEX['AA'];
  const numActions = root.actions.length;
  const openIdx = root.actions.indexOf('open_2.5');
  const openProb = root.strategy[aa * numActions + openIdx];
  assert.ok(openProb > 0.95, `AA open prob = ${openProb}`);
});

test('72o folds at root', () => {
  const result = solve({ ...DEFAULT_V1_CONFIG, rakeCapBb: 5 }, 500);
  const root = result.strategies.get('root')!;
  const idx = HAND_INDEX['72o'];
  const numActions = root.actions.length;
  const foldIdx = root.actions.indexOf('fold');
  const foldProb = root.strategy[idx * numActions + foldIdx];
  assert.ok(foldProb > 0.8, `72o fold prob = ${foldProb}`);
});

test('AA 3bets vs open', () => {
  const result = solve({ ...DEFAULT_V1_CONFIG, rakeCapBb: 5 }, 500);
  const vsOpen = result.strategies.get('open_2.5')!;
  const aa = HAND_INDEX['AA'];
  const numActions = vsOpen.actions.length;
  const idx = vsOpen.actions.indexOf('3bet_11');
  const prob = vsOpen.strategy[aa * numActions + idx];
  assert.ok(prob > 0.9, `AA 3bet prob = ${prob}`);
});

test('lower rake cap allows wider SB open range', () => {
  // 3bb cap: smaller rake → more profitable opens → opens wider
  // 5bb cap: larger rake → tighter opens
  const r3 = solve({ ...DEFAULT_V1_CONFIG, rakeCapBb: 3 }, 800);
  const r5 = solve({ ...DEFAULT_V1_CONFIG, rakeCapBb: 5 }, 800);

  function openShare(result: ReturnType<typeof solve>): number {
    const root = result.strategies.get('root')!;
    const numActions = root.actions.length;
    const openIdx = root.actions.indexOf('open_2.5');
    let total = 0;
    for (let h = 0; h < 169; h++) total += root.strategy[h * numActions + openIdx];
    return total / 169;
  }

  const wide3 = openShare(r3);
  const wide5 = openShare(r5);
  // Lower cap → wider opens (less rake punishment)
  assert.ok(wide3 >= wide5 - 0.01, `wide3=${wide3} wide5=${wide5}`);
});
