import { chmod, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { applyFileTransaction, prepareFileTransaction, recoverFileTransaction } from './transaction.js';

const nativeModes = vi.hoisted(() => ({ windows: false }));
const ioFault = vi.hoisted(() => ({ lstat: '', readFile: '', rename: '', code: 'EACCES', hits: 0 }));
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  function fail(method: 'lstat' | 'readFile' | 'rename', path: unknown) {
    if (String(path) === ioFault[method]) {
      ioFault.hits++;
      throw Object.assign(new Error(`${ioFault.code}: injected ${method} failure at ${String(path)}`), { code: ioFault.code });
    }
  }
  return { ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      fail('lstat', args[0]);
      return actual.lstat(...args);
    },
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      fail('readFile', args[0]);
      return actual.readFile(...args);
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      fail('rename', args[1]);
      return actual.rename(...args);
    },
    open: async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args);
    if (nativeModes.windows) {
      const chmodHandle = handle.chmod.bind(handle);
      handle.chmod = mode => chmodHandle((Number(mode) & 0o200) ? 0o666 : 0o444);
    }
    return handle;
  } };
});
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  nativeModes.windows = false;
  Object.assign(ioFault, { lstat: '', readFile: '', rename: '', code: 'EACCES', hits: 0 });
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'void-recovery-')));
  roots.push(root);
  await writeFile(join(root, 'owned'), 'before');
  await chmod(join(root, 'owned'), 0o600);
  return { root, journal: join(root, '.journal') };
}
const mutations = [{ path: 'owned', content: Buffer.from('after'), mode: 0o755 },
  { path: 'nested/new', content: Buffer.from('created') }];

it.each(['owned', 'journal.json', '0.before'])('does not treat unreadable %s as absent during preparation or recovery', async location => {
  const { root, journal } = await fixture();
  const originalMode = (await fs.stat(join(root, 'owned'))).mode & 0o777;
  if (location === 'owned') {
    ioFault.lstat = join(root, 'owned');
    await expect(prepareFileTransaction(root, mutations, journal, 'io-read')).rejects.toMatchObject({ code: 'EACCES' });
    expect(ioFault.hits).toBeGreaterThan(0);
    ioFault.lstat = '';
    expect(await readFile(join(root, 'owned'), 'utf8')).toBe('before');
    await expect(fs.stat(journal)).rejects.toMatchObject({ code: 'ENOENT' });
  }
  await prepareFileTransaction(root, mutations, journal, 'io-read');
  await applyFileTransaction(root, journal);
  ioFault.readFile = location === 'owned' ? join(root, location) : join(journal, location);
  ioFault.code = 'EIO';
  ioFault.hits = 0;
  await expect(recoverFileTransaction(root, journal)).rejects.toMatchObject({ code: 'EIO' });
  expect(ioFault.hits).toBeGreaterThan(0);
  ioFault.readFile = '';
  expect(await readFile(join(root, 'owned'), 'utf8')).toBe('after');
  expect(await readFile(join(journal, '0.before'), 'utf8')).toBe('before');
  expect(await readFile(join(journal, 'journal.json'), 'utf8')).toContain('io-read');
  await recoverFileTransaction(root, journal);
  expect(await readFile(join(root, 'owned'), 'utf8')).toBe('before');
  expect((await fs.stat(join(root, 'owned'))).mode & 0o777).toBe(originalMode);
  await expect(fs.stat(join(root, 'nested/new'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['EACCES', 'EIO'])('retains the operation and backups after %s during restore and recovers on retry', async code => {
  const { withUpdateLock } = await import('./update-lock.js');
  const { executeUpdateOperation, recoverPendingUpdate } = await import('./update-operation.js');
  const { root } = await fixture();
  const store = join(root, 'store');
  const binRoot = join(root, 'bin');
  for (const path of [store, binRoot, join(root, '.void')]) await mkdir(path);
  const target = join(root, '.void/config.json');
  await writeFile(target, 'original config');
  await chmod(target, 0o600);
  const originalMode = (await fs.stat(target)).mode & 0o777;
  await writeFile(join(store, 'active.json'), 'old CLI selection');
  const selection = { key: 'io-recovery', projectRoots: [root], binRoot };
  const failure = await withUpdateLock(store, lease => executeUpdateOperation(lease, {
    selection, operationId: 'failed-restore', target: '5.1.0', participants: [
      { kind: 'project', root, mutations: [{ path: '.void/config.json', content: Buffer.from('published config'), mode: 0o755 }] },
      { kind: 'active', root: store, mutations: [{ path: 'active.json', content: Buffer.from('new CLI selection') }] },
    ],
  }, { afterParticipant: async kind => {
    if (kind !== 'active') return;
    expect(await readFile(target, 'utf8')).toBe('published config');
    expect(await readFile(join(store, 'active.json'), 'utf8')).toBe('new CLI selection');
    ioFault.rename = target;
    ioFault.code = code;
    throw new Error('publication failure');
  } })).then(() => undefined, error => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure).toMatchObject({ message: expect.stringContaining(code),
    errors: [expect.objectContaining({ message: 'publication failure' }), expect.any(AggregateError)] });
  expect(ioFault.hits).toBeGreaterThan(0);
  expect(await readFile(target, 'utf8')).toBe('published config');
  expect(await readFile(join(store, 'active.json'), 'utf8')).toBe('old CLI selection');
  expect(await readFile(join(store, 'operation/operation.json'), 'utf8')).toContain('failed-restore');
  expect(await readFile(join(store, 'operation/0/0.before'), 'utf8')).toBe('original config');
  expect(await readFile(join(store, 'operation/0/journal.json'), 'utf8')).toContain('failed-restore');
  ioFault.rename = '';
  await withUpdateLock(store, lease => recoverPendingUpdate(lease, selection));
  expect(await readFile(target, 'utf8')).toBe('original config');
  expect((await fs.stat(target)).mode & 0o777).toBe(originalMode);
  expect(await readFile(join(store, 'active.json'), 'utf8')).toBe('old CLI selection');
  await expect(fs.stat(join(store, 'operation'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('recovers using the mode the filesystem actually supports instead of a POSIX request', async () => {
  const { root, journal } = await fixture();
  await chmod(join(root, 'owned'), 0o666);
  nativeModes.windows = true;
  await prepareFileTransaction(root, mutations, journal, 'native-modes');
  await applyFileTransaction(root, journal);
  await expect(recoverFileTransaction(root, journal)).resolves.toBeUndefined();
  expect(await readFile(join(root, 'owned'), 'utf8')).toBe('before');
  expect((await fs.stat(join(root, 'owned'))).mode & 0o777).toBe(0o666);
});

it('persists preparation without publishing and restores bytes and modes after publication', async () => {
  const { root, journal } = await fixture();
  await prepareFileTransaction(root, mutations, journal, 'operation-1');
  expect(await readFile(join(root, 'owned'), 'utf8')).toBe('before');
  await applyFileTransaction(root, journal);
  expect(await readFile(join(root, 'owned'), 'utf8')).toBe('after');
  await recoverFileTransaction(root, journal);
  expect(await readFile(join(root, 'owned'), 'utf8')).toBe('before');
  expect(await readdir(root)).not.toContain('nested');
  const { stat } = await import('node:fs/promises');
  expect((await stat(join(root, 'owned'))).mode & 0o777).toBe(0o600);
  await recoverFileTransaction(root, journal);
  expect(await readFile(join(root, 'owned'), 'utf8')).toBe('before');
});

it('reconciles a rename before any progress record instead of trusting a step counter', async () => {
  const { root, journal } = await fixture();
  await prepareFileTransaction(root, mutations, journal, 'operation-1');
  await expect(applyFileTransaction(root, journal, {
    afterMutation: () => { throw new Error('interrupted'); },
  })).rejects.toThrow('interrupted');
  expect(await readFile(join(root, 'owned'), 'utf8')).toBe('after');
  await recoverFileTransaction(root, journal);
  expect(await readFile(join(root, 'owned'), 'utf8')).toBe('before');
});

it.each(['bytes', 'mode'])('preserves a later user change to %s and keeps backup evidence', async change => {
  const { root, journal } = await fixture();
  await prepareFileTransaction(root, mutations, journal, 'operation-1');
  await applyFileTransaction(root, journal);
  if (change === 'bytes') await writeFile(join(root, 'owned'), 'user edit');
  else await chmod(join(root, 'owned'), 0o640);
  await expect(recoverFileTransaction(root, journal)).rejects.toThrow(/conflict.*owned/i);
  expect(await readFile(join(root, 'owned'), 'utf8')).toBe(change === 'bytes' ? 'user edit' : 'after');
  expect(await readdir(journal)).toContain('0.before');
});

it('refuses a forward write when the prepared snapshot has changed', async () => {
  const { root, journal } = await fixture();
  await prepareFileTransaction(root, mutations, journal, 'operation-1');
  await writeFile(join(root, 'owned'), 'user edit');
  await expect(applyFileTransaction(root, journal)).rejects.toThrow(/conflict.*owned/i);
  expect(await readFile(join(root, 'owned'), 'utf8')).toBe('user edit');
});

it.each(['traversal', 'duplicate', 'foreign-root', 'backup', 'schema', 'own-journal']) (
  'rejects %s journal tampering before changing files', async attack => {
    const { root, journal } = await fixture();
    await prepareFileTransaction(root, mutations, journal, 'operation-1');
    if (attack === 'backup') await writeFile(join(journal, '0.before'), 'corrupted backup');
    else {
      const record = JSON.parse(await readFile(join(journal, 'journal.json'), 'utf8'));
      if (attack === 'traversal') record.entries[0].path = '../escaped';
      if (attack === 'duplicate') record.entries.push(record.entries[0]);
      if (attack === 'foreign-root') record.root = tmpdir();
      if (attack === 'schema') record.schemaVersion = 99;
      if (attack === 'own-journal') record.entries[0].path = '.journal/0.before';
      await writeFile(join(journal, 'journal.json'), JSON.stringify(record));
    }
    await expect(applyFileTransaction(root, journal)).rejects.toThrow();
    expect(await readFile(join(root, 'owned'), 'utf8')).toBe('before');
  },
);

it('rejects a symlink ancestor installed after preparation', async () => {
  const { root, journal } = await fixture();
  await prepareFileTransaction(root, mutations, journal, 'operation-1');
  await mkdir(join(root, 'elsewhere'));
  await symlink(join(root, 'elsewhere'), join(root, 'nested'), 'dir');
  await expect(applyFileTransaction(root, journal)).rejects.toThrow(/symbolic link/i);
  expect(await readdir(join(root, 'elsewhere'))).toEqual([]);
});

it('rejects nonregular targets rather than treating unreadable state as absent', async () => {
  const { root, journal } = await fixture();
  await mkdir(join(root, 'directory'));
  await expect(prepareFileTransaction(root,
    [{ path: 'directory', content: Buffer.from('bad') }], journal, 'operation-1'))
    .rejects.toThrow(/regular file/i);
});

it('adopts only an explicitly verified leaf link and restores the original link on recovery', async () => {
  const { root, journal } = await fixture();
  await symlink('owned', join(root, 'launcher'));
  await prepareFileTransaction(root, [{ path: 'launcher', content: Buffer.from('stable launcher'),
    mode: 0o755, replaceLink: 'owned' }], journal, 'operation-1');
  await applyFileTransaction(root, journal);
  expect(await readFile(join(root, 'launcher'), 'utf8')).toBe('stable launcher');
  expect(await readFile(join(root, 'owned'), 'utf8')).toBe('before');
  await recoverFileTransaction(root, journal);
  expect(await readlink(join(root, 'launcher'))).toBe('owned');
  await recoverFileTransaction(root, journal);
});

it('preserves an unknown replacement link rather than following it during recovery', async () => {
  const { root, journal } = await fixture();
  await symlink('owned', join(root, 'launcher'));
  await prepareFileTransaction(root, [{ path: 'launcher', content: Buffer.from('stable launcher'),
    replaceLink: 'owned' }], journal, 'operation-1');
  await applyFileTransaction(root, journal);
  await rm(join(root, 'launcher'));
  await symlink('user-chosen', join(root, 'launcher'));
  await expect(recoverFileTransaction(root, journal)).rejects.toThrow(/conflict.*launcher/i);
  expect(await readlink(join(root, 'launcher'))).toBe('user-chosen');
});

it('refuses a launcher link that changed after ownership qualification', async () => {
  const { root, journal } = await fixture();
  await symlink('owned', join(root, 'launcher'));
  await expect(prepareFileTransaction(root, [{ path: 'launcher', content: Buffer.from('stable launcher'),
    replaceLink: 'different-link' }], journal, 'operation-1')).rejects.toThrow(/link.*changed/i);
  expect(await readlink(join(root, 'launcher'))).toBe('owned');
});

it('refuses a changed planning snapshot instead of adopting it as the publication baseline', async () => {
  const { root, journal } = await fixture();
  await expect(prepareFileTransaction(root, [{ path: 'owned', content: Buffer.from('new'),
    expected: { exists: false } }], journal, 'operation-1')).rejects.toThrow(/conflict.*owned/i);
  expect(await readFile(join(root, 'owned'), 'utf8')).toBe('before');
});
