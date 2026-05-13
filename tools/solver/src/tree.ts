import type {
  Action,
  DecisionNode,
  GameConfig,
  Player,
  TerminalFoldNode,
  TerminalPostflopNode,
  TerminalShowdownNode,
  TreeNode,
} from './types.js';

interface BuildContext {
  config: GameConfig;
  path: string[];
  player: Player;
  investedSb: number;
  investedBb: number;
  lastRaiseBb: number;
  raiseCount: number;
}

function makePath(parts: string[]): string {
  return parts.length === 0 ? 'root' : parts.join('/');
}

function other(p: Player): Player {
  return p === 'SB' ? 'BB' : 'SB';
}

function ctxFold(ctx: BuildContext): TerminalFoldNode {
  return {
    kind: 'terminal_fold',
    path: makePath([...ctx.path, 'fold']),
    folder: ctx.player,
    potBb: ctx.investedSb + ctx.investedBb,
    investedSb: ctx.investedSb,
    investedBb: ctx.investedBb,
  };
}

function ctxShowdown(ctx: BuildContext, label: string): TerminalShowdownNode {
  const investedSb = ctx.config.stackBb;
  const investedBb = ctx.config.stackBb;
  return {
    kind: 'terminal_showdown',
    path: makePath([...ctx.path, label]),
    potBb: investedSb + investedBb,
    investedSb,
    investedBb,
  };
}

function ctxPostflop(ctx: BuildContext, label: string, matchedTo: number): TerminalPostflopNode {
  const investedSb = matchedTo;
  const investedBb = matchedTo;
  return {
    kind: 'terminal_postflop',
    path: makePath([...ctx.path, label]),
    potBb: investedSb + investedBb,
    investedSb,
    investedBb,
  };
}

function decision(
  ctx: BuildContext,
  actions: Action[],
  childBuilder: (a: Action) => TreeNode,
): DecisionNode {
  return {
    kind: 'decision',
    path: makePath(ctx.path),
    player: ctx.player,
    actions,
    children: actions.map(childBuilder),
    potBb: ctx.investedSb + ctx.investedBb,
    investedSb: ctx.investedSb,
    investedBb: ctx.investedBb,
  };
}

export function buildTree(config: GameConfig): TreeNode {
  return buildRoot({
    config,
    path: [],
    player: 'SB',
    investedSb: config.sbBb,
    investedBb: config.bbBb,
    lastRaiseBb: config.bbBb,
    raiseCount: 0,
  });
}

function buildRoot(ctx: BuildContext): TreeNode {
  const actions: Action[] = [
    { id: 'fold', kind: 'fold' },
    { id: 'limp', kind: 'limp', amountBb: ctx.config.bbBb },
    ...ctx.config.openSizesBb.map(s => ({
      id: `open_${s}`,
      kind: 'raise' as const,
      amountBb: s,
    })),
  ];

  return decision(ctx, actions, action => {
    if (action.kind === 'fold') return ctxFold(ctx);
    if (action.kind === 'limp') {
      return buildVsLimp({
        ...ctx,
        path: [...ctx.path, action.id],
        player: 'BB',
        investedSb: ctx.config.bbBb,
        lastRaiseBb: ctx.config.bbBb,
      });
    }
    return buildVsOpen({
      ...ctx,
      path: [...ctx.path, action.id],
      player: 'BB',
      investedSb: action.amountBb!,
      lastRaiseBb: action.amountBb!,
      raiseCount: 1,
    });
  });
}

function buildVsLimp(ctx: BuildContext): TreeNode {
  const actions: Action[] = [
    { id: 'check', kind: 'check' },
    ...ctx.config.vsLimpRaiseSizesBb.map(s => ({
      id: `raise_${s}`,
      kind: 'raise' as const,
      amountBb: s,
    })),
  ];

  return decision(ctx, actions, action => {
    if (action.kind === 'check') {
      return ctxPostflop(ctx, 'check', ctx.config.bbBb);
    }
    return buildVsRaise({
      ...ctx,
      path: [...ctx.path, action.id],
      player: 'SB',
      investedBb: action.amountBb!,
      lastRaiseBb: action.amountBb!,
      raiseCount: 1,
    });
  });
}

function buildVsOpen(ctx: BuildContext): TreeNode {
  const actions: Action[] = [
    { id: 'fold', kind: 'fold' },
    { id: 'call', kind: 'call', amountBb: ctx.investedSb },
    ...ctx.config.threeBetSizesBb.map(s => ({
      id: `3bet_${s}`,
      kind: 'raise' as const,
      amountBb: s,
    })),
  ];

  return decision(ctx, actions, action => {
    if (action.kind === 'fold') return ctxFold(ctx);
    if (action.kind === 'call') {
      return ctxPostflop(ctx, 'call', ctx.investedSb);
    }
    return buildVs3Bet({
      ...ctx,
      path: [...ctx.path, action.id],
      player: 'SB',
      investedBb: action.amountBb!,
      lastRaiseBb: action.amountBb!,
      raiseCount: 2,
    });
  });
}

function buildVsRaise(ctx: BuildContext): TreeNode {
  const actions: Action[] = [
    { id: 'fold', kind: 'fold' },
    { id: 'call', kind: 'call', amountBb: ctx.investedBb },
  ];

  return decision(ctx, actions, action => {
    if (action.kind === 'fold') return ctxFold(ctx);
    return ctxPostflop(ctx, 'call', ctx.investedBb);
  });
}

function buildVs3Bet(ctx: BuildContext): TreeNode {
  const actions: Action[] = [
    { id: 'fold', kind: 'fold' },
    { id: 'call', kind: 'call', amountBb: ctx.investedBb },
    ...ctx.config.fourBetSizesBb.map(s => ({
      id: `4bet_${s}`,
      kind: 'raise' as const,
      amountBb: s,
    })),
  ];

  return decision(ctx, actions, action => {
    if (action.kind === 'fold') return ctxFold(ctx);
    if (action.kind === 'call') {
      return ctxPostflop(ctx, 'call', ctx.investedBb);
    }
    return buildVs4Bet({
      ...ctx,
      path: [...ctx.path, action.id],
      player: other(ctx.player),
      investedSb: action.amountBb!,
      lastRaiseBb: action.amountBb!,
      raiseCount: 3,
    });
  });
}

function buildVs4Bet(ctx: BuildContext): TreeNode {
  const actions: Action[] = [
    { id: 'fold', kind: 'fold' },
    { id: 'call', kind: 'call', amountBb: ctx.investedSb },
    { id: '5bet_allin', kind: 'allin', amountBb: ctx.config.stackBb },
  ];

  return decision(ctx, actions, action => {
    if (action.kind === 'fold') return ctxFold(ctx);
    if (action.kind === 'call') {
      return ctxPostflop(ctx, 'call', ctx.investedSb);
    }
    return buildVsAllin({
      ...ctx,
      path: [...ctx.path, action.id],
      player: other(ctx.player),
      investedBb: ctx.config.stackBb,
    });
  });
}

function buildVsAllin(ctx: BuildContext): TreeNode {
  const actions: Action[] = [
    { id: 'fold', kind: 'fold' },
    { id: 'call', kind: 'call', amountBb: ctx.config.stackBb },
  ];

  return decision(ctx, actions, action => {
    if (action.kind === 'fold') return ctxFold(ctx);
    return ctxShowdown(ctx, 'call');
  });
}

export function walkTree(node: TreeNode, visit: (n: TreeNode) => void): void {
  visit(node);
  if (node.kind === 'decision') {
    for (const child of node.children) walkTree(child, visit);
  }
}

export function countNodes(root: TreeNode): { decisions: number; terminals: number } {
  let decisions = 0;
  let terminals = 0;
  walkTree(root, n => {
    if (n.kind === 'decision') decisions++;
    else terminals++;
  });
  return { decisions, terminals };
}
