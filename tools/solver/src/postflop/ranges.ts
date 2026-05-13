import { HAND_NAMES, NUM_HANDS } from '../hand.js';

export function strategyToRangeString(probs: number[], threshold = 0.001): string {
  const parts: string[] = [];
  for (let h = 0; h < NUM_HANDS; h++) {
    const p = probs[h];
    if (p > threshold) parts.push(`${HAND_NAMES[h]}:${p.toFixed(4)}`);
  }
  return parts.join(',');
}

export interface GtoNodeData {
  player: 'SB' | 'BB';
  actions: string[];
  strategy: Record<string, number[]>;
}

export interface GtoScenarioData {
  meta: unknown;
  nodes: Record<string, GtoNodeData>;
}

export interface CallTermSpot {
  parentPath: string;
  spotPath: string;
  potBb: number;
  investedBb: number;
  caller: 'SB' | 'BB';
  callIdxInParent: number;
}

export function reachProbForHand(
  scenario: GtoScenarioData,
  targetPath: string,
  player: 'SB' | 'BB',
  handIdx: number,
): number {
  if (targetPath === 'root') return 1;
  const handName = HAND_NAMES[handIdx];
  const parts = targetPath.split('/');
  let reach = 1;
  let currentPath = '';
  for (let i = 0; i < parts.length; i++) {
    const parentPath = currentPath === '' ? 'root' : currentPath;
    const parentNode = scenario.nodes[parentPath];
    if (!parentNode) throw new Error(`parent node not found: ${parentPath}`);
    const action = parts[i];
    const actionIdx = parentNode.actions.indexOf(action);
    if (actionIdx < 0) throw new Error(`action ${action} not in ${parentPath}`);
    if (parentNode.player === player) {
      const probs = parentNode.strategy[handName];
      if (!probs) throw new Error(`hand ${handName} missing`);
      reach *= probs[actionIdx];
    }
    currentPath = currentPath === '' ? action : `${currentPath}/${action}`;
  }
  return reach;
}

export function reachRangeVector(
  scenario: GtoScenarioData,
  targetPath: string,
  player: 'SB' | 'BB',
): number[] {
  const out: number[] = new Array(NUM_HANDS);
  for (let h = 0; h < NUM_HANDS; h++) {
    out[h] = reachProbForHand(scenario, targetPath, player, h);
  }
  return out;
}
