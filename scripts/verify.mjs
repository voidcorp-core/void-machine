#!/usr/bin/env node
// Local verification and bounded impact selection. Actions owns CI execution/results.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GATES = [
  { id: 'version-lockstep', run: ['pnpm', 'version:check'] },
  { id: 'anti-bloat', run: ['pnpm', 'anti-bloat:check'] },
  { id: 'skill-references', run: ['pnpm', 'skills:check-references'] },
  { id: 'lint', run: ['pnpm', 'lint'] },
  { id: 'generated-artifacts', run: ['pnpm', 'derive:check'], artifact: true, fix: ['pnpm', 'derive'] },
  { id: 'publish-safety', run: ['pnpm', 'check:publish'] },
  { id: 'package-size', run: ['pnpm', 'check:size'] },
  { id: 'build', run: ['pnpm', 'build'] },
  { id: 'self-host-sync', run: ['node', 'packages/cli/dist/bin/void-machine.mjs', 'self-host', 'sync'] },
  { id: 'self-host-doctor', run: ['node', 'packages/cli/dist/bin/void-machine.mjs', 'self-host', 'doctor'] },
  { id: 'typecheck', run: ['pnpm', 'typecheck'] },
  { id: 'test-engine', run: ['pnpm', 'test:engine'] },
  { id: 'test-local', run: ['pnpm', 'test:local'] },
  { id: 'test-network', run: ['pnpm', 'test:network'] },
];
const CHEAP = new Set(['version-lockstep', 'anti-bloat', 'skill-references', 'lint']);
const fullImpact = () => ({ docs: false, version: true, engine: true, local: true, network: true, consumer: true, crossPlatform: true });

export function selectImpact(changes) {
  if (changes.length === 0 || changes.some(change => !change.path || ['deleted', 'renamed'].includes(change.status))) return fullImpact();
  const paths = changes.flatMap(change => [change.path, change.previousPath].filter(Boolean));
  if (paths.some(path => typeof path !== 'string' || path.includes('..') || path.includes('\\'))) return fullImpact();
  const docs = path => /^docs\/.+\.md$/.test(path) || ['README.md', 'CONTRIBUTING.md'].includes(path);
  if (paths.every(docs)) return { docs: true, version: false, engine: false, local: false, network: false, consumer: false, crossPlatform: false };
  const result = { docs: false, version: false, engine: false, local: false, network: false, consumer: false, crossPlatform: false };
  for (const path of paths) {
    if (docs(path)) continue;
    // Test-only edits select the existing Vitest project. Shared fixtures/config broaden.
    if (/^(?:packages\/(?:mission-engine|cli|core|hook-runner|void-machine)\/|test\/).+\.test\.ts$/.test(path) && !path.startsWith('test/support/')) {
      if (path.startsWith('packages/mission-engine/src/')) result.engine = true;
      else if (path.startsWith('packages/cli/src/lib/ui/') || /^packages\/void-machine\/test\/[^/]*(?:daemon|note|signal)[^/]*\.test\.ts$/.test(path)) result.network = true;
      else result.local = true;
      continue;
    }
    // These pure engine policies are consumed by CLI and runtime: retain all three projects.
    // File/process/install/shared or otherwise uncertain sources use all supported OS.
    if (/^packages\/mission-engine\/src\/(?:risk|budget|findings|routing|policy)\/[^/]+\.ts$/.test(path)) {
      Object.assign(result, { engine: true, local: true, network: true, consumer: true });
      continue;
    }
    return fullImpact();
  }
  return result;
}

export function selectGates(changes) {
  const impact = selectImpact(changes);
  return GATES.filter(gate => {
    if (impact.docs) return gate.id === 'skill-references';
    if (gate.id === 'version-lockstep') return impact.version;
    if (gate.id.startsWith('test-')) return impact[gate.id.slice(5)];
    return true;
  });
}

export function parseNameStatus(output) {
  if (!output.endsWith('\0')) return [];
  const fields = output.slice(0, -1).split('\0');
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const code = fields[index];
    if (!/^(?:[AMDT]|[RC]\d{1,3})$/.test(code) || code === ' ') return [];
    const renamed = /^[RC]/.test(code);
    const previousPath = renamed ? fields[index + 1] : undefined;
    const path = fields[index + (renamed ? 2 : 1)];
    if (!path || (renamed && !previousPath)) return [];
    changes.push({ path, ...(renamed ? { previousPath } : {}), status: renamed ? 'renamed' : code === 'D' ? 'deleted' : 'modified' });
    index += renamed ? 3 : 2;
  }
  return changes;
}

export function ciImpact(eventName, event, changes) {
  const base = eventName === 'merge_group' ? event.merge_group?.base_sha : event.pull_request?.base?.sha;
  if (!['pull_request', 'merge_group'].includes(eventName)
    || (eventName === 'pull_request' && event.pull_request?.base?.ref !== 'develop')
    || !/^[0-9a-f]{40}$/.test(base ?? '')) return fullImpact();
  return selectImpact(changes);
}

export function parseArgs(argv) {
  const options = { artifactsOnly: false, fix: false, list: false, help: false, ci: false, gateId: null, sha: null, changedFrom: null, unknown: [] };
  const switches = { '--artifacts': 'artifactsOnly', '--fix': 'fix', '--list': 'list', '--help': 'help', '-h': 'help', '--ci-impact': 'ci' };
  const values = { '--gate': 'gateId', '--sha': 'sha', '--changed-from': 'changedFrom' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (switches[arg]) options[switches[arg]] = true;
    else if (values[arg] && argv[index + 1] && !argv[index + 1].startsWith('-')) options[values[arg]] = argv[++index];
    else options.unknown.push(arg);
  }
  return options;
}

function run(command, options = {}) {
  const [bin, ...args] = command;
  const result = spawnSync(bin, args, { cwd: ROOT, stdio: options.quiet ? 'pipe' : 'inherit', encoding: 'utf8', shell: false, env: { ...process.env, ...(options.env ?? {}) } });
  return { exitCode: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

export function runChecks(selected, execute = gate => run(gate.run).exitCode) {
  const failed = [];
  for (const gate of selected.filter(item => CHEAP.has(item.id))) if (execute(gate) !== 0) failed.push(gate.id);
  if (failed.length > 0) return failed;
  for (const gate of selected.filter(item => !CHEAP.has(item.id))) {
    if (execute(gate) !== 0) {
      failed.push(gate.id);
      // No downstream proof after a failed prerequisite, including build/freshness.
      break;
    }
  }
  return failed;
}

function currentSha(explicit) {
  const observed = run(['git', 'rev-parse', 'HEAD'], { quiet: true }).output.trim();
  if (!/^[0-9a-f]{40}$/.test(observed)) throw new Error('verify: could not resolve HEAD');
  if (explicit !== null && explicit !== observed) throw new Error(`verify: claimed SHA is not checked-out HEAD ${observed}`);
  return observed;
}

function changesSince(reference, combined = false) {
  if (!reference || reference.startsWith('-')) return [];
  const result = run(['git', 'diff', '--name-status', '-z', combined ? reference : `${reference}...HEAD`, ...(combined ? ['HEAD'] : []), '--'], { quiet: true });
  return result.exitCode === 0 ? parseNameStatus(result.output) : [];
}

// An invocation-owned temporary is reusable only while the checkout is clean.
export async function withVerificationArtifact(selected, execute) {
  if (process.env.VOID_CONFORMANCE_TARBALL
    || !['publish-safety', 'package-size'].every(id => selected.some(gate => gate.id === id))
    || run(['git', 'status', '--porcelain=v1', '--untracked-files=all'], { quiet: true }).output.trim() !== '') return await execute({});
  const temporary = mkdtempSync(resolve(tmpdir(), 'verify-artifact-'));
  try {
    const { packConformanceArtifact } = await import('../packages/cli/scripts/conformance-artifact.mjs');
    const artifact = await packConformanceArtifact(resolve(temporary, 'artifact'));
    return await execute({ VOID_CONFORMANCE_TARBALL: artifact.tarball });
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.unknown.length) throw new Error(`verify: unknown or incomplete option ${options.unknown.join(', ')}`);
    if (options.help) {
      process.stdout.write('pnpm verify [--changed-from <ref>] [--list] | --artifacts | --fix | --gate <id>\n');
      return;
    }
    const sha = currentSha(options.sha);
    if (options.ci) {
      let event = {};
      try { event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')); }
      catch { process.stderr.write('verify: event unavailable; selecting complete validation.\n'); }
      const name = process.env.GITHUB_EVENT_NAME;
      const base = name === 'merge_group' ? event.merge_group?.base_sha : event.pull_request?.base?.sha;
      const impact = ciImpact(name, event, changesSince(base, name === 'merge_group'));
      const output = Object.entries(impact).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
      process.stdout.write(output);
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
      return;
    }
    const selected = options.gateId ? GATES.filter(gate => gate.id === options.gateId)
      : options.artifactsOnly || options.fix ? GATES.filter(gate => gate.artifact)
      : options.changedFrom ? selectGates(changesSince(options.changedFrom)) : GATES;
    if (!selected.length) throw new Error(`verify: unknown gate ${options.gateId}`);
    if (options.list) {
      for (const gate of selected) process.stdout.write(`${gate.id}: ${gate.run.join(' ')}\n`);
      return;
    }
    if (options.fix) for (const gate of selected) if (gate.fix && run(gate.fix).exitCode !== 0) throw new Error(`verify: could not regenerate ${gate.id}`);
    // Cheap feedback must precede archive preparation as well as build/test work.
    const cheap = selected.filter(gate => CHEAP.has(gate.id));
    let failed = runChecks(cheap);
    if (!failed.length) {
      const remaining = selected.filter(gate => !CHEAP.has(gate.id));
      failed = await withVerificationArtifact(remaining, env => runChecks(remaining, gate => run(gate.run, { env }).exitCode));
    }
    if (failed.length) {
      process.stderr.write(`verify: failed ${failed.join(', ')}; dependent work was not executed.\n`);
      process.exitCode = 1;
    } else process.stdout.write(`verify: ${selected.length} check(s) passed on ${sha}.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
