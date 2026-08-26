import {
  mkdtemp,
  mkdir,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DecisionRecord } from './types.js';
import {
  immutableDecisionIssues,
  isMechanicalReferenceMigration,
  isSafeGitRef,
  parseGitNameStatus,
} from './immutability.js';

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'void-decisions-immutability-'));
}

function record(
  id: string,
  file: string,
  status: DecisionRecord['status'],
): DecisionRecord {
  return {
    schemaVersion: 1,
    id,
    createdAt: '2026-07-24T10:15:00.000Z',
    title: id,
    status,
    deciders: ['folpe'],
    supersedes: [],
    body: '# decision',
    file,
    legacy: false,
  };
}

describe('parseGitNameStatus', () => {
  it('parses modified, deleted and renamed decision paths', () => {
    expect(
      parseGitNameStatus(
        'M\tdocs/decisions/a.md\nD\tdocs/decisions/b.md\nR100\tdocs/decisions/c.md\tdocs/decisions/d.md\n',
      ),
    ).toEqual([
      { kind: 'modified', before: 'docs/decisions/a.md' },
      { kind: 'deleted', before: 'docs/decisions/b.md' },
      {
        kind: 'renamed',
        before: 'docs/decisions/c.md',
        after: 'docs/decisions/d.md',
      },
    ]);
  });

  it('treats a git type change as a decision modification', () => {
    expect(parseGitNameStatus('T\tdocs/decisions/a.md\n')).toEqual([
      { kind: 'modified', before: 'docs/decisions/a.md' },
    ]);
  });
});

describe('immutableDecisionIssues', () => {
  it('blocks modifying, deleting or renaming a decision accepted at the base', () => {
    const base = new Map([
      ['docs/decisions/a.md', record('adr:a', 'docs/decisions/a.md', 'accepted')],
      ['docs/decisions/b.md', record('adr:b', 'docs/decisions/b.md', 'accepted')],
      ['docs/decisions/c.md', record('adr:c', 'docs/decisions/c.md', 'accepted')],
    ]);

    const issues = immutableDecisionIssues(
      [
        { kind: 'modified', before: 'docs/decisions/a.md' },
        { kind: 'deleted', before: 'docs/decisions/b.md' },
        {
          kind: 'renamed',
          before: 'docs/decisions/c.md',
          after: 'docs/decisions/d.md',
        },
      ],
      base,
    );

    expect(issues.map((issue) => issue.code)).toEqual([
      'accepted-decision-modified',
      'accepted-decision-deleted',
      'accepted-decision-renamed',
    ]);
  });

  it('allows editing a proposed decision', () => {
    const base = new Map([
      ['docs/decisions/a.md', record('adr:a', 'docs/decisions/a.md', 'proposed')],
    ]);

    expect(
      immutableDecisionIssues(
        [{ kind: 'modified', before: 'docs/decisions/a.md' }],
        base,
      ),
    ).toEqual([]);
  });

  it('allows an accepted modification only after its reference migration was proven', () => {
    const path = 'docs/decisions/a.md';
    const base = new Map([
      [path, record('adr:a', path, 'accepted')],
    ]);

    expect(
      immutableDecisionIssues(
        [{ kind: 'modified', before: path }],
        base,
        new Set([path]),
      ),
    ).toEqual([]);
  });

  it('fails closed when an existing changed record cannot be parsed at the base', () => {
    expect(
      immutableDecisionIssues(
        [{ kind: 'modified', before: 'docs/decisions/a.md' }],
        new Map(),
      ),
    ).toEqual([
      {
        code: 'git-check-failed',
        file: 'docs/decisions/a.md',
        message: 'could not prove the base decision status; immutability check fails closed',
      },
    ]);
  });
});

describe('isMechanicalReferenceMigration', () => {
  it('allows bounded local paths in prose, links and fenced commands', async () => {
    const root = await tempRoot();
    await mkdir(join(root, '.void'), { recursive: true });
    await mkdir(join(root, 'docs', 'plans'), { recursive: true });
    await mkdir(join(root, 'packages', 'core', 'skills', 'void-tdd'), { recursive: true });
    await writeFile(join(root, '.void', 'program.md'), 'program\n', 'utf8');
    await writeFile(join(root, 'docs', 'plans', 'current.md'), 'plan\n', 'utf8');

    expect(isMechanicalReferenceMigration(
      root,
      'Use `plans/ACTIVE.md`.\n',
      'Use `.void/program.md`.\n',
    )).toBe(true);
    expect(isMechanicalReferenceMigration(
      root,
      'Read the [plan](plans/old.md).\n',
      'Read the [plan](docs/plans/current.md).\n',
    )).toBe(true);
    expect(isMechanicalReferenceMigration(
      root,
      '```\n$ npx skills-ref validate packages/core/skills/tdd\n```\n',
      '```\n$ npx skills-ref validate packages/core/skills/void-tdd\n```\n',
    )).toBe(true);
  });

  it('rejects prose, frontmatter, title and structure edits', async () => {
    const root = await tempRoot();
    await mkdir(join(root, '.void'), { recursive: true });
    await writeFile(join(root, '.void', 'program.md'), 'program\n', 'utf8');

    expect(isMechanicalReferenceMigration(
      root,
      'Use `plans/ACTIVE.md`.\n',
      'Prefer `.void/program.md`.\n',
    )).toBe(false);
    expect(isMechanicalReferenceMigration(
      root,
      '---\ntitle: plans/ACTIVE.md\n---\n# Decision\n',
      '---\ntitle: .void/program.md\n---\n# Decision\n',
    )).toBe(false);
    expect(isMechanicalReferenceMigration(
      root,
      '# plans/ACTIVE.md\n\nContext.\n',
      '# .void/program.md\n\nContext.\n',
    )).toBe(false);
    expect(isMechanicalReferenceMigration(
      root,
      'Use `plans/ACTIVE.md`.\n',
      'Use `.void/program.md` now.\n',
    )).toBe(false);
  });

  it('rejects missing, escaping and symlinked targets', async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(outside, 'outside.md'), 'outside\n', 'utf8');
    await symlink(join(outside, 'outside.md'), join(root, 'docs', 'linked.md'));

    expect(isMechanicalReferenceMigration(
      root,
      'Use `plans/ACTIVE.md`.\n',
      'Use `docs/missing.md`.\n',
    )).toBe(false);
    expect(isMechanicalReferenceMigration(
      root,
      'Use `plans/ACTIVE.md`.\n',
      'Use `../outside.md`.\n',
    )).toBe(false);
    expect(isMechanicalReferenceMigration(
      root,
      'Use `plans/ACTIVE.md`.\n',
      'Use `docs/linked.md`.\n',
    )).toBe(false);
  });
});

describe('isSafeGitRef', () => {
  it('accepts ordinary refs and rejects revision/path expressions', () => {
    expect(isSafeGitRef('origin/main')).toBe(true);
    expect(isSafeGitRef('feature/adr-v3')).toBe(true);
    expect(isSafeGitRef('main:docs/decisions/a.md')).toBe(false);
    expect(isSafeGitRef('--output=/tmp/result')).toBe(false);
  });
});
