import type {
  GameConfig,
  TerminalFoldNode,
  TerminalPostflopNode,
  TerminalShowdownNode,
} from './types.js';
import { equity } from './equity.js';

export function computeRake(potBb: number, rakePct: number, rakeCapBb: number): number {
  return Math.min(potBb * rakePct, rakeCapBb);
}

export function foldPayoffSb(node: TerminalFoldNode): number {
  if (node.folder === 'SB') return -node.investedSb;
  return node.investedBb;
}

export function showdownPayoffSb(
  node: TerminalShowdownNode | TerminalPostflopNode,
  sbHandIdx: number,
  bbHandIdx: number,
  config: GameConfig,
): number {
  const rake = computeRake(node.potBb, config.rakePct, config.rakeCapBb);
  const netPot = node.potBb - rake;
  const eq = equity(sbHandIdx, bbHandIdx);
  return eq * netPot - node.investedSb;
}

export function showdownPayoffBb(
  node: TerminalShowdownNode | TerminalPostflopNode,
  sbHandIdx: number,
  bbHandIdx: number,
  config: GameConfig,
): number {
  const rake = computeRake(node.potBb, config.rakePct, config.rakeCapBb);
  const netPot = node.potBb - rake;
  const eq = equity(sbHandIdx, bbHandIdx);
  return (1 - eq) * netPot - node.investedBb;
}
