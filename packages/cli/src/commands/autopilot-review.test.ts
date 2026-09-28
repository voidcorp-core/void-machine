import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentsContext,
  agentsContext,
  dispatchAgent,
  type AgentRuntimePort,
  type LaunchPlan,
} from '@voidcorp/void-machine/agents';
import { afterEach, describe, expect, it } from 'vitest';
import { admitLocalReview } from '../lib/autopilot/judgments.js';
import { gitIn } from '../lib/autopilot/loop-observe.js';
import {
  readLocalReviews,
  reviewBrief,
  reviewCommand,
  reviewMissionId,
  reviewPath,
  type ReviewRunners,
} from './autopilot-review.js';

// `autopilot review` runs against a real repository and its origin, so the
// worktree, the HEAD checks and the diff are git's own. The runtime is
// scripted: the reviewer's session and its Stop-hook result are what a Claude
// background session produces, written where the kernel reads them.

const FIXTURES = new URL('../lib/autopilot/__fixtures__/gh/', import.meta.url);
const SESSION = '6d5ea8bb-764f-4463-b733-8b94509eb25e';
const OTHER_SESSION = '0f0f0f0f-764f-4463-b733-8b94509eb25e';

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

const scratch: string[] = [];
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
}

interface Repository {
  readonly root: string;
  readonly worktrees: string;
  readonly head: string;
  readonly base: string;
}

/** A checkout with an origin: develop at `base`, and work/DEV-1 one commit ahead at `head`. */
function repository(): Repository {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'vm-review-')));
  scratch.push(home);
  const origin = join(home, 'origin.git');
  const root = join(home, 'checkout');
  git(home, 'init', '-q', '--bare', '-b', 'develop', origin);
  git(home, 'clone', '-q', origin, root);
  writeFileSync(join(root, '.gitignore'), '.void/machine/\n');
  writeFileSync(join(root, 'loop.ts'), 'export const slots = 4;\n');
  mkdirSync(join(root, '.void'));
  writeFileSync(join(root, '.void', 'program.md'), PROGRAM);
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'base');
  git(root, 'push', '-q', 'origin', 'HEAD:develop');
  const base = git(root, 'rev-parse', 'HEAD').trim();
  git(root, 'checkout', '-q', '-b', 'work/DEV-1');
  writeFileSync(join(root, 'loop.ts'), 'export const slots = 5; // ```not a fence```\n');
  git(root, 'commit', '-q', '-am', 'raise the slots');
  git(root, 'push', '-q', 'origin', 'work/DEV-1');
  const head = git(root, 'rev-parse', 'HEAD').trim();
  git(root, 'checkout', '-q', 'develop');
  return { root, worktrees: join(home, 'git-worktrees'), head, base };
}

/** `gh pr view 11` (then 12, ...), open on each of `heads`, from a real capture; every call is recorded. */
function github(heads: readonly string[], calls: string[][] = []) {
  const view = JSON.parse(readFileSync(new URL('pr-view-open.json', FIXTURES), 'utf8')) as Record<string, unknown>;
  return {
    calls,
    run: (args: readonly string[]): string => {
      calls.push([...args]);
      if (args[0] === 'pr' && args[1] === 'view') {
        const number = Number(args[2]);
        const head = heads[number - 11] ?? '';
        return JSON.stringify({ ...view, number, headRefOid: head, headRefName: `work/DEV-${number - 10}`,
          baseRefName: 'develop', comments: [], changedFiles: 1 });
      }
      if (args[0] === 'pr' && args[1] === 'comment') return '';
      throw new Error(`unexpected gh call: ${args.join(' ')}`);
    },
  };
}

const clean = {
  schemaVersion: 1,
  specialistId: 'core:independent-code-reviewer',
  contractVersion: 1,
  completionId: 'review-0001',
  verdict: 'pass',
  findings: [],
  evidenceRequests: [],
  limitations: [],
};

interface Script {
  /** The reviewer's final message; the clean completion unless given. */
  readonly answer?: string;
  /** The session the result is recorded for; the one the runtime lists unless given. */
  readonly resultSession?: string;
  /** Runs once the reviewer's session is first listed, as a writer beside it could. */
  readonly meanwhile?: (plan: LaunchPlan) => void;
}

/** The native session of the n-th reviewer launched, as `claude agents` would list it. */
const sessionOf = (index: number): string => (index === 0 ? SESSION : `${String(index).padStart(8, '0')}-764f-4463-b733-8b94509eb25e`);

/** A runtime whose reviewers each end their turn on their second observation with `answer`. */
function scriptedRuntime(machine: string, clock: { value: number }, script: Script = {}) {
  const launches: LaunchPlan[] = [];
  const stops: string[] = [];
  const seen = new Map<string, number>();
  const runtime: AgentRuntimePort = {
    preflight: async () => ({ ok: true }),
    dispatch: async (plan) => {
      launches.push(plan);
      return { kind: 'acknowledged', handle: sessionOf(launches.length - 1).slice(0, 8) };
    },
    observe: async (refs) => {
      const sessions = new Map(refs.flatMap((ref) => {
        const index = launches.findIndex((plan) => plan.name === ref.name);
        const plan = launches[index];
        if (plan === undefined || stops.includes(ref.name)) return [];
        const count = (seen.get(ref.name) ?? 0) + 1;
        seen.set(ref.name, count);
        const sessionId = sessionOf(index);
        if (count === 2) {
          script.meanwhile?.(plan);
          const claim = JSON.parse(readFileSync(join(machine, 'agents', 'sessions', `${sessionId}.json`), 'utf8'));
          writeFileSync(claim.resultPath, JSON.stringify({ schemaVersion: 1,
            sessionId: script.resultSession ?? sessionId, recordedAt: clock.value,
            lastAssistantMessage: script.answer ?? JSON.stringify(clean), truncated: false }));
        }
        const state = count >= 2 ? 'done' as const : 'working' as const;
        return [[ref.name, { observation: { kind: 'present' as const, state, status: 'idle' as const },
          binding: { handle: sessionId.slice(0, 8), sessionId } }]] as const;
      }));
      return { kind: 'read', sessions };
    },
    send: async () => ({ kind: 'refused', cause: 'not scripted', action: 'none' }),
    stop: async (ref) => { stops.push(ref.name); return { ok: true }; },
    attachCommand: () => undefined,
  };
  return { runtime, launches, stops };
}

function runners(repo: Repository, script: Script = {}, calls: string[][] = [], heads: readonly string[] = [repo.head]) {
  const clock = { value: 1_790_000_000_000 };
  const composed = agentsContext({ cwd: repo.root, env: {}, home: repo.root, updateCommand: 'update' });
  if (!('store' in composed)) throw new Error(composed.cause);
  const machine = join(repo.root, '.void', 'machine');
  const scripted = scriptedRuntime(machine, clock, script);
  const agents: AgentsContext = {
    ...composed,
    runtime: scripted.runtime,
    clock: { now: () => clock.value, sleep: async (ms) => { clock.value += ms; } },
  };
  const gh = github(heads, calls);
  const built: ReviewRunners = {
    root: repo.root, gh: gh.run, git: gitIn, agents, now: () => clock.value, worktrees: repo.worktrees,
  };
  return { runners: built, launches: scripted.launches, stops: scripted.stops, calls: gh.calls, clock, agents };
}

const argv = (head: string, ticket = 'DEV-1', pr = 11) =>
  ['review', '--ticket', ticket, '--pr', String(pr), '--head', head, '--round', '1'];
const worktreeOf = (repo: Repository) => join(repo.worktrees, 'checkout', 'review', 'DEV-1', repo.head);
const recorded = (repo: Repository, ticket = 'DEV-1', head = repo.head) => {
  const admission = admitLocalReview(JSON.parse(readFileSync(reviewPath(repo.root, ticket, head), 'utf8')));
  if (!admission.ok) throw new Error(admission.reason);
  return admission.value;
};

describe('autopilot review', () => {
  it('records a clean verdict bound to the head and to the session the runtime listed', async () => {
    const repo = repository();
    const { runners: built, launches, calls } = runners(repo);
    const output = await reviewCommand(argv(repo.head), built);
    const record = recorded(repo);
    expect(record).toMatchObject({ ticketId: 'DEV-1', pullRequest: 11, headSha: repo.head,
      verdict: { sessionId: SESSION, verdict: { headSha: repo.head, round: 1, blocking: [], advisory: [] } } });
    expect(record.attempts).toHaveLength(1);
    expect(output.human).toContain('clean');
    // The reviewer ran read-only in a detached worktree of exactly that head.
    expect(launches[0]).toMatchObject({ role: 'review', agentType: 'independent-code-reviewer' });
    expect(realpathSync(launches[0]?.cwd ?? '')).toBe(realpathSync(worktreeOf(repo)));
    expect(git(worktreeOf(repo), 'rev-parse', 'HEAD').trim()).toBe(repo.head);
    expect(git(worktreeOf(repo), 'status', '--porcelain=v2', '--branch')).toContain('# branch.head (detached)');
    const brief = readFileSync(launches[0]?.instructionPath ?? '', 'utf8');
    expect(brief).toContain(repo.head);
    expect(brief).toContain('-export const slots = 4;');
    // The copy for humans is posted; nothing reads it back.
    expect(calls.find((call) => call[1] === 'comment')).toBeDefined();
    // The kernel reads exactly what it recorded.
    expect(readLocalReviews(repo.root, ['DEV-1']).get('DEV-1')?.get(repo.head)).toEqual(record);
  });

  it('rejects the verdict when the review worktree HEAD moved during the run', async () => {
    const repo = repository();
    const moved = { meanwhile: (plan: LaunchPlan) => git(plan.cwd, 'checkout', '-q', '--detach', repo.base) };
    const { runners: built } = runners(repo, moved);
    const output = await reviewCommand(argv(repo.head), built);
    expect(output.value).toMatchObject({ outcome: 'failed', cause: expect.stringContaining(repo.base) });
    expect(recorded(repo).verdict).toBeUndefined();
    expect(recorded(repo).attempts[0]?.failure).toContain('not');
  });

  it('rejects the verdict when the review worktree was not at the head before the run', async () => {
    const repo = repository();
    const path = worktreeOf(repo);
    mkdirSync(join(path, '..'), { recursive: true });
    git(repo.root, 'worktree', 'add', '-q', '--detach', path, repo.base);
    const { runners: built, launches } = runners(repo);
    const output = await reviewCommand(argv(repo.head), built);
    expect(output.value).toMatchObject({ outcome: 'failed', cause: expect.stringContaining(`not ${repo.head}`) });
    expect(launches).toHaveLength(0);
    // Recorded as a failed attempt, so the kernel bounds it rather than asking forever.
    expect(recorded(repo).attempts[0]?.failure).toContain(`not ${repo.head}`);
  });

  it('refuses a result recorded for a session the runtime does not list under the run', async () => {
    const repo = repository();
    const { runners: built } = runners(repo, { resultSession: OTHER_SESSION });
    const output = await reviewCommand(argv(repo.head), built);
    expect(output.value).toMatchObject({ outcome: 'failed' });
    expect(recorded(repo).verdict).toBeUndefined();
  });

  it('records an answer it cannot admit as a failed attempt, never as a verdict', async () => {
    const repo = repository();
    const { runners: built } = runners(repo, { answer: 'Looks good to me.' });
    const output = await reviewCommand(argv(repo.head), built);
    expect(output.value).toMatchObject({ outcome: 'failed', cause: expect.stringContaining('review completion refused') });
    expect(recorded(repo).verdict).toBeUndefined();
  });

  it('reviews nothing when the pull request moved past the head the kernel named', async () => {
    const repo = repository();
    const { runners: built, launches } = runners(repo);
    await expect(reviewCommand(argv(repo.base), built)).rejects.toThrow(/not the head the kernel asked to review/);
    expect(launches).toHaveLength(0);
    expect(existsSync(reviewPath(repo.root, 'DEV-1', repo.base))).toBe(false);
  });

  it('delegates no second reviewer on a head already reviewed', async () => {
    const repo = repository();
    await reviewCommand(argv(repo.head), runners(repo).runners);
    const again = runners(repo);
    const output = await reviewCommand(argv(repo.head), again.runners);
    expect(again.launches).toHaveLength(0);
    expect(output.human).toContain('already reviewed');
  });

  it('never removes a directory it did not create at the review worktree location', async () => {
    const repo = repository();
    const path = worktreeOf(repo);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'notes.md'), 'kept\n');
    const { runners: built, launches } = runners(repo);
    const output = await reviewCommand(argv(repo.head), built);
    expect(output.value).toMatchObject({ outcome: 'failed', cause: expect.stringContaining('git lists no worktree') });
    expect(readFileSync(join(path, 'notes.md'), 'utf8')).toBe('kept\n');
    expect(launches).toHaveLength(0);
  });

  it('closes an attempt an interrupted command left open before it delegates again', async () => {
    const repo = repository();
    const path = reviewPath(repo.root, 'DEV-1', repo.head);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, ticketId: 'DEV-1', pullRequest: 11, headSha: repo.head,
      attempts: [{ runId: 'run_00000000-0000-4000-8000-00000000dead', startedAt: 1 }] }));
    const { runners: built, launches } = runners(repo);
    await reviewCommand(argv(repo.head), built);
    const record = recorded(repo);
    expect(record.attempts[0]).toMatchObject({ failure: expect.stringContaining('interrupted') });
    expect(record.verdict).toBeDefined();
    expect(launches).toHaveLength(1);
  });
});

describe('autopilot review, around a crash and beside other reviews', () => {
  it('reuses a review worktree a crash left at the head, and finishes the review there', async () => {
    const repo = repository();
    const path = worktreeOf(repo);
    mkdirSync(join(path, '..'), { recursive: true });
    git(repo.root, 'worktree', 'add', '-q', '--detach', path, repo.head);
    const { runners: built, launches } = runners(repo);
    await reviewCommand(argv(repo.head), built);
    expect(launches).toHaveLength(1);
    expect(recorded(repo).verdict).toBeDefined();
    expect(git(repo.root, 'worktree', 'list', '--porcelain')).toContain(`worktree ${path}`);
  });

  it('stops a reviewer an interrupted command left past its deadline, and never waits a second window', async () => {
    const repo = repository();
    const { runners: built, launches, stops, agents, clock } = runners(repo);
    const receipt = await dispatchAgent(agents, { role: 'review', agentType: 'independent-code-reviewer',
      cwd: repo.root, brief: 'Review.', missionId: reviewMissionId({ ticket: 'DEV-1', head: repo.head }) });
    if (!receipt.ok) throw new Error(receipt.cause);
    const path = reviewPath(repo.root, 'DEV-1', repo.head);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, ticketId: 'DEV-1', pullRequest: 11, headSha: repo.head,
      attempts: [{ runId: receipt.runId, startedAt: clock.value - 31 * 60_000 }] }));
    const before = clock.value;
    const output = await reviewCommand(argv(repo.head), built);
    expect(output.value).toMatchObject({ outcome: 'failed', cause: expect.stringContaining('ran out of time') });
    expect(stops).toEqual([`vm-${receipt.runId}`]);
    expect(launches).toHaveLength(1);
    expect(clock.value).toBe(before);
  });

  it('stops a reviewer orphaned before its run id was recorded, then delegates one reviewer', async () => {
    const repo = repository();
    const { runners: built, launches, stops, agents, clock } = runners(repo);
    const orphan = await dispatchAgent(agents, { role: 'review', agentType: 'independent-code-reviewer',
      cwd: repo.root, brief: 'Review.', missionId: reviewMissionId({ ticket: 'DEV-1', head: repo.head }) });
    if (!orphan.ok) throw new Error(orphan.cause);
    const path = reviewPath(repo.root, 'DEV-1', repo.head);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, ticketId: 'DEV-1', pullRequest: 11, headSha: repo.head,
      attempts: [{ startedAt: clock.value }] }));
    await reviewCommand(argv(repo.head), built);
    // The orphan is stopped before the new reviewer starts; the new one stops once accepted.
    expect(stops[0]).toBe(`vm-${orphan.runId}`);
    expect(launches).toHaveLength(2);
    expect(recorded(repo).verdict?.runId).not.toBe(orphan.runId);
    expect(recorded(repo).attempts[0]?.failure).toContain('interrupted');
    expect(recorded(repo).verdict).toBeDefined();
  });

  it('never checks out for review a change to the configuration the reviewer loads', async () => {
    const repo = repository();
    git(repo.root, 'checkout', '-q', 'work/DEV-1');
    mkdirSync(join(repo.root, '.claude'), { recursive: true });
    writeFileSync(join(repo.root, '.claude', 'settings.json'), '{"hooks":{}}\n');
    git(repo.root, 'add', '.claude/settings.json');
    git(repo.root, 'commit', '-q', '-m', 'reconfigure the reviewer');
    const head = git(repo.root, 'rev-parse', 'HEAD').trim();
    git(repo.root, 'checkout', '-q', 'develop');
    const { runners: built, launches } = runners(repo, {}, [], [head]);
    const output = await reviewCommand(argv(head), built);
    expect(output.value).toMatchObject({ outcome: 'failed', cause: expect.stringContaining('.claude/settings.json') });
    expect(launches).toHaveLength(0);
  });

  it('refuses a round the records do not count, rather than narrowing a first review', async () => {
    const repo = repository();
    const { runners: built, launches } = runners(repo);
    const second = argv(repo.head).map((arg, index, all) => (all[index - 1] === '--round' ? '2' : arg));
    await expect(reviewCommand(second, built)).rejects.toThrow(/round 2/);
    expect(launches).toHaveLength(0);
  });

  it('refuses a second review of a head while one is running on it', async () => {
    const repo = repository();
    const path = reviewPath(repo.root, 'DEV-1', repo.head);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(`${path}.lock`, `${JSON.stringify({ pid: 1, at: Date.now() })}\n`);
    const { runners: built, launches, clock } = runners(repo);
    writeFileSync(`${path}.lock`, `${JSON.stringify({ pid: 1, at: clock.value })}\n`);
    await expect(reviewCommand(argv(repo.head), built)).rejects.toThrow(/already running/);
    expect(launches).toHaveLength(0);
    // A lock older than the window in which a review may run is an interrupted command's.
    writeFileSync(`${path}.lock`, `${JSON.stringify({ pid: 1, at: clock.value - 46 * 60_000 })}\n`);
    await reviewCommand(argv(repo.head), built);
    expect(recorded(repo).verdict).toBeDefined();
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  it('reviews nothing outside a programme, and says that is why', async () => {
    const repo = repository();
    rmSync(join(repo.root, '.void', 'program.md'));
    const { runners: built, launches } = runners(repo);
    const output = await reviewCommand(argv(repo.head), built);
    expect(output.value).toMatchObject({ outcome: 'failed', cause: expect.stringContaining('programme') });
    expect(launches).toHaveLength(0);
  });

  it('keeps two reviews run side by side apart, each on its own head and session', async () => {
    const repo = repository();
    git(repo.root, 'checkout', '-q', '-b', 'work/DEV-2', 'develop');
    writeFileSync(join(repo.root, 'other.ts'), 'export const other = 1;\n');
    git(repo.root, 'add', 'other.ts');
    git(repo.root, 'commit', '-q', '-m', 'another change');
    git(repo.root, 'push', '-q', 'origin', 'work/DEV-2');
    const second = git(repo.root, 'rev-parse', 'HEAD').trim();
    git(repo.root, 'checkout', '-q', 'develop');
    const { runners: built, launches } = runners(repo, {}, [], [repo.head, second]);
    await Promise.all([
      reviewCommand(argv(repo.head), built),
      reviewCommand(argv(second, 'DEV-2', 12), built),
    ]);
    expect(launches).toHaveLength(2);
    const first = recorded(repo);
    const other = recorded(repo, 'DEV-2', second);
    expect([first.headSha, other.headSha]).toEqual([repo.head, second]);
    expect(new Set([first.verdict?.sessionId, other.verdict?.sessionId]).size).toBe(2);
    expect(git(join(repo.worktrees, 'checkout', 'review', 'DEV-2', second), 'rev-parse', 'HEAD').trim()).toBe(second);
    expect(readLocalReviews(repo.root, ['DEV-1', 'DEV-2']).get('DEV-2')?.has(second)).toBe(true);
  });
});

describe('reviewBrief', () => {
  const target = { ticket: 'DEV-1', pullRequest: 11, head: 'a'.repeat(40) } as const;
  const base = { target: { ...target, ticket: target.ticket as never }, base: 'develop', mergeBase: 'b'.repeat(40) };

  it('fences a diff that holds backticks so it cannot close its own block', () => {
    const diff = '+const a = "```";\n+const b = "````";';
    const brief = reviewBrief({ ...base, diff, summarised: false, round: 1, previous: [] });
    expect(brief).toContain(`\`\`\`\`\`diff\n${diff}\n\`\`\`\`\``);
  });

  it('narrows a second round to the findings of the first', () => {
    const previous = [{ location: 'loop.ts:1', scenario: 'Five slots.', correction: 'Keep four.' }];
    const brief = reviewBrief({ ...base, diff: '+x', summarised: false, round: 2, previous });
    expect(brief).toContain('This is round 2');
    expect(brief).toContain('Five slots.');
  });
});
