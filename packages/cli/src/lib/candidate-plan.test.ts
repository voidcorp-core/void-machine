// @test-resource subprocess
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { cliVersion } from './paths.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
function request(root = '/fixture') {
  return { protocol: 1 as const, operationId: 'operation-1', version: cliVersion(), root };
}
function response() {
  return { ...request(), mutations: [{ path: '.void/config.json', content: Buffer.from('{}').toString('base64'), mode: 0o600 }],
    inputs: [], restored: [], preserved: [], runtimes: ['codex'] };
}

it('decodes a bounded candidate plan bound to its requested operation, version and root', async () => {
  const { decodeCandidatePlan } = await import('./candidate-plan.js');
  const decoded = decodeCandidatePlan(JSON.stringify(response()), request());
  expect(decoded.mutations).toEqual([{ path: '.void/config.json', content: Buffer.from('{}'), mode: 0o600, expected: { exists: false } }]);
});

it('binds every write and removal to the original candidate input state', async () => {
  const { decodeCandidatePlan } = await import('./candidate-plan.js');
  const { prepareFileTransaction } = await import('./transaction.js');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'void-candidate-cas-')));
  roots.push(root);
  await mkdir(join(root, '.void'));
  await writeFile(join(root, '.void/config.json'), 'later user edit');
  const input = request(root);
  const plan = decodeCandidatePlan(JSON.stringify({ ...response(), ...input,
    inputs: [{ path: '.void/config.json', sha256: 'a'.repeat(64), mode: 0o600 }],
    mutations: [...response().mutations, { path: '.void/installed/old.md', remove: true }],
  }), input);
  expect(plan.mutations[0]?.expected).toEqual({ exists: true, sha256: 'a'.repeat(64), mode: 0o600 });
  expect(plan.mutations[1]?.expected).toEqual({ exists: false });
  await expect(prepareFileTransaction(root, plan.mutations, join(root, 'journal'), 'cas')).rejects.toThrow(/planning conflict.*config/);
  expect(await readFile(join(root, '.void/config.json'), 'utf8')).toBe('later user edit');
});

it.each(['human', 'union-reviewed'])('prepares equivalent %s programme policy before any project effects', async gate => {
  const { prepareCandidatePlan, decodeCandidatePlan } = await import('./candidate-plan.js');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'void-candidate-policy-')));
  roots.push(root);
  await mkdir(join(root, '.void'));
  await mkdir(join(root, '.codex'));
  await writeFile(join(root, '.void/install-manifest.json'), JSON.stringify({ schemaVersion: 1, version: cliVersion(), files: [] }));
  const program = `---\nschemaVersion: 1\nstatus: executing\nprogram: fixture\nplan: docs/plan.md\nspec: docs/spec.md\nprogress:\n  provider: linear\n  scope: fixture\n  order: [DEV-1022]\n  states:\n    ready: [Todo]\n    started: [Doing]\n    review: [Review]\n    done: [Done]\nautopilot:\n  schemaVersion: 1\n  enabled: false\n  mergeGate: ${gate}\n  base: develop\n  deployBranch: main\n  verifyCommands: [[pnpm, test]]\n---\nAuthored body\n`;
  await writeFile(join(root, '.void/program.md'), program);
  await chmod(join(root, '.void/program.md'), 0o600);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  if (gate === 'union-reviewed') {
    await expect(prepareCandidatePlan(request(root)).then(() => undefined)).rejects.toThrow(/no proven equivalent/);
  } else {
    const plan = decodeCandidatePlan(JSON.stringify(await prepareCandidatePlan(request(root))), request(root));
    expect(plan.mutations.slice(0, 2).map(mutation => mutation.path)).toEqual(['.void/machine/autopilot/merge-hold.json', '.void/program.md']);
    const migrated = plan.mutations[1];
    expect(migrated && 'content' in migrated && Buffer.from(migrated.content).toString()).toContain('enabled: false');
    expect(migrated && 'mode' in migrated && migrated.mode).toBe(0o600);
  }
  expect(await readFile(join(root, '.void/program.md'), 'utf8')).toBe(program);
  await expect(readFile(join(root, '.void/machine/autopilot/merge-hold.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['operationId', 'version', 'root', 'protocol', 'traversal', 'global', 'git', 'duplicate', 'base64', 'mode', 'input-path'])(
  'rejects %s in candidate output before publication', async attack => {
    const { decodeCandidatePlan } = await import('./candidate-plan.js');
    const plan = response();
    const mutation = plan.mutations[0];
    if (!mutation) throw new Error('fixture mutation missing');
    if (attack === 'operationId') plan.operationId = 'foreign';
    if (attack === 'version') plan.version = '99.0.0';
    if (attack === 'root') plan.root = '/foreign';
    if (attack === 'protocol') Object.assign(plan, { protocol: 99 });
    if (attack === 'traversal') mutation.path = '../escape';
    if (attack === 'global') mutation.path = '.void/cli/active.json';
    if (attack === 'git') mutation.path = '.git/config';
    if (attack === 'duplicate') plan.mutations.push(mutation);
    if (attack === 'base64') mutation.content = 'invalid===';
    if (attack === 'mode') mutation.mode = 0o7777;
    if (attack === 'input-path') Object.assign(plan, { inputs: [{ path: '../escape', sha256: 'a'.repeat(64), mode: 0o600 }] });
    expect(() => decodeCandidatePlan(JSON.stringify(plan), request())).toThrow();
  },
);

it('compiles its own bundled assets without changing the selected project and detects later input edits', async () => {
  const { prepareCandidatePlan, decodeCandidatePlan, assertCandidateInputs } = await import('./candidate-plan.js');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'void-candidate-')));
  roots.push(root);
  await mkdir(join(root, '.void'));
  await mkdir(join(root, '.codex'));
  const config = '{"packs":{},"preference":"keep"}\n';
  await writeFile(join(root, '.void/config.json'), config);
  await writeFile(join(root, '.void/install-manifest.json'), JSON.stringify({ schemaVersion: 1, version: cliVersion(), files: [] }));
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const input = request(root);
  const plan = decodeCandidatePlan(JSON.stringify(await prepareCandidatePlan(input)), input);
  expect(await readFile(join(root, '.void/config.json'), 'utf8')).toBe(config);
  expect(plan.runtimes).toEqual(['codex']);
  expect(plan.mutations.some(mutation => mutation.path === '.void/hooks/_void-hook.mjs')).toBe(true);
  await expect(assertCandidateInputs(root, plan.inputs)).resolves.toBeUndefined();
  await writeFile(join(root, '.void/config.json'), '{"preference":"later edit"}');
  await expect(assertCandidateInputs(root, plan.inputs)).rejects.toThrow(/changed.*config/i);
});
