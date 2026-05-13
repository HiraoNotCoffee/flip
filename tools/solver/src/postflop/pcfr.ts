import { NUM_HANDS } from '../hand.js';
import { buildPostflopTree, walkPostflopTree, type PfDecision, type PfNode } from './ptree.js';
import { buildBoardEquity, type BoardEquity } from './boardEquity.js';
import { buildBoardEquityParallel, precomputeTurnEquities } from './boardEquityParallel.js';
import { enumCombos } from '../hand.js';

export interface PostflopConfig {
  startPotBb: number;
  effectiveStackBb: number;
  flopBetPctOfPot: number[];
  turnBetPctOfPot?: number[];
  maxRaiseCount: number;
  rakePct: number;
  rakeCapBb: number;
  oopReach: Float64Array;
  ipReach: Float64Array;
}

interface PfInfoset {
  numActions: number;
  regretSum: Float64Array;
  strategySum: Float64Array;
}

export interface PostflopSolveResult {
  iterations: number;
  strategies: Map<string, { actions: string[]; player: 'OOP' | 'IP'; strategy: Float64Array }>;
  rootEvOop: Float64Array;
  rootEvIp: Float64Array;
}

interface SolveCtx {
  config: PostflopConfig;
  tree: PfNode;
  infosets: Map<string, PfInfoset>;
  flopBoard: number[];     // 3 flop cards (card indices)
  flopEquity: BoardEquity;
  // Cache turn equity per turn card (52 entries; entries for board cards or invalid turn cards are null)
  turnEquityCache: Array<BoardEquity | null>;
  // Per-hand bucket "doesn't include this card" mask: invalidBucketForCard[card][bucket] = 1 if bucket has any combo containing the card
  bucketHasCard: Uint8Array; // 52 × NUM_HANDS, 1 if any combo of bucket contains card
  iteration: number;
}

function regretMatchingPlus(regrets: Float64Array, offset: number, numActions: number, out: Float64Array): void {
  let sum = 0;
  for (let a = 0; a < numActions; a++) {
    const v = regrets[offset + a];
    if (v > 0) sum += v;
  }
  if (sum > 0) {
    for (let a = 0; a < numActions; a++) {
      const v = regrets[offset + a];
      out[a] = v > 0 ? v / sum : 0;
    }
  } else {
    const u = 1 / numActions;
    for (let a = 0; a < numActions; a++) out[a] = u;
  }
}

function rake(potBb: number, pct: number, cap: number): number {
  return Math.min(potBb * pct, cap);
}

interface Utils {
  oop: Float64Array;
  ip: Float64Array;
}

function terminalFoldUtils(
  ctx: SolveCtx,
  equity: BoardEquity,
  node: { potBb: number; investedOop: number; investedIp: number; folder: 'OOP' | 'IP' },
  oopReach: Float64Array,
  ipReach: Float64Array,
): Utils {
  const oop = new Float64Array(NUM_HANDS);
  const ip = new Float64Array(NUM_HANDS);
  const r = rake(node.potBb, ctx.config.rakePct, ctx.config.rakeCapBb);
  let oopPayoff: number;
  let ipPayoff: number;
  if (node.folder === 'OOP') {
    oopPayoff = -node.investedOop;
    ipPayoff = (node.potBb - r) - node.investedIp;
  } else {
    ipPayoff = -node.investedIp;
    oopPayoff = (node.potBb - r) - node.investedOop;
  }
  const jcm = equity.totalCombos;
  for (let h = 0; h < NUM_HANDS; h++) {
    let acc = 0;
    for (let b = 0; b < NUM_HANDS; b++) {
      const jc = jcm[h * NUM_HANDS + b];
      if (jc === 0) continue;
      acc += ipReach[b] * jc * oopPayoff;
    }
    oop[h] = acc;
  }
  for (let b = 0; b < NUM_HANDS; b++) {
    let acc = 0;
    for (let h = 0; h < NUM_HANDS; h++) {
      const jc = jcm[h * NUM_HANDS + b];
      if (jc === 0) continue;
      acc += oopReach[h] * jc * ipPayoff;
    }
    ip[b] = acc;
  }
  return { oop, ip };
}

function terminalShowdownUtils(
  ctx: SolveCtx,
  equity: BoardEquity,
  node: { potBb: number; investedOop: number; investedIp: number },
  oopReach: Float64Array,
  ipReach: Float64Array,
): Utils {
  const oop = new Float64Array(NUM_HANDS);
  const ip = new Float64Array(NUM_HANDS);
  const r = rake(node.potBb, ctx.config.rakePct, ctx.config.rakeCapBb);
  const netPot = node.potBb - r;
  const eq = equity.meanEquity;
  const jcm = equity.totalCombos;
  for (let h = 0; h < NUM_HANDS; h++) {
    let acc = 0;
    for (let b = 0; b < NUM_HANDS; b++) {
      const idx = h * NUM_HANDS + b;
      const combos = jcm[idx];
      if (combos === 0) continue;
      const oopEq = eq[idx];
      acc += ipReach[b] * combos * (oopEq * netPot - node.investedOop);
    }
    oop[h] = acc;
  }
  for (let b = 0; b < NUM_HANDS; b++) {
    let acc = 0;
    for (let h = 0; h < NUM_HANDS; h++) {
      const idx = h * NUM_HANDS + b;
      const combos = jcm[idx];
      if (combos === 0) continue;
      const oopEq = eq[idx];
      acc += oopReach[h] * combos * ((1 - oopEq) * netPot - node.investedIp);
    }
    ip[b] = acc;
  }
  return { oop, ip };
}

function getTurnEquity(ctx: SolveCtx, turnCard: number): BoardEquity {
  let eq = ctx.turnEquityCache[turnCard];
  if (eq) return eq;
  const board4 = [...ctx.flopBoard, turnCard];
  eq = buildBoardEquity(board4);
  ctx.turnEquityCache[turnCard] = eq;
  return eq;
}

function traverseChance(
  ctx: SolveCtx,
  node: { potBb: number; investedOop: number; investedIp: number; childTree: PfNode },
  oopReach: Float64Array,
  ipReach: Float64Array,
): Utils {
  const sumOop = new Float64Array(NUM_HANDS);
  const sumIp = new Float64Array(NUM_HANDS);

  // Enumerate all 52 - 3 = 49 possible turn cards (excluding the flop).
  // For each card, scale per-hand reach by P(hand still compatible) and recurse with that turn's equity.
  // We use the bucket-level approximation: if a bucket has only combos that all contain the new card, its reach drops to 0.
  // bucketHasCard[c * NUM_HANDS + h] tells fraction of combos that contain c.

  const flopSet = new Uint8Array(52);
  for (const c of ctx.flopBoard) flopSet[c] = 1;

  // Pre-compute scaled reaches once for each turn card by scaling reach[h] by (totalCombos - combosWith(c)) / totalCombos.
  // For simplicity we use a Uint8Array boolean: 1 if bucket has any combo with the card. We then ignore that hand for that card.
  // This is an approximation; a more accurate version would use fractional weights.

  let validCards = 0;
  for (let c = 0; c < 52; c++) {
    if (flopSet[c]) continue;
    validCards++;
    const turnEq = getTurnEquity(ctx, c);

    const oopAdj = new Float64Array(NUM_HANDS);
    const ipAdj = new Float64Array(NUM_HANDS);
    for (let h = 0; h < NUM_HANDS; h++) {
      if (ctx.bucketHasCard[c * NUM_HANDS + h]) {
        // Use board-aware combos to scale: how many of bucket's combos avoid card c.
        // Approximation: just scale by combos remaining after removing c, using turn equity's combo data.
        // turnEq.totalCombos uses 4-card board, so already excludes c-containing combos. Approximate uniform-opp scaling:
        oopAdj[h] = oopReach[h]; // we keep reach but turnEq.totalCombos = 0 will zero out terminal contributions automatically
      } else {
        oopAdj[h] = oopReach[h];
      }
      if (ctx.bucketHasCard[c * NUM_HANDS + h]) {
        ipAdj[h] = ipReach[h];
      } else {
        ipAdj[h] = ipReach[h];
      }
    }

    const childUtils = traverse(ctx, node.childTree, oopAdj, ipAdj, turnEq);
    for (let h = 0; h < NUM_HANDS; h++) sumOop[h] += childUtils.oop[h];
    for (let b = 0; b < NUM_HANDS; b++) sumIp[b] += childUtils.ip[b];
  }

  if (validCards > 0) {
    const inv = 1 / validCards;
    for (let h = 0; h < NUM_HANDS; h++) sumOop[h] *= inv;
    for (let b = 0; b < NUM_HANDS; b++) sumIp[b] *= inv;
  }
  return { oop: sumOop, ip: sumIp };
}

function traverse(
  ctx: SolveCtx,
  node: PfNode,
  oopReach: Float64Array,
  ipReach: Float64Array,
  equity: BoardEquity,
): Utils {
  if (node.kind === 'terminal_fold') {
    return terminalFoldUtils(ctx, equity, node, oopReach, ipReach);
  }
  if (node.kind === 'terminal_runout' || node.kind === 'terminal_showdown') {
    return terminalShowdownUtils(ctx, equity, node, oopReach, ipReach);
  }
  if (node.kind === 'chance_turn' || node.kind === 'chance_river') {
    return traverseChance(ctx, node, oopReach, ipReach);
  }
  return traverseDecision(ctx, node, oopReach, ipReach, equity);
}

function traverseDecision(
  ctx: SolveCtx,
  node: PfDecision,
  oopReach: Float64Array,
  ipReach: Float64Array,
  equity: BoardEquity,
): Utils {
  const numActions = node.actions.length;
  const isOop = node.player === 'OOP';
  const info = ctx.infosets.get(node.path)!;

  const strategy = new Float64Array(NUM_HANDS * numActions);
  const tmp = new Float64Array(numActions);
  for (let h = 0; h < NUM_HANDS; h++) {
    regretMatchingPlus(info.regretSum, h * numActions, numActions, tmp);
    for (let a = 0; a < numActions; a++) strategy[h * numActions + a] = tmp[a];
  }

  const childOop: Float64Array[] = [];
  const childIp: Float64Array[] = [];
  for (let a = 0; a < numActions; a++) {
    let nextOop = oopReach;
    let nextIp = ipReach;
    if (isOop) {
      nextOop = new Float64Array(NUM_HANDS);
      for (let h = 0; h < NUM_HANDS; h++) nextOop[h] = oopReach[h] * strategy[h * numActions + a];
    } else {
      nextIp = new Float64Array(NUM_HANDS);
      for (let b = 0; b < NUM_HANDS; b++) nextIp[b] = ipReach[b] * strategy[b * numActions + a];
    }
    const r = traverse(ctx, node.children[a], nextOop, nextIp, equity);
    childOop.push(r.oop);
    childIp.push(r.ip);
  }

  const oopUtil = new Float64Array(NUM_HANDS);
  const ipUtil = new Float64Array(NUM_HANDS);
  if (isOop) {
    for (let h = 0; h < NUM_HANDS; h++) {
      let v = 0;
      for (let a = 0; a < numActions; a++) v += strategy[h * numActions + a] * childOop[a][h];
      oopUtil[h] = v;
    }
    for (let b = 0; b < NUM_HANDS; b++) {
      let v = 0;
      for (let a = 0; a < numActions; a++) v += childIp[a][b];
      ipUtil[b] = v;
    }
  } else {
    for (let b = 0; b < NUM_HANDS; b++) {
      let v = 0;
      for (let a = 0; a < numActions; a++) v += strategy[b * numActions + a] * childIp[a][b];
      ipUtil[b] = v;
    }
    for (let h = 0; h < NUM_HANDS; h++) {
      let v = 0;
      for (let a = 0; a < numActions; a++) v += childOop[a][h];
      oopUtil[h] = v;
    }
  }

  const t = ctx.iteration;
  const myReach = isOop ? oopReach : ipReach;
  if (isOop) {
    for (let h = 0; h < NUM_HANDS; h++) {
      const base = oopUtil[h];
      const reach = myReach[h];
      for (let a = 0; a < numActions; a++) {
        const idx = h * numActions + a;
        const regret = childOop[a][h] - base;
        const cur = info.regretSum[idx] + regret;
        info.regretSum[idx] = cur > 0 ? cur : 0;
        info.strategySum[idx] += t * reach * strategy[idx];
      }
    }
  } else {
    for (let b = 0; b < NUM_HANDS; b++) {
      const base = ipUtil[b];
      const reach = myReach[b];
      for (let a = 0; a < numActions; a++) {
        const idx = b * numActions + a;
        const regret = childIp[a][b] - base;
        const cur = info.regretSum[idx] + regret;
        info.regretSum[idx] = cur > 0 ? cur : 0;
        info.strategySum[idx] += t * reach * strategy[idx];
      }
    }
  }
  return { oop: oopUtil, ip: ipUtil };
}

function initInfosets(tree: PfNode): Map<string, PfInfoset> {
  const map = new Map<string, PfInfoset>();
  walkPostflopTree(tree, n => {
    if (n.kind === 'decision') {
      const numActions = n.actions.length;
      map.set(n.path, {
        numActions,
        regretSum: new Float64Array(NUM_HANDS * numActions),
        strategySum: new Float64Array(NUM_HANDS * numActions),
      });
    }
  });
  return map;
}

function avgStrategy(info: PfInfoset): Float64Array {
  const out = new Float64Array(NUM_HANDS * info.numActions);
  for (let h = 0; h < NUM_HANDS; h++) {
    let sum = 0;
    for (let a = 0; a < info.numActions; a++) sum += info.strategySum[h * info.numActions + a];
    if (sum > 0) {
      for (let a = 0; a < info.numActions; a++) out[h * info.numActions + a] = info.strategySum[h * info.numActions + a] / sum;
    } else {
      const u = 1 / info.numActions;
      for (let a = 0; a < info.numActions; a++) out[h * info.numActions + a] = u;
    }
  }
  return out;
}

function buildBucketHasCard(): Uint8Array {
  const arr = new Uint8Array(52 * NUM_HANDS);
  for (let h = 0; h < NUM_HANDS; h++) {
    const combos = enumCombos(h);
    const cardsInBucket = new Set<number>();
    for (const [a, b] of combos) { cardsInBucket.add(a); cardsInBucket.add(b); }
    for (const c of cardsInBucket) arr[c * NUM_HANDS + h] = 1;
  }
  return arr;
}

export interface SolvePostflopOptions {
  logEvery?: number;
  buildTurnEquityEager?: boolean; // if true, precompute all 49 turn equities up front
  useParallel?: boolean; // use parallel buildBoardEquity (8 workers per board)
  flopWorkers?: number;  // default 8
  turnConcurrency?: number; // default 16 (board-level parallelism for turn equity)
}

export function solvePostflopWithEquity(
  config: PostflopConfig,
  equity: BoardEquity,
  iterations: number,
  options?: SolvePostflopOptions,
): PostflopSolveResult {
  const tree = buildPostflopTree({
    startPotBb: config.startPotBb,
    effectiveStackBb: config.effectiveStackBb,
    flopBetPctOfPot: config.flopBetPctOfPot,
    turnBetPctOfPot: config.turnBetPctOfPot,
    maxRaiseCount: config.maxRaiseCount,
  });
  const ctx: SolveCtx = {
    config,
    tree,
    infosets: initInfosets(tree),
    flopBoard: [],
    flopEquity: equity,
    turnEquityCache: new Array(52).fill(null),
    bucketHasCard: buildBucketHasCard(),
    iteration: 1,
  };

  const start = Date.now();
  let lastUtils: Utils = { oop: new Float64Array(NUM_HANDS), ip: new Float64Array(NUM_HANDS) };
  for (let t = 1; t <= iterations; t++) {
    ctx.iteration = t;
    lastUtils = traverse(ctx, tree, config.oopReach, config.ipReach, equity);
    if (options?.logEvery && (t % options.logEvery === 0 || t === iterations)) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  [postflop iter ${t}/${iterations}] elapsed ${elapsed}s`);
    }
  }

  const strategies = new Map<string, { actions: string[]; player: 'OOP' | 'IP'; strategy: Float64Array }>();
  walkPostflopTree(tree, n => {
    if (n.kind === 'decision') {
      const info = ctx.infosets.get(n.path)!;
      strategies.set(n.path, {
        actions: n.actions.map(a => a.id),
        player: n.player,
        strategy: avgStrategy(info),
      });
    }
  });

  return {
    iterations,
    strategies,
    rootEvOop: lastUtils.oop,
    rootEvIp: lastUtils.ip,
  };
}

export async function solvePostflopAsync(
  config: PostflopConfig,
  boardCards: number[],
  iterations: number,
  options?: SolvePostflopOptions & { phaseB?: boolean },
): Promise<PostflopSolveResult> {
  const useParallel = options?.useParallel ?? false;
  const flopEquity = useParallel
    ? await buildBoardEquityParallel(boardCards, { workers: options?.flopWorkers ?? 8 })
    : buildBoardEquity(boardCards);
  const phaseB = options?.phaseB ?? false;

  if (!phaseB) {
    return solvePostflopWithEquity(config, flopEquity, iterations, options);
  }

  const tree = buildPostflopTree({
    startPotBb: config.startPotBb,
    effectiveStackBb: config.effectiveStackBb,
    flopBetPctOfPot: config.flopBetPctOfPot,
    turnBetPctOfPot: config.turnBetPctOfPot,
    maxRaiseCount: config.maxRaiseCount,
    street: 'flop',
    buildNextStreet: true,
  });
  const ctx: SolveCtx = {
    config,
    tree,
    infosets: initInfosets(tree),
    flopBoard: boardCards,
    flopEquity,
    turnEquityCache: new Array(52).fill(null),
    bucketHasCard: buildBucketHasCard(),
    iteration: 1,
  };

  if (options?.buildTurnEquityEager) {
    if (useParallel) {
      const t0 = Date.now();
      const turnEqs = await precomputeTurnEquities(boardCards, {
        concurrency: options.turnConcurrency ?? 16,
        onProgress: (done, total) => {
          if (done % 10 === 0 || done === total) {
            const el = ((Date.now() - t0) / 1000).toFixed(1);
            console.log(`  [turn equity ${done}/${total} parallel] elapsed ${el}s`);
          }
        },
      });
      for (let c = 0; c < 52; c++) ctx.turnEquityCache[c] = turnEqs[c];
    } else {
      const flopSet = new Uint8Array(52);
      for (const c of boardCards) flopSet[c] = 1;
      const t0 = Date.now();
      let built = 0;
      for (let c = 0; c < 52; c++) {
        if (flopSet[c]) continue;
        getTurnEquity(ctx, c);
        built++;
        if (built % 10 === 0) {
          const el = ((Date.now() - t0) / 1000).toFixed(1);
          console.log(`  [turn equity ${built}/49] elapsed ${el}s`);
        }
      }
    }
  }

  const start = Date.now();
  let lastUtils: Utils = { oop: new Float64Array(NUM_HANDS), ip: new Float64Array(NUM_HANDS) };
  for (let t = 1; t <= iterations; t++) {
    ctx.iteration = t;
    lastUtils = traverse(ctx, tree, config.oopReach, config.ipReach, flopEquity);
    if (options?.logEvery && (t % options.logEvery === 0 || t === iterations)) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  [phaseB iter ${t}/${iterations}] elapsed ${elapsed}s`);
    }
  }

  const strategies = new Map<string, { actions: string[]; player: 'OOP' | 'IP'; strategy: Float64Array }>();
  walkPostflopTree(tree, n => {
    if (n.kind === 'decision') {
      const info = ctx.infosets.get(n.path)!;
      strategies.set(n.path, {
        actions: n.actions.map(a => a.id),
        player: n.player,
        strategy: avgStrategy(info),
      });
    }
  });

  return {
    iterations,
    strategies,
    rootEvOop: lastUtils.oop,
    rootEvIp: lastUtils.ip,
  };
}

export function solvePostflop(
  config: PostflopConfig,
  boardCards: number[],
  iterations: number,
  options?: SolvePostflopOptions & { phaseB?: boolean },
): PostflopSolveResult {
  const flopEquity = buildBoardEquity(boardCards);
  const phaseB = options?.phaseB ?? false;

  if (!phaseB) {
    return solvePostflopWithEquity(config, flopEquity, iterations, options);
  }

  // Phase B: build tree with chance nodes to next street, and prime context with flop board.
  const tree = buildPostflopTree({
    startPotBb: config.startPotBb,
    effectiveStackBb: config.effectiveStackBb,
    flopBetPctOfPot: config.flopBetPctOfPot,
    turnBetPctOfPot: config.turnBetPctOfPot,
    maxRaiseCount: config.maxRaiseCount,
    street: 'flop',
    buildNextStreet: true,
  });
  const ctx: SolveCtx = {
    config,
    tree,
    infosets: initInfosets(tree),
    flopBoard: boardCards,
    flopEquity,
    turnEquityCache: new Array(52).fill(null),
    bucketHasCard: buildBucketHasCard(),
    iteration: 1,
  };

  if (options?.buildTurnEquityEager) {
    const flopSet = new Uint8Array(52);
    for (const c of boardCards) flopSet[c] = 1;
    const t0 = Date.now();
    let built = 0;
    for (let c = 0; c < 52; c++) {
      if (flopSet[c]) continue;
      getTurnEquity(ctx, c);
      built++;
      if (built % 10 === 0) {
        const el = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`  [turn equity ${built}/49] elapsed ${el}s`);
      }
    }
  }

  const start = Date.now();
  let lastUtils: Utils = { oop: new Float64Array(NUM_HANDS), ip: new Float64Array(NUM_HANDS) };
  for (let t = 1; t <= iterations; t++) {
    ctx.iteration = t;
    lastUtils = traverse(ctx, tree, config.oopReach, config.ipReach, flopEquity);
    if (options?.logEvery && (t % options.logEvery === 0 || t === iterations)) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  [phaseB iter ${t}/${iterations}] elapsed ${elapsed}s`);
    }
  }

  const strategies = new Map<string, { actions: string[]; player: 'OOP' | 'IP'; strategy: Float64Array }>();
  walkPostflopTree(tree, n => {
    if (n.kind === 'decision') {
      const info = ctx.infosets.get(n.path)!;
      strategies.set(n.path, {
        actions: n.actions.map(a => a.id),
        player: n.player,
        strategy: avgStrategy(info),
      });
    }
  });

  return {
    iterations,
    strategies,
    rootEvOop: lastUtils.oop,
    rootEvIp: lastUtils.ip,
  };
}
