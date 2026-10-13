import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'void-operation-')));
  roots.push(root);
  const store = join(root, 'store');
  const projects = [join(root, 'first'), join(root, 'second')];
  const binRoot = join(root, 'bin');
  for (const path of [store, binRoot, ...projects]) await mkdir(path);
  for (const project of projects) {
    await mkdir(join(project, '.void'));
    await writeFile(join(project, '.void/config.json'), 'before');
  }
  await writeFile(join(store, 'active.json'), 'old selection');
  return { root, store, projects, selection: { key: 'all', projectRoots: projects, binRoot },
    participants: [...projects.map(project => ({ kind: 'project' as const, root: project,
      mutations: [{ path: '.void/config.json', content: Buffer.from('after') }] })),
    { kind: 'active' as const, root: store, mutations: [{ path: 'active.json', content: Buffer.from('new selection') }] }],
  };
}

it('publishes selected projects serially and activates the CLI last', async () => {
  const { withUpdateLock } = await import('./update-lock.js');
  const { executeUpdateOperation } = await import('./update-operation.js');
  const fixtureState = await fixture();
  const order: string[] = [];
  await withUpdateLock(fixtureState.store, lease => executeUpdateOperation(lease, { ...fixtureState,
    operationId: 'op-1', target: '5.1.0' }, { afterParticipant: async kind => {
    order.push(kind);
    if (kind === 'project') expect(await readFile(join(fixtureState.store, 'active.json'), 'utf8')).toBe('old selection');
  } }));
  expect(order).toEqual(['project', 'project', 'active']);
  expect(await readFile(join(fixtureState.store, 'active.json'), 'utf8')).toBe('new selection');
});

it('restores all earlier participants when a later project fails', async () => {
  const { withUpdateLock } = await import('./update-lock.js');
  const { executeUpdateOperation } = await import('./update-operation.js');
  const state = await fixture();
  let count = 0;
  await expect(withUpdateLock(state.store, lease => executeUpdateOperation(lease, { ...state,
    operationId: 'op-1', target: '5.1.0' }, { afterParticipant: () => { if (++count === 2) throw new Error('later failure'); } })))
    .rejects.toThrow('later failure');
  for (const project of state.projects) expect(await readFile(join(project, '.void/config.json'), 'utf8')).toBe('before');
  expect(await readFile(join(state.store, 'active.json'), 'utf8')).toBe('old selection');
});

it('preserves later user edits and evidence when rollback conflicts', async () => {
  const { withUpdateLock } = await import('./update-lock.js');
  const { executeUpdateOperation } = await import('./update-operation.js');
  const state = await fixture();
  const project = state.projects[0];
  if (!project) throw new Error('fixture missing project');
  await expect(withUpdateLock(state.store, lease => executeUpdateOperation(lease, { ...state,
    operationId: 'op-1', target: '5.1.0' }, { afterParticipant: async () => {
    await writeFile(join(project, '.void/config.json'), 'user edit');
    throw new Error('failure');
  } }))).rejects.toThrow(/recovery.*conflict.*\.void\/config.json/i);
  expect(await readFile(join(project, '.void/config.json'), 'utf8')).toBe('user edit');
  expect(await readFile(join(state.store, 'operation/operation.json'), 'utf8')).toContain('op-1');
});

it.each(['foreign-root', 'foreign-path', 'activation-order', 'missing-selected-project'])(
  'refuses %s before publication', async attack => {
    const { withUpdateLock } = await import('./update-lock.js');
    const { executeUpdateOperation } = await import('./update-operation.js');
    const state = await fixture();
    const first = state.participants[0];
    if (!first) throw new Error('fixture missing participant');
    if (attack === 'foreign-root') first.root = state.root;
    if (attack === 'foreign-path') first.mutations[0] = { path: '.git/config', content: Buffer.from('bad') };
    if (attack === 'activation-order') state.participants.reverse();
    if (attack === 'missing-selected-project') state.participants.splice(1, 1);
    await expect(withUpdateLock(state.store, lease => executeUpdateOperation(lease, { ...state,
      operationId: 'op-1', target: '5.1.0' }))).rejects.toThrow();
    expect(await readFile(join(state.store, 'active.json'), 'utf8')).toBe('old selection');
  },
);

it('recovers a killed updater before the same selection can proceed again', async () => {
  const { withUpdateLock } = await import('./update-lock.js');
  const { recoverPendingUpdate } = await import('./update-operation.js');
  const state = await fixture();
  const input = join(state.root, 'child.json');
  await writeFile(input, JSON.stringify({ store: state.store, selection: state.selection, projects: state.projects }));
  const source = `
    import { readFile } from 'node:fs/promises';
    import { withUpdateLock } from ${JSON.stringify(new URL('./update-lock.ts', import.meta.url).href)};
    import { executeUpdateOperation } from ${JSON.stringify(new URL('./update-operation.ts', import.meta.url).href)};
    const input = JSON.parse(await readFile(process.argv[1], 'utf8'));
    await withUpdateLock(input.store, lease => executeUpdateOperation(lease, {
      selection: input.selection, operationId: 'killed-op', target: '5.1.0',
      participants: [...input.projects.map(root => ({ kind: 'project', root,
        mutations: [{ path: '.void/config.json', content: Buffer.from('after') }] })),
        { kind: 'active', root: input.store, mutations: [{ path: 'active.json', content: Buffer.from('new selection') }] }],
    }, { afterParticipant: () => process.kill(process.pid, 'SIGKILL') }));
  `;
  await expect(promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source, input], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), timeout: 10_000, maxBuffer: 1024 * 1024,
  })).rejects.toMatchObject({ signal: 'SIGKILL' });
  expect(await readFile(join(state.projects[0] ?? '', '.void/config.json'), 'utf8')).toBe('after');
  await withUpdateLock(state.store, lease => recoverPendingUpdate(lease, state.selection));
  for (const project of state.projects) expect(await readFile(join(project, '.void/config.json'), 'utf8')).toBe('before');
  expect(await readFile(join(state.store, 'active.json'), 'utf8')).toBe('old selection');
  await withUpdateLock(state.store, lease => recoverPendingUpdate(lease, state.selection));
});
