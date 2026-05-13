export type Player = 'SB' | 'BB';

export type ActionKind = 'fold' | 'call' | 'check' | 'limp' | 'raise' | 'allin';

export interface Action {
  id: string;
  kind: ActionKind;
  amountBb?: number;
}

export type NodeKind = 'decision' | 'terminal_fold' | 'terminal_showdown' | 'terminal_postflop';

export interface DecisionNode {
  kind: 'decision';
  path: string;
  player: Player;
  actions: Action[];
  children: TreeNode[];
  potBb: number;
  investedSb: number;
  investedBb: number;
}

export interface TerminalFoldNode {
  kind: 'terminal_fold';
  path: string;
  folder: Player;
  potBb: number;
  investedSb: number;
  investedBb: number;
}

export interface TerminalShowdownNode {
  kind: 'terminal_showdown';
  path: string;
  potBb: number;
  investedSb: number;
  investedBb: number;
}

export interface TerminalPostflopNode {
  kind: 'terminal_postflop';
  path: string;
  potBb: number;
  investedSb: number;
  investedBb: number;
}

export type TreeNode = DecisionNode | TerminalFoldNode | TerminalShowdownNode | TerminalPostflopNode;

export interface GameConfig {
  stackBb: number;
  sbBb: number;
  bbBb: number;
  rakePct: number;
  rakeCapBb: number;
  noFlopNoDrop: boolean;
  openSizesBb: number[];
  vsLimpRaiseSizesBb: number[];
  threeBetSizesBb: number[];
  fourBetSizesBb: number[];
}

export const DEFAULT_V1_CONFIG: Omit<GameConfig, 'rakeCapBb'> = {
  stackBb: 100,
  sbBb: 0.5,
  bbBb: 1,
  rakePct: 0.10,
  noFlopNoDrop: true,
  openSizesBb: [2.5],
  vsLimpRaiseSizesBb: [3.5],
  threeBetSizesBb: [11],
  fourBetSizesBb: [25],
};

export const DEFAULT_V2A_CONFIG: Omit<GameConfig, 'rakeCapBb'> = {
  stackBb: 100,
  sbBb: 0.5,
  bbBb: 1,
  rakePct: 0.10,
  noFlopNoDrop: true,
  openSizesBb: [2, 2.5, 3],
  vsLimpRaiseSizesBb: [3, 4],
  threeBetSizesBb: [9, 11, 13],
  fourBetSizesBb: [22, 26],
};
