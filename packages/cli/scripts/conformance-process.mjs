import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, win32 } from 'node:path';

const MAX_PATH_ENTRIES = 128;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const TERMINATION_GRACE_MS = 5_000;
const INHERITED_ENVIRONMENT = [
  'CI',
  'ComSpec',
  'LANG',
  'LC_ALL',
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'WINDIR',
  'npm_execpath',
];

export function conformanceEnvironment(extra = {}, source = process.env) {
  const inherited = INHERITED_ENVIRONMENT
    .map((name) => [name, source[name]])
    .filter((entry) => entry[1] !== undefined);
  return Object.fromEntries([
    ...inherited,
    ...Object.entries(extra).filter((entry) => entry[1] !== undefined),
  ]);
}

export function conformanceFixtureEnvironment(root, extra = {}) {
  const home = join(root, 'home');
  const temporary = join(root, 'tmp');
  return conformanceEnvironment({
    APPDATA: join(home, 'AppData', 'Roaming'),
    HOME: home,
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    TEMP: temporary,
    TMP: temporary,
    TMPDIR: temporary,
    USERPROFILE: home,
    VOID_GLOBAL_DIR: join(root, 'harness-global'),
    XDG_CACHE_HOME: join(home, '.cache'),
    npm_config_cache: join(root, 'npm-cache'),
    npm_config_offline: 'true',
    ...extra,
  });
}

export function safeConformanceDiagnostic(value, maxBytes = 64 * 1024) {
  const redacted = String(value)
    .replace(/(\bBearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(
      /(\b(?:[a-z0-9]+[_-])*(?:api[-_]?key|authorization|password|secret|token)\b\s*[:=]\s*)[^\s&,;]+/gi,
      '$1[REDACTED]',
    );
  return Buffer.from(redacted).subarray(0, maxBytes).toString('utf8');
}

function captureBounded(state, target, chunk, maxOutputBytes, stop) {
  const bytes = Buffer.from(chunk);
  const remaining = Math.max(0, maxOutputBytes - state.outputBytes);
  if (remaining > 0) target.push(bytes.subarray(0, remaining));
  state.outputBytes += Math.min(bytes.length, remaining);
  if (bytes.length > remaining) stop('output-exceeded');
}

function terminateProcessTree(child) {
  if (child.pid === undefined) return;
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
    return;
  }

  const killer = spawn(
    'taskkill.exe',
    ['/pid', String(child.pid), '/t', '/f'],
    {
      env: conformanceEnvironment(),
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  killer.once('error', () => child.kill('SIGKILL'));
  killer.once('close', () => child.kill('SIGKILL'));
}

function processOutcome(state, code, signal) {
  if (state.forcedKind !== undefined) return { kind: state.forcedKind };
  if (state.spawnError !== undefined) {
    return { kind: 'spawn-error', message: state.spawnError.message };
  }
  if (signal !== null) return { kind: 'signaled', signal };
  return { kind: 'exited', code };
}

export function runConformanceProcess(options) {
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const captureStderr = options.captureStderr ?? true;
  return new Promise((resolveRun) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      detached: process.platform !== 'win32',
      env: conformanceEnvironment(options.env),
      shell: false,
      stdio: ['pipe', 'pipe', captureStderr ? 'pipe' : 'ignore'],
      windowsHide: true,
      windowsVerbatimArguments: options.windowsVerbatimArguments === true,
    });
    const stdout = [];
    const stderr = [];
    const state = { forcedKind: undefined, outputBytes: 0, spawnError: undefined };
    let finished = false;
    let terminationTimer;

    const finish = (outcome) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutTimer);
      clearTimeout(terminationTimer);
      resolveRun({
        outcome,
        stderr: Buffer.concat(stderr).toString('utf8'),
        stdout: Buffer.concat(stdout).toString('utf8'),
      });
    };
    const stop = (kind) => {
      if (state.forcedKind !== undefined) return;
      state.forcedKind = kind;
      terminateProcessTree(child);
      terminationTimer = setTimeout(
        () => finish({ kind: 'termination-failed', trigger: kind }),
        TERMINATION_GRACE_MS,
      );
    };
    const timeoutTimer = setTimeout(() => stop('timed-out'), timeoutMs);

    child.stdout.on('data', (chunk) => {
      captureBounded(state, stdout, chunk, maxOutputBytes, stop);
    });
    if (captureStderr) {
      child.stderr.on('data', (chunk) => {
        captureBounded(state, stderr, chunk, maxOutputBytes, stop);
      });
    }
    child.once('error', (error) => {
      state.spawnError = error;
      if (child.pid === undefined) finish(processOutcome(state, null, null));
    });
    child.once('close', (code, signal) => {
      finish(processOutcome(state, code, signal));
    });
    child.stdin.on('error', () => {
      // The exit outcome and caller-owned postconditions remain authoritative.
    });
    child.stdin.end(options.input);
  });
}

export function requireConformanceExit(result, label, expectedCodes = [0]) {
  if (
    result.outcome.kind === 'exited'
    && expectedCodes.includes(result.outcome.code)
  ) {
    return result;
  }
  const detail = safeConformanceDiagnostic(
    `${result.stdout}\n${result.stderr}`.trim(),
  );
  const outcome = result.outcome.kind === 'exited'
    ? `exited with code ${result.outcome.code}, expected ${expectedCodes.join(' or ')}`
    : result.outcome.kind;
  throw new Error([
    `${label}: ${outcome}`,
    detail === '' ? undefined : detail,
  ].filter(Boolean).join('\n'));
}

function reportConformanceStep(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

export async function runConformanceStep(label, options, report = reportConformanceStep) {
  const started = performance.now();
  report({ phase: 'started', label });
  const result = await runConformanceProcess(options);
  report({ phase: 'finished', label, outcome: result.outcome.kind,
    code: result.outcome.code, durationMs: Math.round(performance.now() - started) });
  return requireConformanceExit(result, label);
}

export async function runConformanceSuites(suites, run) {
  for (const suite of suites) {
    const failure = await run(suite);
    if (failure !== undefined) throw new Error(`consumer conformance: ${failure}`);
  }
}

function windowsNpmCli(options) {
  const pathValue = options.environment.PATH
    ?? options.environment.Path
    ?? '';
  const directories = [
    dirname(options.nodeExecutable),
    ...pathValue.split(win32.delimiter),
  ].filter((entry) => entry !== '').slice(0, MAX_PATH_ENTRIES);
  for (const directory of new Set(directories)) {
    const candidate = win32.join(
      directory,
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js',
    );
    if (options.isFile(candidate)) return candidate;
  }
  return undefined;
}

function windowsCli(manager, options) {
  if (manager === 'pnpm') {
    const candidate = options.environment.npm_execpath;
    if (
      typeof candidate === 'string'
      && /\.(?:cjs|mjs|js)$/i.test(candidate)
      && options.isFile(candidate)
    ) {
      return candidate;
    }
  } else {
    const candidate = windowsNpmCli(options);
    if (candidate !== undefined) return candidate;
  }
  throw new Error(
    `conformance cannot resolve ${manager} JavaScript entrypoint on Windows`,
  );
}

export function packageManagerCommand(manager, overrides = {}) {
  if (manager !== 'npm' && manager !== 'pnpm') {
    throw new Error(`conformance unsupported package manager: ${String(manager)}`);
  }
  const options = {
    platform: overrides.platform ?? process.platform,
    nodeExecutable: overrides.nodeExecutable ?? process.execPath,
    environment: overrides.environment ?? process.env,
    isFile: overrides.isFile ?? existsSync,
  };
  if (options.platform !== 'win32') {
    return { executable: manager, prefixArguments: [] };
  }
  return {
    executable: options.nodeExecutable,
    prefixArguments: [windowsCli(manager, options)],
  };
}
