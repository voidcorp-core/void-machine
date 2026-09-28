import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  gitIn,
  observeGithub,
  parseBehind,
  parseDefaultBranch,
  parseMergeMethod,
  parseMergeQueuePresence,
  parseQueueMembership,
  parsePullRequestFiles,
  parsePullRequestView,
  PULL_REQUEST_FILE_PAGES_MAX,
  parseEjections,
  parseQueueTimeline,
  PULL_REQUEST_FIELDS,
  readSharedState,
  resolveLoopBase,
} from './loop-observe.js';
import { renderJudgmentComment } from './judgment-comment.js';
import { changedParts, fingerprintOf } from './shared-state.js';

// Every double below is a real `gh` output captured read-only (see
// __fixtures__/gh/README.md). A variant overrides fields of a real capture; no
// shape is written by hand, because a hand-written shape is where an adapter and
// the API it reads quietly disagree.

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/gh/${name}`, import.meta.url), 'utf8');
}

type Raw = Record<string, unknown>;
/**
 * A captured view with the `comments` and the `changedFiles` of other real
 * captures, as gh prints them together when all are requested.
 */
const view = (name: string): Raw => ({
  ...(JSON.parse(fixture(name)) as Raw),
  ...(JSON.parse(fixture('pr-view-comments.json')) as Raw),
  changedFiles: (JSON.parse(fixture('pr-view-files.json')) as Raw).changedFiles,
});
const viewText = (name: string): string => JSON.stringify(view(name));
const openView = (): Raw => view('pr-view-open.json');
const armedView = (): Raw => view('pr-view-auto-merge.json');
const queuedRun = (): Raw => JSON.parse(fixture('check-run-queued.json')) as Raw;
const statusContexts = (): Raw[] => JSON.parse(fixture('status-contexts.json')) as Raw[];

function withRollup(view: Raw, rollup: readonly Raw[]): string {
  return JSON.stringify({ ...view, statusCheckRollup: rollup });
}

/** The review check as the review job publishes it, from a real check run shape. */
function reviewCheck(conclusion: string): Raw {
  const [run] = openView().statusCheckRollup as Raw[];
  return conclusion === 'PENDING'
    ? { ...run, name: 'independent-review', status: 'IN_PROGRESS', conclusion: '' }
    : { ...run, name: 'independent-review', conclusion };
}

/** A comment on a real comment shape, by the review job's bot unless another author is given. */
function commentBy(body: string, login = 'github-actions'): Raw {
  const [real] = openView().comments as Raw[];
  return { ...real, body, author: { login } };
}

describe('parsePullRequestView', () => {
  it('reads an open pull request whose checks all passed', () => {
    expect(parsePullRequestView(viewText('pr-view-open.json'))).toEqual({
      number: 381,
      state: 'open',
      draft: false,
      headRef: 'develop',
      headSha: 'ca7fdc0008c5b597224c37b195e2a0ba0cd58e63',
      baseRef: 'main',
      conflicted: false,
      behind: false,
      autoMerge: false,
      checks: 'passing',
      changedFiles: 15,
    });
  });

  it('reads how many files GitHub counts, which tells a short list from a whole one', () => {
    const truncated = { ...openView(), changedFiles: 140 };
    expect(parsePullRequestView(JSON.stringify(truncated))).toMatchObject({ changedFiles: 140 });
    const { changedFiles: _dropped, ...countless } = openView();
    expect(() => parsePullRequestView(JSON.stringify(countless))).toThrow(/changedFiles/);
  });

  it('asks gh for no file list, whose renames name only the destination', () => {
    expect(PULL_REQUEST_FIELDS).not.toContain('files');
  });

  it('reads a merged pull request and an armed auto-merge', () => {
    expect(parsePullRequestView(viewText('pr-view-merged.json')).state).toBe('merged');
    const armed = parsePullRequestView(viewText('pr-view-auto-merge.json'));
    expect(armed.autoMerge).toBe(true);
    // PR 379 carries a failed `publish` run beside a skipped one: skipped passes.
    expect(armed.checks).toBe('failing');
  });

  it('holds the checks pending while a run has not completed', () => {
    const view = openView();
    const rollup = [...(view.statusCheckRollup as Raw[]), queuedRun()];
    expect(parsePullRequestView(withRollup(view, rollup)).checks).toBe('pending');
  });

  it('reads a head no check runs on as having none, not as pending forever', () => {
    // A project without CI merges on its local verdict alone; a pending state
    // that never settles would hold every one of its pull requests.
    expect(parsePullRequestView(withRollup(openView(), [])).checks).toBe('none');
  });

  it('reads commit statuses as checks', () => {
    const [pending, success] = statusContexts();
    const view = openView();
    expect(parsePullRequestView(withRollup(view, [success as Raw])).checks).toBe('passing');
    expect(parsePullRequestView(withRollup(view, [pending as Raw])).checks).toBe('pending');
    const failed = { ...success, state: 'ERROR' };
    expect(parsePullRequestView(withRollup(view, [failed])).checks).toBe('failing');
  });

  it('reads the review check a repository runs on GitHub as one more check', () => {
    // The loop's verdict is local; a review check is a check that must pass.
    const view = openView();
    const passing = view.statusCheckRollup as Raw[];
    for (const [conclusion, checks] of [
      ['SUCCESS', 'passing'],
      ['FAILURE', 'failing'],
      ['PENDING', 'pending'],
    ] as const) {
      expect(parsePullRequestView(withRollup(view, [...passing, reviewCheck(conclusion)])).checks).toBe(checks);
    }
  });

  it('reads the latest conflict class posted as a comment block, and no review verdict at all', () => {
    const base = openView();
    const head = 'ca7fdc0008c5b597224c37b195e2a0ba0cd58e63';
    const verdictJudgment = { headSha: head, round: 1, blocking: [], advisory: [] };
    const conflictJudgment = { headSha: head, class: 'semantic', reason: 'Both sides changed the grant.' };
    const posted = [
      commentBy(renderJudgmentComment('review-verdict', verdictJudgment)),
      commentBy(renderJudgmentComment('conflict-class', conflictJudgment), 'folpe'),
    ];
    const rollup = [...(base.statusCheckRollup as Raw[]), reviewCheck('SUCCESS')];
    const comments = [...(base.comments as Raw[]), ...posted];
    const read = parsePullRequestView(JSON.stringify({ ...base, statusCheckRollup: rollup, comments }));
    expect(read.conflict).toEqual(conflictJudgment);
    // A verdict block on GitHub is a copy for humans: the observation carries none.
    expect(Object.values(read)).not.toContainEqual(verdictJudgment);
    expect(parsePullRequestView(viewText('pr-view-open.json')).conflict).toBeUndefined();
  });

  it('reads a conflict and a branch behind its base', () => {
    const dirty = JSON.stringify({ ...openView(), mergeStateStatus: 'DIRTY' });
    const behind = JSON.stringify({ ...openView(), mergeStateStatus: 'BEHIND' });
    expect(parsePullRequestView(dirty)).toMatchObject({ conflicted: true, behind: false });
    expect(parsePullRequestView(behind)).toMatchObject({ conflicted: false, behind: true });
  });

  it('refuses an output it cannot read rather than guessing', () => {
    expect(() => parsePullRequestView('not json')).toThrow(/pull request/);
    const unknown = JSON.stringify({ ...openView(), mergeStateStatus: 'SIDEWAYS' });
    expect(() => parsePullRequestView(unknown)).toThrow(/mergeStateStatus/);
    const { headRefOid: _dropped, ...headless } = armedView();
    expect(() => parsePullRequestView(JSON.stringify(headless))).toThrow(/headRefOid/);
  });

  it('asks gh for exactly the fields it reads', () => {
    const keys = Object.keys(openView()).sort();
    expect([...PULL_REQUEST_FIELDS].sort()).toEqual(keys);
  });
});

describe('parseDefaultBranch', () => {
  it('reads the default branch gh reports', () => {
    expect(parseDefaultBranch(fixture('repo-view-default-branch.json'))).toBe('main');
  });

  it('reads an empty repository as having none, never as a guessed name', () => {
    expect(parseDefaultBranch('{"defaultBranchRef":null}')).toBeUndefined();
    expect(parseDefaultBranch('{"defaultBranchRef":{"name":""}}')).toBeUndefined();
    expect(() => parseDefaultBranch('{}')).toThrow(/default branch/);
  });
});

describe('parseBehind', () => {
  it('reads the commits of the base a head lacks', () => {
    expect(parseBehind(fixture('compare-behind.json'))).toBe(true);
    expect(parseBehind(fixture('compare-ahead.json'))).toBe(false);
    expect(() => parseBehind('{"status":"behind"}')).toThrow(/base comparison/);
  });
});

describe('parseMergeMethod', () => {
  const methods = (merge: boolean, squash: boolean, rebase: boolean) => JSON.stringify({
    ...(JSON.parse(fixture('repo-view-merge-methods.json')) as Raw),
    mergeCommitAllowed: merge,
    squashMergeAllowed: squash,
    rebaseMergeAllowed: rebase,
  });

  it('prefers a merge commit, which keeps each commit of the unit', () => {
    expect(parseMergeMethod(fixture('repo-view-merge-methods.json'))).toBe('--merge');
  });

  it('takes the method the repository allows, and refuses a repository that allows none', () => {
    expect(parseMergeMethod(methods(false, true, true))).toBe('--squash');
    expect(parseMergeMethod(methods(false, false, true))).toBe('--rebase');
    expect(() => parseMergeMethod(methods(false, false, false))).toThrow(/no merge method/);
  });
});

describe('parseMergeQueuePresence', () => {
  it('tells a branch with a merge queue from one without', () => {
    expect(parseMergeQueuePresence(fixture('queue-present.json'))).toBe(true);
    expect(parseMergeQueuePresence(fixture('queue-absent.json'))).toBe(false);
  });

  it('refuses an answer carrying errors', () => {
    const failed = JSON.stringify({ data: { repository: { mergeQueue: {} } }, errors: [{ message: 'x' }] });
    expect(() => parseMergeQueuePresence(failed)).toThrow(/merge queue/);
    expect(() => parseMergeQueuePresence('{"data":{}}')).toThrow(/merge queue/);
  });
});

describe('parseQueueMembership', () => {
  it('tells a queued pull request from one outside the queue, with the id that dequeues it', () => {
    expect(parseQueueMembership(fixture('pr-queue-membership-queued.json'))).toEqual({
      nodeId: 'PR_kwDOAeUeuM8AAAABBpI4rA',
      queued: true,
    });
    expect(parseQueueMembership(fixture('pr-queue-membership-absent.json'))).toMatchObject({ queued: false });
  });

  it('refuses an answer carrying errors or missing the membership', () => {
    const pullRequest = { id: 'PR_x', isInMergeQueue: false };
    const failed = JSON.stringify({ data: { repository: { pullRequest } }, errors: [{ message: 'x' }] });
    expect(() => parseQueueMembership(failed)).toThrow(/merge queue membership/);
    const partial = JSON.stringify({ data: { repository: { pullRequest: { id: 'PR_x' } } } });
    expect(() => parseQueueMembership(partial)).toThrow(/merge queue membership/);
  });
});

describe('parseQueueTimeline', () => {
  type Timeline = { data: { repository: { pullRequest: { timelineItems: { nodes: Raw[] } } } } };
  const requeued = (): Timeline => JSON.parse(fixture('timeline-requeued-after-ejections.json')) as Timeline;

  function upTo(timeline: Timeline, count: number): string {
    const nodes = timeline.data.repository.pullRequest.timelineItems.nodes.slice(0, count);
    return JSON.stringify({ data: { repository: { pullRequest: { timelineItems: { nodes } } } } });
  }

  it('reads the last merge queue event of a pull request', () => {
    // Real sequence of zed PR 64552: ejected, re-queued, ejected, re-queued, merged.
    expect(parseQueueTimeline(upTo(requeued(), 1))).toBe('ejected');
    expect(parseQueueTimeline(upTo(requeued(), 2))).toBe('queued');
    expect(parseQueueTimeline(upTo(requeued(), 5))).toBe('none');
  });

  it('reads a commit as the end of any queue episode', () => {
    const timeline = JSON.parse(fixture('timeline-commit-then-ejection.json')) as Timeline;
    expect(parseQueueTimeline(upTo(timeline, 1))).toBe('none');
    expect(parseQueueTimeline(upTo(timeline, 3))).toBe('ejected');
    expect(parseQueueTimeline(upTo(timeline, 0))).toBe('none');
  });

  it('refuses an event it does not know', () => {
    const odd = { data: { repository: { pullRequest: { timelineItems: { nodes: [{ __typename: 'X' }] } } } } };
    expect(() => parseQueueTimeline(JSON.stringify(odd))).toThrow(/timeline/);
  });

  it('counts the ejections since the last commit, which a re-queue does not reset', () => {
    // Two `failed_checks` removals with no commit between them: the same head
    // was ejected twice, typically for a neighbour of its group.
    expect(parseEjections(upTo(requeued(), 1))).toBe(1);
    expect(parseEjections(upTo(requeued(), 2))).toBe(1);
    expect(parseEjections(upTo(requeued(), 3))).toBe(2);
    // The removal that merged it is no ejection.
    expect(parseEjections(upTo(requeued(), 5))).toBe(2);
    const afterCommit = JSON.parse(fixture('timeline-commit-then-ejection.json')) as Timeline;
    expect(parseEjections(upTo(afterCommit, 1))).toBe(0);
    expect(parseEjections(upTo(afterCommit, 3))).toBe(1);
  });
});

describe('parsePullRequestFiles', () => {
  // REST, unlike `gh pr view --json files`, reports where a renamed file came from.
  const restFiles = (): Raw[] => JSON.parse(fixture('pulls-files-rest.json')) as Raw[];

  it('reads each changed file, and the source of each rename', () => {
    const files = parsePullRequestFiles(fixture('pulls-files-rest.json'));
    expect(files).toHaveLength(35);
    expect(files).toContainEqual({
      path: 'packages/void-machine/schema/doctor-v1.json',
      previousPath: 'native/void-machine/schema/doctor-v1.json',
    });
    expect(files.filter((file) => file.previousPath !== undefined)).toHaveLength(2);
    expect(files).toContainEqual({ path: expect.any(String) });
  });

  it('refuses an entry without a file name', () => {
    const [first] = restFiles();
    const { filename: _dropped, ...nameless } = first as Raw;
    expect(() => parsePullRequestFiles(JSON.stringify([nameless]))).toThrow(/filename/);
  });
});

describe('observeGithub', () => {
  function runner(answers: Record<string, string>) {
    const calls: string[][] = [];
    const run = (args: readonly string[]): string => {
      calls.push([...args]);
      const key = Object.keys(answers).find((prefix) => args.join(' ').includes(prefix));
      if (key === undefined) throw new Error(`unexpected gh call: ${args.join(' ')}`);
      return answers[key] as string;
    };
    return { run, calls };
  }

  it('reads the queue once and each pull request with its queue event', () => {
    const { run, calls } = runner({
      'mergeQueue(branch': fixture('queue-present.json'),
      'defaultBranchRef': fixture('repo-view-default-branch.json'),
      'pr view 381': viewText('pr-view-open.json'),
      'timelineItems': fixture('timeline-requeued-after-ejections.json'),
      'isInMergeQueue': fixture('pr-queue-membership-absent.json'),
      'pulls/381/files': fixture('pulls-files-rest.json'),
    });
    const observed = observeGithub(run, { base: 'develop', pullRequests: [381] });
    expect(observed.mergeQueue).toBe(true);
    expect(observed.pullRequests.get(381)).toMatchObject({
      headSha: expect.any(String),
      queue: 'none',
      ejections: 2,
    });
    const views = calls.filter((call) => call[0] === 'pr' && call.includes('view'));
    expect(views).toHaveLength(1);
    // argv, never a shell string: the PR number and fields travel as separate words.
    expect(views[0]).toEqual([
      'pr', 'view', '381', '--json', PULL_REQUEST_FIELDS.join(','),
    ]);
  });

  it('takes whether a pull request sits in the queue from GitHub now, not from its timeline', () => {
    // A timeline window can miss the removal that followed an entry, and a
    // stale `queued` would have the loop disarm, every tick, a pull request
    // that `autopilot disarm` finds already out of the queue.
    const entered = JSON.stringify({
      data: { repository: { pullRequest: { timelineItems: { nodes: [{ __typename: 'AddedToMergeQueueEvent' }] } } } },
    });
    const observe = (timeline: string, membership: string) =>
      observeGithub(
        runner({
          'mergeQueue(branch': fixture('queue-present.json'),
          'defaultBranchRef': fixture('repo-view-default-branch.json'),
          'pr view 381': viewText('pr-view-open.json'),
          'timelineItems': timeline,
          'isInMergeQueue': fixture(membership),
              'pulls/381/files': fixture('pulls-files-rest.json'),
        }).run,
        { base: 'develop', pullRequests: [381] },
      ).pullRequests.get(381)?.queue;
    expect(observe(entered, 'pr-queue-membership-absent.json')).toBe('none');
    expect(observe(entered, 'pr-queue-membership-queued.json')).toBe('queued');
    const ejected = fixture('timeline-requeued-after-ejections.json');
    expect(observe(ejected, 'pr-queue-membership-queued.json')).toBe('queued');
  });

  it('never reads an Actions run: a failed review check is a failed check, not a job to re-run', () => {
    const view = openView();
    const [run] = view.statusCheckRollup as Raw[];
    const failed = { ...run, name: 'independent-review', conclusion: 'FAILURE' };
    const { run: gh, calls } = runner({
      'mergeQueue(branch': fixture('queue-present.json'),
      'defaultBranchRef': fixture('repo-view-default-branch.json'),
      'pr view 381': withRollup(view, [...(view.statusCheckRollup as Raw[]), failed]),
      'timelineItems': fixture('timeline-requeued-after-ejections.json'),
      'isInMergeQueue': fixture('pr-queue-membership-absent.json'),
      'pulls/381/files': fixture('pulls-files-rest.json'),
    });
    expect(observeGithub(gh, { base: 'develop', pullRequests: [381] }).pullRequests.get(381))
      .toMatchObject({ checks: 'failing' });
    expect(calls.find((call) => call[0] === 'run')).toBeUndefined();
  });

  describe('the files of a pull request', () => {
    // A page of 100 entries, derived from the real capture.
    const fullPage = (): string => {
      const entries = JSON.parse(fixture('pulls-files-rest.json')) as Raw[];
      return JSON.stringify(
        Array.from({ length: 100 }, (_, index) => ({
          ...entries[index % entries.length],
          filename: `docs/page/${index}.md`,
        })),
      );
    };
    function observeFiles(changedFiles: number, page: () => string) {
      const calls: string[][] = [];
      const run = (args: readonly string[]): string => {
        calls.push([...args]);
        const line = args.join(' ');
        if (line.includes('mergeQueue(branch')) return fixture('queue-present.json');
        if (line.includes('defaultBranchRef')) return fixture('repo-view-default-branch.json');
        if (line.includes('pr view 381')) return JSON.stringify({ ...openView(), changedFiles });
        if (line.includes('timelineItems')) return fixture('timeline-requeued-after-ejections.json');
        if (line.includes('isInMergeQueue')) return fixture('pr-queue-membership-absent.json');
        if (line.includes('pulls/381/files')) return page();
        throw new Error(`unexpected gh call: ${line}`);
      };
      const observed = observeGithub(run, { base: 'develop', pullRequests: [381] }).pullRequests.get(381);
      return { observed, pages: calls.filter((call) => call.join(' ').includes('pulls/381/files')) };
    }

    it('reads them through REST, sources of renames included', () => {
      const { observed, pages } = observeFiles(35, () => fixture('pulls-files-rest.json'));
      expect(pages).toEqual([['api', 'repos/{owner}/{repo}/pulls/381/files?per_page=100&page=1']]);
      expect(observed?.files).toHaveLength(35);
      expect(observed?.files).toContainEqual({
        path: 'packages/cli/src/lib/autopilot/durable-run-v1.json',
        previousPath: 'native/void-machine/schema/durable-run-v1.json',
      });
    });

    it('reads every page GitHub counts', () => {
      const { observed, pages } = observeFiles(250, fullPage);
      expect(pages).toHaveLength(3);
      expect(pages.at(-1)).toEqual(['api', 'repos/{owner}/{repo}/pulls/381/files?per_page=100&page=3']);
      expect(observed?.files).toHaveLength(300);
    });

    it('stops at its bound, and leaves the list short for the kernel to refuse', () => {
      const changedFiles = (PULL_REQUEST_FILE_PAGES_MAX + 5) * 100;
      const { observed, pages } = observeFiles(changedFiles, fullPage);
      expect(pages).toHaveLength(PULL_REQUEST_FILE_PAGES_MAX);
      expect(observed?.files.length).toBeLessThan(changedFiles);
    });
  });

  it('reads the default branch once, the one that deploys when the programme names none', () => {
    const { run, calls } = runner({
      'mergeQueue(branch': fixture('queue-present.json'),
      'defaultBranchRef': fixture('repo-view-default-branch.json'),
    });
    expect(observeGithub(run, { base: 'develop', pullRequests: [] }).defaultBranch).toBe('main');
    expect(calls.filter((call) => call.join(' ') === 'repo view --json defaultBranchRef')).toHaveLength(1);
  });

  describe('without a merge queue', () => {
    // The loop merges one pull request at a time and brings the base into a
    // head the base moved past, so it reads that itself: GitHub reports BEHIND
    // only under a protection that requires it.
    function observe(compare: string, mergeQueue = false) {
      const { run, calls } = runner({
        'mergeQueue(branch': fixture(mergeQueue ? 'queue-present.json' : 'queue-absent.json'),
        'defaultBranchRef': fixture('repo-view-default-branch.json'),
        'pr view 381': viewText('pr-view-open.json'),
        'timelineItems': fixture('timeline-requeued-after-ejections.json'),
        'isInMergeQueue': fixture('pr-queue-membership-absent.json'),
        'pulls/381/files': fixture('pulls-files-rest.json'),
        '/compare/': fixture(compare),
      });
      const observed = observeGithub(run, { base: 'develop', pullRequests: [381] });
      return { observed, compares: calls.filter((call) => call.join(' ').includes('/compare/')) };
    }

    it('reads a head the base moved past as behind, whatever the protection says', () => {
      const { observed, compares } = observe('compare-behind.json');
      expect(observed.mergeQueue).toBe(false);
      expect(observed.pullRequests.get(381)?.behind).toBe(true);
      const head = observed.pullRequests.get(381)?.headSha as string;
      expect(compares).toEqual([[
        'api', `repos/{owner}/{repo}/compare/develop...${head}`,
        '--jq', '{behind_by: .behind_by, ahead_by: .ahead_by, status: .status}',
      ]]);
    });

    it('reads a head that contains its base as up to date', () => {
      expect(observe('compare-ahead.json').observed.pullRequests.get(381)?.behind).toBe(false);
    });

    it('asks nothing more of a base with no protection at all', () => {
      // 4.0 refused the tick here unless the base required branches up to date,
      // which no consumer project had set up.
      expect(() => observe('compare-ahead.json')).not.toThrow();
    });

    it('leaves the comparison to the queue when there is one', () => {
      expect(observe('compare-behind.json', true).compares).toEqual([]);
    });
  });

  it('refuses to decide on a partial observation', () => {
    const run = (args: readonly string[]): string => {
      if (args.includes('defaultBranchRef')) return fixture('repo-view-default-branch.json');
      if (args.includes('view')) throw new Error('HTTP 502');
      return fixture('queue-absent.json');
    };
    expect(() => observeGithub(run, { base: 'develop', pullRequests: [7] })).toThrow(/#7/);
  });

  it('refuses more pull requests than a loop can hold slots for', () => {
    const run = (): string => fixture('queue-absent.json');
    const many = Array.from({ length: 33 }, (_, index) => index + 1);
    expect(() => observeGithub(run, { base: 'develop', pullRequests: many })).toThrow(/at most/);
  });
});

describe('resolveLoopBase', () => {
  it('keeps a named base and resolves auto to develop, then main', () => {
    const none = (): string => {
      throw new Error('no call expected');
    };
    expect(resolveLoopBase(none, 'develop')).toBe('develop');
    const onlyMain = (args: readonly string[]): string => {
      if (args.some((arg) => arg.endsWith('/branches/main'))) return 'b'.repeat(40);
      throw new Error('gh: Not Found (HTTP 404)');
    };
    expect(resolveLoopBase(onlyMain, 'auto')).toBe('main');
    const neither = (): string => {
      throw new Error('gh: Not Found (HTTP 404)');
    };
    expect(() => resolveLoopBase(neither, 'auto')).toThrow(/base/);
  });
});

describe('readSharedState', () => {
  // Real git on a scratch repository: the fingerprint is only worth what the
  // commands it runs actually report, so no double stands in for git here.
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function repository(): string {
    const root = mkdtempSync(join(tmpdir(), 'void-loop-shared-'));
    roots.push(root);
    const git = (...args: string[]) =>
      spawnSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=t', ...args], { cwd: root });
    git('init', '-q');
    writeFileSync(join(root, 'a.txt'), 'a\n');
    git('add', 'a.txt');
    git('commit', '-qm', 'init');
    return root;
  }

  const fingerprint = (root: string) =>
    fingerprintOf(readSharedState(gitIn(root), { bases: ['develop'] }), ['develop']);
  const git = (root: string, ...args: string[]) =>
    spawnSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=t', ...args], { cwd: root });

  it('sees every shared part a unit can change', () => {
    const root = repository();
    const before = fingerprint(root);
    git(root, 'tag', 'v1');
    git(root, 'notes', 'add', '-m', 'note');
    git(root, 'remote', 'add', 'mirror', 'https://example.test/m.git');
    writeFileSync(join(root, 'a.txt'), 'changed\n');
    git(root, 'stash', 'push', '-q');
    git(root, 'config', 'core.hooksPath', '/tmp/elsewhere');
    expect(changedParts(before, fingerprint(root)).sort()).toEqual(
      ['config', 'notes', 'remotes', 'stash', 'tags'],
    );
  });

  it('sees what a worktree shares beyond config and refs: base, replacements, hooks, info', () => {
    const root = repository();
    const included = `${root}-included.cfg`;
    roots.push(included);
    writeFileSync(included, '[user]\n\tname = before\n');
    git(root, 'config', 'include.path', included);
    git(root, 'branch', 'develop');
    const before = fingerprint(root);
    // Each is shared by every worktree and none shows in a worker's diff.
    git(root, 'commit', '-q', '--allow-empty', '-m', 'second');
    git(root, 'branch', '-f', 'develop', 'HEAD');
    git(root, 'replace', 'HEAD', 'HEAD~1');
    writeFileSync(join(root, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\nexit 0\n');
    appendFileSync(join(root, '.git', 'info', 'exclude'), 'secret/\n');
    writeFileSync(included, '[user]\n\tname = after\n');
    expect(changedParts(before, fingerprint(root)).sort()).toEqual(
      ['bases', 'config', 'hooks', 'info', 'replace'],
    );
  });

  it('counts an upstream set on the base, which a later pull of the base would follow', () => {
    const root = repository();
    git(root, 'branch', 'develop');
    const before = fingerprint(root);
    git(root, 'config', 'branch.develop.remote', '.');
    git(root, 'config', 'branch.develop.merge', 'refs/heads/work/dev-1');
    expect(changedParts(before, fingerprint(root))).toEqual(['config']);
  });

  it('ignores the branch a worker pushes and reads the same state from its worktree', () => {
    const root = repository();
    const before = fingerprint(root);
    const linked = join(root, '..', `${root.split('/').at(-1) ?? 'x'}-wt`);
    roots.push(linked);
    git(root, 'worktree', 'add', '-q', linked, '-b', 'work/dev-1');
    git(linked, 'config', 'branch.work/dev-1.remote', 'origin');
    expect(changedParts(before, fingerprint(linked))).toEqual([]);
  });

  it('lets units in flight add, push and delete branches without refusing each other', () => {
    // The three gestures of parallel units, on real git: a worktree created from
    // the remote base (which sets its upstream), a `push -u`, and the removal of
    // a merged ticket's branch. None may count against a neighbour's unit.
    const root = repository();
    const origin = `${root}-origin.git`;
    roots.push(origin);
    spawnSync('git', ['init', '-q', '--bare', origin]);
    git(root, 'branch', 'develop');
    git(root, 'remote', 'add', 'origin', origin);
    git(root, 'push', '-q', 'origin', 'develop');
    git(root, 'branch', 'work/dev-0', 'develop');
    git(root, 'push', '-q', '-u', 'origin', 'work/dev-0');
    const unitA = fingerprint(root);
    const linked = join(root, '..', `${root.split('/').at(-1) ?? 'x'}-dev-2`);
    roots.push(linked);
    git(root, 'worktree', 'add', '-q', '-b', 'work/dev-2', linked, 'origin/develop');
    expect(git(root, 'config', 'branch.work/dev-2.merge').stdout.toString().trim()).toBe('refs/heads/develop');
    const unitB = fingerprint(linked);
    git(linked, 'commit', '-q', '--allow-empty', '-m', 'b');
    git(linked, 'push', '-q', '-u', 'origin', 'work/dev-2');
    git(root, 'branch', '-D', 'work/dev-0');
    expect(changedParts(unitA, fingerprint(root))).toEqual([]);
    expect(changedParts(unitB, fingerprint(linked))).toEqual([]);
    // The base's own upstream is still everyone's: moved, it refuses both units.
    git(root, 'config', 'branch.develop.merge', 'refs/heads/work/dev-2');
    expect(changedParts(unitA, fingerprint(root))).toEqual(['config']);
    expect(changedParts(unitB, fingerprint(linked))).toEqual(['config']);
  });

  it('refuses to fingerprint outside a repository', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-loop-none-'));
    roots.push(root);
    expect(() => readSharedState(gitIn(root), { bases: ['develop'] })).toThrow(/shared Git state/);
  });
});
