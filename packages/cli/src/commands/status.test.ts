import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { statusLines } from './status.js';

describe('status facts', () => {
  it('reports observed runtime facts and preserves unknown observations', () => {
    const text = statusLines([
      { runtime: 'claude', evidence: { installed: true, wired: false, fired: null, observed: null } },
      { runtime: 'codex', evidence: { installed: true, wired: true, fired: true, observed: false } },
    ], '7.0.2').join('\n');
    expect(text).toContain('installed version: 7.0.2');
    expect(text).toContain('claude installed=yes wired=no fired=unknown observed=unknown');
    expect(text).toContain('codex installed=yes wired=yes fired=yes observed=no');
    expect(text).not.toMatch(/score|certified|capabilities/i);
  });

  it('reports absent receipt and runtimes without inferring an installation', () => {
    const text = statusLines([], undefined).join('\n');
    expect(text).toContain('installed version: unknown');
    expect(text).toContain('no runtime detected');
  });
});

describe('status from a linked worktree', () => {
  const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'bin', 'void-machine.mjs');
  const INSTALLED_VERSION = '1.0.0';
  const PUBLISHED_VERSION = '9.9.9';

  function git(cwd: string, ...args: string[]): void {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  }

  /**
   * A published version the CLI answers from cache, so the freshness check
   * never reaches the network and the verdict is `behind` for the receipt below.
   */
  function freshnessCache(): string {
    const cache = mkdtempSync(join(tmpdir(), 'status-cache-'));
    mkdirSync(join(cache, 'void-machine'), { recursive: true });
    writeFileSync(
      join(cache, 'void-machine', 'freshness.json'),
      JSON.stringify({ latest: PUBLISHED_VERSION, checkedAt: Date.now() }),
    );
    return cache;
  }

  /** What `init` leaves behind and hides from git: the receipt of an npm install, one release behind. */
  function installReceipt(root: string): void {
    const dir = join(root, '.void', 'machine', 'receipts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'install-v1.json'),
      JSON.stringify({ schemaVersion: 1, version: INSTALLED_VERSION, source: 'local', runtimes: [], files: [] }),
    );
  }

  function fixture(): { main: string; linked: string; cache: string } {
    const main = mkdtempSync(join(tmpdir(), 'status-main-'));
    mkdirSync(join(main, '.void'), { recursive: true });
    writeFileSync(join(main, '.void', 'config.json'), '{}\n');
    git(main, 'init', '--quiet');
    git(main, 'add', '.void/config.json');
    git(
      main,
      '-c', 'user.name=Void Test',
      '-c', 'user.email=void@example.test',
      'commit', '--quiet', '-m', 'test: seed',
    );
    installReceipt(main);
    const linked = join(mkdtempSync(join(tmpdir(), 'status-linked-')), 'DEV-000');
    git(main, 'worktree', 'add', '--quiet', linked, '-b', 'worker/DEV-000');
    return { main, linked, cache: freshnessCache() };
  }

  function runStatus(root: string, cache: string): { code: number; out: string } {
    const result = spawnSync(process.execPath, [CLI, 'status'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, XDG_CACHE_HOME: cache },
    });
    return { code: result.status ?? 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }

  /** The lines that prescribe a command. */
  function remedies(out: string): readonly string[] {
    return out.split('\n').filter((line) => /void-machine (update|init)/.test(line));
  }

  /** Strip the directory each remedy and the footer name, so two reports of one install compare equal. */
  function report(out: string): string {
    return out.replace(/ in \/\S+: /g, ' ').replace(/written to \/\S+\/\.void\//g, 'written to .void/');
  }

  // `.void/machine/` is per-repository state (decision of 2026-09-02): what
  // `status` measures is the installation, and where it persists the snapshot
  // must be where the installation is. Read from the tree it ran in, it
  // reported a worktree as an uninstalled project and left a `status.json`
  // there for the reconciler to delete.
  it('measures the installation and persists the snapshot in the main checkout', () => {
    const { main, linked, cache } = fixture();

    const fromMain = runStatus(main, cache);
    const fromWorktree = runStatus(linked, cache);

    expect(fromMain.code).toBe(0);
    expect(fromWorktree.code).toBe(0);
    expect(existsSync(join(main, '.void', 'machine', 'status.json'))).toBe(true);
    expect(existsSync(join(linked, '.void', 'machine'))).toBe(false);
    expect(fromMain.out).toContain(`${INSTALLED_VERSION} is installed; ${PUBLISHED_VERSION} is published`);
    expect(report(fromWorktree.out)).toBe(report(fromMain.out));
  });

  it('preserves historical snapshots and creates no new score history', () => {
    const { main, cache } = fixture();
    const history = join(main, '.void', 'machine', 'history');
    mkdirSync(history, { recursive: true });
    for (let i = 0; i < 31; i += 1) writeFileSync(join(history, `${i}.json`), 'historical custom data');
    const before = readdirSync(history).sort();
    const result = runStatus(main, cache);
    expect(result.code).toBe(0);
    expect(readdirSync(history).sort()).toEqual(before);
    for (const file of before) expect(readFileSync(join(history, file), 'utf8')).toBe('historical custom data');
    const snapshot = JSON.parse(readFileSync(join(main, '.void', 'machine', 'status.json'), 'utf8'));
    expect(snapshot).not.toHaveProperty('score');
    expect(snapshot).not.toHaveProperty('capabilities');
    expect(snapshot.installedVersion).toBe(INSTALLED_VERSION);
  });

  // The freshness notice prescribes `void-machine update`, which acts on the
  // directory it is typed in: from the worktree it finds no receipt and, the
  // manifest being tracked, installs a second copy there, upgrading nothing of
  // the install `status` just described. So from a worktree the remedy names
  // the installation, and in the main checkout it names nothing.
  it('names the installation directory in every remedy it prints from a worktree', () => {
    const { main, linked, cache } = fixture();

    const fromMain = runStatus(main, cache);
    const fromWorktree = runStatus(linked, cache);

    expect(remedies(fromMain.out).length).toBeGreaterThan(0);
    expect(fromMain.out).not.toMatch(/ in \/\S+: /);
    const named = remedies(fromWorktree.out);
    expect(named.length).toBe(remedies(fromMain.out).length);
    for (const remedy of named) expect(remedy).toContain(`in ${realpathSync(main)}: `);
  });

  // The footer names the file it wrote. Relative, that path is read against the
  // worktree, where the file was deliberately not written; from a worktree it
  // is named in full, and in the main checkout it stays relative.
  it('names the snapshot under the installation when written from a worktree', () => {
    const { main, linked, cache } = fixture();

    const fromMain = runStatus(main, cache);
    const fromWorktree = runStatus(linked, cache);

    expect(fromMain.out).toContain('state written to .void/machine/status.json');
    expect(fromWorktree.out).toContain(`state written to ${join(realpathSync(main), '.void/machine/status.json')}`);
  });
});
