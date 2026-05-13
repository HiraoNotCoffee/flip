// Builds a postflop EV table by averaging postflop CFR results over multiple boards
// for each "call terminal" of the preflop tree.
//
// Output structure:
//   evTable[spotPath] = { sbEv: number[169], bbEv: number[169], potBb, investedSb, investedBb, oopPlayer }
//
// "spotPath" is the preflop terminal_postflop node path (e.g., "open_2.5/call").

import { HAND_NAMES, NUM_HANDS, buildJointCombosMatrix } from './hand.js';
import { buildTree, walkTree } from './tree.js';
import type {
  GameConfig,
  TerminalPostflopNode,
  TreeNode,
} from './types.js';
import { solvePostflopWithEquity, type PostflopConfig } from './postflop/pcfr.js';
import { sampleBoards, type SampledBoard } from './postflop/boardSample.js';
import { buildBoardEquity } from './postflop/boardEquity.js';
import { buildBoardEquityParallel, precomputeTurnEquities } from './postflop/boardEquityParallel.js';

export interface PostflopSpot {
  path: string;
  potBb: number;
  investedSb: number;
  investedBb: number;
  // In HU postflop, SB is the IP player (BTN). So when we pass to postflop CFR,
  //   IP = SB, OOP = BB.
  // Reach vectors per hand bucket reaching this spot, conditional on the preflop strategy.
  sbReach: Float64Array;
  bbReach: Float64Array;
}

// Compute reach probability per hand for each terminal_postflop node, given the v2-A
// strategy results stored in a scenario JSON. We re-walk the preflop tree applying
// the average strategy.
export function collectPostflopSpots(
  config: GameConfig,
  scenarioStrategies: Map<string, { actions: string[]; player: 'SB' | 'BB'; strategy: Float64Array }>,
): PostflopSpot[] {
  const tree = buildTree(config);

  const spotsByPath = new Map<string, PostflopSpot>();
  for (const node of walkAll(tree)) {
    if (node.kind !== 'terminal_postflop') continue;
    spotsByPath.set(node.path, {
      path: node.path,
      potBb: node.potBb,
      investedSb: node.investedSb,
      investedBb: node.investedBb,
      sbReach: new Float64Array(NUM_HANDS).fill(1),
      bbReach: new Float64Array(NUM_HANDS).fill(1),
    });
  }

  // Walk tree, propagating reach.
  function walk(
    n: TreeNode,
    sbReach: Float64Array,
    bbReach: Float64Array,
  ): void {
    if (n.kind === 'terminal_postflop') {
      const spot = spotsByPath.get(n.path);
      if (!spot) return;
      // Use the cumulative reach at this terminal
      spot.sbReach = new Float64Array(sbReach);
      spot.bbReach = new Float64Array(bbReach);
      return;
    }
    if (n.kind !== 'decision') return;

    const stratInfo = scenarioStrategies.get(n.path);
    if (!stratInfo) return;
    const numActions = n.actions.length;
    for (let a = 0; a < numActions; a++) {
      const child = n.children[a];
      const isSb = n.player === 'SB';
      let nextSb = sbReach;
      let nextBb = bbReach;
      if (isSb) {
        nextSb = new Float64Array(NUM_HANDS);
        for (let h = 0; h < NUM_HANDS; h++) nextSb[h] = sbReach[h] * stratInfo.strategy[h * numActions + a];
      } else {
        nextBb = new Float64Array(NUM_HANDS);
        for (let h = 0; h < NUM_HANDS; h++) nextBb[h] = bbReach[h] * stratInfo.strategy[h * numActions + a];
      }
      walk(child, nextSb, nextBb);
    }
  }

  const initReach = new Float64Array(NUM_HANDS).fill(1);
  walk(tree, initReach, new Float64Array(initReach));

  return [...spotsByPath.values()];
}

function* walkAll(node: TreeNode): Generator<TreeNode> {
  yield node;
  if (node.kind === 'decision') {
    for (const c of node.children) yield* walkAll(c);
  }
}

export interface PostflopEvResult {
  // For each spot, per-hand SB EV and BB EV averaged across all boards
  perSpot: Map<string, { sbEv: Float64Array; bbEv: Float64Array; boardCount: number }>;
  boards: SampledBoard[];
}

// For a single board, solve postflop CFR for each spot and return per-hand SB/BB EVs.
// `usePhaseB=true` uses turn-aware CFR; otherwise Phase A (flop-only).
// IMPORTANT: board equity is built ONCE per board and reused across all spots.
async function evalSpotsOnBoard(
  board: number[],
  spots: PostflopSpot[],
  config: GameConfig,
  iterations: number,
  usePhaseB: boolean,
  useParallel: boolean,
): Promise<Array<{ path: string; sbEv: Float64Array; bbEv: Float64Array }>> {
  // Build the flop equity matrix ONCE — shared across all spots on this board.
  const flopEquity = useParallel
    ? await buildBoardEquityParallel(board, { workers: 8 })
    : buildBoardEquity(board);

  // For Phase B, also precompute the 49 turn equities once.
  let turnEquityCache: ReturnType<typeof buildBoardEquity>[] | null = null;
  if (usePhaseB) {
    if (useParallel) {
      const all = await precomputeTurnEquities(board, { concurrency: 16 });
      turnEquityCache = all.map(e => e ?? buildBoardEquity(board)); // dummy fallback for board cards (won't be used)
    }
  }

  const out: Array<{ path: string; sbEv: Float64Array; bbEv: Float64Array }> = [];
  for (const spot of spots) {
    const startPot = spot.potBb;
    const effStack = config.stackBb - Math.max(spot.investedSb, spot.investedBb);

    const postflopConfig: PostflopConfig = {
      startPotBb: startPot,
      effectiveStackBb: effStack,
      flopBetPctOfPot: [50],
      turnBetPctOfPot: [50],
      maxRaiseCount: 3,
      rakePct: config.rakePct,
      rakeCapBb: config.rakeCapBb,
      oopReach: spot.bbReach,
      ipReach: spot.sbReach,
    };

    const result = solvePostflopWithEquity(postflopConfig, flopEquity, iterations);

    // Normalize: rootEvIp[h] = sum_b (bbReach[b] * jc[h,b] * payoff). Divide by the
    // same weight to get "expected SB payoff per (sb_combo, valid bb_combo)" — a
    // per-combo expected value that doesn't depend on the absolute reach scale.
    const joint = flopEquity.totalCombos; // board-aware (excludes board-conflicting combos)
    const sbEv = new Float64Array(NUM_HANDS);
    const bbEv = new Float64Array(NUM_HANDS);
    for (let h = 0; h < NUM_HANDS; h++) {
      let weight = 0;
      for (let b = 0; b < NUM_HANDS; b++) {
        const jc = joint[h * NUM_HANDS + b];
        if (jc === 0) continue;
        weight += spot.bbReach[b] * jc;
      }
      if (weight > 0) sbEv[h] = result.rootEvIp[h] / weight;
    }
    for (let b = 0; b < NUM_HANDS; b++) {
      let weight = 0;
      for (let h = 0; h < NUM_HANDS; h++) {
        const jc = joint[h * NUM_HANDS + b];
        if (jc === 0) continue;
        weight += spot.sbReach[h] * jc;
      }
      if (weight > 0) bbEv[b] = result.rootEvOop[b] / weight;
    }

    out.push({ path: spot.path, sbEv, bbEv });
  }
  void turnEquityCache;
  void buildJointCombosMatrix;
  return out;
}

export async function buildPostflopEvTable(
  config: GameConfig,
  scenarioStrategies: Map<string, { actions: string[]; player: 'SB' | 'BB'; strategy: Float64Array }>,
  options: {
    numBoards: number;
    iterations: number;
    usePhaseB: boolean;
    useParallel: boolean;
    seed?: number;
    onBoardDone?: (idx: number, total: number) => void;
  },
): Promise<PostflopEvResult> {
  const spots = collectPostflopSpots(config, scenarioStrategies);
  const boards = sampleBoards(options.numBoards, options.seed ?? 42);

  const perSpot = new Map<string, { sbEv: Float64Array; bbEv: Float64Array; boardCount: number }>();
  for (const s of spots) {
    perSpot.set(s.path, {
      sbEv: new Float64Array(NUM_HANDS),
      bbEv: new Float64Array(NUM_HANDS),
      boardCount: 0,
    });
  }

  for (let bi = 0; bi < boards.length; bi++) {
    const board = boards[bi].cards;
    const results = await evalSpotsOnBoard(board, spots, config, options.iterations, options.usePhaseB, options.useParallel);
    for (const r of results) {
      const agg = perSpot.get(r.path);
      if (!agg) continue;
      for (let h = 0; h < NUM_HANDS; h++) {
        agg.sbEv[h] += r.sbEv[h];
        agg.bbEv[h] += r.bbEv[h];
      }
      agg.boardCount++;
    }
    options.onBoardDone?.(bi + 1, boards.length);
  }

  // Normalize by board count
  for (const agg of perSpot.values()) {
    if (agg.boardCount === 0) continue;
    const inv = 1 / agg.boardCount;
    for (let h = 0; h < NUM_HANDS; h++) {
      agg.sbEv[h] *= inv;
      agg.bbEv[h] *= inv;
    }
  }

  void HAND_NAMES;
  return { perSpot, boards };
}

export function exportEvTableJson(result: PostflopEvResult): {
  spots: Record<string, { sbEv: number[]; bbEv: number[] }>;
  boards: string[];
} {
  const spots: Record<string, { sbEv: number[]; bbEv: number[] }> = {};
  for (const [path, agg] of result.perSpot.entries()) {
    spots[path] = {
      sbEv: Array.from(agg.sbEv).map(v => Number(v.toFixed(4))),
      bbEv: Array.from(agg.bbEv).map(v => Number(v.toFixed(4))),
    };
  }
  const boards = result.boards.map(b =>
    b.cards.map(c => {
      const rankChar = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'][Math.floor(c / 4)];
      const suitChar = ['s', 'h', 'd', 'c'][c % 4];
      return rankChar + suitChar;
    }).join(''),
  );
  return { spots, boards };
}

// Need to also export terminal node info, e.g., terminal_showdown - those use equity directly
// rather than EV lookup. We'll keep showdown handling in cfr.ts.

// Re-export expected types
export type { GameConfig } from './types.js';
export type { TerminalPostflopNode };
