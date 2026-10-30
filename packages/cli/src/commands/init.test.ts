/**
 * Unit tests for the pure init helpers most exposed to the audited failure
 * modes (#67): an unresolved marketplace must never write a stale core pin, and
 * every unmet prerequisite must surface as an impossible-to-miss checklist item.
 */

import { describe, expect, it } from 'vitest';
import { buildDefaultConfig, buildFinalChecklist, configWriteVerdict, installDoctrineFiles, resolveInstallSource, sourceRepoVerdict } from './init.js';
import { stageInstallManifest } from '../lib/local-install.js';
import type { CheckResult } from '../lib/prerequisites.js';
import type { Stack } from '../lib/stack.js';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterEach } from 'vitest';

const STACK: Stack = { packageManager: 'pnpm', testRunner: 'vitest', e2eRunner: 'none', mutationRunner: 'none' };

describe('buildDefaultConfig pin behavior', () => {
  it('pins core when a version was resolved', () => {
    const config = buildDefaultConfig({ pinVersion: '0.14.0', stack: STACK });
    expect(config.core).toBe('^0.14.0');
  });

  it('omits the core pin entirely when the marketplace was unreachable', () => {
    const config = buildDefaultConfig({ pinVersion: undefined, stack: STACK });
    expect(config.core).toBeUndefined();
    expect('core' in config).toBe(false);
    // and never a stale literal
    expect(JSON.stringify(config)).not.toContain('0.1.0');
  });
});

describe('buildFinalChecklist', () => {
  const ok: CheckResult = { name: 'jq', ok: true, message: 'available' };
  const failJq: CheckResult = { name: 'jq', ok: false, message: 'jq not installed', fix: 'brew install jq' };
  const failGh: CheckResult = { name: 'gh CLI', ok: false, message: 'gh not authenticated', fix: 'gh auth login' };

  it('leads with the adapters\' next-steps in order', () => {
    const steps = ['restart Claude Code', 'trust the project .codex/ layer'];
    const items = buildFinalChecklist([ok], steps);
    expect(items[0]).toBe('restart Claude Code');
    expect(items[1]).toBe('trust the project .codex/ layer');
  });

  it('adds a FAILED line with remediation for each unmet prerequisite, after the steps', () => {
    const items = buildFinalChecklist([failJq, failGh], ['step one']);
    const failed = items.filter((i) => i.startsWith('FAILED:'));
    expect(failed).toHaveLength(2);
    expect(failed[0]).toContain('brew install jq');
    expect(failed[1]).toContain('gh auth login');
    expect(items[0]).toBe('step one');
  });

  it('passes through a FAILED next-step (e.g. an unresolved pin from the Claude adapter)', () => {
    const items = buildFinalChecklist([ok], ['FAILED: core version unresolved — run gh auth login']);
    const pinItem = items.find((i) => i.includes('core version unresolved'));
    expect(pinItem).toContain('FAILED:');
  });

  it('produces no FAILED lines when everything is healthy', () => {
    const items = buildFinalChecklist([ok], ['restart Claude Code']);
    expect(items.some((i) => i.startsWith('FAILED:'))).toBe(false);
  });
});

describe('install source', () => {
  it('defaults to the bundled local package and requires an explicit marketplace opt-in', () => {
    expect(resolveInstallSource([])).toBe('local');
    expect(resolveInstallSource(['--marketplace'])).toBe('marketplace');
    expect(resolveInstallSource(['--source', 'marketplace'])).toBe('marketplace');
    expect(resolveInstallSource(['--source', 'local'])).toBe('local');
  });
});

// An update that refuses everything because one file is protected teaches the
// user that updating is dangerous, and they stop. The source repo is the only
// place the guard fires, and even there the right answer is to do the rest of
// the work and say what was preserved -- not to die after half a job.
describe('sourceRepoVerdict', () => {
  it('lets any consumer project through, which is every project but one', () => {
    expect(sourceRepoVerdict({ isSourceRepo: false, force: false, preserveDoctrine: false })).toBe('proceed');
  });

  it('refuses a bare init on the source repo, where the doctrine is the source and not a copy', () => {
    expect(sourceRepoVerdict({ isSourceRepo: true, force: false, preserveDoctrine: false })).toBe('refuse');
  });

  it('proceeds while preserving the doctrine, which is what update asks for', () => {
    expect(sourceRepoVerdict({ isSourceRepo: true, force: false, preserveDoctrine: true })).toBe('preserve-doctrine');
  });

  it('keeps --force meaning what it always meant: install anyway, doctrine included', () => {
    expect(sourceRepoVerdict({ isSourceRepo: true, force: true, preserveDoctrine: false })).toBe('proceed');
  });

  // The two flags answer different people. `preserveDoctrine` is what `update`
  // declares about the repo it is running in; `--force` is what an operator
  // types to get past a conflict on two hook files. Letting the second cancel
  // the first rewrote the canonical CLAUDE.md as a side effect of unblocking
  // something else entirely.
  it('keeps the doctrine preserved under --force, because the flag answered a conflict elsewhere', () => {
    expect(sourceRepoVerdict({ isSourceRepo: true, force: true, preserveDoctrine: true })).toBe('preserve-doctrine');
  });
});

// `--force` seizes ownership of a MANAGED asset: one the harness owns alone and
// can prove it wrote. `.void/config.json` is co-owned -- the project tunes its
// paths, modes and commands, and the harness only adds pack pins. So the flag
// buys nothing here, and overwriting cost a monorepo its enforcement floor.
// It stays useful for exactly one case: a config too broken to merge into.
describe('configWriteVerdict', () => {
  it('writes the seeded scaffold when the project has no config yet', () => {
    expect(configWriteVerdict({ exists: false, readable: false, force: false })).toBe('scaffold');
  });

  it('merges into a readable config rather than replacing what the project tuned', () => {
    expect(configWriteVerdict({ exists: true, readable: true, force: false })).toBe('merge');
  });

  it('still merges under --force, which never spoke about a co-owned file', () => {
    expect(configWriteVerdict({ exists: true, readable: true, force: true })).toBe('merge');
  });

  it('leaves an unparseable config untouched, saying so rather than guessing', () => {
    expect(configWriteVerdict({ exists: true, readable: false, force: false })).toBe('keep-unreadable');
  });

  it('lets --force replace an unparseable config, the one case nothing can be merged', () => {
    expect(configWriteVerdict({ exists: true, readable: false, force: true })).toBe('overwrite-unreadable');
  });
});

describe('installDoctrineFiles', () => {
  const roots: string[] = [];
  const project = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'void-init-doctrine-'));
    roots.push(root);
    return root;
  };
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  const source = (): string => {
    const root = project();
    writeFileSync(join(root, 'PHILOSOPHY.md'), 'PACKAGED PHILOSOPHY\n');
    writeFileSync(join(root, 'PROJECT-DOCTRINE.template.md'), 'TEMPLATE\n');
    return root;
  };

  it('writes the packaged philosophy into a project that has none', async () => {
    const stage = project();
    await installDoctrineFiles(stage, source());
    expect(readFileSync(join(stage, '.void/installed/PHILOSOPHY.md'), 'utf8')).toContain('PACKAGED');
  });

  it('refreshes the installed copy from canonical source doctrine without overwriting its owner', async () => {
    const stage = project();
    const installed = project();
    mkdirSync(join(installed, '.void/installed'), { recursive: true });
    mkdirSync(join(installed, 'docs'), { recursive: true });
    writeFileSync(join(installed, '.void/installed/PHILOSOPHY.md'), 'STALE DERIVED PHILOSOPHY\n');
    writeFileSync(join(installed, 'docs/PHILOSOPHY.md'), 'CANONICAL SOURCE PHILOSOPHY\n');
    await installDoctrineFiles(stage, source(), { preserveFrom: installed });
    expect(readFileSync(join(stage, '.void/installed/PHILOSOPHY.md'), 'utf8')).toBe('CANONICAL SOURCE PHILOSOPHY\n');
    expect(readFileSync(join(installed, 'docs/PHILOSOPHY.md'), 'utf8')).toBe('CANONICAL SOURCE PHILOSOPHY\n');
  });

  it('preserves a legacy installed copy when no canonical source exists', async () => {
    const stage = project();
    const installed = project();
    mkdirSync(join(installed, '.void/installed'), { recursive: true });
    writeFileSync(join(installed, '.void/installed/PHILOSOPHY.md'), 'LEGACY PHILOSOPHY\n');
    await installDoctrineFiles(stage, source(), { preserveFrom: installed });
    expect(readFileSync(join(stage, '.void/installed/PHILOSOPHY.md'), 'utf8')).toBe('LEGACY PHILOSOPHY\n');
  });

  it('still writes the packaged one when preserving a project that has none, rather than leaving a hole', async () => {
    const stage = project();
    await installDoctrineFiles(stage, source(), { preserveFrom: project() });
    expect(readFileSync(join(stage, '.void/installed/PHILOSOPHY.md'), 'utf8')).toContain('PACKAGED');
  });

  /**
   * The project doctrine is co-owned: the project owns every line, so the
   * harness preserves it. The one exception is a file the project has never
   * written into, which the manifest proves byte for byte -- see the decision
   * on refreshing an untouched project doctrine.
   */
  const staged = (body: string): string => {
    const stage = project();
    mkdirSync(join(stage, '.void'), { recursive: true });
    writeFileSync(join(stage, '.void/PROJECT-DOCTRINE.md'), body);
    return stage;
  };

  const attesting = (body: string): string => {
    const installed = project();
    mkdirSync(join(installed, '.void'), { recursive: true });
    writeFileSync(
      join(installed, '.void/install-manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        version: '3.3.0',
        projectDoctrineTemplateSha256: createHash('sha256').update(body).digest('hex'),
        files: [{ path: '.void/PROJECT-DOCTRINE.md', sha256: createHash('sha256').update(body).digest('hex') }],
      }),
    );
    return installed;
  };

  const doctrineIn = (stage: string): string =>
    readFileSync(join(stage, '.void/PROJECT-DOCTRINE.md'), 'utf8');

  it('seeds the project doctrine from the template when the project has none', async () => {
    const stage = project();
    await installDoctrineFiles(stage, source());
    expect(doctrineIn(stage)).toBe('TEMPLATE\n');
  });

  it('refreshes a project doctrine still byte-identical to the one the install wrote', async () => {
    // Every consumer that never filled it in keeps paying for the old template
    // in every session otherwise. The manifest makes that case decidable.
    const stage = staged('OLD TEMPLATE\n');
    await installDoctrineFiles(stage, source(), { installRoot: attesting('OLD TEMPLATE\n') });
    expect(doctrineIn(stage)).toBe('TEMPLATE\n');
  });

  it('distributes the universal worktree invariant while preserving a customized doctrine on repeated installs', async () => {
    const core = fileURLToPath(new URL('../../../core/', import.meta.url));
    const custom = '# My project\r\n\r\n- Keep my conventions and accents: dépôt.\r\n';
    const stage = staged(custom);
    const installed = attesting('ORIGINAL TEMPLATE\n');

    await installDoctrineFiles(stage, core, { installRoot: installed });
    await installDoctrineFiles(stage, core, { installRoot: installed });

    expect(doctrineIn(stage)).toBe(custom);
    const philosophy = readFileSync(join(stage, '.void/installed/PHILOSOPHY.md'), 'utf8');
    expect(philosophy).toBe(readFileSync(join(core, 'PHILOSOPHY.md'), 'utf8'));
    expect(philosophy).toContain(`\${VOID_WORKTREES:-\${XDG_DATA_HOME:-$HOME/.local/share}/git-worktrees}`);
    expect(philosophy).toContain('git worktree move');
    expect(philosophy).toContain('git worktree prune');
  });

  it('preserves custom CRLF doctrine after the real manifest records a preserved first install', async () => {
    const custom = Buffer.from('# Project rules\r\n\r\n- Preserve accents: dépôt, and this custom rule.\r\n', 'utf8');
    const stage = staged(custom.toString('utf8'));
    const core = source();
    await installDoctrineFiles(stage, core, { installRoot: stage });
    expect(readFileSync(join(stage, '.void/PROJECT-DOCTRINE.md'))).toEqual(custom);
    // Persist the actual first-install manifest, not an attesting template mock.
    await stageInstallManifest(stage, '3.8.0');
    await installDoctrineFiles(stage, core, { installRoot: stage });
    expect(readFileSync(join(stage, '.void/PROJECT-DOCTRINE.md'))).toEqual(custom);
  });

  it('refreshes a proven seeded template but preserves custom bytes in a real manifest with template provenance', async () => {
    for (const body of ['TEMPLATE\n', '# Personal rules\r\n- dépôt\r\n']) {
      const stage = staged(body);
      const core = source();
      const deliveredHash = createHash('sha256').update('TEMPLATE\n').digest('hex');
      await stageInstallManifest(stage, '3.8.0', deliveredHash);
      writeFileSync(join(core, 'PROJECT-DOCTRINE.template.md'), 'NEW TEMPLATE\n');
      await installDoctrineFiles(stage, core, { installRoot: stage });
      expect(readFileSync(join(stage, '.void/PROJECT-DOCTRINE.md'))).toEqual(
        Buffer.from(body === 'TEMPLATE\n' ? 'NEW TEMPLATE\n' : body),
      );
    }
  });

  it('never touches a project doctrine the project has written into', async () => {
    const written = 'OLD TEMPLATE\n\n- **no raw fetch in a component**.\n';
    const stage = staged(written);
    await installDoctrineFiles(stage, source(), { installRoot: attesting('OLD TEMPLATE\n') });
    expect(doctrineIn(stage)).toBe(written);
  });

  it('preserves the file when no manifest can attest what the harness wrote', async () => {
    // An install predating the manifest. Silence is not proof of an untouched
    // file, so the conservative branch wins.
    const stage = staged('OLD TEMPLATE\n');
    await installDoctrineFiles(stage, source(), { installRoot: project() });
    expect(doctrineIn(stage)).toBe('OLD TEMPLATE\n');
  });

  it('leaves the file alone when the package carries no template at all', async () => {
    // A broken package must not be the thing that decides a project's doctrine.
    const stage = staged('OLD TEMPLATE\n');
    await installDoctrineFiles(stage, project(), { installRoot: attesting('OLD TEMPLATE\n') });
    expect(doctrineIn(stage)).toBe('OLD TEMPLATE\n');
  });

  it('preserves the file when the installation root is unknown', async () => {
    const stage = staged('OLD TEMPLATE\n');
    await installDoctrineFiles(stage, source());
    expect(doctrineIn(stage)).toBe('OLD TEMPLATE\n');
  });
});
