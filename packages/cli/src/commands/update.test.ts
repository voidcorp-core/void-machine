import { spawnSync } from 'node:child_process';
import { PRODUCT_IDENTITY } from '@voidcorp/hook-runner';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INSTALL_RECEIPT_PATH, type InstallReceipt } from '../lib/receipts.js';
import { sourceRepoVerdict } from './init.js';
import {
  completeOwnership,
  localInitArgs,
  ownedFromManifestPaths,
  updateModeFor,
  updateRouteFor,
} from './update.js';

const receipt = (source: InstallReceipt['source']): InstallReceipt => ({
  schemaVersion: 1,
  version: '2.0.2',
  source,
  runtimes: ['codex'],
  files: [],
});

describe('update routing', () => {
  it('keeps local receipts offline and marketplace receipts on the remote adapter', () => {
    expect(updateModeFor(receipt('local'))).toBe('local');
    expect(updateModeFor(receipt('marketplace'))).toBe('marketplace');
    expect(updateModeFor(undefined)).toBe('marketplace');
  });
});

describe('localInitArgs', () => {
  it('carries the recorded runtimes and the selected packs', () => {
    const args = localInitArgs(receipt('local'), ['monorepo', 'react'], { force: false });

    expect(args).toContain('--no-interactive');
    expect(args).toContain('--replace-packs');
    expect(args.join(' ')).toContain('--runtime codex');
    expect(args.join(' ')).toContain('--pack monorepo');
    expect(args.join(' ')).toContain('--pack react');
  });

  it('does not force by default', () => {
    expect(localInitArgs(receipt('local'), [], { force: false })).not.toContain('--force');
  });

  /**
   * Reported from a real consumer project on 2.6.0. `init` refuses to clobber a
   * managed file it cannot prove it wrote and says "preserve it or re-run with
   * --force" — but `update` never parsed the flag nor passed it on, so the
   * remedy the tool printed could not be applied through the command that
   * printed it. An instruction that cannot be followed is worse than none.
   */
  it('forwards --force so the remedy it prints can actually be applied', () => {
    expect(localInitArgs(receipt('local'), [], { force: true })).toContain('--force');
  });

  /**
   * The two travel together on the source repo, and each keeps its own meaning:
   * --force answers a conflict on some managed asset, --preserve-doctrine says
   * the canonical CLAUDE.md / AGENTS.md / PHILOSOPHY.md here are the source and
   * not a copy of it. Sending only the first rewrote the doctrine as a side
   * effect of unblocking two hook files.
   */
  it('carries --preserve-doctrine alongside --force, since they answer different things', () => {
    const args = localInitArgs(receipt('local'), [], { force: true, preserveDoctrine: true });
    expect(args).toContain('--force');
    expect(args).toContain('--preserve-doctrine');
    expect(sourceRepoVerdict({ isSourceRepo: true, force: true, preserveDoctrine: true }))
      .toBe('preserve-doctrine');
  });
});

// The receipt is observed state, so it is gitignored and absent from every
// clone. Reading the route from it alone made `update` fall through to the
// marketplace branch on a colleague's fresh checkout: it pulled a plugin cache,
// bumped the pins, materialised nothing, and reported success. The install
// manifest is the committed half of the same fact and is always there.
describe('updateRouteFor', () => {
  it('follows the receipt when there is one', () => {
    expect(updateRouteFor(receipt('local'), true)).toBe('local');
    expect(updateRouteFor(receipt('marketplace'), true)).toBe('marketplace');
  });

  // A missing receipt used to end the command with two commands to type, one of
  // them `--force`. It is the common case, not an edge: the receipt is
  // machine-local, so EVERY fresh clone arrives without one. The committed
  // manifest names the paths the harness owns, which is the only thing the
  // update needs from it -- the contents come from the version being installed.
  // Reading it is not guessing.
  it('rehydrates ownership from the committed manifest instead of stopping', () => {
    expect(updateRouteFor(undefined, true)).toBe('local-rehydrate');
  });

  it('is a marketplace install when neither is there', () => {
    expect(updateRouteFor(undefined, false)).toBe('marketplace');
  });
})

// Rehydration takes the paths from the committed manifest and the CONTENT from
// disk, never the manifest's hashes: those describe the version that wrote it,
// and the point is to reclaim ownership of what is there now so the new version
// can overwrite it. Hashing the manifest's own values would fail every comparison
// and reproduce the conflict this removes.
describe('ownedFromManifestPaths', () => {
  it('claims the paths the manifest names, with the content found on disk', () => {
    const owned = ownedFromManifestPaths(
      [
        { path: '.void/hooks/_void-hook.mjs', sha256: 'sha-of-.void/hooks/_void-hook.mjs' },
        { path: '.claude/skills/tdd/SKILL.md', sha256: 'sha-of-.claude/skills/tdd/SKILL.md' },
      ],
      (path) => ({ sha256: `sha-of-${path}`, mode: 0o644 }),
    );
    expect(owned).toEqual([
      { path: '.void/hooks/_void-hook.mjs', sha256: 'sha-of-.void/hooks/_void-hook.mjs', mode: 0o644 },
      { path: '.claude/skills/tdd/SKILL.md', sha256: 'sha-of-.claude/skills/tdd/SKILL.md', mode: 0o644 },
    ]);
  });

  it('drops a path the manifest names and the disk no longer has', () => {
    const owned = ownedFromManifestPaths(
      [
        { path: '.void/hooks/_void-hook.mjs', sha256: 'x' },
        { path: '.claude/skills/retired/SKILL.md', sha256: 'x' },
      ],
      (path) => (path.includes('retired') ? undefined : { sha256: 'x', mode: 0o644 }),
    );
    expect(owned.map((file) => file.path)).toEqual(['.void/hooks/_void-hook.mjs']);
  });

  it('claims nothing from an empty manifest rather than inventing ownership', () => {
    expect(ownedFromManifestPaths([], () => ({ sha256: 'x', mode: 0o644 }))).toEqual([]);
  });
});

// A receipt that covers only part of what the manifest names is the state a real
// consumer arrives in: the layout migration parked the previous receipt, the
// install that followed rewrote a shorter one, and every path it dropped became
// an asset the next update could not recognise. Ownership is the union of the
// two proofs, not a choice between them.
describe('completeOwnership', () => {
  it('adds the manifest paths a partial receipt no longer covers', () => {
    const owned = completeOwnership(
      [{ path: '.claude/skills/tdd/SKILL.md', sha256: 'from-receipt', mode: 0o644 }],
      [
        { path: '.claude/skills/tdd/SKILL.md', sha256: 'attested' },
        { path: '.claude/agents/code-explorer.md', sha256: 'attested' },
      ],
      () => ({ sha256: 'attested', mode: 0o644 }),
    );

    expect(owned.map((file) => file.path)).toEqual([
      '.claude/skills/tdd/SKILL.md',
      '.claude/agents/code-explorer.md',
    ]);
  });

  it('keeps the receipt authoritative for a path both of them name', () => {
    // The receipt records what THIS machine wrote; the manifest only proves the
    // path is ours. Letting the disk overwrite that entry would erase the very
    // evidence that tells a hand-edited file from an untouched one.
    const owned = completeOwnership(
      [{ path: '.claude/skills/tdd/SKILL.md', sha256: 'from-receipt', mode: 0o644 }],
      [{ path: '.claude/skills/tdd/SKILL.md', sha256: 'attested' }],
      () => ({ sha256: 'on-disk', mode: 0o600 }),
    );

    expect(owned).toEqual([
      { path: '.claude/skills/tdd/SKILL.md', sha256: 'from-receipt', mode: 0o644 },
    ]);
  });

  it('leaves a complete receipt untouched', () => {
    const files = [{ path: '.claude/skills/tdd/SKILL.md', sha256: 'x', mode: 0o644 }];

    expect(completeOwnership(files, [{ path: '.claude/skills/tdd/SKILL.md', sha256: 'x' }], () => undefined)).toEqual(files);
  });

  it('drops a manifest path the disk no longer has', () => {
    const owned = completeOwnership([], [{ path: '.claude/skills/gone/SKILL.md', sha256: 'x' }], () => undefined);

    expect(owned).toEqual([]);
  });
});

// The manifest proves a PATH is ours. It never proves the bytes sitting at that
// path today are ours: a project that edited a skill we shipped has a path we
// own holding content we do not. Reclaiming from disk without checking turned
// "unknown content" into "proven ours", and the install then overwrote a
// customisation it would otherwise have refused. Measured on a real project
// before this guard existed.
describe('completeOwnership, against content the project changed', () => {
  it('declines a path whose bytes no longer match what the manifest attests', () => {
    const owned = completeOwnership(
      [],
      [{ path: '.claude/skills/tdd/SKILL.md', sha256: 'as-installed' }],
      () => ({ sha256: 'edited-by-the-project', mode: 0o644 }),
    );

    expect(owned).toEqual([]);
  });

  it('reclaims a path the project left untouched', () => {
    const owned = completeOwnership(
      [],
      [{ path: '.claude/skills/tdd/SKILL.md', sha256: 'as-installed' }],
      () => ({ sha256: 'as-installed', mode: 0o644 }),
    );

    expect(owned).toEqual([
      { path: '.claude/skills/tdd/SKILL.md', sha256: 'as-installed', mode: 0o644 },
    ]);
  });

  it('reclaims a path the manifest cannot attest, since it never lists itself', () => {
    // A file cannot carry the hash of contents that include that hash, so the
    // manifest is absent from its own file list -- and it is ours by construction.
    const owned = completeOwnership(
      [],
      [{ path: '.void/install-manifest.json', sha256: undefined }],
      () => ({ sha256: 'whatever-it-is-now', mode: 0o644 }),
    );

    expect(owned.map((file) => file.path)).toEqual(['.void/install-manifest.json']);
  });
});

// The receipt is machine-local and dates from 2026-07-24. A marketplace install
// made before it carries none, and until now this was the one route of `update`
// that never wrote one: the two local routes rebuild it from the manifest, the
// marketplace route has no manifest to rebuild from and left the tree unmarked.
// From a linked worktree that IS the install, an unmarked tree makes `doctor`
// prefer the main checkout, which holds nothing (DEV-732, DEV-740).
describe('update on a marketplace install that predates the receipt', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const REPO = resolve(HERE, '..', '..', '..', '..');
  const CLI = resolve(HERE, '..', '..', 'dist', 'bin', 'void-harness.mjs');

  function git(cwd: string, ...args: string[]): void {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  }

  /**
   * A `gh` that answers `gh api repos/<repo>/contents/<path>` from this
   * checkout, so the marketplace route runs against the real catalog and the
   * real core plugin.json without a network or an account. Nothing else of
   * `gh` is imitated: the route asks for two files and stops.
   */
  function fakeGhOnPath(): string {
    const bin = mkdtempSync(join(tmpdir(), 'update-gh-'));
    const script = join(bin, 'gh');
    writeFileSync(
      script,
      [
        '#!/bin/sh',
        'for argument in "$@"; do target="$argument"; done',
        'path=$(printf %s "$target" | sed -e "s|^repos/[^/]*/[^/]*/contents/||" -e "s|?.*$||")',
        `exec cat "${REPO}/$path"`,
        '',
      ].join('\n'),
    );
    chmodSync(script, 0o755);
    return `${bin}:${process.env.PATH ?? ''}`;
  }

  function run(command: string, cwd: string, env: NodeJS.ProcessEnv): { code: number; out: string } {
    const result = spawnSync(process.execPath, [CLI, ...command.split(' ')], { cwd, encoding: 'utf8', env });
    return { code: result.status ?? 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }

  /** What `init` left in a tree before receipts existed: config, doctrine, wiring, no manifest. */
  function installWithoutReceipt(root: string): void {
    mkdirSync(join(root, '.void', 'installed'), { recursive: true });
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.void', 'config.json'), '{}\n');
    writeFileSync(join(root, '.void', 'installed', 'PHILOSOPHY.md'), '# Philosophy\n');
    writeFileSync(join(root, '.void', 'PROJECT-DOCTRINE.md'), '# Doctrine\n');
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({
        extraKnownMarketplaces: { voidcorp: { source: { source: 'github', repo: PRODUCT_IDENTITY.repositorySlug } } },
        enabledPlugins: { 'harness@voidcorp': true },
      }),
    );
    writeFileSync(join(root, 'CLAUDE.md'), '# Project\n');
  }

  it('writes the receipt, so doctor from that worktree judges the install it holds', () => {
    const main = mkdtempSync(join(tmpdir(), 'update-main-'));
    git(main, 'init', '--quiet');
    writeFileSync(join(main, 'README.md'), '# fixture\n');
    git(main, 'add', 'README.md');
    git(main, '-c', 'user.name=Void Test', '-c', 'user.email=void@example.test', 'commit', '--quiet', '-m', 'test: seed');
    const linked = join(mkdtempSync(join(tmpdir(), 'update-linked-')), 'DEV-000');
    git(main, 'worktree', 'add', '--quiet', linked, '-b', 'worker/DEV-000');
    installWithoutReceipt(linked);
    const env = { ...process.env, PATH: fakeGhOnPath() };

    const before = run('doctor --no-remote', linked, env);
    expect(before.out).toMatch(new RegExp(`^\\s+installed\\s+${realpathSync(main)}$`, 'm'));
    expect(before.out).toContain('.void/config.json missing');

    // `--pins-only` keeps the route off the marketplace cache under $HOME.
    const updated = run('update --pins-only', linked, env);
    expect(updated.code).toBe(0);

    const receipt = JSON.parse(readFileSync(join(linked, INSTALL_RECEIPT_PATH), 'utf8')) as InstallReceipt;
    expect(receipt.source).toBe('marketplace');
    expect(receipt.runtimes).toEqual(['claude']);
    expect(receipt.files).toEqual([]);

    const after = run('doctor --no-remote', linked, env);
    expect(after.out).not.toMatch(/^\s+installed\s+\//m);
    expect(after.out).toMatch(/project config\s+valid JSON \+ schema/);
    expect(after.out).toMatch(/doctrine files\s+PHILOSOPHY\.md \+ PROJECT-DOCTRINE\.md present/);
  });

  it('previews and then retires the obsolete registry through update', () => {
    const project = mkdtempSync(join(tmpdir(), 'update-registry-project-'));
    const globalDir = mkdtempSync(join(tmpdir(), 'update-registry-global-'));
    const registry = join(globalDir, 'projects');
    installWithoutReceipt(project);
    mkdirSync(registry);
    writeFileSync(join(registry, 'a.path'), '/project/a\n');
    writeFileSync(join(registry, 'b.path'), '/project/b\n');
    const env = {
      ...process.env,
      PATH: fakeGhOnPath(),
      VOID_GLOBAL_DIR: globalDir,
    };

    const preview = run('update --pins-only --dry-run', project, env);

    expect(preview.code).toBe(0);
    expect(preview.out).toContain('would retire 2 obsolete project pointer(s)');
    expect(existsSync(join(registry, 'a.path'))).toBe(true);

    const applied = run('update --pins-only', project, env);

    expect(applied.code).toBe(0);
    expect(applied.out).toContain('retired 2 obsolete project pointer(s)');
    expect(existsSync(join(registry, 'a.path'))).toBe(false);
    expect(existsSync(join(registry, 'b.path'))).toBe(false);
  });
});
