import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

function usageLine(usedTokens) {
  return `${JSON.stringify({
    type: 'assistant',
    message: {
      usage: {
        input_tokens: Math.max(0, usedTokens - 30),
        output_tokens: 10,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 10,
      },
    },
  })}\n`;
}

function spawnMeasured(script, args, options = {}) {
  let result;
  const wallMs = timed(() => {
    result = spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      ...options,
    });
  });
  if (result.status !== 0) throw new Error(`Benchmark child failed: ${result.stderr}`);
  const processMs = Number(result.stdout.trim());
  if (!Number.isFinite(processMs) || processMs < 0) {
    throw new Error(`Benchmark child reported invalid process time: ${result.stdout}`);
  }
  return { processMs, wallMs };
}

async function main() {
  const temporary = mkdtempSync(join(tmpdir(), 'context-continuity-benchmark-'));
  const project = join(temporary, 'project');
  const featureBundle = join(temporary, 'context-continuity.mjs');
  const processBundle = join(temporary, 'context-continuity-process.cjs');
  const processEntry = join(temporary, 'context-continuity-process-entry.mjs');
  const bareNode = join(temporary, 'node-startup.mjs');
  const checkpoint = join(project, '.void', 'machine', 'checkpoint.md');
  const transcript = join(project, 'transcript.jsonl');
  mkdirSync(dirname(checkpoint), { recursive: true });
  writeFileSync(
    join(project, '.void', 'config.json'),
    '{"context":{"windowTokens":200000,"checkpointThresholdPercent":50}}\n',
  );
  writeFileSync(checkpoint, '## Objective\n\nBenchmark context continuity.\n');
  writeFileSync(transcript, usageLine(10_000));
  writeFileSync(bareNode, [
    'const usage = process.cpuUsage();',
    'process.stdout.write(String((usage.user + usage.system) / 1_000));',
    '',
  ].join('\n'));
  const executorSource = join(
    ROOT,
    'packages',
    'hook-runner',
    'src',
    'lifecycle',
    'context-continuity-executor.ts',
  );
  writeFileSync(processEntry, [
    `import { executeContextContinuity } from ${JSON.stringify(executorSource)};`,
    "const root = process.env['VOID_BENCH_ROOT'] ?? '';",
    "const transcript = process.env['VOID_BENCH_TRANSCRIPT'] ?? '';",
    "const index = Number(process.env['VOID_BENCH_INDEX'] ?? '0');",
    'executeContextContinuity({',
    "  hook_event_name: 'UserPromptSubmit',",
    "  session_id: 'context-continuity-benchmark',",
    '  transcript_path: transcript,',
    "}, root, 'codex', 10_000 + index * 5_001);",
    'const usage = process.cpuUsage();',
    'process.stdout.write(String((usage.user + usage.system) / 1_000));',
    '',
  ].join('\n'));

  try {
    await Promise.all([
      build({
        entryPoints: [
          executorSource,
        ],
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node22',
        outfile: featureBundle,
      }),
      build({
        entryPoints: [processEntry],
        bundle: true,
        platform: 'node',
        // Cold ESM loading is measured above. CJS keeps this process comparison focused on
        // continuity CPU rather than charging one runtime module-loader choice to the feature.
        format: 'cjs',
        target: 'node22',
        outfile: processBundle,
      }),
    ]);
    const feature = await import(pathToFileURL(featureBundle).href);
    feature.executeContextContinuity(
      { hook_event_name: 'PreCompact', transcript_path: transcript },
      project,
      'codex',
      1_000,
    );
    let hotIndex = 0;
    const hot = Array.from({ length: RUNS }, () => {
      hotIndex += 1;
      appendFileSync(transcript, usageLine(10_000 + hotIndex));
      return timed(() => feature.executeContextContinuity(
        {
          hook_event_name: 'PostToolUse',
          transcript_path: transcript,
          tool_name: 'read_file',
          tool_input: { path: `src/hot-${String(hotIndex)}.ts` },
          tool_response: { success: true },
        },
        project,
        'codex',
        10_000 + hotIndex * 5_001,
      ));
    });
    const cold = [];
    for (let index = 0; index < RUNS; index += 1) {
      const coldBundle = join(temporary, `context-continuity-cold-${String(index)}.mjs`);
      copyFileSync(featureBundle, coldBundle);
      appendFileSync(transcript, usageLine(20_000 + index));
      const started = process.hrtime.bigint();
      const coldFeature = await import(pathToFileURL(coldBundle).href);
      coldFeature.executeContextContinuity(
        {
          hook_event_name: 'PostToolUse',
          transcript_path: transcript,
          tool_name: 'read_file',
          tool_input: { path: `src/cold-${String(index)}.ts` },
          tool_response: { success: true },
        },
        project,
        'codex',
        20_000 + index * 5_001,
      );
      cold.push(Number(process.hrtime.bigint() - started) / 1_000_000);
    }

    const environment = {
      ...process.env,
      VOID_BENCH_ROOT: project,
      VOID_BENCH_TRANSCRIPT: transcript,
    };
    const nodeStartup = [];
    const processFeature = [];
    const nodeStartupWall = [];
    const processFeatureWall = [];
    for (let index = 0; index < RUNS; index += 1) {
      const nodeSample = spawnMeasured(bareNode, []);
      appendFileSync(transcript, usageLine(30_000 + index));
      const processSample = spawnMeasured(
        processBundle,
        [],
        {
          env: { ...environment, VOID_BENCH_INDEX: String(index) },
        },
      );
      nodeStartup.push(nodeSample.processMs);
      processFeature.push(processSample.processMs);
      nodeStartupWall.push(nodeSample.wallMs);
      processFeatureWall.push(processSample.wallMs);
    }

    const nodeStartupP95Ms = percentile95(nodeStartup);
    const processFeatureP95Ms = percentile95(processFeature);
    const processVsNodeP95Ms = percentile95(processFeature.map((sample, index) =>
      Math.max(0, sample - (nodeStartup[index] ?? 0))));
    const coldP95Ms = percentile95(cold);
    const hotP95Ms = percentile95(hot);
    const overheadP95Ms = processVsNodeP95Ms;
    const result = {
      coldP95Ms: Number(coldP95Ms.toFixed(2)),
      hotP95Ms: Number(hotP95Ms.toFixed(2)),
      overheadP95Ms: Number(overheadP95Ms.toFixed(2)),
      processFeatureCpuP95Ms: Number(processFeatureP95Ms.toFixed(2)),
      nodeStartupCpuP95Ms: Number(nodeStartupP95Ms.toFixed(2)),
      processFeatureWallP95Ms: Number(percentile95(processFeatureWall).toFixed(2)),
      nodeStartupWallP95Ms: Number(percentile95(nodeStartupWall).toFixed(2)),
      budgetsMs: { coldP95: 150, hotP95: 75, overheadP95: 25 },
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (coldP95Ms >= 150 || hotP95Ms >= 75 || overheadP95Ms >= 25) process.exitCode = 1;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

await main();
