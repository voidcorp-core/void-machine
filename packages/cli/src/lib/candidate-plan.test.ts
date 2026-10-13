// @test-resource subprocess
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
  expect(decoded.mutations).toEqual([{ path: '.void/config.json', content: Buffer.from('{}'), mode: 0o600 }]);
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
