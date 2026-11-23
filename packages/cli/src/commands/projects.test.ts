import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projects } from './projects.js';

/**
 * The command is a projection: whatever it prints, it must leave every project
 * exactly as it found it, and it must answer without a network.
 *
 * `--json` is the contract the served view will consume, so it is asserted as a
 * contract rather than as a rendering detail.
 */

let park: string;
let globalDir: string;
let written: string;

function repo(name: string, opts: { dirty?: boolean; decisions?: string } = {}): string {
  const dir = join(park, name);
  mkdirSync(join(dir, '.void'), { recursive: true });
  writeFileSync(join(dir, '.void', 'config.json'), JSON.stringify({ packs: {} }));
  for (const args of [
    ['init', '-q'],
    ['config', 'user.email', 't@t.io'],
    ['config', 'user.name', 'T'],
    ['config', 'commit.gpgsign', 'false'],
  ]) {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  }
  writeFileSync(join(dir, 'README.md'), '# hi\n');
  if (opts.decisions !== undefined) {
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'DECISIONS.md'), opts.decisions);
  }
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir, stdio: 'ignore' });
  if (opts.dirty === true) writeFileSync(join(dir, 'README.md'), '# changed\n');
  return dir;
}

function parseJsonOutput(): {
  readonly projects: readonly { name: string; attention: readonly unknown[] }[];
  readonly roots: readonly string[];
} {
  return JSON.parse(written) as never;
}

beforeEach(() => {
  park = realpathSync(mkdtempSync(join(tmpdir(), 'void-cmd-park-')));
  globalDir = realpathSync(mkdtempSync(join(tmpdir(), 'void-cmd-global-')));
  written = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    written += String(chunk);
    return true;
  });
  vi.stubEnv('VOID_GLOBAL_DIR', globalDir);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(park, { recursive: true, force: true });
  rmSync(globalDir, { recursive: true, force: true });
});

function declareRoots(): void {
  writeFileSync(join(globalDir, 'discovery.json'), JSON.stringify({ roots: [park] }));
}

describe('projects command', () => {
  it('lists every discovered project as json', async () => {
    repo('alpha');
    repo('bravo');
    declareRoots();

    await projects(['--json']);

    expect(parseJsonOutput().projects.map((p) => p.name).sort()).toEqual(['alpha', 'bravo']);
  });

  it('renders a human table naming each project', async () => {
    repo('alpha');
    declareRoots();

    await projects([]);

    expect(written).toContain('alpha');
    expect(written).toContain('project(s)');
  });

  it('explains how to configure roots when nothing is found', async () => {
    declareRoots();

    await projects([]);

    expect(written).toContain('.void/config.json');
    expect(written).toContain('discovery.json');
  });

  // The whole discipline of the view in one assertion.
  it('leaves every project byte-identical', async () => {
    const dir = repo('alpha', { dirty: true });
    declareRoots();
    const before = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });

    await projects(['--json']);

    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })).toBe(
      before,
    );
  });

  it('puts projects with attention before quiet ones', async () => {
    repo('quiet');
    repo('risky', { dirty: true });
    declareRoots();

    await projects(['--json']);

    expect(parseJsonOutput().projects[0]?.name).toBe('risky');
  });

  // Format drift must not be counted as attention: measured on the real park it
  // affects most projects, and counting it flagged all of them at once.
  it('does not rank a drifting but clean project as needing attention', async () => {
    repo('drifting', { decisions: '# D\n\n### 01. A choice\n\ntext\n' });
    declareRoots();

    await projects(['--json']);

    const [first] = parseJsonOutput().projects;
    expect(first?.attention).toEqual([]);
  });

  it('reports the resolved roots so the answer is auditable', async () => {
    repo('alpha');
    declareRoots();

    await projects(['--json']);

    expect(parseJsonOutput().roots).toEqual([park]);
  });
});
