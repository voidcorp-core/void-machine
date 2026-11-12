import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareFreshness } from '@voidcorp/hook-runner';
import { buildInstallReceipt, encodeReceipt, INSTALL_RECEIPT_PATH } from '../lib/receipts.js';
import { CORE_PLUGIN_NAME } from '../lib/packs.js';
import { check, type CheckRemote } from './check.js';

// `check` compares what `init` installed with the marketplace at HEAD. The
// pins and the installed doctrine are hidden from git by design, so a linked
// worktree carries none of them: read from the tree it ran in, `check` told a
// worker that the doctrine was missing and every plugin uninstalled, and its
// remedy was to install a second copy where git was told not to look.

const PHILOSOPHY = '# Philosophy\n\nSafety > Performance > Developer Experience.\n';
const INSTALLED_PIN = '3.5.0';
const MARKETPLACE_PIN = '3.6.0';
const scratch: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

function directory(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function repository(): string {
  const root = directory('void-check-main-');
  git(root, 'init', '--quiet');
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  git(root, 'add', 'README.md');
  git(
    root,
    '-c', 'user.name=Void Test',
    '-c', 'user.email=void@example.test',
    'commit', '--quiet', '-m', 'test: seed',
  );
  return root;
}

function linkedWorktree(main: string): string {
  const path = join(directory('void-check-linked-'), 'DEV-000');
  git(main, 'worktree', 'add', '--quiet', path, '-b', 'worker/DEV-000');
  return path;
}

/** What `init` leaves behind and hides from git: the core pin and the installed doctrine. */
function install(root: string): void {
  mkdirSync(join(root, '.void', 'installed'), { recursive: true });
  writeFileSync(join(root, '.void', 'config.json'), JSON.stringify({ core: INSTALLED_PIN }));
  writeFileSync(join(root, '.void', 'installed', 'PHILOSOPHY.md'), PHILOSOPHY);
}

/** A marketplace one core release ahead of the install, with the same doctrine, answered without gh. */
function marketplaceAhead(): CheckRemote {
  return {
    fetchRemoteMarketplace: () => ({
      ok: true,
      value: { name: 'voidcorp', plugins: [{ name: CORE_PLUGIN_NAME }] },
    }),
    fetchPinnedPluginVersion: () => ({ ok: true, value: MARKETPLACE_PIN }),
    fetchRemotePhilosophy: () => ({ ok: true, value: PHILOSOPHY }),
  };
}

async function checkFrom(cwd: string, remote: CheckRemote = marketplaceAhead()): Promise<string> {
  let written = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    written += String(chunk);
    return true;
  });
  await check(['--doctrine'], { cwd, remote });
  return written;
}

/** The lines that prescribe a command. */
function remedies(out: string): readonly string[] {
  return out.split('\n').filter((line) => /void-machine (update|init)/.test(line));
}

/** Strip the directory each remedy names, so two reports of one install compare equal. */
function report(out: string): string {
  return out.replace(/ in \/\S+: /g, ' ');
}

describe('check from a linked worktree', () => {
  it('reads the pins and the installed doctrine of the main checkout', async () => {
    const main = repository();
    install(main);
    const linked = linkedWorktree(main);
    expect(existsSync(join(linked, '.void'))).toBe(false);

    const report = await checkFrom(linked);

    expect(report).toContain('update available');
    expect(report).toContain('in sync');
    expect(report).not.toContain('not installed');
    expect(report).not.toContain('missing locally');
  });

  it('measures from the worktree what it measures from the main checkout', async () => {
    const main = repository();
    install(main);
    const linked = linkedWorktree(main);

    const fromMain = await checkFrom(main);
    const fromWorktree = await checkFrom(linked);

    expect(report(fromWorktree)).toBe(report(fromMain));
  });

  // Every remedy `check` prints is a command that acts on the directory it is
  // typed in: `update` bumps the pins of the tree it runs in, `init` installs
  // there. Followed from the worktree as printed, either would take the
  // marketplace route and write a second install exactly where git was told
  // not to look, touching none of the pins this check measured. So from a
  // worktree each remedy names the installation, and in the main checkout it
  // names nothing.
  it('names the installation directory in every remedy it prints from a worktree', async () => {
    const main = repository();
    install(main);
    const linked = linkedWorktree(main);

    const fromMain = await checkFrom(main);
    const fromWorktree = await checkFrom(linked);

    expect(remedies(fromMain).length).toBeGreaterThan(0);
    expect(fromMain).not.toMatch(/ in \/\S+: /);
    const named = remedies(fromWorktree);
    expect(named.length).toBe(remedies(fromMain).length);
    for (const remedy of named) expect(remedy).toContain(`in ${realpathSync(main)}: `);
  });

  it('names the installation when the doctrine is missing', async () => {
    const main = repository();
    const linked = linkedWorktree(main);

    const fromWorktree = await checkFrom(linked);

    const named = remedies(fromWorktree);
    expect(named.some((remedy) => remedy.includes('void-machine init'))).toBe(true);
    for (const remedy of named) expect(remedy).toContain(`in ${realpathSync(main)}: `);
  });

  it('names the installation when the doctrine drifted', async () => {
    const main = repository();
    install(main);
    const linked = linkedWorktree(main);
    const drifted: CheckRemote = {
      ...marketplaceAhead(),
      fetchRemotePhilosophy: () => ({ ok: true, value: `${PHILOSOPHY}\nA new rule.\n` }),
    };

    const fromWorktree = await checkFrom(linked, drifted);

    expect(fromWorktree).toContain('drift');
    const named = remedies(fromWorktree);
    expect(named.some((remedy) => remedy.includes('void-machine init'))).toBe(true);
    for (const remedy of named) expect(remedy).toContain(`in ${realpathSync(main)}: `);
  });

  it('still reports the doctrine missing when nothing was installed anywhere', async () => {
    const main = repository();
    const linked = linkedWorktree(main);

    const report = await checkFrom(linked);

    expect(report).toContain('missing locally');
    expect(report).toContain('not installed');
  });
});

describe('check in the main checkout', () => {
  it('reads the install next to the code, as before', async () => {
    const main = repository();
    install(main);

    const report = await checkFrom(main);

    expect(report).toContain('update available');
    expect(report).toContain('in sync');
    expect(report).not.toContain('missing locally');
  });
});


describe('check installation channel', () => {
  function receipt(root: string, source: 'local' | 'marketplace', version: string): void {
    const path = join(root, INSTALL_RECEIPT_PATH);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, encodeReceipt(buildInstallReceipt({ version, source, runtimes: ['codex'], files: [] })));
  }

  function manifest(root: string, version: string): void {
    writeFileSync(join(root, '.void/install-manifest.json'), JSON.stringify({ schemaVersion: 1, version, files: [] }));
  }

  async function bundledReport(root: string, args: string[] = []): Promise<string> {
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      output += String(chunk);
      return true;
    });
    await check(args, {
      cwd: root,
      remote: {
        ...marketplaceAhead(),
        fetchRemoteMarketplace: () => { throw new Error('ordinary bundled check must not contact marketplace'); },
      },
      resolveFreshness: async ({ installed }) => compareFreshness(installed, '7.0.1'),
    });
    return output;
  }

  it('compares the bundled receipt version, ignoring old pins and a different manifest version', async () => {
    const root = repository();
    install(root);
    receipt(root, 'local', '7.0.1');
    manifest(root, '6.0.0');
    const pins = readFileSync(join(root, '.void/config.json'), 'utf8');
    const out = await bundledReport(root);
    expect(readFileSync(join(root, '.void/config.json'), 'utf8')).toBe(pins);
    expect(out).toContain('7.0.1 is the published version');
    expect(out).not.toContain('plugin');
    expect(out).not.toContain('3.5.0');
  });

  it('reads a clone manifest when no local receipt exists', async () => {
    const root = repository();
    install(root);
    manifest(root, '7.0.1');
    expect(await bundledReport(root)).toContain('7.0.1 is the published version');
    manifest(root, '7.0.0');
    const behind = await bundledReport(root);
    expect(behind).toContain('void-machine update');
    expect(behind).not.toContain('hydrate');
  });

  it('reports an invalid existing manifest as unknown, never legacy marketplace or current', async () => {
    const root = repository();
    install(root);
    writeFileSync(join(root, '.void/install-manifest.json'), '{ broken');
    const out = await bundledReport(root);
    expect(out).toContain('unknown');
    expect(out).not.toContain('all up to date');
  });

  it('names the install root in the bundled update remedy from a linked worktree', async () => {
    const root = repository();
    install(root);
    receipt(root, 'local', '7.0.0');
    const out = await bundledReport(linkedWorktree(root));
    expect(out).toContain('7.0.0 installed, 7.0.1 published');
    expect(out).toContain(`in ${realpathSync(root)}: `);
    expect(out).toContain('void-machine update');
  });

  it('keeps an explicit marketplace receipt authoritative over the manifest', async () => {
    const root = repository();
    install(root);
    receipt(root, 'marketplace', '7.0.1');
    manifest(root, '7.0.1');
    expect(await checkFrom(root)).toContain('update available');
  });

  it('still compares marketplace doctrine when explicitly requested on a bundled install', async () => {
    const root = repository();
    install(root);
    receipt(root, 'local', '7.0.1');
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => { output += String(chunk); return true; });
    await check(['--doctrine'], { cwd: root, remote: marketplaceAhead(),
      resolveFreshness: async ({ installed }) => compareFreshness(installed, '7.0.1') });
    expect(output).toContain('7.0.1 is the published version');
    expect(output).toContain('in sync');
    expect(output).not.toContain('plugins behind');
  });
});


it('reports unavailable published freshness without claiming the bundled install is current', async () => {
  const root = repository();
  install(root);
  writeFileSync(join(root, '.void/install-manifest.json'), JSON.stringify({ schemaVersion: 1, version: '7.0.1', files: [] }));
  let output = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => { output += String(chunk); return true; });
  await check([], { cwd: root,
    remote: { ...marketplaceAhead(), fetchRemoteMarketplace: () => { throw new Error('wrong channel'); } },
    resolveFreshness: async ({ installed }) => ({ verdict: 'unknown', installed, reason: 'registry unavailable' }),
  });
  expect(output).toContain('unknown (registry unavailable)');
  expect(output).not.toContain('all up to date');
});
