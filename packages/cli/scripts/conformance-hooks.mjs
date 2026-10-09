#!/usr/bin/env node

import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRODUCT_IDENTITY } from '../../../scripts/product-identity.mjs';
import { conformanceArtifactFromEnvironment } from './conformance-artifact.mjs';
import {
  assertCanonicalHookReplay,
  codexDenialReason,
  codexHookLaunchers,
  codexHookTimeoutMs,
  runtimesForMode,
} from './conformance-hooks-lib.mjs';
import {
  conformanceFixtureEnvironment,
  packageManagerCommand,
  requireConformanceExit,
  runConformanceProcess,
} from './conformance-process.mjs';

const MAX_HOOK_INPUT_BYTES = 1024 * 1024;
const DANGEROUS_COMMAND = 'rm -rf /';
const HOOK_TIMEOUT_MS = 5_000;

function requireDiagnostic(result, pattern, label) {
  const output = `${result.stdout}\n${result.stderr}`;
  if (!pattern.test(output)) {
    throw new Error(`hook conformance ${label} lacked its expected diagnostic`);
  }
}

// Claude Code refuses on exit 2 with the reason on stderr. Codex refuses on
// exit 0 with a PreToolUse denial on stdout, the one channel PowerShell does not
// rewrite; its exit 2 would reach Codex as 1, a failed hook that lets the call
// through. The refusal is read the way each runtime reads it.
async function requireRefusal(runtime, command, args, options, pattern, label) {
  const result = await run(command, args, {
    ...options,
    label,
    expectedCodes: [runtime === 'codex' ? 0 : 2],
  });
  const reason = runtime === 'codex'
    ? codexDenialReason(result.stdout)
    : result.stderr;
  if (reason === undefined || !pattern.test(reason)) {
    throw new Error(
      `hook conformance ${label} was not refused as ${runtime} reads a refusal\n`
        + `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
}

function requireNoDecision(result, label) {
  if (result.stdout.trim() !== '') {
    throw new Error(`hook conformance ${label} wrote a decision: ${result.stdout}`);
  }
}

async function run(command, args, options) {
  const expectedCodes = options.expectedCodes ?? [0];
  const result = await runConformanceProcess({
    command,
    args,
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    timeoutMs: options.timeoutMs,
    windowsVerbatimArguments: options.verbatim,
  });
  return requireConformanceExit(
    result,
    `hook conformance ${options.label ?? 'command'} [${[command, ...args].join(' ')}]`,
    expectedCodes,
  );
}

async function requireRegularFile(path, label) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`hook conformance unsafe ${label}: ${path}`);
  }
}

function payloadFor(runtime, fixture) {
  if (runtime === 'claude') {
    return {
      hook_event_name: 'PreToolUse',
      session_id: 'hook-conformance-claude',
      tool_name: 'Write',
      tool_input: {
        file_path: join(fixture, 'example.py'),
        content: 'print("safe")\n',
      },
    };
  }
  return {
    hook_event_name: 'PreToolUse',
    session_id: 'hook-conformance-codex',
    tool_name: 'apply_patch',
    tool_input: {
      patch: [
        '*** Begin Patch',
        '*** Update File: example.py',
        '@@',
        '-print("safe")',
        '+print("still safe")',
        '*** End Patch',
      ].join('\n'),
    },
  };
}

function hookEnvironment(fixture, missionId, runtime) {
  return conformanceFixtureEnvironment(fixture, {
    CLAUDE_PROJECT_DIR: fixture,
    VOID_AGENT_RUNTIME: runtime,
    VOID_GLOBAL_DIR: join(fixture, '.void', 'global'),
    VOID_MISSION_ID: missionId,
    VOID_PROJECT_ROOT: fixture,
  });
}

async function exerciseRuntime(runner, fixture, missionId, runtime) {
  const env = hookEnvironment(fixture, missionId, runtime);
  const payload = payloadFor(runtime, fixture);
  await run(process.execPath, [runner, 'activation', runtime], {
    cwd: fixture,
    env,
    input: JSON.stringify(payload),
    timeoutMs: HOOK_TIMEOUT_MS,
  });
  await run(process.execPath, [runner, 'enforce', 'no-console', runtime], {
    cwd: fixture,
    env,
    input: JSON.stringify(payload),
    timeoutMs: HOOK_TIMEOUT_MS,
  });
  const refusal = [runner, 'enforce', 'dangerous-command', runtime];
  const base = { cwd: fixture, env, timeoutMs: HOOK_TIMEOUT_MS };
  await requireRefusal(
    runtime,
    process.execPath,
    refusal,
    {
      ...base,
      input: JSON.stringify({
        ...payload,
        tool_name: runtime === 'claude' ? 'Bash' : 'shell',
        tool_input: { command: DANGEROUS_COMMAND },
      }),
    },
    /DANGEROUS_COMMAND/,
    `${runtime} blocked command`,
  );
  await requireRefusal(
    runtime,
    process.execPath,
    refusal,
    { ...base, input: '{not-json}' },
    /HOOK_INPUT_REJECTED/,
    `${runtime} invalid input`,
  );
  await requireRefusal(
    runtime,
    process.execPath,
    refusal,
    { ...base, input: Buffer.alloc(MAX_HOOK_INPUT_BYTES + 1, 0x61) },
    /HOOK_RUNNER_FAILED: HOOK_INPUT_TOO_LARGE/,
    `${runtime} oversized input`,
  );
}

function manifestHook(manifest, suffix) {
  const hook = Object.values(manifest.hooks)
    .flatMap((groups) => groups.flatMap((group) => group.hooks))
    .find((candidate) => candidate.command.endsWith(suffix));
  if (hook === undefined) throw new Error(`hook conformance manifest lacks ${suffix}`);
  return hook;
}

// Runs the installed .codex/hooks.json commands the way Codex launches them,
// from the project root and from a subdirectory, with no project-root variable:
// the command itself must find the runner (DEV-918). Each launch is bounded by
// the timeout Codex would give that hook.
async function exerciseCodexManifest(fixture, mode) {
  const manifest = JSON.parse(await readFile(join(fixture, '.codex', 'hooks.json'), 'utf8'));
  const blockHook = manifestHook(manifest, ' enforce dangerous-command codex');
  const allowHook = manifestHook(manifest, ' enforce no-console codex');
  const nested = join(fixture, 'src', 'nested');
  await mkdir(nested, { recursive: true });
  const env = conformanceFixtureEnvironment(fixture, {
    VOID_AGENT_RUNTIME: 'codex',
    VOID_MISSION_ID: `mis_conformance_launch_${mode}`,
  });
  const payload = payloadFor('codex', fixture);
  const blockInput = JSON.stringify({
    ...payload,
    tool_name: 'shell',
    tool_input: { command: DANGEROUS_COMMAND },
  });
  const blockLaunchers = codexHookLaunchers(process.platform, blockHook.command, env);
  const allowLaunchers = codexHookLaunchers(process.platform, allowHook.command, env);
  for (const cwd of [fixture, nested]) {
    for (const [index, launcher] of blockLaunchers.entries()) {
      const label = `codex ${launcher.shell} in ${cwd === fixture ? 'root' : 'subdirectory'}`;
      await requireRefusal(
        'codex',
        launcher.command,
        launcher.args,
        {
          cwd,
          env,
          input: blockInput,
          timeoutMs: codexHookTimeoutMs(blockHook),
          verbatim: launcher.verbatim,
        },
        /DANGEROUS_COMMAND/,
        `${label} block`,
      );
      const allow = allowLaunchers[index];
      const allowed = await run(allow.command, allow.args, {
        label: `${label} allow`,
        cwd,
        env,
        input: JSON.stringify(payload),
        timeoutMs: codexHookTimeoutMs(allowHook),
        verbatim: allow.verbatim,
      });
      requireNoDecision(allowed, `${label} allow`);
    }
  }
  return blockLaunchers.map((launcher) => launcher.shell);
}

async function assertBrokenWiring(bin, fixture, mode, env) {
  const relativeManifest = mode === 'claude'
    ? join('.claude', 'settings.json')
    : join('.codex', 'hooks.json');
  const manifest = join(fixture, relativeManifest);
  const broken = `${manifest}.broken`;
  await rename(manifest, broken);
  try {
    const result = await run(process.execPath, [bin, 'doctor', '--no-remote'], {
      cwd: fixture,
      env,
      expectedCodes: [1],
    });
    requireDiagnostic(
      result,
      mode === 'claude' ? /settings\.json missing/ : /hooks\.json missing/,
      `${mode} broken wiring`,
    );
  } finally {
    await rename(broken, manifest);
  }
}

async function exerciseFixture(temporary, tarball, npmCache, mode) {
  const fixture = join(temporary, `fixture ${mode}`);
  await mkdir(join(fixture, 'tmp'), { recursive: true });
  const env = conformanceFixtureEnvironment(fixture, {
    npm_config_cache: npmCache,
  });
  await run(
    npm.executable,
    [
      ...npm.prefixArguments,
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      tarball,
    ],
    { cwd: fixture, env },
  );
  const bin = join(
    fixture,
    'node_modules',
    PRODUCT_IDENTITY.packageName,
    'bin',
    `${PRODUCT_IDENTITY.commands.primary}.mjs`,
  );
  await requireRegularFile(bin, `${mode} installed CLI`);
  await writeFile(join(fixture, 'example.py'), 'print("safe")\n', 'utf8');
  await run(
    process.execPath,
    [bin, 'init', '--runtime', mode, '--no-interactive'],
    { cwd: fixture, env },
  );

  const runner = join(fixture, '.void', 'hooks', '_void-hook.mjs');
  await requireRegularFile(runner, `${mode} installed runner`);
  const runtimes = runtimesForMode(mode);
  const missionId = `mis_conformance_${mode}`;
  await Promise.all(
    runtimes.map((runtime) =>
      exerciseRuntime(runner, fixture, missionId, runtime),
    ),
  );

  const log = join(fixture, '.void', 'machine', 'runs', missionId, 'events.jsonl');
  await requireRegularFile(log, `${mode} canonical event log`);
  assertCanonicalHookReplay(await readFile(log, 'utf8'), {
    missionId,
    runtimes,
  });

  const shells = runtimes.includes('codex') ? await exerciseCodexManifest(fixture, mode) : [];

  await run(process.execPath, [bin, 'doctor', '--no-remote'], {
    cwd: fixture,
    env,
  });
  await assertBrokenWiring(bin, fixture, mode, env);
  await run(process.execPath, [bin, 'doctor', '--no-remote'], {
    cwd: fixture,
    env,
  });
  return shells;
}

const npm = packageManagerCommand('npm');
const temporary = await mkdtemp(join(tmpdir(), 'void hook conformance-'));
try {
  const { manifest, tarball } = await conformanceArtifactFromEnvironment();
  const npmCache = join(temporary, 'npm-cache');
  await mkdir(npmCache, { recursive: true });
  const codexShells = new Set();
  for (const mode of ['claude', 'codex', 'both']) {
    for (const shell of await exerciseFixture(temporary, tarball, npmCache, mode)) {
      codexShells.add(shell);
    }
  }
  process.stdout.write(
    `hook conformance passed (${process.platform}) for ${manifest.sourceSha}: claude, codex, both; `
      + `codex manifest from root and subdirectory via ${[...codexShells].join(', ')}\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
