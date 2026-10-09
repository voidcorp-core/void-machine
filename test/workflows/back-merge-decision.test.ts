import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PRODUCT_IDENTITY } from '../../packages/hook-runner/src/identity.js';

// The guard back-merge.yml runs before it opens anything, executed against a
// real history: main requires a promotion to be up to date with it, so every
// commit main holds must reach develop, a promotion's own merge commit
// included, even when it changes no file.
const workflow = readFileSync(new URL('../../.github/workflows/back-merge.yml', import.meta.url), 'utf8');
const start = workflow.indexOf('          set -euo pipefail\n          git config user.name');
const end = workflow.indexOf('          branch="$EXPECTED_HEAD"', start);
const guard = workflow.slice(start, end).replace(/^ {10}/gm, '');
const run = workflow.slice(start).replace(/^ {10}/gm, '');

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'back-merge-'));
  roots.push(root);
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_COMMITTER_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.test', GIT_COMMITTER_EMAIL: 'test@example.test' },
    });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q', '-b', 'develop');
  writeFileSync(join(root, 'file.txt'), 'one\n');
  git('add', 'file.txt');
  git('commit', '-q', '-m', 'base');
  git('branch', 'main');
  writeFileSync(join(root, 'file.txt'), 'two\n');
  git('commit', '-q', '-am', 'feature on develop');
  return { root, git };
}

function guardOutcome(root: string) {
  const result = spawnSync('bash', ['-c', `${guard}\necho proceeds`], { cwd: root, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout };
}

function publish(git: (...args: string[]) => string) {
  git('update-ref', 'refs/remotes/origin/develop', 'develop');
  git('update-ref', 'refs/remotes/origin/main', 'main');
}

describe('back-merge guard', () => {
  it('carries a promotion merge commit back even when it changes no file', () => {
    const { root, git } = repository();
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', '--no-edit', 'develop');
    publish(git);
    expect(git('diff', 'origin/develop', 'origin/main')).toBe('');
    expect(guardOutcome(root).stdout).toContain('proceeds');
  });

  it('carries back what main holds and develop does not', () => {
    const { root, git } = repository();
    git('checkout', '-q', 'main');
    writeFileSync(join(root, 'CHANGELOG.md'), 'release\n');
    git('add', 'CHANGELOG.md');
    git('commit', '-q', '-m', 'chore: release');
    publish(git);
    expect(guardOutcome(root).stdout).toContain('proceeds');
  });

  it('opens nothing when develop already holds every commit of main', () => {
    const { root, git } = repository();
    publish(git);
    const outcome = guardOutcome(root);
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain('develop already holds main; nothing to back-merge.');
    expect(outcome.stdout).not.toContain('proceeds');
  });
});

// Run the shipped shell with real Git histories and a receive hook standing in
// for GitHub's locked queue branch. Only the external GitHub API is substituted.
function queuedBackMerge(options: {
  queued?: boolean;
  prs?: number[];
  failure?: 'list' | 'queue';
  identity?: Record<string, object | string | boolean>;
  queueResponse?: string;
} = {}) {
  const { root, git } = repository();
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '--no-edit', 'develop');
  git('checkout', '-qb', 'chore/back-merge-main', 'develop');
  git('merge', '-q', '--no-ff', '--no-edit', 'main');
  const queuedHead = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'main');
  writeFileSync(join(root, 'CHANGELOG.md'), 'new release\n');
  git('add', 'CHANGELOG.md');
  git('commit', '-qm', 'release after queue entry');
  git('init', '--bare', '-q', join(root, 'remote.git'));
  git('remote', 'add', 'origin', join(root, 'remote.git'));
  git('push', '-q', 'origin', 'main', 'develop', 'chore/back-merge-main');
  const pushes = join(root, 'pushes');
  writeFileSync(pushes, '');
  writeFileSync(join(root, 'remote.git/hooks/pre-receive'), `#!/bin/sh
cat >> "$PUSH_LOG"
if [ "$QUEUE_LOCKED" = true ]; then
  echo 'GH006: Protected branch update failed' >&2
  exit 1
fi
`, { mode: 0o755 });
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const calls = join(root, 'calls');
  writeFileSync(calls, '');
  const identity = {
    baseRefName: 'develop', headRefName: 'chore/back-merge-main',
    headRepository: { nameWithOwner: PRODUCT_IDENTITY.repositorySlug },
    headRepositoryOwner: { login: PRODUCT_IDENTITY.repository.owner }, isCrossRepository: false,
    ...options.identity,
  };
  writeFileSync(join(bin, 'gh'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_CALLS, JSON.stringify(args) + '\\n');
const command = args.slice(0, 2).join(' ');
if (command === 'pr list') {
  if (process.env.GH_FAILURE === 'list') process.exit(1);
  const prs = JSON.parse(process.env.GH_PRS);
  process.stdout.write(args.includes('--jq') ? prs.join('\\n') :
    JSON.stringify(prs.map(number => ({ number }))));
} else if (command === 'pr view') {
  process.stdout.write(args.includes('--jq') ? '425' : process.env.GH_IDENTITY);
} else if (command === 'api graphql') {
  if (process.env.GH_FAILURE === 'queue') process.exit(1);
  if (!args.some(arg => arg.includes('isInMergeQueue'))) process.exit(2);
  process.stdout.write(process.env.GH_QUEUE_RESPONSE);
} else if (command === 'pr create') {
  process.stdout.write('${PRODUCT_IDENTITY.repositoryUrl}/pull/425');
} else if (command !== 'pr merge') {
  process.stderr.write('Unexpected gh command: ' + command);
  process.exit(2);
}
`, { mode: 0o755 });
  const queued = options.queued ?? true;
  const execute = (next: { queued?: boolean; locked?: boolean; prs?: number[] } = {}) =>
  spawnSync('bash', ['-c', run], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
      EXPECTED_REPOSITORY: PRODUCT_IDENTITY.repositorySlug,
      EXPECTED_OWNER: PRODUCT_IDENTITY.repository.owner,
      EXPECTED_HEAD: 'chore/back-merge-main', EXPECTED_BASE: 'develop',
      PUSH_LOG: pushes, QUEUE_LOCKED: String(next.locked ?? next.queued ?? queued), GH_CALLS: calls,
      GH_FAILURE: options.failure ?? '', GH_PRS: JSON.stringify(next.prs ?? options.prs ?? [425]),
      GH_IDENTITY: JSON.stringify(identity),
      GH_QUEUE_RESPONSE: options.queueResponse ?? JSON.stringify({
        data: { repository: { pullRequest: { isInMergeQueue: next.queued ?? queued } } },
      }),
    },
  });
  return { root, git, queuedHead, execute,
    pushes: () => readFileSync(pushes, 'utf8'),
    calls: () => readFileSync(calls, 'utf8'),
  };
}

describe('canonical back-merge branch protection', () => {
  it('defers a queued PR without attempting to rewrite its locked branch', () => {
    const fixture = queuedBackMerge();
    const outcome = fixture.execute();
    expect(outcome.status, outcome.stderr).toBe(0);
    expect(outcome.stdout).toContain('next push to main');
    expect(fixture.pushes()).toBe('');
    expect(fixture.git('rev-parse', 'origin/chore/back-merge-main')).toBe(fixture.queuedHead);
    expect(fixture.calls()).not.toContain('["pr","merge"');
    expect(fixture.calls()).not.toContain('["pr","create"');
  });

  it.each(['list', 'queue'] as const)('fails closed before push when %s lookup fails', failure => {
    const fixture = queuedBackMerge({ queued: false, failure });
    expect(fixture.execute().status).not.toBe(0);
    expect(fixture.pushes()).toBe('');
  });

  it('keeps the server refusal if the PR enters the queue after inspection', () => {
    const fixture = queuedBackMerge({ queued: false });
    const outcome = fixture.execute({ locked: true });
    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toContain('GH006: Protected branch update failed');
    expect(fixture.git('rev-parse', 'origin/chore/back-merge-main')).toBe(fixture.queuedHead);
    expect(fixture.calls()).not.toContain('["pr","merge"');
  });

  it('rebuilds from refreshed develop on the next trigger after the queued PR merges', () => {
    const fixture = queuedBackMerge();
    expect(fixture.execute().status).toBe(0);
    expect(fixture.pushes()).toBe('');
    // GitHub merges the old head; checkout on the next run fetches this new base.
    fixture.git('--git-dir=remote.git', 'update-ref', 'refs/heads/develop', fixture.queuedHead);
    fixture.git('fetch', '-q', 'origin');
    const outcome = fixture.execute({ queued: false, prs: [] });
    expect(outcome.status, outcome.stderr).toBe(0);
    for (const branch of ['main', 'develop']) {
      expect(fixture.git('merge-base', `origin/${branch}`, 'origin/chore/back-merge-main'))
        .toBe(fixture.git('rev-parse', `origin/${branch}`));
    }
    expect(fixture.calls()).toContain('["pr","create"');
  });

  it('rejects ambiguous canonical PRs before pushing', () => {
    const fixture = queuedBackMerge({ queued: false, prs: [425, 427] });
    expect(fixture.execute().status).not.toBe(0);
    expect(fixture.pushes()).toBe('');
  });

  it.each([
    { isCrossRepository: true }, { headRefName: 'other' }, { baseRefName: 'main' },
    { headRepository: { nameWithOwner: 'other/void-machine' } },
    { headRepositoryOwner: { login: 'other' } },
  ])('rejects a foreign PR before pushing: %j', identity => {
    const fixture = queuedBackMerge({ queued: false, identity });
    expect(fixture.execute().status).not.toBe(0);
    expect(fixture.pushes()).toBe('');
  });

  it.each(['{}', '{"data":{"repository":{"pullRequest":{"isInMergeQueue":"false"}}}}'])
  ('refuses an unknown queue state: %s', queueResponse => {
    const fixture = queuedBackMerge({ queued: false, queueResponse });
    expect(fixture.execute().status).not.toBe(0);
    expect(fixture.pushes()).toBe('');
  });

  it.each([[425], []])('updates or creates an unqueued canonical PR: %j', (...prs) => {
    const fixture = queuedBackMerge({ queued: false, prs });
    const outcome = fixture.execute();
    expect(outcome.status, outcome.stderr).toBe(0);
    expect(fixture.pushes()).not.toBe('');
    expect(fixture.calls()).toContain('["pr","merge","425"');
    expect(fixture.git('merge-base', 'origin/main', 'origin/chore/back-merge-main'))
      .toBe(fixture.git('rev-parse', 'origin/main'));
  });
});
