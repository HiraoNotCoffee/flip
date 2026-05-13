import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, countNodes, walkTree } from './tree.js';
import { DEFAULT_V1_CONFIG } from './types.js';

const config = { ...DEFAULT_V1_CONFIG, rakeCapBb: 5 };

test('root is SB decision with fold/limp/open_2.5', () => {
  const root = buildTree(config);
  assert.equal(root.kind, 'decision');
  if (root.kind !== 'decision') return;
  assert.equal(root.player, 'SB');
  assert.deepEqual(root.actions.map(a => a.id), ['fold', 'limp', 'open_2.5']);
});

test('SB fold at root is terminal_fold by SB', () => {
  const root = buildTree(config);
  if (root.kind !== 'decision') throw new Error('root must be decision');
  const foldChild = root.children[0];
  assert.equal(foldChild.kind, 'terminal_fold');
  if (foldChild.kind !== 'terminal_fold') return;
  assert.equal(foldChild.folder, 'SB');
  assert.equal(foldChild.investedSb, 0.5);
  assert.equal(foldChild.investedBb, 1);
});

test('BB facing open has fold/call/3bet_11', () => {
  const root = buildTree(config);
  if (root.kind !== 'decision') throw new Error();
  const vsOpen = root.children[2];
  assert.equal(vsOpen.kind, 'decision');
  if (vsOpen.kind !== 'decision') return;
  assert.equal(vsOpen.player, 'BB');
  assert.deepEqual(vsOpen.actions.map(a => a.id), ['fold', 'call', '3bet_11']);
});

test('BB 3bet path leads SB to fold/call/4bet_25', () => {
  const root = buildTree(config);
  if (root.kind !== 'decision') throw new Error();
  const vsOpen = root.children[2];
  if (vsOpen.kind !== 'decision') throw new Error();
  const vs3bet = vsOpen.children[2];
  assert.equal(vs3bet.kind, 'decision');
  if (vs3bet.kind !== 'decision') return;
  assert.equal(vs3bet.player, 'SB');
  assert.deepEqual(vs3bet.actions.map(a => a.id), ['fold', 'call', '4bet_25']);
});

test('5-bet allin leads to fold/call (showdown)', () => {
  const root = buildTree(config);
  if (root.kind !== 'decision') throw new Error();
  const vsOpen = root.children[2];
  if (vsOpen.kind !== 'decision') throw new Error();
  const vs3bet = vsOpen.children[2];
  if (vs3bet.kind !== 'decision') throw new Error();
  const vs4bet = vs3bet.children[2];
  if (vs4bet.kind !== 'decision') throw new Error();
  const vsAllin = vs4bet.children[2];
  if (vsAllin.kind !== 'decision') throw new Error();
  assert.equal(vsAllin.player, 'SB');
  const showdown = vsAllin.children[1];
  assert.equal(showdown.kind, 'terminal_showdown');
  if (showdown.kind !== 'terminal_showdown') return;
  assert.equal(showdown.potBb, 200);
});

test('node counts are small for v1 single-size tree', () => {
  const root = buildTree(config);
  const { decisions, terminals } = countNodes(root);
  assert.ok(decisions > 0);
  assert.ok(terminals > 0);
});

test('paths are unique', () => {
  const root = buildTree(config);
  const seen = new Set<string>();
  walkTree(root, n => {
    assert.ok(!seen.has(n.path), `dup path: ${n.path}`);
    seen.add(n.path);
  });
});
