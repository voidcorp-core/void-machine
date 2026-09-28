import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderJudgmentComment } from '../lib/autopilot/judgment-comment.js';
import { gitIn } from '../lib/autopilot/loop-observe.js';
import { type AutopilotCommandContext, runAutopilotCommand } from './autopilot.js';

// The loop commands run in process against a real scratch repository (git is
// what the fingerprint is worth) and a gh runner answering with real captures.

const FIXTURES = new URL('../lib/autopilot/__fixtures__/gh/', import.meta.url);
const fixture = (name: string): string => readFileSync(new URL(name, FIXTURES), 'utf8');
const NOW = '2026-09-22T12:00:00.000Z';

const PROGRAM = `---
schemaVersion: 1
status: executing
program: loop
plan: docs/plans/p.md
spec: docs/specs/s.md
progress:
  provider: linear
  scope: voidcorp/DEV
  order: [DEV-1]
  states:
    ready: [Todo]
    started: [In Progress]
    review: [In Review]
    done: [Done]
autopilot:
  schemaVersion: 1
  clusterSize: 4
  base: develop
  mergeGate: union-reviewed
  deployBranch: main
---
`;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(root: string, ...args: string[]) {
  return spawnSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=t', ...args], { cwd: root });
}

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'vh-autopilot-loop-'));
  roots.push(root);
  git(root, 'init', '-q');
  mkdirSync(join(root, '.void'));
  // What the harness install ignores: the loop's local state lives there.
  writeFileSync(join(root, '.gitignore'), '.void/machine/\n');
  writeFileSync(join(root, '.void', 'program.md'), PROGRAM);
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'init');
  return root;
}

/**
 * Pull request 11, open on `work/DEV-1` against develop, its checks passing and
 * a verdict block posted beside them, by `reviewer` or the Actions bot: a copy
 * for humans the loop never reads.
 */
function reviewedPull(
  options: { head?: string; armed?: boolean; queued?: boolean; reviewer?: string } = {},
): string {
  const view = JSON.parse(fixture('pr-view-open.json')) as Record<string, unknown>;
  const rollup = view.statusCheckRollup as Record<string, unknown>[];
  const review = { ...rollup[0], name: 'independent-review', conclusion: 'SUCCESS' };
  const { comments } = JSON.parse(fixture('pr-view-comments.json')) as { comments: Record<string, unknown>[] };
  return JSON.stringify({
    ...view,
    number: 11,
    headRefName: 'work/DEV-1',
    baseRefName: 'develop',
    mergeStateStatus: 'BLOCKED',
    ...(options.head === undefined ? {} : { headRefOid: options.head }),
    ...(options.armed === true ? { autoMergeRequest: armedRequest() } : {}),
    ...(options.queued === true ? queuedView() : {}),
    statusCheckRollup: [...rollup, review],
    comments: [...comments, {
      ...comments[0],
      body: renderJudgmentComment('review-verdict', cleanVerdict),
      author: { login: options.reviewer ?? 'github-actions' },
    }],
    changedFiles: 1,
  });
}

/** The auto-merge request of a real armed pull request, as gh reports it. */
function armedRequest(): unknown {
  return (JSON.parse(fixture('pr-view-auto-merge.json')) as { autoMergeRequest: unknown }).autoMergeRequest;
}

/**
 * What gh reports of a real pull request sitting in a merge queue: no auto-merge
 * request. `isInMergeQueue`, read through GraphQL, is the only sign it is armed.
 */
function queuedView(): Record<string, unknown> {
  const { autoMergeRequest } = JSON.parse(fixture('pr-view-queued.json')) as Record<string, unknown>;
  return { autoMergeRequest };
}

/** Pull request 11's merge queue membership, from a real queued or unqueued answer. */
function membership(queued: boolean): string {
  const answer = fixture(`pr-queue-membership-${queued ? 'queued' : 'absent'}.json`);
  return answer.replace(/"id":"[^"]+"/, `"id":"${PULL_NODE_ID}"`);
}

const PULL_NODE_ID = 'PR_kwDOSrTydc8AAAABDn7FaQ';

/** The one file pull request 11 changes, on the shape REST reports it. */
function pullFiles(): string {
  const [entry] = JSON.parse(fixture('pulls-files-rest.json')) as Record<string, unknown>[];
  return JSON.stringify([{ ...entry, filename: 'packages/dev-1/index.ts', status: 'modified' }]);
}

const gh = (args: readonly string[]): string => answer(args);

function answer(args: readonly string[], view: string = reviewedPull()): string {
  const line = args.join(' ');
  if (line.includes('mergeQueue(branch')) return fixture('queue-present.json');
  if (line.includes('pr view 11')) return view;
  if (line.includes('pulls/11/files')) return pullFiles();
  if (line.includes('isInMergeQueue')) return membership(false);
  if (line.includes('timelineItems')) return fixture('timeline-commit-then-ejection.json').replace(
    /"nodes":\[.*\]/,
    '"nodes":[{"__typename":"PullRequestCommit","commit":{"oid":"x"}}]',
  );
  throw new Error(`unexpected gh call: ${line}`);
}

function unreachableGh(): string {
  throw new Error('gh must not be called');
}

function context(root: string, runner: (args: readonly string[]) => string = gh): AutopilotCommandContext {
  return { root, now: NOW, gh: runner, git: gitIn(root) };
}

const ready = { verdict: 'ready', reason: 'Scope and acceptance are explicit.' };

function trackerJson(tickets: readonly Record<string, unknown>[], queued: readonly string[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    queue: {
      entries: queued.map((ticketId) => ({
        ticketId,
        justification: 'Next in line for the loop.',
        footprint: [`packages/${ticketId.toLowerCase()}`],
      })),
    },
    tickets,
    recent: [],
    liveWorkers: [],
    quota: 'ok',
  });
}

const heldTicket = {
  id: 'DEV-1',
  status: 'In Review',
  humanWait: false,
  pullRequest: 11,
  branch: 'work/DEV-1',
  footprint: ['packages/dev-1'],
};

const HEAD = 'ca7fdc0008c5b597224c37b195e2a0ba0cd58e63';
const cleanVerdict = { headSha: HEAD, round: 1, blocking: [], advisory: [] };
const queuedTicket = { id: 'DEV-2', status: 'Todo', humanWait: false, readiness: ready };

const RUN = 'run_00000000-0000-4000-8000-000000000001';
const SESSION = '6d5ea8bb-764f-4463-b733-8b94509eb25e';

/** What `autopilot review` records once a reviewer passed pull request 11 on `head`. */
function recordLocalVerdict(root: string, head = HEAD, verdict: unknown = { ...cleanVerdict, headSha: head }): string {
  const directory = join(root, '.void', 'machine', 'autopilot', 'reviews', 'DEV-1');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${head}.json`);
  writeFileSync(path, JSON.stringify({
    schemaVersion: 1,
    ticketId: 'DEV-1',
    pullRequest: 11,
    headSha: head,
    attempts: [{ runId: RUN, startedAt: 1, endedAt: 2 }],
    verdict: { runId: RUN, sessionId: SESSION, recordedAt: 2, verdict },
  }));
  return path;
}

function next(root: string, stdin: string, runner?: (args: readonly string[]) => string) {
  const result = runAutopilotCommand(['next', '--json'], stdin, context(root, runner));
  return { ...result, decision: result.exitCode === 0 ? JSON.parse(result.stdout) : undefined };
}

describe('autopilot next', () => {
  it('seats the head of the queue and arms the merge of a unit with a clean local verdict', () => {
    const root = project();
    expect(runAutopilotCommand(['fingerprint', '--before', 'DEV-1'], '', context(root)).exitCode).toBe(0);
    recordLocalVerdict(root);
    const { decision } = next(root, trackerJson([heldTicket, queuedTicket], ['DEV-2']), gh);
    expect(decision.actions).toEqual([
      {
        kind: 'enable-auto-merge',
        ticketId: 'DEV-1',
        pullRequest: 11,
        headSha: 'ca7fdc0008c5b597224c37b195e2a0ba0cd58e63',
      },
      { kind: 'assign', ticketId: 'DEV-2', footprint: ['packages/dev-2'] },
    ]);
  });

  it('withholds the merge of a unit that changed the shared Git state', () => {
    const root = project();
    runAutopilotCommand(['fingerprint', '--before', 'DEV-1'], '', context(root));
    recordLocalVerdict(root);
    git(root, 'tag', 'stray');
    const { decision } = next(root, trackerJson([heldTicket], []), gh);
    expect(decision.actions[0]).toMatchObject({
      kind: 'mark-human-wait',
      reason: 'shared-state-changed',
      detail: expect.stringMatching(/tags/),
    });
  });

  it('delegates a review, whatever verdict GitHub shows, while none is recorded for the head', () => {
    // On a public repository anyone can comment, and any workflow can post a
    // check under the review's name: the loop decides on its local verdict.
    const root = project();
    runAutopilotCommand(['fingerprint', '--before', 'DEV-1'], '', context(root));
    for (const reviewer of ['github-actions', 'folpe']) {
      const posted = (args: readonly string[]) => answer(args, reviewedPull({ reviewer }));
      const { decision } = next(root, trackerJson([heldTicket], []), posted);
      expect(decision.actions[0]).toEqual({ kind: 'review', ticketId: 'DEV-1', pullRequest: 11, headSha: HEAD });
    }
    recordLocalVerdict(root, 'b'.repeat(40));
    const { decision } = next(root, trackerJson([heldTicket], []), gh);
    expect(decision.actions[0]).toMatchObject({ kind: 'review', headSha: HEAD });
  });

  it('sends a local record it cannot read to a human, never to a merge', () => {
    const root = project();
    runAutopilotCommand(['fingerprint', '--before', 'DEV-1'], '', context(root));
    writeFileSync(recordLocalVerdict(root), '{ half a record');
    const { decision } = next(root, trackerJson([heldTicket], []), gh);
    expect(decision.actions[0]).toMatchObject({ kind: 'mark-human-wait', reason: 'verdict-unproven' });
  });

  it('refuses a tracker observation with the field at fault', () => {
    const result = next(project(), JSON.stringify({ schemaVersion: 1 }));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/tracker observation was refused/);
  });

  it('refuses to run without a programme', () => {
    const root = project();
    rmSync(join(root, '.void', 'program.md'));
    const result = next(root, trackerJson([], []));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/AUTOPILOT_PROGRAM/);
  });
});

describe('autopilot judgment', () => {
  it('prints the comment block of a judgment it admits', () => {
    const result = runAutopilotCommand(['judgment', 'conflict-class'], JSON.stringify({
      headSha: HEAD,
      class: 'mechanical',
      reason: 'Both sides appended to one list.',
    }));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^<!-- void-autopilot:conflict-class -->\n```json\n/);
    expect(result.stdout).toContain('<!-- /void-autopilot:conflict-class -->');
  });

  it('refuses a judgment it would not admit, and a kind it does not know', () => {
    const unbound = runAutopilotCommand(['judgment', 'conflict-class'], JSON.stringify({ class: 'mechanical' }));
    expect(unbound.exitCode).toBe(2);
    expect(unbound.stderr).toMatch(/headSha/);
    const unknown = runAutopilotCommand(['judgment', 'opinion'], '{}');
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stderr).toMatch(/conflict-class/);
  });

  it('renders no review verdict: `autopilot review` is its only writer', () => {
    const result = runAutopilotCommand(['judgment', 'review-verdict'], JSON.stringify(cleanVerdict));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/autopilot review/);
  });
});

describe('autopilot arm and disarm', () => {
  // GitHub exposes no armed head and keeps an auto-merge armed across a push by
  // anyone with write access, so the loop records the head it armed and the
  // kernel disarms what it can no longer vouch for.
  const armedPath = (root: string) => join(root, '.void', 'machine', 'autopilot', 'armed', 'DEV-1.json');

  /**
   * A gh answering each `pr view` with the next view given, each merge queue
   * read with the next membership (out of the queue once they run out), and
   * recording every call.
   */
  function sequence(views: readonly string[], queued: readonly boolean[] = []) {
    const calls: string[][] = [];
    const [pending, memberships] = [[...views], [...queued]];
    const isRead = (args: readonly string[]) =>
      (args[0] === 'pr' && args[1] === 'view') || args.some((arg) => arg.includes('isInMergeQueue'));
    const run = (args: readonly string[]): string => {
      calls.push([...args]);
      if (args[0] === 'pr' && args[1] === 'view') return pending.shift() ?? '';
      if (isRead(args)) return membership(memberships.shift() ?? false);
      return '';
    };
    return { run, calls, writes: () => calls.filter((call) => !isRead(call)) };
  }

  const dequeue = (call: readonly string[] | undefined) =>
    call !== undefined &&
    call.includes(`id=${PULL_NODE_ID}`) &&
    call.some((arg) => arg.includes('dequeuePullRequest'));

  it('records the head, arms on exactly that head, and checks GitHub armed it', () => {
    const root = project();
    const gh = sequence([reviewedPull(), reviewedPull({ armed: true })]);
    const argv = ['arm', '--ticket', 'DEV-1', '--pr', '11', '--head', HEAD, '--json'];
    const result = runAutopilotCommand(argv, '', { ...context(root), gh: gh.run });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(gh.writes()).toEqual([['pr', 'merge', '11', '--auto', '--match-head-commit', HEAD]]);
    expect(JSON.parse(readFileSync(armedPath(root), 'utf8'))).toEqual({ pullRequest: 11, headSha: HEAD });
  });

  it('arms nothing on a head the pull request has moved past', () => {
    const root = project();
    const gh = sequence([reviewedPull({ head: 'b'.repeat(40) })]);
    const argv = ['arm', '--ticket', 'DEV-1', '--pr', '11', '--head', HEAD];
    const result = runAutopilotCommand(argv, '', { ...context(root), gh: gh.run });
    expect(result.exitCode).toBe(2);
    expect(gh.writes()).toEqual([]);
    expect(existsSync(armedPath(root))).toBe(false);
  });

  it('fails when GitHub did not arm it, and disarms at once if the head moved meanwhile', () => {
    const root = project();
    const unarmed = sequence([reviewedPull(), reviewedPull()]);
    const argv = ['arm', '--ticket', 'DEV-1', '--pr', '11', '--head', HEAD];
    expect(runAutopilotCommand(argv, '', { ...context(root), gh: unarmed.run }).stderr).toMatch(/not armed/);
    const moved = sequence([reviewedPull(), reviewedPull({ armed: true, head: 'b'.repeat(40) })]);
    const result = runAutopilotCommand(argv, '', { ...context(root), gh: moved.run });
    expect(result.exitCode).toBe(2);
    expect(moved.writes().at(-1)).toEqual(['pr', 'merge', '11', '--disable-auto']);
  });

  it('disarms, then checks GitHub no longer holds the auto-merge', () => {
    const root = project();
    const gh = sequence([reviewedPull({ armed: true }), reviewedPull()]);
    const result = runAutopilotCommand(['disarm', '--pr', '11', '--json'], '', { ...context(root), gh: gh.run });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(gh.writes()).toEqual([['pr', 'merge', '11', '--disable-auto']]);
    expect(JSON.parse(result.stdout)).toMatchObject({ pullRequest: 11, disarmed: true });
    const idle = sequence([reviewedPull()]);
    expect(runAutopilotCommand(['disarm', '--pr', '11'], '', { ...context(root), gh: idle.run }).exitCode).toBe(0);
    expect(idle.writes()).toEqual([]);
    const stuck = sequence([reviewedPull({ armed: true }), reviewedPull({ armed: true })]);
    const refused = runAutopilotCommand(['disarm', '--pr', '11'], '', { ...context(root), gh: stuck.run });
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toMatch(/still armed/);
  });

  it('counts a pull request GitHub put straight into the merge queue as armed', () => {
    // Once the checks pass, arming on a base with a merge queue queues the pull
    // request and leaves no auto-merge request behind.
    const root = project();
    const gh = sequence([reviewedPull(), reviewedPull({ queued: true })], [true]);
    const argv = ['arm', '--ticket', 'DEV-1', '--pr', '11', '--head', HEAD, '--json'];
    const result = runAutopilotCommand(argv, '', { ...context(root), gh: gh.run });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(gh.writes()).toEqual([['pr', 'merge', '11', '--auto', '--match-head-commit', HEAD]]);
  });

  it('takes a queued pull request out of the merge queue, which --disable-auto leaves alone', () => {
    const root = project();
    const gh = sequence([reviewedPull({ queued: true }), reviewedPull()], [true, false]);
    const result = runAutopilotCommand(['disarm', '--pr', '11', '--json'], '', { ...context(root), gh: gh.run });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(gh.writes()).toHaveLength(1);
    expect(dequeue(gh.writes()[0])).toBe(true);
    expect(JSON.parse(result.stdout)).toMatchObject({ pullRequest: 11, disarmed: true });
    const stuck = sequence([reviewedPull({ queued: true }), reviewedPull()], [true, true]);
    const refused = runAutopilotCommand(['disarm', '--pr', '11'], '', { ...context(root), gh: stuck.run });
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toMatch(/still armed/);
  });

  it('turns the auto-merge off before it dequeues, so GitHub cannot queue it again in between', () => {
    const root = project();
    const both = reviewedPull({ armed: true, queued: false });
    const gh = sequence([both, reviewedPull()], [true, false]);
    const result = runAutopilotCommand(['disarm', '--pr', '11'], '', { ...context(root), gh: gh.run });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(gh.writes()[0]).toEqual(['pr', 'merge', '11', '--disable-auto']);
    expect(dequeue(gh.writes()[1])).toBe(true);
    expect(gh.writes()).toHaveLength(2);
  });

  it('succeeds when GitHub merged the head it armed before the read back', () => {
    const root = project();
    const merged = JSON.stringify({ ...(JSON.parse(reviewedPull()) as Record<string, unknown>), state: 'MERGED' });
    const gh = sequence([reviewedPull(), merged]);
    const argv = ['arm', '--ticket', 'DEV-1', '--pr', '11', '--head', HEAD];
    const result = runAutopilotCommand(argv, '', { ...context(root), gh: gh.run });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/#11 merged on/);
  });

  it('has next disarm and hand back a pull request pushed after it was armed', () => {
    const root = project();
    runAutopilotCommand(['fingerprint', '--before', 'DEV-1'], '', context(root));
    recordLocalVerdict(root);
    const arming = sequence([reviewedPull(), reviewedPull({ armed: true })]);
    const argv = ['arm', '--ticket', 'DEV-1', '--pr', '11', '--head', HEAD];
    expect(runAutopilotCommand(argv, '', { ...context(root), gh: arming.run }).exitCode).toBe(0);
    const moved = (args: readonly string[]): string =>
      args.join(' ').includes('pr view 11')
        ? reviewedPull({ armed: true, head: 'b'.repeat(40) })
        : answer(args);
    const { decision } = next(root, trackerJson([heldTicket], []), moved);
    expect(decision.actions.slice(0, 2)).toEqual([
      { kind: 'disable-auto-merge', ticketId: 'DEV-1', pullRequest: 11, headSha: 'b'.repeat(40), armedSha: HEAD },
      { kind: 'hand-back-to-worker', ticketId: 'DEV-1', reason: 'head-moved-after-arming', pullRequest: 11 },
    ]);
  });
});

describe('autopilot stop', () => {
  it('drains on request: nothing new is seated, and the signal is a file anyone can write', () => {
    const root = project();
    const stop = runAutopilotCommand(['stop', '--drain'], '', context(root));
    expect(stop.exitCode).toBe(0);
    expect(readFileSync(join(root, '.void', 'machine', 'autopilot', 'stop'), 'utf8')).toBe('drain\n');
    const { decision } = next(root, trackerJson([queuedTicket], ['DEV-2']));
    expect(decision.actions).toEqual([
      { kind: 'drain', reason: 'requested' },
      { kind: 'recap', merged: [], humanWait: [] },
    ]);
  });

  it('prints in the text recap why each ticket went to a human', () => {
    const root = project();
    runAutopilotCommand(['stop', '--drain'], '', context(root));
    const withRecent = JSON.stringify({
      ...(JSON.parse(trackerJson([], [])) as Record<string, unknown>),
      recent: [{ ticketId: 'DEV-0', outcome: 'human-wait', reason: 'branch-missing' }],
    });
    const result = runAutopilotCommand(['next'], withRecent, context(root));
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('recap: merged none; waiting DEV-0 (branch-missing)');
  });

  it('freezes without asking GitHub anything when no pull request is in flight', () => {
    const root = project();
    runAutopilotCommand(['stop', '--now'], '', context(root));
    const { decision } = next(root, trackerJson([queuedTicket], ['DEV-2']), unreachableGh);
    expect(decision.actions).toEqual([{ kind: 'freeze' }]);
  });

  it('disarms every armed pull request before it freezes, a proven one included', () => {
    // Freezing means nothing moves; a merge GitHub runs on its own moves develop.
    const root = project();
    runAutopilotCommand(['stop', '--now'], '', context(root));
    const armed = (args: readonly string[]) => {
      if (args.join(' ').includes('pr view 11')) return reviewedPull({ armed: true });
      return args.some((arg) => arg.includes('isInMergeQueue')) ? membership(false) : unreachableGh();
    };
    const { decision } = next(root, trackerJson([heldTicket, queuedTicket], ['DEV-2']), armed);
    expect(decision.actions).toEqual([
      { kind: 'disable-auto-merge', ticketId: 'DEV-1', pullRequest: 11, headSha: HEAD },
      { kind: 'freeze' },
    ]);
  });

  it('disarms a pull request sitting in the merge queue before it freezes', () => {
    const root = project();
    runAutopilotCommand(['stop', '--now'], '', context(root));
    const queued = (args: readonly string[]) => {
      if (args.join(' ').includes('pr view 11')) return reviewedPull({ queued: true });
      return args.some((arg) => arg.includes('isInMergeQueue')) ? membership(true) : unreachableGh();
    };
    const { decision } = next(root, trackerJson([heldTicket, queuedTicket], ['DEV-2']), queued);
    expect(decision.actions).toEqual([
      { kind: 'disable-auto-merge', ticketId: 'DEV-1', pullRequest: 11, headSha: HEAD },
      { kind: 'freeze' },
    ]);
  });

  it('refuses to freeze while it cannot tell what GitHub would still merge, and says so', () => {
    const root = project();
    runAutopilotCommand(['stop', '--now'], '', context(root));
    const result = next(root, trackerJson([heldTicket], []), unreachableGh);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/cannot freeze/);
    expect(result.stderr).toMatch(/#11: turn off its auto-merge and take it out of the merge queue/);
  });

  it('needs exactly one of --drain and --now', () => {
    const root = project();
    expect(runAutopilotCommand(['stop'], '', context(root)).exitCode).toBe(2);
    expect(runAutopilotCommand(['stop', '--drain', '--now'], '', context(root)).exitCode).toBe(2);
    expect(existsSync(join(root, '.void', 'machine', 'autopilot', 'stop'))).toBe(false);
  });
});

describe('autopilot fingerprint', () => {
  it('passes a unit that left the shared state alone and fails one that did not', () => {
    const root = project();
    runAutopilotCommand(['fingerprint', '--before', 'DEV-1'], '', context(root));
    expect(runAutopilotCommand(['fingerprint', '--after', 'DEV-1'], '', context(root)).exitCode).toBe(0);
    git(root, 'remote', 'add', 'mirror', 'https://example.test/m.git');
    const after = runAutopilotCommand(['fingerprint', '--after', 'DEV-1'], '', context(root));
    expect(after.exitCode).toBe(2);
    expect(after.stderr).toMatch(/remotes/);
  });

  it('records a baseline once: a second --before cannot launder a change', () => {
    const root = project();
    expect(runAutopilotCommand(['fingerprint', '--before', 'DEV-1'], '', context(root)).exitCode).toBe(0);
    git(root, 'remote', 'add', 'mirror', 'https://example.test/m.git');
    const again = runAutopilotCommand(['fingerprint', '--before', 'DEV-1'], '', context(root));
    expect(again.exitCode).toBe(2);
    expect(again.stderr).toMatch(/already recorded/);
    const after = runAutopilotCommand(['fingerprint', '--after', 'DEV-1'], '', context(root));
    expect(after.exitCode).toBe(2);
    expect(after.stderr).toMatch(/remotes/);
  });

  it("leaves out the upstream of every unit's branch, never the base's", () => {
    const root = project();
    expect(runAutopilotCommand(['fingerprint', '--before', 'DEV-1'], '', context(root)).exitCode).toBe(0);
    git(root, 'config', 'branch.work/DEV-1.remote', 'origin');
    git(root, 'config', 'branch.work/DEV-2.merge', 'refs/heads/develop');
    expect(runAutopilotCommand(['fingerprint', '--after', 'DEV-1'], '', context(root)).exitCode).toBe(0);
    git(root, 'config', 'branch.develop.merge', 'refs/heads/work/DEV-2');
    const moved = runAutopilotCommand(['fingerprint', '--after', 'DEV-1'], '', context(root));
    expect(moved.exitCode).toBe(2);
    expect(moved.stderr).toMatch(/config/);
  });

  it('records digests, never the content they were taken from', () => {
    const root = project();
    git(root, 'remote', 'add', 'origin', 'https://token@example.test/r.git');
    runAutopilotCommand(['fingerprint', '--before', 'DEV-1'], '', context(root));
    const record = readFileSync(join(root, '.void', 'machine', 'autopilot', 'fingerprints', 'DEV-1.json'), 'utf8');
    expect(record).not.toMatch(/token|example/);
  });

  it('fails a unit whose baseline was never recorded, and a ticket that is not one', () => {
    const root = project();
    const unrecorded = runAutopilotCommand(['fingerprint', '--after', 'DEV-9'], '', context(root));
    expect(unrecorded.exitCode).toBe(2);
    expect(unrecorded.stderr).toMatch(/no fingerprint was recorded/);
    const escaping = runAutopilotCommand(['fingerprint', '--before', '../x'], '', context(root));
    expect(escaping.exitCode).toBe(2);
    expect(existsSync(join(root, '.void', 'machine', 'autopilot', 'x.json'))).toBe(false);
  });
});
