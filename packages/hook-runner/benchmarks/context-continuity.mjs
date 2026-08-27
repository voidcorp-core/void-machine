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

function spawnMeasured(measurement, script, args, options = {}) {
  let result;
  const parentWallMs = timed(() => {
    result = spawnSync(process.execPath, ['--require', measurement, script, ...args], {
      encoding: 'utf8',
      ...options,
    });
  });
  if (result.status !== 0) throw new Error(`Benchmark child failed: ${result.stderr}`);
  const match = result.stderr.match(/VOID_BENCH_UPTIME_MS=([0-9.]+)/);
  const uptimeMs = Number(match?.[1]);
  if (!Number.isFinite(uptimeMs) || uptimeMs < 0) {
    throw new Error(`Benchmark child reported invalid uptime: ${result.stderr}`);
  }
  return { parentWallMs, uptimeMs };
}

async function main() {
  const temporary = mkdtempSync(join(tmpdir(), 'context-continuity-benchmark-'));
  const project = join(temporary, 'project');
  const featureBundle = join(temporary, 'context-continuity.mjs');
  const shippedBundle = join(ROOT, 'packages', 'core', 'hooks', '_void-hook.mjs');
  const bareNode = join(temporary, 'node-startup.mjs');
  const measurement = join(temporary, 'measure-uptime.cjs');
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
  writeFileSync(
    measurement,
    [
      "const { writeSync } = require('node:fs');",
      "process.once('exit', () => {",
      "  writeSync(2, `\\nVOID_BENCH_UPTIME_MS=${String(process.uptime() * 1_000)}\\n`);",
      '});',
      '',
    ].join('\n'),
  );
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
      return timed(() =>
        feature.executeContextContinuity(
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
    const featureVsNoop = [];
    const featureVsNode = [];
    const bundleNoopVsNode = [];
    const nodeParentWall = [];
    const noopParentWall = [];
    const featureParentWall = [];
    for (let index = 0; index < RUNS; index += 1) {
      let nodeSample;
      let noopSample;
      let processSample;
      const order = ['node', 'noop', 'feature'];
      const rotated = [
        ...order.slice(index % order.length),
        ...order.slice(0, index % order.length),
      ];
      for (const sample of rotated) {
        if (sample === 'node') {
          nodeSample = spawnMeasured(measurement, bareNode, []);
        } else if (sample === 'noop') {
          noopSample = spawnMeasured(
            measurement,
            shippedBundle,
            ['lifecycle', 'context-continuity', 'codex'],
            {
              env: environment,
              input: JSON.stringify({ hook_event_name: 'Unknown' }),
            },
          );
        } else {
          appendFileSync(transcript, usageLine(30_000 + index));
          processSample = spawnMeasured(
            measurement,
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
        }
      }
      if (nodeSample === undefined || noopSample === undefined || processSample === undefined) {
        throw new Error('Benchmark rotation omitted a required sample');
      }
      nodeStartup.push(nodeSample.uptimeMs);
      bundleNoop.push(noopSample.uptimeMs);
      processFeature.push(processSample.uptimeMs);
      featureVsNoop.push(Math.max(0, processSample.uptimeMs - noopSample.uptimeMs));
      featureVsNode.push(Math.max(0, processSample.uptimeMs - nodeSample.uptimeMs));
      bundleNoopVsNode.push(Math.max(0, noopSample.uptimeMs - nodeSample.uptimeMs));
      nodeParentWall.push(nodeSample.parentWallMs);
      noopParentWall.push(noopSample.parentWallMs);
      featureParentWall.push(processSample.parentWallMs);
    }

    const nodeStartupP95Ms = percentile95(nodeStartup);
    const bundleNoopP95Ms = percentile95(bundleNoop);
    const processFeatureP95Ms = percentile95(processFeature);
    const processVsNodeP95Ms = percentile95(featureVsNode);
    const bundleNoopVsNodeP95Ms = percentile95(bundleNoopVsNode);
    const featureVsNoopP95Ms = percentile95(featureVsNoop);
    const coldP95Ms = processFeatureP95Ms;
    const hotP95Ms = percentile95(hot);
    const result = {
      coldP95Ms: Number(coldP95Ms.toFixed(2)),
      hotP95Ms: Number(hotP95Ms.toFixed(2)),
      processFeatureP95Ms: Number(processFeatureP95Ms.toFixed(2)),
      bundleNoopP95Ms: Number(bundleNoopP95Ms.toFixed(2)),
      nodeStartupP95Ms: Number(nodeStartupP95Ms.toFixed(2)),
      featureVsNoopP95Ms: Number(featureVsNoopP95Ms.toFixed(2)),
      featureVsNodeP95Ms: Number(processVsNodeP95Ms.toFixed(2)),
      bundleNoopVsNodeP95Ms: Number(bundleNoopVsNodeP95Ms.toFixed(2)),
      budgetsMs: { hotP95: 75, featureVsNoopP95: 25 },
      globalBaseline: {
        trackedBy: 'DEV-662',
        budgetsMs: { coldP95: 150, bundleNoopVsNodeP95: 25 },
      },
      parentWallDiagnosticP95Ms: {
        node: Number(percentile95(nodeParentWall).toFixed(2)),
        bundleNoop: Number(percentile95(noopParentWall).toFixed(2)),
        processFeature: Number(percentile95(featureParentWall).toFixed(2)),
      },
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (hotP95Ms >= 75 || featureVsNoopP95Ms >= 25) process.exitCode = 1;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

await main();
