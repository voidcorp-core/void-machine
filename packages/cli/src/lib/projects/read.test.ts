import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readGitSignals, readProjectSummary } from './read.js';

/**
 * The I/O edge, tested against real directories and a real git repository.
 *
 * Two guarantees matter more than any individual signal: reading a project
 * NEVER WRITES to it, and reading one project can never throw, because eight
 * are read at once and one permission error must not take the view down.
 */

let root: string;

function run(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function repo(name: string): string {
  const dir = join(root, name);
  mkdirSync(join(dir, '.void'), { recursive: true });
  writeFileSync(join(dir, '.void', 'config.json'), JSON.stringify({ packs: {} }));
  run(dir, 'init', '-q');
  run(dir, 'config', 'user.email', 't@t.io');
  run(dir, 'config', 'user.name', 'T');
  run(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'README.md'), '# hi\n');
  run(dir, 'add', '.');
  run(dir, 'commit', '-qm', 'init');
  return dir;
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'void-read-')));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('readGitSignals', () => {
  it('reads branch, cleanliness and history from a real repository', () => {
    const dir = repo('alpha');

    const signals = readGitSignals(dir);

    expect(signals.available).toBe(true);
    expect(signals.branch).not.toBe(undefined);
    expect(signals.dirtyFiles).toBe(0);
    expect(signals.commitsToday).toBe(1);
    expect(signals.lastCommitAt).toBeTypeOf('number');
  });

  it('counts uncommitted files', () => {
    const dir = repo('alpha');
    writeFileSync(join(dir, 'new.txt'), 'x\n');
    writeFileSync(join(dir, 'README.md'), '# changed\n');

    expect(readGitSignals(dir).dirtyFiles).toBe(2);
  });

  // No upstream means the question has no answer, so it resolves to zero rather
  // than to a number nothing backs.
  it('reports zero unpushed commits when the branch has no upstream', () => {
    expect(readGitSignals(repo('alpha')).unpushedCommits).toBe(0);
  });

  it('degrades instead of throwing outside a repository', () => {
    const plain = join(root, 'plain');
    mkdirSync(plain, { recursive: true });

    const signals = readGitSignals(plain);

    expect(signals.available).toBe(false);
    expect(signals.branch).toBe(undefined);
  });

  it('degrades instead of throwing on a path that does not exist', () => {
    expect(() => readGitSignals(join(root, 'absent'))).not.toThrow();
    expect(readGitSignals(join(root, 'absent')).available).toBe(false);
  });
});

describe('readProjectSummary', () => {
  const NOW = Date.parse('2026-08-17T12:00:00Z');

  it('summarizes a project with no docs at all', () => {
    const dir = repo('bare');

    const summary = readProjectSummary({ name: 'bare', path: dir }, NOW);

    expect(summary.name).toBe('bare');
    expect(summary.decisions.format).toBe('none');
    expect(summary.planCount).toBe(0);
    expect(summary.program).toBe(undefined);
    expect(summary.resumeLine).toBe(undefined);
  });

  it('reads decisions out of a legacy monolith and flags the drift', () => {
    const dir = repo('legacy');
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(
      join(dir, 'docs', 'DECISIONS.md'),
      '# Decisions\n\n### 01. First choice\n\ntext\n\n### 02. Second choice\n\ntext\n',
    );

    const summary = readProjectSummary({ name: 'legacy', path: dir }, NOW);

    expect(summary.decisions.count).toBe(2);
    expect(summary.decisions.format).toBe('live-monolith');
    expect(summary.conformance.map((item) => item.reason)).toContain('decisions-drift');
  });

  // The filename slug reads as `some-title--eb74b522-4442-409f-a5dd-...`, which
  // is not a sentence anyone wants in a card.
  it('reads the real title of a per-file decision rather than its filename', () => {
    const dir = repo('adr');
    mkdirSync(join(dir, 'docs', 'decisions-log'), { recursive: true });
    writeFileSync(
      join(dir, 'docs', 'decisions-log', '2026-08-06-slugified-name--eb74b522-4442.md'),
      '---\nschemaVersion: 1\ntitle: "A build is partial only when completeness is in doubt"\n---\n\nbody\n',
    );

    const summary = readProjectSummary({ name: 'adr', path: dir }, NOW);

    expect(summary.decisions.recent[0]?.title).toBe(
      'A build is partial only when completeness is in doubt',
    );
    expect(summary.decisions.recent[0]?.date).toBe('2026-08-06');
  });

  it('falls back to the filename slug when a record has no title', () => {
    const dir = repo('untitled');
    mkdirSync(join(dir, 'docs', 'decisions-log'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'decisions-log', '2026-08-06-no-frontmatter.md'), 'body\n');

    expect(readProjectSummary({ name: 'untitled', path: dir }, NOW).decisions.recent[0]?.title).toBe(
      'no-frontmatter',
    );
  });

  it('counts plans and surfaces an executing provider-agnostic program', () => {
    const dir = repo('programme');
    mkdirSync(join(dir, 'docs', 'plans'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'plans', 'a-plan.md'), '# plan\n');
    writeFileSync(
      join(dir, '.void', 'program.md'),
      '---\nschemaVersion: 1\nstatus: executing\nprogram: demo\nplan: docs/plans/a-plan.md\nspec: docs/specs/demo.md\nprogress:\n  provider: jira\n  scope: ACME\n  order: [X-1, X-2]\n  states:\n    ready: [Todo]\n    started: [Doing]\n    review: [Review]\n    done: [Done]\nautopilot:\n  schemaVersion: 1\n  enabled: false\n  mergeGate: human\n---\n\n# Program\n',
    );

    const summary = readProjectSummary({ name: 'programme', path: dir }, NOW);

    expect(summary.planCount).toBe(1);
    expect(summary.program).toEqual({ program: 'demo', provider: 'jira', unitCount: 2 });
  });

  it('ignores a program that is not executing', () => {
    const dir = repo('paused');
    writeFileSync(
      join(dir, '.void', 'program.md'),
      '---\nschemaVersion: 1\nstatus: completed\nprogram: demo\nplan: docs/plans/demo.md\nspec: docs/specs/demo.md\nautopilot:\n  schemaVersion: 1\n  enabled: false\n  mergeGate: human\n---\n',
    );

    expect(readProjectSummary({ name: 'paused', path: dir }, NOW).program).toBe(undefined);
  });

  it('surfaces the first meaningful line of a checkpoint', () => {
    const dir = repo('resumable');
    mkdirSync(join(dir, '.void', 'session'), { recursive: true });
    writeFileSync(
      join(dir, '.void', 'session', 'current.md'),
      '---\ndate: 2026-08-17\n---\n\n# Session\n\nEvaluator integration remains.\n',
    );

    expect(readProjectSummary({ name: 'resumable', path: dir }, NOW).resumeLine).toBe(
      'Evaluator integration remains.',
    );
  });

  it('never writes into the project it reads', () => {
    const dir = repo('untouched');
    const before = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });

    readProjectSummary({ name: 'untouched', path: dir }, NOW);

    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })).toBe(
      before,
    );
  });

  it.each([
    ['unparseable program frontmatter', '.void/program.md', '---\n: : :\nnope\n---\n'],
    ['a malformed decisions file', 'docs/DECISIONS.md', `bin${String.fromCharCode(0)}ary`],
    ['an empty checkpoint', '.void/session/current.md', ''],
  ])('degrades instead of throwing on %s', (_label, relative, content) => {
    const dir = repo('broken');
    const target = join(dir, relative);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);

    expect(() => readProjectSummary({ name: 'broken', path: dir }, NOW)).not.toThrow();
  });
});
