// Full 2-pass HU 100bb preflop solve with postflop EV table integration.
//
// Pipeline:
//   For each rake cap in [5, 4, 3]:
//     1. Run v2-A preflop CFR (pass 1) — gets initial strategies
//     2. Build postflop EV table from N boards
//     3. Re-run preflop CFR with the EV table (pass 2)
//     4. (Optional) iterate 3 times
//   Save combined output to src/utils/gtoTable_HU.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { solve } from './cfr.js';
import { DEFAULT_V2A_CONFIG } from './types.js';
import { combineScenarios, formatResult } from './output.js';
import { buildPostflopEvTable } from './postflopEvBuilder.js';
import type { PostflopEvTable } from './cfr.js';
import { NUM_HANDS } from './hand.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUTS_DIR = resolve(__dirname, '../outputs');
const APP_TABLE_PATH = resolve(__dirname, '../../../src/utils/gtoTable_HU.json');

const RAKE_CAPS = [5, 4, 3];
const PASS1_ITER = Number(process.env.PASS1_ITER ?? '2000');
const PASS2_ITER = Number(process.env.PASS2_ITER ?? '3000');
const NUM_BOARDS = Number(process.env.NUM_BOARDS ?? '50');
const POSTFLOP_ITER = Number(process.env.POSTFLOP_ITER ?? '100');
const USE_PHASE_B = (process.env.USE_PHASE_B ?? '0') === '1';
const NUM_PASSES = Number(process.env.NUM_PASSES ?? '2');

async function solveOneRake(cap: number): Promise<ReturnType<typeof formatResult>> {
  const scenarioName = `HU_100bb_v2b${USE_PHASE_B ? '_phaseB' : ''}_rake10pct_cap${cap}bb`;
  console.log(`\n========== ${scenarioName} ==========`);
  const config = { ...DEFAULT_V2A_CONFIG, rakeCapBb: cap };

  // PASS 1: initial preflop CFR
  console.log(`[pass 1] preflop CFR (${PASS1_ITER} iter)`);
  let result = solve(config, PASS1_ITER, {
    logEvery: Math.max(1, Math.floor(PASS1_ITER / 5)),
  });

  let evTable: PostflopEvTable | undefined;
  for (let pass = 2; pass <= NUM_PASSES; pass++) {
    console.log(`[pass ${pass}] building postflop EV table (${NUM_BOARDS} boards, phaseB=${USE_PHASE_B})`);
    const start = Date.now();
    const ev = await buildPostflopEvTable(config, result.strategies, {
      numBoards: NUM_BOARDS,
      iterations: POSTFLOP_ITER,
      usePhaseB: USE_PHASE_B,
      useParallel: true,
      seed: cap,
      onBoardDone: (i, n) => {
        const el = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`  board ${i}/${n} elapsed ${el}s`);
      },
    });
    const evElapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  EV table built in ${evElapsed}s, ${ev.perSpot.size} spots covered`);

    evTable = {
      spots: new Map(
        Array.from(ev.perSpot.entries()).map(([path, agg]) => [
          path,
          { sbEv: agg.sbEv, bbEv: agg.bbEv },
        ]),
      ),
    };

    console.log(`[pass ${pass}] preflop CFR re-solve (${PASS2_ITER} iter, with EV table)`);
    result = solve(config, PASS2_ITER, {
      logEvery: Math.max(1, Math.floor(PASS2_ITER / 5)),
      postflopEvTable: evTable,
    });
  }

  void NUM_HANDS;
  return formatResult(result, config, scenarioName);
}

async function main(): Promise<void> {
  mkdirSync(OUTPUTS_DIR, { recursive: true });
  const scenarios: { capBb: number; output: ReturnType<typeof formatResult> }[] = [];

  for (const cap of RAKE_CAPS) {
    const out = await solveOneRake(cap);
    const path = resolve(OUTPUTS_DIR, `full_rake_${cap}bb.json`);
    writeFileSync(path, JSON.stringify(out, null, 2));
    console.log(`written: ${path}`);
    scenarios.push({ capBb: cap, output: out });
  }

  const combined = combineScenarios(scenarios, 100, 0.10);
  writeFileSync(APP_TABLE_PATH, JSON.stringify(combined));
  console.log(`\ncombined output written: ${APP_TABLE_PATH}`);
}

await main();
