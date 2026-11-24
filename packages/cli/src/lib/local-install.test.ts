import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitFileTransaction } from './transaction.js';
import {
  buildInstallReceipt,
  encodeReceipt,
  INSTALL_RECEIPT_PATH,
} from './receipts.js';
import {
  conflictMessage,
  prepareInstallCommit,
  seedInstallStage,
  withholdProjectOwned,
} from './local-install.js';

function scratch(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Mark the project as one we have installed into before, i.e. an update. */
function priorInstall(root: string): void {
  mkdirSync(join(root, '.void', 'machine', 'receipts'), { recursive: true });
  writeFileSync(
    join(root, ...INSTALL_RECEIPT_PATH.split('/')),
    encodeReceipt(buildInstallReceipt({
      version: '3.1.1',
      source: 'local',
      runtimes: ['claude'],
      files: [],
    })),
  );
}

describe('conflictMessage', () => {
  it('keeps the remedy singular for one path and plural beyond it', () => {
    expect(conflictMessage(['a.md'])).toContain('preserve it');
    expect(conflictMessage(['a.md', 'b.md'])).toContain('preserve them');
  });

  it('caps the list so the remedy stays visible under it', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => `.claude/skills/${n}/SKILL.md`);

    const message = conflictMessage(many);

    expect(message).toContain('and 2 more');
    expect(message).not.toContain('/g/');
    expect(message).toContain('--force');
  });
});

describe('local install staging', () => {
  it.each(['symlink', 'directory'])('refuses an ambiguous %s before withholding project files', async (kind) => {
    const root = scratch('void-project-');
    const stage = scratch('void-stage-');
    const path = '.claude/skills/void-tdd/SKILL.md';
    mkdirSync(join(root, '.claude/skills/void-tdd'), { recursive: true });
    mkdirSync(join(stage, '.claude/skills/void-tdd'), { recursive: true });
    writeFileSync(join(stage, path), '# shipped');
    if (kind === 'directory') mkdirSync(join(root, path));
    else {
      writeFileSync(join(root, 'target.md'), '# project');
      symlinkSync(join(root, 'target.md'), join(root, path));
    }
    await expect(withholdProjectOwned(root, stage)).rejects.toThrow(/unowned asset conflict/);
    expect(readFileSync(join(stage, path), 'utf8')).toBe('# shipped');
  });
  it('seeds only shared files needed for non-destructive merges', async () => {
    const root = scratch('void-project-');
    const stage = scratch('void-stage-');
    mkdirSync(join(root, '.claude'), { recursive: true });
    mkdirSync(join(root, '.claude', 'skills', 'private'), { recursive: true });
    writeFileSync(join(root, '.claude', 'settings.json'), '{"user":true}\n');
    writeFileSync(join(root, 'CLAUDE.md'), '# user\n');
    writeFileSync(join(root, '.claude', 'skills', 'private', 'SKILL.md'), '# private\n');

    await seedInstallStage(root, stage);

    expect(readFileSync(join(stage, '.claude', 'settings.json'), 'utf8')).toBe('{"user":true}\n');
    expect(readFileSync(join(stage, 'CLAUDE.md'), 'utf8')).toBe('# user\n');
    expect(existsSync(join(stage, '.claude', 'skills', 'private', 'SKILL.md'))).toBe(false);
  });

  it('owns new managed files but never takes ownership of a pre-existing shared file', async () => {
    const root = scratch('void-project-');
    const stage = scratch('void-stage-');
    writeFileSync(join(root, 'CLAUDE.md'), '# user\n');
    mkdirSync(join(stage, '.void', 'hooks'), { recursive: true });
    writeFileSync(join(stage, '.void', 'hooks', 'guard.mjs'), 'guard\n');
    writeFileSync(join(stage, 'CLAUDE.md'), '# user\n\n<!-- void-harness -->\n');

    const prepared = await prepareInstallCommit({
      projectRoot: root,
      stageRoot: stage,
      version: '2.0.2',
      source: 'local',
      runtimes: ['claude'],
      force: false,
    });
    await commitFileTransaction(root, prepared.mutations);

    expect(prepared.receipt.files.map((file) => file.path)).toEqual(['.void/hooks/guard.mjs']);
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toContain('void-harness');
    expect(existsSync(join(root, '.void', 'machine', 'receipts', 'install-v1.json'))).toBe(true);
  });

  it('refuses to overwrite an unowned native asset unless force is explicit', async () => {
    // On an UPDATE: a receipt proves we installed here, so a managed file that
    // differs may be our own asset, edited. On a FIRST install the same situation
    // means the file predates us and belongs to the project — covered below.
    const root = scratch('void-project-');
    const stage = scratch('void-stage-');
    priorInstall(root);
    mkdirSync(join(root, '.claude', 'skills', 'tdd'), { recursive: true });
    mkdirSync(join(stage, '.claude', 'skills', 'tdd'), { recursive: true });
    writeFileSync(join(root, '.claude', 'skills', 'tdd', 'SKILL.md'), '# user version\n');
    writeFileSync(join(stage, '.claude', 'skills', 'tdd', 'SKILL.md'), '# harness version\n');

    await expect(prepareInstallCommit({
      projectRoot: root,
      stageRoot: stage,
      version: '2.0.2',
      source: 'local',
      runtimes: ['claude'],
      force: false,
    })).rejects.toThrow(/unowned asset conflict/);
  });

  it('claims a managed file whose bytes already match what it compiled', async () => {
    // The install writes nothing here, so the old code claimed nothing either
    // and the file silently left the receipt. The next version to change those
    // bytes then met an asset it no longer recognised and refused to update.
    const root = scratch('void-project-');
    const stage = scratch('void-stage-');
    const path = '.claude/agents/code-explorer.md';
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
    mkdirSync(join(stage, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(root, ...path.split('/')), '# explorer\n');
    writeFileSync(join(stage, ...path.split('/')), '# explorer\n');

    const prepared = await prepareInstallCommit({
      projectRoot: root,
      stageRoot: stage,
      version: '3.1.1',
      source: 'local',
      runtimes: ['claude'],
      force: false,
    });

    expect(prepared.receipt.files.map((file) => file.path)).toEqual([path]);
    // Identical bytes are no reason to rewrite them.
    expect(prepared.mutations.filter((m) => m.path === path)).toEqual([]);
  });

  it('leaves a shared file unclaimed even when its bytes already match', async () => {
    // Ownership of a shared file is the project's; matching bytes are a
    // coincidence of the block we patched into it, never a claim. Claiming one
    // would licence deleting it at the next update.
    const root = scratch('void-project-');
    const stage = scratch('void-stage-');
    writeFileSync(join(root, 'CLAUDE.md'), '# same\n');
    writeFileSync(join(stage, 'CLAUDE.md'), '# same\n');

    const prepared = await prepareInstallCommit({
      projectRoot: root,
      stageRoot: stage,
      version: '3.1.1',
      source: 'local',
      runtimes: ['claude'],
      force: false,
    });

    expect(prepared.receipt.files).toEqual([]);
  });

  it('names every conflicting asset at once, not just the first', async () => {
    // Rendered one at a time, the operator fixes one, re-runs, and meets the
    // next: the cost of the message is paid once per file instead of once.
    const root = scratch('void-project-');
    const stage = scratch('void-stage-');
    priorInstall(root);
    for (const name of ['tdd', 'verify']) {
      mkdirSync(join(root, '.claude', 'skills', name), { recursive: true });
      mkdirSync(join(stage, '.claude', 'skills', name), { recursive: true });
      writeFileSync(join(root, '.claude', 'skills', name, 'SKILL.md'), '# theirs\n');
      writeFileSync(join(stage, '.claude', 'skills', name, 'SKILL.md'), '# ours\n');
    }

    const attempt = prepareInstallCommit({
      projectRoot: root,
      stageRoot: stage,
      version: '3.1.1',
      source: 'local',
      runtimes: ['claude'],
      force: false,
    });

    await expect(attempt).rejects.toThrow('.claude/skills/tdd/SKILL.md');
    await expect(attempt).rejects.toThrow('.claude/skills/verify/SKILL.md');
  });

  it('can add one runtime while retaining unchanged ownership from the other', async () => {
    const root = scratch('void-project-');
    const stage = scratch('void-stage-');
    const claudePath = '.claude/skills/tdd/SKILL.md';
    mkdirSync(join(root, '.claude', 'skills', 'tdd'), { recursive: true });
    mkdirSync(join(root, '.void', 'machine', 'receipts'), { recursive: true });
    mkdirSync(join(stage, '.codex'), { recursive: true });
    writeFileSync(join(root, ...claudePath.split('/')), '# TDD\n');
    writeFileSync(join(stage, '.codex', 'hooks.json'), '{}\n');
    const prior = buildInstallReceipt({
      version: '2.0.2',
      source: 'local',
      runtimes: ['claude'],
      files: [{ path: claudePath, content: Buffer.from('# TDD\n'), mode: 0o644 }],
    });
    writeFileSync(join(root, ...INSTALL_RECEIPT_PATH.split('/')), encodeReceipt(prior));

    const prepared = await prepareInstallCommit({
      projectRoot: root,
      stageRoot: stage,
      version: '2.0.2',
      source: 'local',
      runtimes: ['claude', 'codex'],
      force: false,
      retainPreviousOwned: true,
    });

    expect(prepared.receipt.files.map((file) => file.path)).toEqual([
      '.claude/skills/tdd/SKILL.md',
      '.codex/hooks.json',
    ]);
    expect(prepared.mutations).not.toContainEqual({ path: claudePath, remove: true });
  });
});

// A project that already has skills and no harness could not install at all: init
// ran to the end, hit a name it shares with one of ours, and rolled everything
// back. `--force` would have overwritten a file the project owned before us and
// that we never wrote. Measured on a real first install, 2026-08-20.
describe('a first install onto a project that already has skills', () => {
  let withheld: string[] = [];
  const withExistingSkill = async (root: string, stage: string) => {
    mkdirSync(join(root, '.claude', 'skills', 'frontend-design'), { recursive: true });
    mkdirSync(join(stage, '.claude', 'skills', 'frontend-design'), { recursive: true });
    mkdirSync(join(stage, '.claude', 'skills', 'tdd'), { recursive: true });
    writeFileSync(join(root, '.claude', 'skills', 'frontend-design', 'SKILL.md'), '# the project own\n');
    writeFileSync(join(stage, '.claude', 'skills', 'frontend-design', 'SKILL.md'), '# ours\n');
    writeFileSync(join(stage, '.claude', 'skills', 'tdd', 'SKILL.md'), '# ours\n');
    // The stage is filtered first, exactly as `init` does it.
    withheld = await withholdProjectOwned(root, stage);
    return prepareInstallCommit({
      projectRoot: root,
      stageRoot: stage,
      version: '3.2.0',
      source: 'local',
      runtimes: ['claude'],
      force: false,
    });
  };

  it('installs everything else instead of refusing', async () => {
    const root = scratch('void-project-');
    const prepared = await withExistingSkill(root, scratch('void-stage-'));

    expect(prepared.mutations.map((m) => m.path)).toContain('.claude/skills/tdd/SKILL.md');
  });

  it('leaves the project its own file, byte for byte', async () => {
    const root = scratch('void-project-');
    const prepared = await withExistingSkill(root, scratch('void-stage-'));

    expect(prepared.mutations.map((m) => m.path)).not.toContain('.claude/skills/frontend-design/SKILL.md');
    expect(readFileSync(join(root, '.claude', 'skills', 'frontend-design', 'SKILL.md'), 'utf8'))
      .toBe('# the project own\n');
  });

  it('never claims it, so no later update may touch it', async () => {
    const root = scratch('void-project-');
    const prepared = await withExistingSkill(root, scratch('void-stage-'));

    expect(prepared.receipt.files.map((file) => file.path))
      .not.toContain('.claude/skills/frontend-design/SKILL.md');
  });

  it('names what it did not install, so nobody wonders where it went', async () => {
    const root = scratch('void-project-');
    await withExistingSkill(root, scratch('void-stage-'));

    expect(withheld).toEqual(['.claude/skills/frontend-design/SKILL.md']);
  });

  it('restores and reports an edited path that the previous receipt claimed', async () => {
    // The distinction is per path, not per install: a receipt that owns this exact
    // path means the file is our asset, and a difference means someone changed it.
    const root = scratch('void-project-');
    const stage = scratch('void-stage-');
    const path = '.claude/skills/frontend-design/SKILL.md';
    mkdirSync(join(root, '.void', 'machine', 'receipts'), { recursive: true });
    writeFileSync(
      join(root, ...INSTALL_RECEIPT_PATH.split('/')),
      encodeReceipt(buildInstallReceipt({
        version: '3.1.1',
        source: 'local',
        runtimes: ['claude'],
        files: [{ path, content: Buffer.from('# ours, as installed\n'), mode: 0o644 }],
      })),
    );

    const prepared = await withExistingSkill(root, stage);
    await commitFileTransaction(root, prepared.mutations);
    expect(prepared.restored).toEqual([path]);
    expect(readFileSync(join(root, path), 'utf8')).toBe('# ours\n');
    expect(prepared.receipt.files.map((file) => file.path)).toContain(path);
  });

  it.each([false, true])('reports corrected hook permissions with a rehydrated receipt: %s', async (rehydrated) => {
    const root = scratch('void-project-');
    const stage = scratch('void-stage-');
    const path = '.void/hooks/check.sh';
    const content = '#!/bin/sh\nexit 0\n';
    for (const base of [root, stage]) {
      mkdirSync(join(base, '.void/hooks'), { recursive: true });
      writeFileSync(join(base, path), content);
    }
    chmodSync(join(root, path), 0o644);
    chmodSync(join(stage, path), 0o755);
    writeFileSync(join(root, '.void/install-manifest.json'), JSON.stringify({
      schemaVersion: 1, version: '3.1.1',
      files: [{ path, sha256: createHash('sha256').update(content).digest('hex') }],
    }));
    if (rehydrated) {
      mkdirSync(join(root, '.void/machine/receipts'), { recursive: true });
      writeFileSync(join(root, INSTALL_RECEIPT_PATH), encodeReceipt(buildInstallReceipt({
        version: '3.1.1', source: 'local', runtimes: ['claude'],
        files: [{ path, content: Buffer.from(content), mode: 0o644 }],
      })));
    }
    const prepared = await prepareInstallCommit({
      projectRoot: root, stageRoot: stage, version: '3.2.0',
      source: 'local', runtimes: ['claude'], force: false,
    });
    expect(prepared.restored).toEqual([path]);
    expect(prepared.mutations).toContainEqual({ path, content: Buffer.from(content), mode: 0o755 });
  });

  it('restores a manifest-owned path even after the local receipt is lost', async () => {
    const root = scratch('void-project-');
    const stage = scratch('void-stage-');
    const path = '.claude/skills/frontend-design/SKILL.md';
    mkdirSync(join(root, '.void'), { recursive: true });
    writeFileSync(join(root, '.void/install-manifest.json'), JSON.stringify({
      schemaVersion: 1, version: '3.1.1',
      files: [{ path, sha256: 'a'.repeat(64) }],
    }));
    const prepared = await withExistingSkill(root, stage);
    await commitFileTransaction(root, prepared.mutations);
    expect(prepared.restored).toEqual([path]);
    expect(readFileSync(join(root, path), 'utf8')).toBe('# ours\n');
    expect(prepared.receipt.files.map((file) => file.path)).toContain(path);
  });
});


describe('doctrine destination ownership', () => {
  it('rejects a symlink at the new destination without touching its target', async () => {
    const root = scratch('void-doctrine-link-');
    const stage = scratch('void-stage-');
    for (const base of [root, stage]) mkdirSync(join(base, '.void'), { recursive: true });
    writeFileSync(join(root, 'user.md'), 'KEEP');
    symlinkSync(join(root, 'user.md'), join(root, '.void/PHILOSOPHY.md'));
    writeFileSync(join(stage, '.void/PHILOSOPHY.md'), 'SHIPPED');
    await expect(withholdProjectOwned(root, stage)).rejects.toThrow('non-regular');
    await expect(prepareInstallCommit({ projectRoot: root, stageRoot: stage,
      version: '7.0.2', source: 'local', runtimes: ['claude'], force: true })).rejects.toThrow('symbolic link');
    expect(readFileSync(join(root, 'user.md'), 'utf8')).toBe('KEEP');
  });

  it.each([false, true])('refuses a differing unclaimed philosophy even with force=%s', async (force) => {
    const root = scratch('void-doctrine-');
    const stage = scratch('void-stage-');
    for (const base of [root, stage]) mkdirSync(join(base, '.void'), { recursive: true });
    writeFileSync(join(root, '.void/PHILOSOPHY.md'), 'PROJECT');
    writeFileSync(join(stage, '.void/PHILOSOPHY.md'), 'SHIPPED');
    await expect(withholdProjectOwned(root, stage)).rejects.toThrow('.void/PHILOSOPHY.md');
    await expect(prepareInstallCommit({ projectRoot: root, stageRoot: stage,
      version: '7.0.2', source: 'local', runtimes: ['claude'], force })).rejects.toThrow('.void/PHILOSOPHY.md');
    expect(readFileSync(join(root, '.void/PHILOSOPHY.md'), 'utf8')).toBe('PROJECT');
  });
});


describe('transactional philosophy relocation', () => {
  const oldPath = '.void/installed/PHILOSOPHY.md';
  const newPath = '.void/PHILOSOPHY.md';
  it.each(['intact', 'modified', 'unknown', 'nonempty', 'mode-change', 'symlink'] as const)(
    'preserves ownership and surrounding data for %s old doctrine', async (state) => {
      const root = scratch('void-doctrine-migration-');
      const stage = scratch('void-stage-');
      mkdirSync(join(root, '.void/installed'), { recursive: true });
      mkdirSync(join(stage, '.void'), { recursive: true });
      writeFileSync(join(root, oldPath), 'OLD');
      writeFileSync(join(stage, newPath), 'NEW');
      if (state !== 'unknown') {
        const receipt = buildInstallReceipt({ version: '7.0.1', source: 'local',
          runtimes: ['claude'], files: [{ path: oldPath, content: Buffer.from('OLD'), mode: 0o644 }] });
        mkdirSync(join(root, '.void/machine/receipts'), { recursive: true });
        writeFileSync(join(root, INSTALL_RECEIPT_PATH), encodeReceipt(receipt));
      }
      if (state === 'modified') writeFileSync(join(root, oldPath), 'USER');
      if (state === 'mode-change') chmodSync(join(root, oldPath), 0o600);
      if (state === 'nonempty') writeFileSync(join(root, '.void/installed/user.md'), 'KEEP');
      if (state === 'symlink') {
        const { unlinkSync } = await import('node:fs');
        unlinkSync(join(root, oldPath));
        writeFileSync(join(root, 'outside.md'), 'KEEP');
        symlinkSync(join(root, 'outside.md'), join(root, oldPath));
      }
      const input = { projectRoot: root, stageRoot: stage, version: '7.0.2',
        source: 'local' as const, runtimes: ['claude'] as const, force: false };
      const prepared = await prepareInstallCommit(input);
      expect(existsSync(join(root, newPath))).toBe(false);
      await commitFileTransaction(root, prepared.mutations);
      expect(readFileSync(join(root, newPath), 'utf8')).toBe('NEW');
      expect(existsSync(join(root, oldPath))).toBe(!['intact', 'nonempty'].includes(state));
      expect(existsSync(join(root, '.void/installed'))).toBe(state !== 'intact');
      if (state === 'nonempty') expect(readFileSync(join(root, '.void/installed/user.md'), 'utf8')).toBe('KEEP');
      const second = await prepareInstallCommit(input);
      await commitFileTransaction(root, second.mutations);
      expect(second.mutations.filter((mutation) => mutation.path === newPath)).toEqual([]);
    },
  );

  it('restores old doctrine and permissions when publication fails after preparation', async () => {
    const root = scratch('void-doctrine-rollback-');
    const stage = scratch('void-stage-');
    mkdirSync(join(root, '.void/installed'), { recursive: true });
    mkdirSync(join(root, '.void/machine/receipts'), { recursive: true });
    mkdirSync(join(stage, '.void'), { recursive: true });
    writeFileSync(join(root, oldPath), 'OLD', { mode: 0o600 });
    const receipt = encodeReceipt(buildInstallReceipt({ version: '7.0.1', source: 'local',
      runtimes: ['claude'], files: [{ path: oldPath, content: Buffer.from('OLD'), mode: 0o600 }] }));
    writeFileSync(join(root, INSTALL_RECEIPT_PATH), receipt);
    writeFileSync(join(stage, newPath), 'NEW');
    const prepared = await prepareInstallCommit({ projectRoot: root, stageRoot: stage,
      version: '7.0.2', source: 'local', runtimes: ['claude'], force: false });
    await expect(commitFileTransaction(root, prepared.mutations, { failAfterMutation: 1 })).rejects.toThrow('injected');
    expect(readFileSync(join(root, oldPath), 'utf8')).toBe('OLD');
    const { statSync } = await import('node:fs');
    expect(statSync(join(root, oldPath)).mode & 0o777).toBe(0o600);
    expect(existsSync(join(root, newPath))).toBe(false);
    expect(readFileSync(join(root, INSTALL_RECEIPT_PATH), 'utf8')).toBe(receipt);
  });
});
