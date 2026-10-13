import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { applyFileTransaction, prepareFileTransaction, recoverFileTransaction } from './transaction.js';

const roots: string[] = [];
afterEach(async () => {
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

it.each(['traversal', 'duplicate', 'foreign-root', 'backup', 'schema']) (
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
