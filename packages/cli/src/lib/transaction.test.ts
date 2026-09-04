import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileModesEqual } from './receipts.js';
import { commitFileTransaction, type FileMutation } from './transaction.js';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'void-transaction-'));
}

const mutations: readonly FileMutation[] = [
  { path: '.void/hooks/guard.mjs', content: Buffer.from('new guard\n'), mode: 0o755 },
  { path: '.agents/skills/tdd/SKILL.md', content: Buffer.from('# TDD\n'), mode: 0o644 },
];

describe('commitFileTransaction', () => {
  it('publishes every staged file with its requested mode', async () => {
    const root = scratch();

    await commitFileTransaction(root, mutations);

    expect(readFileSync(join(root, '.void/hooks/guard.mjs'), 'utf8')).toBe('new guard\n');
    expect(fileModesEqual(lstatSync(join(root, '.void/hooks/guard.mjs')).mode, 0o755)).toBe(true);
    expect(readFileSync(join(root, '.agents/skills/tdd/SKILL.md'), 'utf8')).toBe('# TDD\n');
  });

  it.each([0, 1])('restores byte-for-byte after injected failure %s', async (failAfterMutation) => {
    const root = scratch();
    const existing = join(root, '.void/hooks/guard.mjs');
    mkdirSync(join(root, '.void/hooks'), { recursive: true });
    writeFileSync(existing, 'user bytes\n');
    chmodSync(existing, 0o600);

    await expect(commitFileTransaction(root, mutations, { failAfterMutation })).rejects.toThrow(
      /injected transaction failure/,
    );

    expect(readFileSync(existing, 'utf8')).toBe('user bytes\n');
    expect(fileModesEqual(lstatSync(existing).mode, 0o600)).toBe(true);
    expect(existsSync(join(root, '.agents/skills/tdd/SKILL.md'))).toBe(false);
  });

  it('keeps adjacent user files during commit and rollback', async () => {
    const root = scratch();
    const adjacent = join(root, '.agents/skills/private/SKILL.md');
    mkdirSync(join(root, '.agents/skills/private'), { recursive: true });
    writeFileSync(adjacent, '# private\n');

    await expect(commitFileTransaction(root, mutations, { failAfterMutation: 1 })).rejects.toThrow();

    expect(readFileSync(adjacent, 'utf8')).toBe('# private\n');
  });

  it('rolls back a receipt-authorized stale-file removal', async () => {
    const root = scratch();
    const stale = join(root, '.agents/skills/old/SKILL.md');
    mkdirSync(join(root, '.agents/skills/old'), { recursive: true });
    writeFileSync(stale, '# old\n');

    await expect(
      commitFileTransaction(
        root,
        [
          { path: '.agents/skills/old/SKILL.md', remove: true },
          { path: '.void/new', content: Buffer.from('new') },
        ],
        { failAfterMutation: 1 },
      ),
    ).rejects.toThrow();

    expect(readFileSync(stale, 'utf8')).toBe('# old\n');
    expect(existsSync(join(root, '.void/new'))).toBe(false);
  });

  it('rejects traversal and symlink targets before writing', async () => {
    const root = scratch();
    const outside = scratch();
    mkdirSync(join(root, '.void'), { recursive: true });
    symlinkSync(outside, join(root, '.void/hooks'));

    await expect(
      commitFileTransaction(root, [{ path: '../escape', content: Buffer.from('bad') }]),
    ).rejects.toThrow(/unsafe transaction path/);
    await expect(commitFileTransaction(root, mutations)).rejects.toThrow(/symbolic link/);
    expect(existsSync(join(outside, 'guard.mjs'))).toBe(false);
  });
});
