import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildJointCombosMatrix,
  comboCount,
  enumCombos,
  HAND_INDEX,
  HAND_NAMES,
  NUM_HANDS,
} from './hand.js';
import { equity, getEquityMatrix } from './equity.js';
import { computeRake, foldPayoffSb, showdownPayoffSb, showdownPayoffBb } from './payoff.js';
import { DEFAULT_V1_CONFIG } from './types.js';
import type { TerminalFoldNode, TerminalShowdownNode } from './types.js';

test('169 hand names, ordering, and combos', () => {
  assert.equal(HAND_NAMES.length, 169);
  assert.equal(HAND_NAMES[0], 'AA');
  assert.equal(HAND_NAMES[12], '22');
  assert.equal(HAND_INDEX['AKs'], 13);
  assert.equal(HAND_INDEX['AKo'], 13 + 78);
  assert.equal(comboCount(HAND_INDEX['AA']), 6);
  assert.equal(comboCount(HAND_INDEX['AKs']), 4);
  assert.equal(comboCount(HAND_INDEX['AKo']), 12);
  // Combos sum to 1326
  let total = 0;
  for (let i = 0; i < NUM_HANDS; i++) total += comboCount(i);
  assert.equal(total, 1326);
});

test('combos contain expected card pairs', () => {
  const aaCombos = enumCombos(HAND_INDEX['AA']);
  assert.equal(aaCombos.length, 6);
  // All combos have rank A (index 0), so card / 4 = 0 for both
  for (const [c1, c2] of aaCombos) {
    assert.equal(Math.floor(c1 / 4), 0);
    assert.equal(Math.floor(c2 / 4), 0);
    assert.notEqual(c1, c2);
  }
});

test('AA vs KK equity ~ 0.818', () => {
  const eq = equity(HAND_INDEX['AA'], HAND_INDEX['KK']);
  assert.ok(Math.abs(eq - 0.818) < 0.01, `got ${eq}`);
});

test('KK vs AA equity is mirror', () => {
  const eq = equity(HAND_INDEX['KK'], HAND_INDEX['AA']);
  assert.ok(Math.abs(eq - 0.182) < 0.01, `got ${eq}`);
});

test('AA vs AA equity ~ 0.5', () => {
  const eq = equity(HAND_INDEX['AA'], HAND_INDEX['AA']);
  assert.ok(Math.abs(eq - 0.5) < 0.05, `got ${eq}`);
});

test('equity matrix is fully populated', () => {
  const m = getEquityMatrix();
  for (let i = 0; i < NUM_HANDS * NUM_HANDS; i++) {
    assert.ok(m[i] >= 0 && m[i] <= 1, `idx ${i} = ${m[i]}`);
  }
});

test('jointCombos: AA vs AA = 6 * 1 = 6', () => {
  const m = buildJointCombosMatrix();
  const aaIdx = HAND_INDEX['AA'];
  // SB picks 2 of 4 Aces = 6, BB picks 2 of remaining 2 = 1 → 6
  assert.equal(m[aaIdx * NUM_HANDS + aaIdx], 6);
});

test('jointCombos: AA vs KK = 6 * 6 = 36', () => {
  const m = buildJointCombosMatrix();
  const aa = HAND_INDEX['AA'];
  const kk = HAND_INDEX['KK'];
  assert.equal(m[aa * NUM_HANDS + kk], 36);
});

test('jointCombos: AKs vs AKs = 4 * 3 = 12', () => {
  const m = buildJointCombosMatrix();
  const aks = HAND_INDEX['AKs'];
  assert.equal(m[aks * NUM_HANDS + aks], 12);
});

test('rake: 50bb pot, 10%, cap=5 -> 5', () => {
  assert.equal(computeRake(50, 0.10, 5), 5);
});

test('rake: 20bb pot, 10%, cap=5 -> 2', () => {
  assert.equal(computeRake(20, 0.10, 5), 2);
});

test('rake: 100bb pot, 10%, cap=3 -> 3', () => {
  assert.equal(computeRake(100, 0.10, 3), 3);
});

test('fold payoff: SB folds preflop loses sb', () => {
  const node: TerminalFoldNode = {
    kind: 'terminal_fold',
    path: 'fold',
    folder: 'SB',
    potBb: 1.5,
    investedSb: 0.5,
    investedBb: 1,
  };
  assert.equal(foldPayoffSb(node), -0.5);
});

test('fold payoff: BB folds preflop SB wins bb', () => {
  const node: TerminalFoldNode = {
    kind: 'terminal_fold',
    path: 'open_2.5/fold',
    folder: 'BB',
    potBb: 3.5,
    investedSb: 2.5,
    investedBb: 1,
  };
  assert.equal(foldPayoffSb(node), 1);
});

test('showdown payoff: SB+BB sum to -rake', () => {
  const config = { ...DEFAULT_V1_CONFIG, rakeCapBb: 5 };
  const node: TerminalShowdownNode = {
    kind: 'terminal_showdown',
    path: 'all_in',
    potBb: 200,
    investedSb: 100,
    investedBb: 100,
  };
  const sb = showdownPayoffSb(node, HAND_INDEX['AA'], HAND_INDEX['KK'], config);
  const bb = showdownPayoffBb(node, HAND_INDEX['AA'], HAND_INDEX['KK'], config);
  const expectedRake = 5; // capped
  assert.ok(Math.abs(sb + bb - -expectedRake) < 1e-9, `sb+bb = ${sb + bb}`);
});

test('showdown payoff: AA wins big vs KK in 200bb pot', () => {
  const config = { ...DEFAULT_V1_CONFIG, rakeCapBb: 5 };
  const node: TerminalShowdownNode = {
    kind: 'terminal_showdown',
    path: 'all_in',
    potBb: 200,
    investedSb: 100,
    investedBb: 100,
  };
  const sb = showdownPayoffSb(node, HAND_INDEX['AA'], HAND_INDEX['KK'], config);
  // SB EV = 0.818 * 195 - 100 = ~59.5
  assert.ok(sb > 55 && sb < 65, `got ${sb}`);
});
