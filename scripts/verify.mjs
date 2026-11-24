#!/usr/bin/env node
// One catalogue for local verification, CI steps and exact-SHA evidence.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TIERS = new Set(['pure', 'contract', 'consumer', 'system', 'certification']);
const RESOURCES = new Set([
  'cpu',
  'filesystem',
  'subprocess',
  'network-browser',
  'external-state',
]);

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   run: readonly string[],
 *   tier: 'pure'|'contract'|'consumer'|'system'|'certification',
 *   resource: 'cpu'|'filesystem'|'subprocess'|'network-browser'|'external-state',
 *   required: boolean,
 *   impacts: readonly ('docs'|'source'|'tests')[],
 *   artifact?: boolean,
 *   fix?: readonly string[],
 *   drift?: readonly string[],
 *   ciEnv?: Readonly<Record<string, string>>,
 * }} Gate
 */

/** @type {readonly Gate[]} */
export const GATES = Object.freeze([
  gate('sister-docs', 'Sister-doc parity', ['pnpm', 'sync:docs'], 'contract', 'filesystem', ['source']),
  gate('version-lockstep', 'Version lockstep', ['pnpm', 'version:check'], 'contract', 'filesystem', ['source']),
  gate('anti-bloat', 'Anti-bloat', ['pnpm', 'anti-bloat:check'], 'contract', 'subprocess', ['source']),
  gate(
    'hook-runner-current',
    'Generated hook runner',
    ['pnpm', 'hooks:check'],
    'consumer',
    'subprocess',
    ['source'],
    {
      artifact: true,
      fix: ['pnpm', 'hooks:build'],
      drift: ['packages/core/dist/hooks/_void-hook.mjs'],
    },
  ),
  gate(
    'core-assets',
    'Core assets mirror',
    ['pnpm', 'assets:check'],
    'consumer',
    'filesystem',
    ['source'],
    {
      artifact: true,
      fix: ['pnpm', '--filter', './packages/cli', 'build:assets'],
      drift: ['packages/cli/dist/core-assets'],
    },
  ),
  gate('lint', 'Lint', ['pnpm', 'lint'], 'contract', 'cpu', ['source', 'tests']),
  gate('publish-safety', 'Publish safety', ['pnpm', 'check:publish'], 'consumer', 'filesystem', ['source']),
  gate('package-size', 'Package size report', ['pnpm', 'check:size'], 'consumer', 'filesystem', ['source']),
  gate('build', 'Build packages', ['pnpm', 'build'], 'contract', 'subprocess', ['source']),
  gate(
    'self-host-sync',
    'Self-host compile',
    ['node', 'packages/cli/dist/bin/void-machine.mjs', 'self-host', 'sync', '--mode', 'release-gate'],
    'consumer',
    'subprocess',
    ['source'],
  ),
  gate(
    'self-host-doctor',
    'Self-host doctor',
    ['node', 'packages/cli/dist/bin/void-machine.mjs', 'self-host', 'doctor', '--mode', 'release-gate'],
    'consumer',
    'subprocess',
    ['source'],
  ),
  gate(
    'generated-artifacts',
    'Generated artifacts',
    ['pnpm', 'derive:check'],
    'consumer',
    'subprocess',
    ['source'],
    { artifact: true, fix: ['pnpm', 'derive'] },
  ),
  gate(
    'skill-references',
    'Skill references',
    ['pnpm', 'skills:check-references'],
    'contract',
    'filesystem',
    ['docs', 'source'],
  ),
  gate('test-cpu', 'CPU tests', ['pnpm', 'test:cpu'], 'contract', 'cpu', ['source', 'tests']),
  gate(
    'test-filesystem',
    'Filesystem tests',
    ['pnpm', 'test:filesystem'],
    'contract',
    'filesystem',
    ['source', 'tests'],
  ),
  gate(
    'test-subprocess',
    'Subprocess tests',
    ['pnpm', 'test:subprocess'],
    'system',
    'subprocess',
    ['source', 'tests'],
  ),
  gate(
    'test-network',
    'Network and browser tests',
    ['pnpm', 'test:network'],
    'system',
    'network-browser',
    ['source', 'tests'],
  ),
  gate('typecheck', 'Typecheck', ['pnpm', 'typecheck'], 'contract', 'subprocess', ['source', 'tests']),
]);

/** @returns {Gate} */
function gate(id, label, run, tier, resource, impacts, options = {}) {
  return Object.freeze({ id, label, run, tier, resource, required: true, impacts, ...options });
}

const REQUIRED = GATES.filter((candidate) => candidate.required);
const CONSERVATIVE_PATHS = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'vitest.config.ts',
  'scripts/verify.mjs',
]);
const KNOWN_PREFIXES = ['apps/', 'docs/', 'packages/', 'scripts/', 'test/', '.github/'];

/**
 * @param {readonly {path: string, previousPath?: string, status?: string}[]} changes
 * @returns {readonly Gate[]}
 */
export function selectGates(changes) {
  if (changes.length === 0) return REQUIRED;
  const paths = changes.flatMap((change) => [change.path, change.previousPath].filter(Boolean)).map(normalizePath);
  const conservative = changes.some((change) => change.status === 'deleted' || change.status === 'renamed')
    || paths.some((path) =>
      CONSERVATIVE_PATHS.has(path)
      || path.startsWith('test/support/test-catalog.')
      || path.startsWith('.github/workflows/')
      || path.startsWith('packages/core/')
      || !KNOWN_PREFIXES.some((prefix) => path.startsWith(prefix)),
    );
  if (conservative) return REQUIRED;

  const impacts = new Set();
  for (const path of paths) {
    if (path.startsWith('docs/')) impacts.add('docs');
    if (path.startsWith('test/') || path.endsWith('.test.ts')) impacts.add('tests');
    if (path.startsWith('apps/') || path.startsWith('packages/') || path.startsWith('scripts/')) {
      impacts.add('source');
    }
  }
  const selected = REQUIRED.filter((candidate) => candidate.impacts.some((impact) => impacts.has(impact)));
  return selected.length === 0 ? REQUIRED : selected;
}

function normalizePath(path) {
  return String(path).replaceAll('\\', '/').replace(/^\.\//, '');
}

/**
 * @param {string} output
 * @returns {{path: string, previousPath?: string, status: string}[]}
 */
export function parseNameStatus(output) {
  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();
  const changes = [];
  for (let index = 0; index < fields.length; ) {
    const code = fields[index];
    const kind = code?.at(0);
    if (kind === undefined || !/^[A-Z]$/.test(kind)) return [];
    if (kind === 'R' || kind === 'C') {
      const previousPath = fields[index + 1];
      const path = fields[index + 2];
      if (previousPath === undefined || path === undefined) return [];
      changes.push({ path, previousPath, status: 'renamed' });
      index += 3;
      continue;
    }
    const path = fields[index + 1];
    if (path === undefined) return [];
    changes.push({ path, status: kind === 'D' ? 'deleted' : 'modified' });
    index += 2;
  }
  return changes;
}

/**
 * @param {readonly string[]} requiredGateIds
 * @param {readonly unknown[]} reports
 * @param {string} sha
 */
export function aggregateGateReports(requiredGateIds, reports, sha) {
  const errors = [];
  const byId = new Map();
  for (const value of reports) {
    if (!isReport(value)) {
      errors.push('invalid gate report');
      continue;
    }
    const entries = byId.get(value.gateId) ?? [];
    entries.push(value);
    byId.set(value.gateId, entries);
  }

  for (const id of requiredGateIds) {
    const gateDefinition = GATES.find((candidate) => candidate.id === id);
    if (gateDefinition === undefined) {
      errors.push(`unknown required gate ${id}`);
      continue;
    }
    const entries = byId.get(id) ?? [];
    if (entries.length === 0) {
      errors.push(`missing report for ${id}`);
      continue;
    }
    if (entries.length > 1) errors.push(`duplicate reports for ${id}`);
    for (const entry of entries) {
      if (entry.sha !== sha) errors.push(`stale SHA for ${id}: ${entry.sha}`);
      if (JSON.stringify(entry.argv) !== JSON.stringify(gateDefinition.run)) {
        errors.push(`argv mismatch for ${id}`);
      }
      if (entry.status !== 'passed' || entry.exitCode !== 0) errors.push(`failed gate ${id}`);
    }
    byId.delete(id);
  }
  for (const id of byId.keys()) errors.push(`unexpected report for ${id}`);
  return { ok: errors.length === 0, gateIds: [...requiredGateIds], sha, errors };
}

function isReport(value) {
  return value !== null
    && typeof value === 'object'
    && value.schemaVersion === 1
    && typeof value.gateId === 'string'
    && /^[0-9a-f]{40}$/.test(value.sha)
    && Array.isArray(value.argv)
    && value.argv.every((part) => typeof part === 'string')
    && (value.status === 'passed' || value.status === 'failed')
    && Number.isInteger(value.exitCode)
    && typeof value.startedAt === 'string'
    && Number.isFinite(value.durationMs)
    && value.durationMs >= 0;
}

/** @param {readonly string[]} argv */
export function parseArgs(argv) {
  const valueAfter = (flag) => {
    const index = argv.indexOf(flag);
    const value = index < 0 ? null : argv[index + 1];
    return value === null || value === undefined || value.startsWith('-') ? null : value;
  };
  const valueFlags = new Set(['--gate', '--sha', '--report', '--reports', '--changed-from']);
  const switches = new Set(['--artifacts', '--fix', '--list', '--observations', '--aggregate', '--help', '-h']);
  const unknown = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('-')) continue;
    if (switches.has(arg)) continue;
    if (valueFlags.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) unknown.push(arg);
      else index += 1;
      continue;
    }
    unknown.push(arg);
  }
  return {
    artifactsOnly: argv.includes('--artifacts'),
    fix: argv.includes('--fix'),
    list: argv.includes('--list'),
    observations: argv.includes('--observations'),
    aggregate: argv.includes('--aggregate'),
    help: argv.includes('--help') || argv.includes('-h'),
    gateId: valueAfter('--gate'),
    sha: valueAfter('--sha'),
    report: valueAfter('--report'),
    reports: valueAfter('--reports'),
    changedFrom: valueAfter('--changed-from'),
    unknown,
  };
}

function run(command, options = {}) {
  const [bin, ...args] = command;
  const result = spawnSync(bin, args, {
    cwd: ROOT,
    stdio: options.quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function snapshot(paths) {
  if (paths === undefined) return null;
  return run(['git', 'status', '--porcelain', '--', ...paths], { quiet: true }).output;
}

function runOne(gateDefinition, sha) {
  const before = snapshot(gateDefinition.drift);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const outcome = run(gateDefinition.run);
  const after = snapshot(gateDefinition.drift);
  const drifted = before !== null && after !== null && before !== after;
  const exitCode = outcome.exitCode === 0 && !drifted ? 0 : 1;
  return {
    schemaVersion: 1,
    gateId: gateDefinition.id,
    sha,
    argv: gateDefinition.run,
    status: exitCode === 0 ? 'passed' : 'failed',
    exitCode,
    startedAt,
    durationMs: Math.round(performance.now() - started),
    ...(drifted ? { detail: 'generated artifact drifted' } : {}),
  };
}

function checkedPath(path, kind) {
  if (path === null) throw new Error(`verify: --${kind} needs a path`);
  const absolute = resolve(ROOT, path);
  const rel = relative(ROOT, absolute);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || resolve(absolute) !== absolute) {
    throw new Error(`verify: --${kind} must stay inside the repository`);
  }
  return absolute;
}

function writeReport(path, report) {
  const absolute = checkedPath(path, 'report');
  if (existsSync(absolute)) throw new Error(`verify: report already exists: ${path}`);
  mkdirSync(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${String(process.pid)}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, absolute);
}

function readReports(path) {
  const absolute = checkedPath(path, 'reports');
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      try {
        return JSON.parse(readFileSync(resolve(absolute, name), 'utf8'));
      } catch {
        return { invalidReport: name };
      }
    });
}

function currentSha(explicit) {
  if (explicit !== null && !/^[0-9a-f]{40}$/.test(explicit)) {
    throw new Error('verify: --sha must be a full lowercase commit SHA');
  }
  const observed = run(['git', 'rev-parse', 'HEAD'], { quiet: true }).output.trim();
  if (!/^[0-9a-f]{40}$/.test(observed)) throw new Error('verify: could not resolve HEAD');
  if (explicit !== null && explicit !== observed) {
    throw new Error(`verify: claimed SHA ${explicit} is not checked-out HEAD ${observed}`);
  }
  return observed;
}

function changesSince(reference) {
  const outcome = run(['git', 'diff', '--name-status', '-z', `${reference}...HEAD`], {
    quiet: true,
  });
  return outcome.exitCode === 0 ? parseNameStatus(outcome.output) : [];
}

function selectedFor(options) {
  if (options.artifactsOnly || options.fix) return REQUIRED.filter((candidate) => candidate.artifact === true);
  if (options.observations) return GATES.filter((candidate) => !candidate.required);
  if (options.changedFrom !== null) return selectGates(changesSince(options.changedFrom));
  return REQUIRED;
}

function usage() {
  return [
    'void-machine verify - run the canonical proof gates.',
    '',
    '  pnpm verify                 required gates',
    '  pnpm verify --artifacts     generated-artifact gates',
    '  pnpm verify --fix           regenerate, then check artifacts',
    '  pnpm verify --observations  non-gating performance observations',
    '  pnpm verify --changed-from <ref>  gates affected since a merge base',
    '  pnpm verify --list          stable gate IDs and argv',
  ].join('\n');
}

function main() {
  try {
    validateCatalogue();
    const options = parseArgs(process.argv.slice(2));
    if (options.unknown.length > 0) throw new Error(`verify: unknown or incomplete option ${options.unknown.join(', ')}`);
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const sha = currentSha(options.sha);

    if (options.aggregate) {
      const result = aggregateGateReports(REQUIRED.map((candidate) => candidate.id), readReports(options.reports), sha);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.ok) process.exitCode = 1;
      return;
    }

    if (options.gateId !== null) {
      const gateDefinition = GATES.find((candidate) => candidate.id === options.gateId);
      if (gateDefinition === undefined) throw new Error(`verify: unknown gate ${options.gateId}`);
      const report = runOne(gateDefinition, sha);
      if (options.report !== null) writeReport(options.report, report);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (report.status !== 'passed') process.exitCode = 1;
      return;
    }

    const selected = selectedFor(options);
    if (options.list) {
      for (const item of selected) process.stdout.write(`${item.id}: ${item.run.join(' ')}\n`);
      return;
    }
    if (options.fix) {
      for (const item of selected) {
        if (item.fix === undefined) continue;
        if (run(item.fix).exitCode !== 0) throw new Error(`verify: could not regenerate ${item.id}`);
      }
    }
    const failed = selected.map((item) => runOne(item, sha)).filter((report) => report.status === 'failed');
    if (failed.length === 0) {
      process.stdout.write(`verify: ${String(selected.length)} gate(s) passed on ${sha}.\n`);
      return;
    }
    for (const report of failed) process.stderr.write(`verify: ${report.gateId} failed\n`);
    process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

function validateCatalogue() {
  const ids = new Set();
  for (const item of GATES) {
    if (ids.has(item.id)) throw new Error(`verify: duplicate gate ${item.id}`);
    ids.add(item.id);
    if (!/^[a-z][a-z0-9-]*$/.test(item.id) || item.run.length === 0) throw new Error(`verify: invalid gate ${item.id}`);
    if (!TIERS.has(item.tier) || !RESOURCES.has(item.resource)) throw new Error(`verify: invalid classification for ${item.id}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
