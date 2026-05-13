import { HAND_NAMES, NUM_HANDS } from './hand.js';
import type { SolveResult } from './cfr.js';
import type { GameConfig } from './types.js';

export interface RakeScenarioOutput {
  meta: {
    scenario: string;
    stack_bb: number;
    rake_pct: number;
    rake_cap_bb: number;
    no_flop_no_drop: boolean;
    iterations: number;
    exploitability_mbb_per_pot: number;
    generated_at: string;
  };
  nodes: Record<
    string,
    {
      player: 'SB' | 'BB';
      actions: string[];
      strategy: Record<string, number[]>;
    }
  >;
}

export function formatResult(
  result: SolveResult,
  config: GameConfig,
  scenarioName: string,
): RakeScenarioOutput {
  const nodes: RakeScenarioOutput['nodes'] = {};
  for (const [path, info] of result.strategies) {
    const numActions = info.actions.length;
    const strategy: Record<string, number[]> = {};
    for (let h = 0; h < NUM_HANDS; h++) {
      const probs: number[] = [];
      for (let a = 0; a < numActions; a++) {
        const p = info.strategy[h * numActions + a];
        probs.push(Number(p.toFixed(4)));
      }
      strategy[HAND_NAMES[h]] = probs;
    }
    nodes[path] = {
      player: info.player,
      actions: info.actions,
      strategy,
    };
  }

  return {
    meta: {
      scenario: scenarioName,
      stack_bb: config.stackBb,
      rake_pct: config.rakePct,
      rake_cap_bb: config.rakeCapBb,
      no_flop_no_drop: config.noFlopNoDrop,
      iterations: result.iterations,
      exploitability_mbb_per_pot: Number(result.exploitabilityMbbPerPot.toFixed(3)),
      generated_at: new Date().toISOString(),
    },
    nodes,
  };
}

export interface CombinedOutput {
  meta: {
    scenario: string;
    stack_bb: number;
    rake_pct: number;
    generated_at: string;
  };
  rake_caps: Record<string, RakeScenarioOutput>;
}

export function combineScenarios(
  scenarios: { capBb: number; output: RakeScenarioOutput }[],
  stackBb: number,
  rakePct: number,
): CombinedOutput {
  const rake_caps: Record<string, RakeScenarioOutput> = {};
  for (const s of scenarios) rake_caps[`cap_${s.capBb}bb`] = s.output;
  return {
    meta: {
      scenario: 'HU_100bb_preflop',
      stack_bb: stackBb,
      rake_pct: rakePct,
      generated_at: new Date().toISOString(),
    },
    rake_caps,
  };
}
