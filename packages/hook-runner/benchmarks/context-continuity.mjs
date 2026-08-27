import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
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
  const elapsed = timed(() => {
    result = spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      ...options,
    });
  });
  if (result.status !== 0) throw new Error(`Benchmark child failed: ${result.stderr}`);
  return elapsed;
}

async function main() {
  const temporary = mkdtempSync(join(tmpdir(), 'context-continuity-benchmark-'));
  const project = join(temporary, 'project');
  const featureBundle = join(temporary, 'context-continuity.mjs');
  const shippedBundle = join(ROOT, 'packages', 'core', 'hooks', '_void-hook.mjs');
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
  writeFileSync(bareNode, '');
  const executorSource = join(
    ROOT,
    'packages',
    'hook-runner',
    'src',
    'lifecycle',
    'context-continuity-executor.ts',
  );

  try {
    await build({
      entryPoints: [executorSource],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      outfile: featureBundle,
    });
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
    const environment = {
      ...process.env,
      VOID_GLOBAL_DIR: join(project, '.void', 'global'),
      VOID_PROJECT_ROOT: project,
    };
    const nodeStartup = [];
    const bundleNoop = [];
    const processFeature = [];
    for (let index = 0; index < RUNS; index += 1) {
      const nodeSample = spawnMeasured(bareNode, []);
      const noopSample = spawnMeasured(
        shippedBundle,
        ['lifecycle', 'context-continuity', 'codex'],
        {
          env: environment,
          input: JSON.stringify({ hook_event_name: 'Unknown' }),
        },
      );
      appendFileSync(transcript, usageLine(30_000 + index));
      const processSample = spawnMeasured(
        shippedBundle,
        ['lifecycle', 'context-continuity', 'codex'],
        {
          env: environment,
          input: JSON.stringify({
            hook_event_name: 'PostToolUse',
            session_id: 'context-continuity-benchmark',
            transcript_path: transcript,
            tool_name: 'read_file',
            tool_input: { path: `src/process-${String(index)}.ts` },
            tool_response: { success: true },
          }),
        },
      );
      nodeStartup.push(nodeSample);
      bundleNoop.push(noopSample);
      processFeature.push(processSample);
    }

    const nodeStartupP95Ms = percentile95(nodeStartup);
    const bundleNoopP95Ms = percentile95(bundleNoop);
    const processFeatureP95Ms = percentile95(processFeature);
    const processVsNodeP95Ms = Math.max(0, processFeatureP95Ms - nodeStartupP95Ms);
    const featureVsNoopP95Ms = Math.max(0, processFeatureP95Ms - bundleNoopP95Ms);
    const coldP95Ms = processFeatureP95Ms;
    const hotP95Ms = percentile95(hot);
    const overheadP95Ms = processVsNodeP95Ms;
    const result = {
      coldP95Ms: Number(coldP95Ms.toFixed(2)),
      hotP95Ms: Number(hotP95Ms.toFixed(2)),
      overheadP95Ms: Number(overheadP95Ms.toFixed(2)),
      processFeatureP95Ms: Number(processFeatureP95Ms.toFixed(2)),
      bundleNoopP95Ms: Number(bundleNoopP95Ms.toFixed(2)),
      nodeStartupP95Ms: Number(nodeStartupP95Ms.toFixed(2)),
      featureVsNoopP95Ms: Number(featureVsNoopP95Ms.toFixed(2)),
      featureVsNodeP95Ms: Number(processVsNodeP95Ms.toFixed(2)),
      budgetsMs: { coldP95: 150, hotP95: 75, overheadP95: 25 },
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (coldP95Ms >= 150 || hotP95Ms >= 75 || overheadP95Ms >= 25) process.exitCode = 1;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

await main();
