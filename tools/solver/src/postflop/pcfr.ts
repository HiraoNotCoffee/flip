import { NUM_HANDS, buildJointCombosMatrix } from '../hand.js';
import { buildPostflopTree, walkPostflopTree, type PfDecision, type PfNode } from './ptree.js';
import { buildBoardEquity, type BoardEquity } from './boardEquity.js';

export interface PostflopConfig {
  startPotBb: number;
  effectiveStackBb: number; // remaining stack at start of flop (per player)
  flopBetPctOfPot: number[];
  maxRaiseCount: number;
  rakePct: number;
  rakeCapBb: number;
  // initial reach weights per player (e.g., from preflop CFR reach probabilities)
  oopReach: Float64Array; // length NUM_HANDS
  ipReach: Float64Array;  // length NUM_HANDS
}

interface PfInfoset {
  numActions: number;
  regretSum: Float64Array;   // NUM_HANDS × numActions
  strategySum: Float64Array;
}

export interface PostflopSolveResult {
  iterations: number;
  // Per decision node: average strategy (NUM_HANDS × numActions)
  strategies: Map<string, { actions: string[]; player: 'OOP' | 'IP'; strategy: Float64Array }>;
  // Per-hand expected EV at the root (OOP's perspective and IP's perspective)
  rootEvOop: Float64Array;
  rootEvIp: Float64Array;
}

interface SolveCtx {
  config: PostflopConfig;
  tree: PfNode;
  infosets: Map<string, PfInfoset>;
  equity: BoardEquity;
  joint: Float64Array;   // 169×169 joint combos WITHOUT board awareness (we use equity.totalCombos for weighting instead)
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
  node: { potBb: number; investedOop: number; investedIp: number; folder: 'OOP' | 'IP' },
  oopReach: Float64Array,
  ipReach: Float64Array,
): Utils {
  const oop = new Float64Array(NUM_HANDS);
  const ip = new Float64Array(NUM_HANDS);
  // Postflop folds incur rake (we are past the flop; No-Flop-No-Drop already cleared).
  // Folder loses their invested in this round. Winner takes (pot - rake) - their own invested.
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
  // Use board-aware combos for consistency with showdown/runout terminals.
  const jcm = ctx.equity.totalCombos;
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
  node: { potBb: number; investedOop: number; investedIp: number },
  oopReach: Float64Array,
  ipReach: Float64Array,
): Utils {
  const oop = new Float64Array(NUM_HANDS);
  const ip = new Float64Array(NUM_HANDS);
  const r = rake(node.potBb, ctx.config.rakePct, ctx.config.rakeCapBb);
  const netPot = node.potBb - r;
  const eq = ctx.equity.meanEquity; // OOP = "sb" in matrix? We define OOP = sb-bucket. Use as-is.
  const jcm = ctx.equity.totalCombos;
  for (let h = 0; h < NUM_HANDS; h++) {
    let acc = 0;
    for (let b = 0; b < NUM_HANDS; b++) {
      const idx = h * NUM_HANDS + b;
      const combos = jcm[idx];
      if (combos === 0) continue;
      const oopEq = eq[idx];
      // OOP payoff = oopEq * netPot - investedOop
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

function traverse(ctx: SolveCtx, node: PfNode, oopReach: Float64Array, ipReach: Float64Array): Utils {
  if (node.kind === 'terminal_fold') {
    return terminalFoldUtils(ctx, node, oopReach, ipReach);
  }
  if (node.kind === 'terminal_runout' || node.kind === 'terminal_showdown') {
    return terminalShowdownUtils(ctx, node, oopReach, ipReach);
  }
  return traverseDecision(ctx, node, oopReach, ipReach);
}

function traverseDecision(
  ctx: SolveCtx,
  node: PfDecision,
  oopReach: Float64Array,
  ipReach: Float64Array,
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
    const r = traverse(ctx, node.children[a], nextOop, nextIp);
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

  // Regret + strategy updates
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

export function solvePostflopWithEquity(
  config: PostflopConfig,
  equity: BoardEquity,
  iterations: number,
  options?: { logEvery?: number },
): PostflopSolveResult {
  const tree = buildPostflopTree({
    startPotBb: config.startPotBb,
    effectiveStackBb: config.effectiveStackBb,
    flopBetPctOfPot: config.flopBetPctOfPot,
    maxRaiseCount: config.maxRaiseCount,
  });
  const ctx: SolveCtx = {
    config,
    tree,
    infosets: initInfosets(tree),
    equity,
    joint: buildJointCombosMatrix(),
    iteration: 1,
  };

  const start = Date.now();
  let lastUtils: Utils = { oop: new Float64Array(NUM_HANDS), ip: new Float64Array(NUM_HANDS) };
  for (let t = 1; t <= iterations; t++) {
    ctx.iteration = t;
    lastUtils = traverse(ctx, tree, config.oopReach, config.ipReach);
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

export function solvePostflop(
  config: PostflopConfig,
  boardCards: number[],
  iterations: number,
  options?: { logEvery?: number },
): PostflopSolveResult {
  const equity = buildBoardEquity(boardCards);
  return solvePostflopWithEquity(config, equity, iterations, options);
}
