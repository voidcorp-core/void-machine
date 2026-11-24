import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cliVersion } from '../lib/paths.js';

// `doctor` is a command with side effects and a process exit, so it is exercised
// the way a user meets it: as a binary, in a throwaway project. The behaviour
// worth pinning is the one that cost an hour on 2026-08-18, when a 2.5.1 binary
// told a healthy 2.7.0 project that its doctrine was missing, its hooks never
// fired and five packs were unwired. Four failures, none real, each with a
// remedy that would have damaged a correct install.
const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'bin', 'void-machine.mjs');

function projectRecording(version: string): string {
  const root = mkdtempSync(join(tmpdir(), 'doctor-cmd-'));
  mkdirSync(join(root, '.void'), { recursive: true });
  writeFileSync(
    join(root, '.void', 'install-manifest.json'),
    JSON.stringify({ schemaVersion: 1, version, files: [] }),
  );
  writeFileSync(join(root, '.void', 'config.json'), '{}');
  return root;
}

function runDoctor(root: string, ...args: readonly string[]): { code: number; out: string } {
  const result = spawnSync(process.execPath, [CLI, 'doctor', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return { code: result.status ?? 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

it('keeps --no-remote as a compatible no-op', () => {
  const root = projectRecording(cliVersion());
  expect(runDoctor(root, '--no-remote')).toEqual(runDoctor(root));
});

describe('doctor and a runner older than the project', () => {
  it('reports the version gap and judges nothing else', () => {
    // A version no release will ever reach, so this stays true as the CLI moves.
    const { code, out } = runDoctor(projectRecording('99.0.0'));
    expect(code).toBe(1);
    expect(out).toContain('99.0.0');
    expect(out).toMatch(/structure/i);
    // The checks it declined to run must not appear at all: reporting them from
    // the previous layout is exactly the damage being prevented.
    expect(out).not.toMatch(/doctrine files/);
    expect(out).not.toMatch(/packs coherence/);
  });

  // A newer CLI meeting an older project is the ordinary state between a publish
  // and that project's `update`. Suspending there would refuse every healthy
  // project in the days after a release.
  it('says nothing about the gap when the project is the older one', () => {
    const { out } = runDoctor(projectRecording('0.0.1'));
    expect(out).not.toMatch(/structure checks\s+suspended/);
  });
});

describe('doctor from a linked worktree', () => {
  function git(cwd: string, ...args: string[]): void {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  }

  /**
   * Strip the roots block (two lines and its blank) and the directory each
   * remedy names, so two reports of one install compare equal.
   */
  function report(out: string): string {
    return out
      .split('\n')
      .filter((line) => !/^\s+(work tree|installed)\s+\//.test(line))
      .map((line) => line.replace(/ in \/\S+: /, ' '))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  }

  // The install is per repository and hidden from git on purpose, so a linked
  // worktree carries none of it. Judged against the tree it ran in, doctor
  // reported a healthy repository as an absent install; it judges the
  // installation root instead, and says which two directories it looked at.
  it('judges the installation of the main checkout and names both roots', () => {
    const main = projectRecording(cliVersion());
    git(main, 'init', '--quiet');
    writeFileSync(join(main, 'README.md'), '# fixture\n');
    git(main, 'add', 'README.md', '.void/config.json', '.void/install-manifest.json');
    git(
      main,
      '-c', 'user.name=Void Test',
      '-c', 'user.email=void@example.test',
      'commit', '--quiet', '-m', 'test: seed',
    );
    const linked = join(mkdtempSync(join(tmpdir(), 'doctor-linked-')), 'DEV-000');
    git(main, 'worktree', 'add', '--quiet', linked, '-b', 'worker/DEV-000');

    // Source checkouts obey the same installation-root rule as consumers.
    for (const root of [main, linked]) {
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'void-harness' }));
      mkdirSync(join(root, 'packages/cli'), { recursive: true });
      mkdirSync(join(root, 'packages/core'), { recursive: true });
    }

    const fromMain = runDoctor(main);
    const fromWorktree = runDoctor(linked);

    expect(fromWorktree.out).toContain(realpathSync(linked));
    expect(fromWorktree.out).toContain(realpathSync(main));
    expect(fromMain.out).not.toMatch(/^\s+installed\s+\//m);
    expect(fromWorktree.code).toBe(fromMain.code);
    expect(report(fromWorktree.out)).toBe(report(fromMain.out));

    // Every remedy doctor prints is a command that acts on the directory it is
    // typed in. Followed from the worktree, `void-machine init` would install a
    // second copy exactly where git was told not to look: the defect this
    // command exists to prevent. So from a worktree each remedy names the
    // directory it must run in, and in the main checkout it names nothing. The
    // fixture wires no runtime, so at least one remedy is printed. These
    // assertions share this fixture and these two runs rather than paying for
    // an identical pair of their own.
    expect(fromMain.out).toMatch(/void-machine init/);
    expect(fromMain.out).not.toMatch(/ in \/\S+: /);
    const remedies = fromWorktree.out.split('\n').filter((line) => /^\s+\S+\s+.*void-machine (init|runtime add)/.test(line));
    expect(remedies.length).toBeGreaterThan(0);
    for (const remedy of remedies) expect(remedy).toContain(`in ${realpathSync(main)}: `);
  });

  it.each(['--fix', '--dry-run'])('explicitly rejects retired repair flag %s', (flag) => {
    const { code, out } = runDoctor(projectRecording(cliVersion()), flag);
    expect(code).toBe(2);
    expect(out).toContain(`${flag} was removed`);
    expect(out).not.toContain('would write');
  });

});


describe('doctor shares Autopilot authority admission', () => {
  it('reports config-only authority and its actual source without requiring a programme', () => {
    const root = projectRecording(cliVersion());
    writeFileSync(join(root, '.void/config.json'), JSON.stringify({ autopilot: {
      schemaVersion: 3, enabled: true, base: 'develop', deployBranch: 'main',
      progress: { provider: 'linear', scope: 'team/project',
        states: { ready: ['Todo'], started: ['Doing'], review: ['Review'], done: ['Done'] } },
    } }));
    const { out } = runDoctor(root);
    expect(out).toContain('executing, autopilot declared in .void/config.json');
    expect(out).not.toContain('no .void/program.md');
  });
  it('does not invent a permission for absent or malformed config', () => {
    const root = projectRecording(cliVersion());
    expect(runDoctor(root).out).not.toContain('autopilot program');
    writeFileSync(join(root, '.void/config.json'), '{ broken');
    expect(runDoctor(root).out).toContain('Autopilot authority could not be parsed');
  });
});
