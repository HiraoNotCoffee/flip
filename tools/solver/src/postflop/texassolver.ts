import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const execFileP = promisify(execFile);

export const SOLVER_DIR = 'C:\\Users\\hirak\\個人開発\\TexasSolver-v0.2.0-Windows';
export const SOLVER_EXE = resolve(SOLVER_DIR, 'console_solver.exe');

export interface PostflopConfig {
  potBb: number;
  effectiveStackBb: number;
  board: string;
  rangeOop: string;
  rangeIp: string;
  flopBetPcts?: number[];
  iterations?: number;
  accuracy?: number;
  threads?: number;
  raiseLimit?: number;
  allinThreshold?: number;
  dumpRounds?: number;
}

export function buildParametersText(cfg: PostflopConfig, outputResultPath: string): string {
  const lines: string[] = [];
  lines.push(`set_pot ${cfg.potBb}`);
  lines.push(`set_effective_stack ${cfg.effectiveStackBb}`);
  lines.push(`set_board ${cfg.board}`);
  lines.push(`set_range_oop ${cfg.rangeOop}`);
  lines.push(`set_range_ip ${cfg.rangeIp}`);
  const sizes = (cfg.flopBetPcts ?? [50, 100]).join(',');
  for (const player of ['oop', 'ip'] as const) {
    lines.push(`set_bet_sizes ${player},flop,bet,${sizes}`);
    lines.push(`set_bet_sizes ${player},flop,raise,${sizes}`);
    lines.push(`set_bet_sizes ${player},flop,allin`);
    lines.push(`set_bet_sizes ${player},turn,bet,${sizes}`);
    lines.push(`set_bet_sizes ${player},turn,raise,${sizes}`);
    lines.push(`set_bet_sizes ${player},turn,allin`);
    lines.push(`set_bet_sizes ${player},river,bet,${sizes}`);
    lines.push(`set_bet_sizes ${player},river,raise,${sizes}`);
    lines.push(`set_bet_sizes ${player},river,allin`);
  }
  lines.push(`set_allin_threshold ${cfg.allinThreshold ?? 0.67}`);
  lines.push(`build_tree`);
  lines.push(`set_thread_num ${cfg.threads ?? 4}`);
  lines.push(`set_accuracy ${cfg.accuracy ?? 0.5}`);
  lines.push(`set_max_iteration ${cfg.iterations ?? 200}`);
  lines.push(`set_print_interval 50`);
  lines.push(`set_use_isomorphism 1`);
  lines.push(`start_solve`);
  lines.push(`set_dump_rounds ${cfg.dumpRounds ?? 2}`);
  lines.push(`dump_result ${outputResultPath}`);
  return lines.join('\n');
}

export interface SolverRunResult {
  outputPath: string;
  parsed: unknown;
  stdout: string;
  durationMs: number;
}

export async function runTexasSolver(
  cfg: PostflopConfig,
  tmpDir: string,
  tag: string,
): Promise<SolverRunResult> {
  mkdirSync(tmpDir, { recursive: true });
  const paramFile = resolve(tmpDir, `param_${tag}.txt`);
  const outFile = resolve(tmpDir, `output_${tag}.json`);
  const params = buildParametersText(cfg, outFile);
  writeFileSync(paramFile, params);

  const start = Date.now();
  const { stdout } = await execFileP(
    SOLVER_EXE,
    [
      '--input_file', paramFile,
      '--resource_dir', SOLVER_DIR,
      '--mode', 'holdem',
    ],
    { cwd: SOLVER_DIR, maxBuffer: 128 * 1024 * 1024 },
  );
  const durationMs = Date.now() - start;

  const parsed = JSON.parse(readFileSync(outFile, 'utf-8'));
  return { outputPath: outFile, parsed, stdout, durationMs };
}
