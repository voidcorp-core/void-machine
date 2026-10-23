// @test-resource subprocess
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { cliVersion } from './paths.js';
import type { FileMutation } from './transaction.js';

async function provePolicyRollback(root: string, mutations: readonly FileMutation[], program: string, hold: string | undefined) {
  const { withUpdateLock } = await import('./update-lock.js');
  const { executeUpdateOperation } = await import('./update-operation.js');
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'policy-rollback-')));
  roots.push(workspace);
  const store = join(workspace, 'store');
  const later = join(workspace, 'later');
  const binRoot = join(workspace, 'bin');
  for (const path of [store, binRoot, join(later, '.void')]) await mkdir(path, { recursive: true });
  await writeFile(join(later, '.void/config.json'), 'later before');
  await writeFile(join(store, 'active.json'), 'old CLI selection');
  const programPath = join(root, '.void/program.md');
  const holdPath = join(root, '.void/machine/autopilot/merge-hold.json');
  const originalMode = (await stat(programPath)).mode & 0o777;
  const migrated = mutations.find(mutation => mutation.path === '.void/program.md');
  if (!migrated || !('content' in migrated)) throw new Error('Missing real programme migration');
  let published = 0;
  await expect(withUpdateLock(store, lease => executeUpdateOperation(lease, {
    selection: { key: 'policy-all', projectRoots: [root, later], binRoot },
    operationId: 'operation-1', target: cliVersion(), participants: [
      { kind: 'project', root, mutations },
      { kind: 'project', root: later, mutations: [{ path: '.void/config.json', content: Buffer.from('later after') }] },
      { kind: 'active', root: store, mutations: [{ path: 'active.json', content: Buffer.from('new CLI selection') }] },
    ],
  }, { afterParticipant: async kind => {
    expect(kind).toBe('project');
    published++;
    expect(await readFile(programPath)).toEqual(Buffer.from(migrated.content));
    expect(JSON.parse(await readFile(holdPath, 'utf8')).mergedBy).toBe('human');
    if (hold !== undefined) expect(await readFile(holdPath, 'utf8')).toBe(hold);
    expect(await readFile(join(store, 'active.json'), 'utf8')).toBe('old CLI selection');
    if (published === 2) {
      expect(await readFile(join(later, '.void/config.json'), 'utf8')).toBe('later after');
      throw new Error('later project failure');
    }
  } }))).rejects.toThrow('later project failure');
  expect(published).toBe(2);
  expect(await readFile(programPath, 'utf8')).toBe(program);
  expect((await stat(programPath)).mode & 0o777).toBe(originalMode);
  if (hold === undefined) await expect(readFile(holdPath)).rejects.toMatchObject({ code: 'ENOENT' });
  else expect(await readFile(holdPath, 'utf8')).toBe(hold);
  expect(await readFile(join(later, '.void/config.json'), 'utf8')).toBe('later before');
  expect(await readFile(join(store, 'active.json'), 'utf8')).toBe('old CLI selection');
  await expect(stat(join(store, 'operation'))).rejects.toMatchObject({ code: 'ENOENT' });
}

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

it.each(['absent', 'partial', 'authoritative'])('recovers manifest ownership with a %s receipt only in the prepared update', async state => {
  const { prepareCandidatePlan, decodeCandidatePlan, assertCandidateInputs } = await import('./candidate-plan.js');
  const { INSTALL_RECEIPT_PATH, parseReceipt } = await import('./receipts.js');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'candidate-ownership-')));
  roots.push(root);
  await mkdir(join(root, '.void/machine/receipts'), { recursive: true });
  await mkdir(join(root, '.codex'));
  const files = [
    { path: 'AGENTS.md', content: '# Authored guidance\n' },
    { path: '.void/config.json', content: '{"packs":{},"preference":"keep"}\n' },
    { path: '.void/PROJECT-DOCTRINE.md', content: '# Original doctrine\n' },
  ];
  const attested = files.map(file => ({ path: file.path,
    sha256: createHash('sha256').update(file.content).digest('hex') }));
  for (const file of files) await writeFile(join(root, file.path), file.content);
  await writeFile(join(root, '.void/install-manifest.json'), JSON.stringify({
    schemaVersion: 1, version: cliVersion(), files: attested,
  }));
  // A manifest must not reclaim a later edit, even though init preserves it.
  await writeFile(join(root, '.void/PROJECT-DOCTRINE.md'), '# Later user edit\n');
  const prior = JSON.stringify({ schemaVersion: 1, version: cliVersion(), source: 'local',
    runtimes: ['codex'], files: state === 'authoritative'
      ? [{ path: 'AGENTS.md', sha256: 'a'.repeat(64), mode: 0o644 }] : [] });
  if (state !== 'absent') await writeFile(join(root, INSTALL_RECEIPT_PATH), prior);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const plan = decodeCandidatePlan(JSON.stringify(await prepareCandidatePlan(request(root))), request(root));
  const mutation = plan.mutations.find(file => file.path === INSTALL_RECEIPT_PATH);
  if (!mutation || !('content' in mutation)) throw new Error('Missing prepared receipt');
  const receipt = parseReceipt(Buffer.from(mutation.content).toString());
  expect(receipt?.files.map(file => file.path)).toContain('.void/config.json');
  expect(receipt?.files.some(file => file.path === 'AGENTS.md')).toBe(state !== 'authoritative');
  expect(receipt?.files.map(file => file.path)).not.toContain('.void/PROJECT-DOCTRINE.md');
  await expect(assertCandidateInputs(root, plan.inputs)).resolves.toBeUndefined();
  if (state === 'absent') await expect(readFile(join(root, INSTALL_RECEIPT_PATH))).rejects.toMatchObject({ code: 'ENOENT' });
  else expect(await readFile(join(root, INSTALL_RECEIPT_PATH), 'utf8')).toBe(prior);
});

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

it.each([
  ['human', false], ['human', true], ['union-reviewed', false],
] as const)('prepares %s policy with existing hold %s and restores it after later-project failure', async (gate, existingHold) => {
  const { prepareCandidatePlan, decodeCandidatePlan } = await import('./candidate-plan.js');
  const { mergeHoldRecord } = await import('./autopilot/merge-hold.js');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'void-candidate-policy-')));
  roots.push(root);
  await mkdir(join(root, '.void'));
  await mkdir(join(root, '.codex'));
  await writeFile(join(root, '.void/install-manifest.json'), JSON.stringify({ schemaVersion: 1, version: cliVersion(), files: [] }));
  const program = `---\nschemaVersion: 1\nstatus: executing\nprogram: fixture\nplan: docs/plan.md\nspec: docs/spec.md\nprogress:\n  provider: linear\n  scope: fixture\n  order: [DEV-1022]\n  states:\n    ready: [Todo]\n    started: [Doing]\n    review: [Review]\n    done: [Done]\nautopilot:\n  schemaVersion: 1\n  enabled: false\n  mergeGate: ${gate}\n  base: develop\n  deployBranch: main\n  verifyCommands: [[pnpm, test]]\n---\nAuthored body\n`;
  await writeFile(join(root, '.void/program.md'), program);
  await chmod(join(root, '.void/program.md'), 0o600);
  const programMode = (await stat(join(root, '.void/program.md'))).mode & 0o777;
  const hold = existingHold ? mergeHoldRecord('2026-09-01T00:00:00.000Z') : undefined;
  if (hold !== undefined) {
    await mkdir(join(root, '.void/machine/autopilot'), { recursive: true });
    await writeFile(join(root, '.void/machine/autopilot/merge-hold.json'), hold);
  }
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  if (gate === 'union-reviewed') {
    await expect(prepareCandidatePlan(request(root)).then(() => undefined)).rejects.toThrow(/no proven equivalent/);
  } else {
    const plan = decodeCandidatePlan(JSON.stringify(await prepareCandidatePlan(request(root))), request(root));
    const policyPaths = existingHold ? ['.void/program.md'] : ['.void/machine/autopilot/merge-hold.json', '.void/program.md'];
    expect(plan.mutations.slice(0, policyPaths.length).map(mutation => mutation.path)).toEqual(policyPaths);
    const migrated = plan.mutations.find(mutation => mutation.path === '.void/program.md');
    expect(migrated && 'content' in migrated && Buffer.from(migrated.content).toString()).toContain('enabled: false');
    expect(migrated && 'mode' in migrated && migrated.mode).toBe(programMode);
    expect(await readFile(join(root, '.void/program.md'), 'utf8')).toBe(program);
    await provePolicyRollback(root, plan.mutations, program, hold);
  }
  expect(await readFile(join(root, '.void/program.md'), 'utf8')).toBe(program);
  if (hold === undefined) await expect(readFile(join(root, '.void/machine/autopilot/merge-hold.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  else expect(await readFile(join(root, '.void/machine/autopilot/merge-hold.json'), 'utf8')).toBe(hold);
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
