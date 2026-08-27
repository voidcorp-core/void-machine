import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RUNS = 25;

function percentile95(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1] ?? 0;
}

function timed(action) {
  const started = process.hrtime.bigint();
  action();
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

function nodeStartupP95() {
  return percentile95(Array.from({ length: 10 }, () => timed(() => {
    const result = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
    if (result.status !== 0) throw new Error('Node startup baseline failed');
  })));
}

async function main() {
  const temporary = mkdtempSync(join(tmpdir(), 'context-continuity-benchmark-'));
  const project = join(temporary, 'project');
  const bundle = join(temporary, 'context-continuity.mjs');
  const checkpoint = join(project, '.void', 'machine', 'checkpoint.md');
  mkdirSync(dirname(checkpoint), { recursive: true });
  writeFileSync(join(project, '.void', 'config.json'), '{}\n');
  writeFileSync(checkpoint, '## Objective\n\nBenchmark context continuity.\n');

  try {
    await build({
      entryPoints: [
        join(ROOT, 'packages', 'hook-runner', 'src', 'lifecycle', 'context-continuity-executor.ts'),
      ],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      outfile: bundle,
    });
    const importStarted = process.hrtime.bigint();
    const module = await import(pathToFileURL(bundle).href);
    const importMs = Number(process.hrtime.bigint() - importStarted) / 1_000_000;
    const invoke = () => module.executeContextContinuity(
      { hook_event_name: 'UserPromptSubmit', prompt: 'continue' },
      project,
      'codex',
      1_000,
    );
    const firstInvokeMs = timed(invoke);
    const hot = Array.from({ length: RUNS }, () => timed(invoke));
    const baseline = Array.from({ length: RUNS }, () => timed(() => undefined));
    const coldMs = importMs + firstInvokeMs;
    const hotP95Ms = percentile95(hot);
    const overheadP95Ms = Math.max(0, hotP95Ms - percentile95(baseline));
    const result = {
      coldMs: Number(coldMs.toFixed(2)),
      hotP95Ms: Number(hotP95Ms.toFixed(2)),
      overheadP95Ms: Number(overheadP95Ms.toFixed(2)),
      nodeStartupP95Ms: Number(nodeStartupP95().toFixed(2)),
      budgetsMs: { cold: 150, hotP95: 75, overheadP95: 25 },
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (coldMs >= 150 || hotP95Ms >= 75 || overheadP95Ms >= 25) process.exitCode = 1;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

await main();
