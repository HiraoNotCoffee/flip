// Postflop tree (Phase A)
// - Heads-up, SB = IP, BB = OOP (HU convention)
// - Flop is the only fully solved street; turn/river collapsed into all-in equity terminal
// - Bet sizes: configurable per node, default 50% / 100% pot
//
// Action vocabulary on flop:
//   OOP (BB) opens:   check | bet_<size>
//   IP after check:   check | bet_<size>
//   IP after bet:     fold | call | raise_<size>
//   OOP after raise:  fold | call | re-raise (capped by raise count)
// Terminal types:
//   fold       - one player folded; remaining pot to winner (rake applies)
//   showdown   - both committed all-in (postflop call after all-in raise); 7-card showdown immediately
//   runout     - both called/checked without all-in; remaining streets evaluated via all-in-equity approx

export type PfPlayer = 'OOP' | 'IP';

export interface PfAction {
  id: string;
  kind: 'check' | 'bet' | 'call' | 'raise' | 'fold' | 'allin';
  toBb?: number;
}

export interface PfDecision {
  kind: 'decision';
  path: string;
  player: PfPlayer;
  actions: PfAction[];
  children: PfNode[];
  potBb: number;
  investedOop: number;
  investedIp: number;
  lastBetBb: number;
  raiseCount: number;
}

export interface PfTerminalFold {
  kind: 'terminal_fold';
  path: string;
  folder: PfPlayer;
  potBb: number;
  investedOop: number;
  investedIp: number;
}

export interface PfTerminalShowdown {
  kind: 'terminal_showdown';
  path: string;
  potBb: number;
  investedOop: number;
  investedIp: number;
}

export interface PfTerminalRunout {
  kind: 'terminal_runout';
  path: string;
  potBb: number;
  investedOop: number;
  investedIp: number;
}

// Phase B: chance node — both players checked/called this street;
// the dealer brings a new card and play continues on the next street.
// The CFR loop iterates over all valid new cards (filtered by hand cards) and
// recursively solves the subtree (`childTree`) for each new card.
export interface PfChanceNode {
  kind: 'chance_turn' | 'chance_river';
  path: string;
  potBb: number;
  investedOop: number;
  investedIp: number;
  // The subtree built for the next street; same structure but advanced street.
  childTree: PfNode;
}

export type PfNode =
  | PfDecision
  | PfTerminalFold
  | PfTerminalShowdown
  | PfTerminalRunout
  | PfChanceNode;

export type Street = 'flop' | 'turn' | 'river';

export interface PfConfig {
  startPotBb: number;
  effectiveStackBb: number; // remaining stack per player at start of flop
  flopBetPctOfPot: number[]; // e.g., [50, 100]
  turnBetPctOfPot?: number[]; // defaults to flopBetPctOfPot
  riverBetPctOfPot?: number[]; // defaults to flopBetPctOfPot
  maxRaiseCount: number; // including initial bet
  street?: Street; // which street is currently being built. Defaults to 'flop'
  // If set, replace terminal_runout (both players checked/called) nodes with a chance
  // node pointing to the next street's subtree built with `street` advanced.
  buildNextStreet?: boolean;
}

interface BuildCtx {
  config: PfConfig;
  pathParts: string[];
  player: PfPlayer;
  investedOop: number;
  investedIp: number;
  lastBetBb: number;
  raiseCount: number;
}

function other(p: PfPlayer): PfPlayer {
  return p === 'OOP' ? 'IP' : 'OOP';
}

function makePath(parts: string[]): string {
  return parts.length === 0 ? 'flop_root' : parts.join('/');
}

// invested in this round (postflop). pot includes the carried-over preflop pot.
function pot(c: BuildCtx): number {
  return c.config.startPotBb + c.investedOop + c.investedIp;
}

function remainingStack(c: BuildCtx, p: PfPlayer): number {
  const invested = p === 'OOP' ? c.investedOop : c.investedIp;
  return c.config.effectiveStackBb - invested;
}

function maxInvested(c: BuildCtx): number {
  return Math.max(c.investedOop, c.investedIp);
}

function ctxFold(c: BuildCtx): PfTerminalFold {
  return {
    kind: 'terminal_fold',
    path: makePath([...c.pathParts, 'fold']),
    folder: c.player,
    potBb: pot(c),
    investedOop: c.investedOop,
    investedIp: c.investedIp,
  };
}

function ctxRunout(c: BuildCtx, label: string, matchedTo: number): PfNode {
  const potBb = c.config.startPotBb + matchedTo * 2;
  const node: PfTerminalRunout = {
    kind: 'terminal_runout',
    path: makePath([...c.pathParts, label]),
    potBb,
    investedOop: matchedTo,
    investedIp: matchedTo,
  };

  // Phase B: if requested, replace runout with a chance node that leads into the
  // next street's subtree built with the carried-over pot and effective stack.
  if (c.config.buildNextStreet && (c.config.street ?? 'flop') !== 'river') {
    const curStreet: Street = c.config.street ?? 'flop';
    const nextStreet: Street = curStreet === 'flop' ? 'turn' : 'river';
    const nextEffStack = c.config.effectiveStackBb - matchedTo;
    if (nextEffStack <= 0) return node; // already all-in: can't have further streets
    const nextSubtree = buildPostflopTree({
      ...c.config,
      startPotBb: potBb,
      effectiveStackBb: nextEffStack,
      street: nextStreet,
      // Only flop → turn auto-builds; turn → river requires explicit opt-in.
      // For Phase B we only build turn (not river). River runout is final.
      buildNextStreet: false,
    });
    const chance: PfChanceNode = {
      kind: curStreet === 'flop' ? 'chance_turn' : 'chance_river',
      path: makePath([...c.pathParts, label]),
      potBb,
      investedOop: matchedTo,
      investedIp: matchedTo,
      childTree: nextSubtree,
    };
    return chance;
  }
  return node;
}

function ctxShowdown(c: BuildCtx, label: string, matchedTo: number): PfTerminalShowdown {
  return {
    kind: 'terminal_showdown',
    path: makePath([...c.pathParts, label]),
    potBb: c.config.startPotBb + matchedTo * 2,
    investedOop: matchedTo,
    investedIp: matchedTo,
  };
}

export function buildPostflopTree(config: PfConfig): PfNode {
  return buildOopFirst({
    config,
    pathParts: [],
    player: 'OOP',
    investedOop: 0,
    investedIp: 0,
    lastBetBb: 0,
    raiseCount: 0,
  });
}

function betSizesFor(cfg: PfConfig): number[] {
  const street = cfg.street ?? 'flop';
  if (street === 'turn') return cfg.turnBetPctOfPot ?? cfg.flopBetPctOfPot;
  if (street === 'river') return cfg.riverBetPctOfPot ?? cfg.flopBetPctOfPot;
  return cfg.flopBetPctOfPot;
}

function buildOopFirst(c: BuildCtx): PfNode {
  // No prior action on this street → OOP picks check or bet
  const actions: PfAction[] = [{ id: 'check', kind: 'check' }];
  for (const pct of betSizesFor(c.config)) {
    const sizeBb = Math.min((pct / 100) * pot(c), remainingStack(c, 'OOP'));
    if (sizeBb <= 0) continue;
    actions.push({ id: `bet_${pct}p`, kind: 'bet', toBb: sizeBb });
  }
  return makeDecision(c, actions, action => {
    if (action.kind === 'check') {
      return buildIpAfterCheck({ ...c, pathParts: [...c.pathParts, 'check'], player: 'IP' });
    }
    const newInvested = c.investedOop + action.toBb!;
    return buildAfterBet(
      {
        ...c,
        pathParts: [...c.pathParts, action.id],
        player: 'IP',
        investedOop: newInvested,
        lastBetBb: action.toBb!,
        raiseCount: 1,
      },
      'IP',
    );
  });
}

function buildIpAfterCheck(c: BuildCtx): PfNode {
  // OOP checked → IP picks check or bet
  const actions: PfAction[] = [{ id: 'check', kind: 'check' }];
  for (const pct of betSizesFor(c.config)) {
    const sizeBb = Math.min((pct / 100) * pot(c), remainingStack(c, 'IP'));
    if (sizeBb <= 0) continue;
    actions.push({ id: `bet_${pct}p`, kind: 'bet', toBb: sizeBb });
  }
  return makeDecision(c, actions, action => {
    if (action.kind === 'check') {
      return ctxRunout({ ...c, pathParts: [...c.pathParts, 'check'] }, 'runout', c.investedOop);
    }
    const newInvested = c.investedIp + action.toBb!;
    return buildAfterBet(
      {
        ...c,
        pathParts: [...c.pathParts, action.id],
        player: 'OOP',
        investedIp: newInvested,
        lastBetBb: action.toBb!,
        raiseCount: 1,
      },
      'OOP',
    );
  });
}

function investedOf(c: BuildCtx, p: PfPlayer): number {
  return p === 'OOP' ? c.investedOop : c.investedIp;
}

// `facer` is the player to act facing a bet/raise from the opponent.
function buildAfterBet(c: BuildCtx, facer: PfPlayer): PfNode {
  const stack = c.config.effectiveStackBb;
  const myInv = investedOf(c, facer);
  const oppInv = investedOf(c, other(facer));
  const callAmount = oppInv - myInv;
  const myRemaining = stack - myInv;

  const actions: PfAction[] = [{ id: 'fold', kind: 'fold' }];
  actions.push({ id: 'call', kind: 'call', toBb: oppInv });

  // raises possible only if facer hasn't already committed everything and raise cap not reached
  const facingAllIn = oppInv >= stack - 1e-9;
  if (!facingAllIn && c.raiseCount < c.config.maxRaiseCount && myRemaining > callAmount) {
    const potIfCall = 2 * oppInv; // pot once facer calls
    const seen = new Set<number>();
    for (const pct of betSizesFor(c.config)) {
      const onTop = (potIfCall * pct) / 100;
      let raiseTo = oppInv + onTop;
      raiseTo = Math.min(raiseTo, stack);
      // ensure minimum legal raise (at least double the previous raise / bet)
      const minRaiseTo = oppInv + Math.max(callAmount, c.lastBetBb);
      if (raiseTo < minRaiseTo) raiseTo = Math.min(minRaiseTo, stack);
      const rounded = Math.round(raiseTo * 100) / 100;
      if (rounded - oppInv < 1e-6) continue;
      if (seen.has(rounded)) continue;
      seen.add(rounded);
      const isAllin = rounded >= stack - 1e-9;
      actions.push({
        id: isAllin ? 'allin' : `raise_${pct}p`,
        kind: isAllin ? 'allin' : 'raise',
        toBb: rounded,
      });
    }
    const stackRounded = Math.round(stack * 100) / 100;
    if (!seen.has(stackRounded)) {
      actions.push({ id: 'allin', kind: 'allin', toBb: stackRounded });
    }
  }

  return makeDecision(c, actions, action => {
    if (action.kind === 'fold') return ctxFold(c);
    if (action.kind === 'call') {
      const matched = oppInv;
      const ctxNext = { ...c, pathParts: [...c.pathParts, 'call'] };
      const isAllInCall = matched >= stack - 1e-9;
      if (isAllInCall) return ctxShowdown(ctxNext, 'showdown', matched);
      return ctxRunout(ctxNext, 'runout', matched);
    }
    // raise or allin
    const newInvestedForFacer = action.toBb!;
    const next: BuildCtx = {
      ...c,
      pathParts: [...c.pathParts, action.id],
      player: other(facer),
      raiseCount: c.raiseCount + 1,
      lastBetBb: newInvestedForFacer - myInv,
    };
    if (facer === 'OOP') next.investedOop = newInvestedForFacer;
    else next.investedIp = newInvestedForFacer;
    return buildAfterBet(next, other(facer));
  });
}

function makeDecision(
  c: BuildCtx,
  actions: PfAction[],
  childBuilder: (a: PfAction) => PfNode,
): PfDecision {
  return {
    kind: 'decision',
    path: makePath(c.pathParts),
    player: c.player,
    actions,
    children: actions.map(childBuilder),
    potBb: pot(c),
    investedOop: c.investedOop,
    investedIp: c.investedIp,
    lastBetBb: c.lastBetBb,
    raiseCount: c.raiseCount,
  };
}

export function walkPostflopTree(node: PfNode, visit: (n: PfNode) => void): void {
  visit(node);
  if (node.kind === 'decision') {
    for (const c of node.children) walkPostflopTree(c, visit);
  } else if (node.kind === 'chance_turn' || node.kind === 'chance_river') {
    walkPostflopTree(node.childTree, visit);
  }
}

export function countPostflopNodes(root: PfNode): {
  decisions: number;
  terminals: number;
  chanceNodes: number;
  terminalsByKind: Record<string, number>;
} {
  let decisions = 0;
  let terminals = 0;
  let chanceNodes = 0;
  const byKind: Record<string, number> = {};
  walkPostflopTree(root, n => {
    if (n.kind === 'decision') decisions++;
    else if (n.kind === 'chance_turn' || n.kind === 'chance_river') chanceNodes++;
    else {
      terminals++;
      byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
    }
  });
  return { decisions, terminals, chanceNodes, terminalsByKind: byKind };
}
