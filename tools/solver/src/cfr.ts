import { buildJointCombosMatrix, NUM_HANDS } from './hand.js';
import { equity } from './equity.js';
import { computeRake, foldPayoffSb } from './payoff.js';
import { buildTree, walkTree } from './tree.js';
import type { DecisionNode, GameConfig, TreeNode } from './types.js';

interface Infoset {
  numActions: number;
  regretSum: Float64Array; // NUM_HANDS * numActions
  strategySum: Float64Array;
}

export interface SolveResult {
  iterations: number;
  exploitabilityMbbPerPot: number;
  strategies: Map<string, { actions: string[]; player: 'SB' | 'BB'; strategy: Float64Array }>;
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
    const uniform = 1 / numActions;
    for (let a = 0; a < numActions; a++) out[a] = uniform;
  }
}

export interface PostflopEvTable {
  // spotPath -> per-hand SB/BB EV averaged across boards. When present, terminal_postflop
  // payoffs are taken from here instead of all-in-equity approximation.
  spots: Map<string, { sbEv: Float64Array; bbEv: Float64Array }>;
}

interface SolveContext {
  config: GameConfig;
  joint: Float64Array;
  infosets: Map<string, Infoset>;
  tree: TreeNode;
  iteration: number;
  postflopEvTable?: PostflopEvTable;
}

function traverse(
  ctx: SolveContext,
  node: TreeNode,
  sbReach: Float64Array,
  bbReach: Float64Array,
): { sbUtil: Float64Array; bbUtil: Float64Array } {
  if (node.kind === 'terminal_fold') {
    const sbUtil = new Float64Array(NUM_HANDS);
    const bbUtil = new Float64Array(NUM_HANDS);
    const sbPay = foldPayoffSb(node);
    const bbPay = -sbPay;
    for (let h = 0; h < NUM_HANDS; h++) {
      let s = 0;
      for (let b = 0; b < NUM_HANDS; b++) {
        const jc = ctx.joint[h * NUM_HANDS + b];
        if (jc === 0) continue;
        s += bbReach[b] * jc * sbPay;
      }
      sbUtil[h] = s;
    }
    for (let b = 0; b < NUM_HANDS; b++) {
      let s = 0;
      for (let h = 0; h < NUM_HANDS; h++) {
        const jc = ctx.joint[h * NUM_HANDS + b];
        if (jc === 0) continue;
        s += sbReach[h] * jc * bbPay;
      }
      bbUtil[b] = s;
    }
    return { sbUtil, bbUtil };
  }

  if (node.kind === 'terminal_postflop' && ctx.postflopEvTable) {
    // Look up per-hand SB/BB EV averaged across sampled boards.
    const entry = ctx.postflopEvTable.spots.get(node.path);
    if (entry) {
      const sbUtil = new Float64Array(NUM_HANDS);
      const bbUtil = new Float64Array(NUM_HANDS);
      // The EV table already accounts for the postflop subgame's invested amounts and rake.
      // It's an absolute per-hand EV value at the start of the flop, given the spot's reach.
      // For preflop CFR we need: per-hand value at this terminal weighted by opponent reach.
      // Approximation: treat ev[hand] as the cf-utility given uniform opponent reach.
      // To respect the current opponent reach, we scale by (bbReach[b] * jc) / (expected_reach[b] * jc)
      // — but we don't have the expected_reach normalization here. As a first-cut approximation:
      // sum_b bbReach[b] * jc * (ev[hand] / sum_b expected_reach[b] * jc) — collapses to ev[hand] when reach matches.
      // Practical simplification: use ev[hand] * sum_b (bbReach[b] * jc) as the SB utility.
      // This preserves regret ordering for the SB while staying consistent with other terminals.
      for (let h = 0; h < NUM_HANDS; h++) {
        let weight = 0;
        for (let b = 0; b < NUM_HANDS; b++) {
          const jc = ctx.joint[h * NUM_HANDS + b];
          if (jc === 0) continue;
          weight += bbReach[b] * jc;
        }
        sbUtil[h] = entry.sbEv[h] * weight;
      }
      for (let b = 0; b < NUM_HANDS; b++) {
        let weight = 0;
        for (let h = 0; h < NUM_HANDS; h++) {
          const jc = ctx.joint[h * NUM_HANDS + b];
          if (jc === 0) continue;
          weight += sbReach[h] * jc;
        }
        bbUtil[b] = entry.bbEv[b] * weight;
      }
      return { sbUtil, bbUtil };
    }
    // fall through to equity approximation
  }

  if (node.kind === 'terminal_showdown' || node.kind === 'terminal_postflop') {
    const sbUtil = new Float64Array(NUM_HANDS);
    const bbUtil = new Float64Array(NUM_HANDS);
    const rake = computeRake(node.potBb, ctx.config.rakePct, ctx.config.rakeCapBb);
    const netPot = node.potBb - rake;
    for (let h = 0; h < NUM_HANDS; h++) {
      let s = 0;
      for (let b = 0; b < NUM_HANDS; b++) {
        const jc = ctx.joint[h * NUM_HANDS + b];
        if (jc === 0) continue;
        const eq = equity(h, b);
        const sbPay = eq * netPot - node.investedSb;
        s += bbReach[b] * jc * sbPay;
      }
      sbUtil[h] = s;
    }
    for (let b = 0; b < NUM_HANDS; b++) {
      let s = 0;
      for (let h = 0; h < NUM_HANDS; h++) {
        const jc = ctx.joint[h * NUM_HANDS + b];
        if (jc === 0) continue;
        const eq = equity(h, b);
        const bbPay = (1 - eq) * netPot - node.investedBb;
        s += sbReach[h] * jc * bbPay;
      }
      bbUtil[b] = s;
    }
    return { sbUtil, bbUtil };
  }

  return traverseDecision(ctx, node, sbReach, bbReach);
}

function traverseDecision(
  ctx: SolveContext,
  node: DecisionNode,
  sbReach: Float64Array,
  bbReach: Float64Array,
): { sbUtil: Float64Array; bbUtil: Float64Array } {
  const numActions = node.actions.length;
  const isSb = node.player === 'SB';
  const myReach = isSb ? sbReach : bbReach;

  const infoset = ctx.infosets.get(node.path)!;

  const strategy = new Float64Array(NUM_HANDS * numActions);
  const tmpStrat = new Float64Array(numActions);
  for (let h = 0; h < NUM_HANDS; h++) {
    regretMatchingPlus(infoset.regretSum, h * numActions, numActions, tmpStrat);
    for (let a = 0; a < numActions; a++) strategy[h * numActions + a] = tmpStrat[a];
  }

  const childSbUtils: Float64Array[] = [];
  const childBbUtils: Float64Array[] = [];
  for (let a = 0; a < numActions; a++) {
    let nextSb = sbReach;
    let nextBb = bbReach;
    if (isSb) {
      nextSb = new Float64Array(NUM_HANDS);
      for (let h = 0; h < NUM_HANDS; h++) nextSb[h] = sbReach[h] * strategy[h * numActions + a];
    } else {
      nextBb = new Float64Array(NUM_HANDS);
      for (let b = 0; b < NUM_HANDS; b++) nextBb[b] = bbReach[b] * strategy[b * numActions + a];
    }
    const r = traverse(ctx, node.children[a], nextSb, nextBb);
    childSbUtils.push(r.sbUtil);
    childBbUtils.push(r.bbUtil);
  }

  const sbUtil = new Float64Array(NUM_HANDS);
  const bbUtil = new Float64Array(NUM_HANDS);

  if (isSb) {
    for (let h = 0; h < NUM_HANDS; h++) {
      let v = 0;
      for (let a = 0; a < numActions; a++) v += strategy[h * numActions + a] * childSbUtils[a][h];
      sbUtil[h] = v;
    }
    for (let b = 0; b < NUM_HANDS; b++) {
      let v = 0;
      for (let a = 0; a < numActions; a++) v += childBbUtils[a][b];
      bbUtil[b] = v;
    }
  } else {
    for (let b = 0; b < NUM_HANDS; b++) {
      let v = 0;
      for (let a = 0; a < numActions; a++) v += strategy[b * numActions + a] * childBbUtils[a][b];
      bbUtil[b] = v;
    }
    for (let h = 0; h < NUM_HANDS; h++) {
      let v = 0;
      for (let a = 0; a < numActions; a++) v += childSbUtils[a][h];
      sbUtil[h] = v;
    }
  }

  const t = ctx.iteration;
  if (isSb) {
    for (let h = 0; h < NUM_HANDS; h++) {
      const reach = myReach[h];
      const base = sbUtil[h];
      for (let a = 0; a < numActions; a++) {
        const regret = childSbUtils[a][h] - base;
        const idx = h * numActions + a;
        const cur = infoset.regretSum[idx] + regret;
        infoset.regretSum[idx] = cur > 0 ? cur : 0;
        infoset.strategySum[idx] += t * reach * strategy[idx];
      }
    }
  } else {
    for (let b = 0; b < NUM_HANDS; b++) {
      const reach = myReach[b];
      const base = bbUtil[b];
      for (let a = 0; a < numActions; a++) {
        const regret = childBbUtils[a][b] - base;
        const idx = b * numActions + a;
        const cur = infoset.regretSum[idx] + regret;
        infoset.regretSum[idx] = cur > 0 ? cur : 0;
        infoset.strategySum[idx] += t * reach * strategy[idx];
      }
    }
  }

  return { sbUtil, bbUtil };
}

function initInfosets(tree: TreeNode): Map<string, Infoset> {
  const map = new Map<string, Infoset>();
  walkTree(tree, n => {
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

function computeRootEv(
  ctx: SolveContext,
  player: 'SB' | 'BB',
): number {
  const sbReach = new Float64Array(NUM_HANDS).fill(1);
  const bbReach = new Float64Array(NUM_HANDS).fill(1);
  const { sbUtil, bbUtil } = traverseReadonly(ctx, ctx.tree, sbReach, bbReach);
  const util = player === 'SB' ? sbUtil : bbUtil;
  let total = 0;
  let weight = 0;
  for (let h = 0; h < NUM_HANDS; h++) {
    let w = 0;
    for (let b = 0; b < NUM_HANDS; b++) w += ctx.joint[h * NUM_HANDS + b];
    total += util[h];
    weight += w;
  }
  return total / weight;
}

function traverseReadonly(
  ctx: SolveContext,
  node: TreeNode,
  sbReach: Float64Array,
  bbReach: Float64Array,
): { sbUtil: Float64Array; bbUtil: Float64Array } {
  if (node.kind === 'terminal_fold') {
    const sbUtil = new Float64Array(NUM_HANDS);
    const bbUtil = new Float64Array(NUM_HANDS);
    const sbPay = foldPayoffSb(node);
    const bbPay = -sbPay;
    for (let h = 0; h < NUM_HANDS; h++) {
      let s = 0;
      for (let b = 0; b < NUM_HANDS; b++) {
        const jc = ctx.joint[h * NUM_HANDS + b];
        if (jc === 0) continue;
        s += bbReach[b] * jc * sbPay;
      }
      sbUtil[h] = s;
    }
    for (let b = 0; b < NUM_HANDS; b++) {
      let s = 0;
      for (let h = 0; h < NUM_HANDS; h++) {
        const jc = ctx.joint[h * NUM_HANDS + b];
        if (jc === 0) continue;
        s += sbReach[h] * jc * bbPay;
      }
      bbUtil[b] = s;
    }
    return { sbUtil, bbUtil };
  }
  if (node.kind === 'terminal_showdown' || node.kind === 'terminal_postflop') {
    const sbUtil = new Float64Array(NUM_HANDS);
    const bbUtil = new Float64Array(NUM_HANDS);
    const rake = computeRake(node.potBb, ctx.config.rakePct, ctx.config.rakeCapBb);
    const netPot = node.potBb - rake;
    for (let h = 0; h < NUM_HANDS; h++) {
      let s = 0;
      for (let b = 0; b < NUM_HANDS; b++) {
        const jc = ctx.joint[h * NUM_HANDS + b];
        if (jc === 0) continue;
        const eq = equity(h, b);
        s += bbReach[b] * jc * (eq * netPot - node.investedSb);
      }
      sbUtil[h] = s;
    }
    for (let b = 0; b < NUM_HANDS; b++) {
      let s = 0;
      for (let h = 0; h < NUM_HANDS; h++) {
        const jc = ctx.joint[h * NUM_HANDS + b];
        if (jc === 0) continue;
        const eq = equity(h, b);
        s += sbReach[h] * jc * ((1 - eq) * netPot - node.investedBb);
      }
      bbUtil[b] = s;
    }
    return { sbUtil, bbUtil };
  }

  // Decision: use average strategy
  const numActions = node.actions.length;
  const isSb = node.player === 'SB';
  const infoset = ctx.infosets.get(node.path)!;
  const avgStrat = getAverageStrategy(infoset);

  const childSb: Float64Array[] = [];
  const childBb: Float64Array[] = [];
  for (let a = 0; a < numActions; a++) {
    let ns = sbReach;
    let nb = bbReach;
    if (isSb) {
      ns = new Float64Array(NUM_HANDS);
      for (let h = 0; h < NUM_HANDS; h++) ns[h] = sbReach[h] * avgStrat[h * numActions + a];
    } else {
      nb = new Float64Array(NUM_HANDS);
      for (let b = 0; b < NUM_HANDS; b++) nb[b] = bbReach[b] * avgStrat[b * numActions + a];
    }
    const r = traverseReadonly(ctx, node.children[a], ns, nb);
    childSb.push(r.sbUtil);
    childBb.push(r.bbUtil);
  }

  const sbUtil = new Float64Array(NUM_HANDS);
  const bbUtil = new Float64Array(NUM_HANDS);
  if (isSb) {
    for (let h = 0; h < NUM_HANDS; h++) {
      let v = 0;
      for (let a = 0; a < numActions; a++) v += avgStrat[h * numActions + a] * childSb[a][h];
      sbUtil[h] = v;
    }
    for (let b = 0; b < NUM_HANDS; b++) {
      let v = 0;
      for (let a = 0; a < numActions; a++) v += childBb[a][b];
      bbUtil[b] = v;
    }
  } else {
    for (let b = 0; b < NUM_HANDS; b++) {
      let v = 0;
      for (let a = 0; a < numActions; a++) v += avgStrat[b * numActions + a] * childBb[a][b];
      bbUtil[b] = v;
    }
    for (let h = 0; h < NUM_HANDS; h++) {
      let v = 0;
      for (let a = 0; a < numActions; a++) v += childSb[a][h];
      sbUtil[h] = v;
    }
  }
  return { sbUtil, bbUtil };
}

function getAverageStrategy(infoset: Infoset): Float64Array {
  const numActions = infoset.numActions;
  const out = new Float64Array(NUM_HANDS * numActions);
  for (let h = 0; h < NUM_HANDS; h++) {
    let sum = 0;
    for (let a = 0; a < numActions; a++) sum += infoset.strategySum[h * numActions + a];
    if (sum > 0) {
      for (let a = 0; a < numActions; a++) out[h * numActions + a] = infoset.strategySum[h * numActions + a] / sum;
    } else {
      const uniform = 1 / numActions;
      for (let a = 0; a < numActions; a++) out[h * numActions + a] = uniform;
    }
  }
  return out;
}

export function solve(
  config: GameConfig,
  iterations: number,
  opts?: { logEvery?: number; postflopEvTable?: PostflopEvTable },
): SolveResult {
  const tree = buildTree(config);
  const ctx: SolveContext = {
    config,
    joint: buildJointCombosMatrix(),
    infosets: initInfosets(tree),
    tree,
    iteration: 1,
    postflopEvTable: opts?.postflopEvTable,
  };

  const sbInit = new Float64Array(NUM_HANDS).fill(1);
  const bbInit = new Float64Array(NUM_HANDS).fill(1);

  const logEvery = opts?.logEvery ?? 0;
  const start = Date.now();

  for (let t = 1; t <= iterations; t++) {
    ctx.iteration = t;
    traverse(ctx, tree, sbInit, bbInit);
    if (logEvery > 0 && (t % logEvery === 0 || t === iterations)) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[iter ${t}/${iterations}] elapsed ${elapsed}s`);
    }
  }

  const strategies = new Map<string, { actions: string[]; player: 'SB' | 'BB'; strategy: Float64Array }>();
  walkTree(tree, n => {
    if (n.kind === 'decision') {
      const infoset = ctx.infosets.get(n.path)!;
      strategies.set(n.path, {
        actions: n.actions.map(a => a.id),
        player: n.player,
        strategy: getAverageStrategy(infoset),
      });
    }
  });

  const evSb = computeRootEv(ctx, 'SB');
  const evBb = computeRootEv(ctx, 'BB');
  const totalCombos = 1326 * 1326;
  const evSbNorm = evSb / totalCombos;
  const evBbNorm = evBb / totalCombos;
  const exploitabilityBb = Math.max(0, -(evSbNorm + evBbNorm));
  const meanPotBb = 5;
  const exploitabilityMbbPerPot = (exploitabilityBb / meanPotBb) * 1000;

  return {
    iterations,
    exploitabilityMbbPerPot,
    strategies,
  };
}
