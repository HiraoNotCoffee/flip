import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { solve } from './cfr.js';
import { DEFAULT_V1_CONFIG, DEFAULT_V2A_CONFIG } from './types.js';
import { combineScenarios, formatResult } from './output.js';

const VERSION = process.env.SOLVER_VERSION ?? 'v2a';
const BASE_CONFIG = VERSION === 'v1' ? DEFAULT_V1_CONFIG : DEFAULT_V2A_CONFIG;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUTS_DIR = resolve(__dirname, '../outputs');
const APP_TABLE_PATH = resolve(__dirname, '../../../src/utils/gtoTable_HU.json');

const ITERATIONS = Number(process.env.ITERATIONS ?? '5000');
const RAKE_CAPS = [5, 4, 3];

function main(): void {
  mkdirSync(OUTPUTS_DIR, { recursive: true });
  const scenarios: { capBb: number; output: ReturnType<typeof formatResult> }[] = [];

  for (const cap of RAKE_CAPS) {
    const scenarioName = `HU_100bb_${VERSION}_rake10pct_cap${cap}bb`;
    console.log(`\n=== solving: ${scenarioName} (${ITERATIONS} iterations) ===`);
    const config = { ...BASE_CONFIG, rakeCapBb: cap };
    const start = Date.now();
    const result = solve(config, ITERATIONS, { logEvery: Math.max(1, Math.floor(ITERATIONS / 10)) });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  done in ${elapsed}s, infosets=${result.strategies.size}`);
    const output = formatResult(result, config, scenarioName);
    const path = resolve(OUTPUTS_DIR, `rake_${cap}bb.json`);
    writeFileSync(path, JSON.stringify(output, null, 2));
    console.log(`  written: ${path}`);
    scenarios.push({ capBb: cap, output });
  }

  const combined = combineScenarios(scenarios, 100, 0.10);
  writeFileSync(APP_TABLE_PATH, JSON.stringify(combined));
  console.log(`\ncombined output written: ${APP_TABLE_PATH}`);
}

main();
