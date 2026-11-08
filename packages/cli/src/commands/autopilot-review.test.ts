import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import filesystem from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { currentChecksFixture, noWorkflowRuns } from '../test/fixtures/loop-checks.js';
import { runAutopilotCommand } from './autopilot.js';
import { mergeCommand } from './autopilot-loop.js';
import { adapterFor } from '../lib/runtime-adapters.js';
import {
  type AgentsContext,
  agentsContext,
  dispatchAgent,
  type AgentRuntimePort,
  type LaunchPlan,
} from '@voidcorp/void-machine/agents';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileContextPack, sealEvidence, type MissionSpecialistPlan } from '@voidcorp/mission-engine';
import { createMission, recordMissionEvidence, missionControllerRoutingHash, writeMissionControllerPlan } from '../lib/runs/store.js';
import { parseSpecialistLifecycleInput, recordSpecialistLifecycle, recordSpecialistRequests } from '../lib/runs/specialist-lifecycle.js';
import { admitLocalReview } from '../lib/autopilot/judgments.js';
import { gitIn } from '../lib/autopilot/loop-observe.js';
import { computeProjectState } from '../lib/runs/project-state.js';
import {
  readLocalReviews,
  reviewBrief,
  reviewLegacyCommand as reviewCommand,
  reviewCommand as nativeReviewCommand,
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
  schemaVersion: 2
  clusterSize: 4
  base: develop
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
  writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.34.5' }));
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
    capabilities: {
      view: { available: false, provenance: 'unknown', note: 'scripted' },
      capture: { available: false, provenance: 'unknown', note: 'scripted' },
      structuredOutput: { available: false, provenance: 'unknown', note: 'scripted' },
    },
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
    runtimes: { ...composed.runtimes, claude: scripted.runtime },
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

function missionCli(cwd: string, args: readonly string[]) {
  const entry = pathToFileURL(resolve('packages/cli/src/commands/mission.ts')).href;
  return spawnSync(process.execPath, ['--import', resolve('packages/cli/node_modules/tsx/dist/loader.mjs'),
    '-e', `import(${JSON.stringify(entry)}).then(module => module.mission(${JSON.stringify(args)}))`],
  { cwd, env: { ...process.env, CODEX_CI: '1' }, encoding: 'utf8', timeout: 15000 });
}

async function boundNativeMission(repo: Repository, mission: string): Promise<void> {
  const body = '# DEV-1\nAcceptance: slots are five.\n';
  const hash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
  const plan: MissionSpecialistPlan = { planHash: hash, context: { status: 'complete', issues: [] },
    specialists: [{ specialistId: 'core:independent-code-reviewer', contractVersion: 1,
      inputHash: hash, state: 'applicable', stages: ['post-implementation'] }] };
  const ticket = { path: 'tickets/DEV-1.md', contentHash: hash };
  mkdirSync(join(repo.root, 'tickets'), { recursive: true });
  writeFileSync(join(repo.root, ticket.path), body);
  await createMission(repo.root, { missionId: mission, title: 'Review DEV-1', mode: 'team',
    teamController: { planHash: hash, routingHash: missionControllerRoutingHash(plan, ticket, repo.base),
      leadWriterId: 'writer:primary', runtime: 'codex' } });
  await writeMissionControllerPlan(repo.root, mission, plan, ticket, repo.base);
}

/** Exercise the CLI process, scripting only its external GitHub transport. */
function reviewCli(cwd: string, args: readonly string[], repo: Repository) {
  const entry = pathToFileURL(resolve('packages/cli/src/commands/autopilot.ts')).href;
  const view = github([repo.head]).run(['pr', 'view', '11']);
  const script = `const cp = require('node:child_process');
    const original = cp.execFileSync;
    cp.execFileSync = (command, argv, options) => command === 'gh'
      ? (argv[1] === 'view' ? ${JSON.stringify(view)} : '')
      : original(command, argv, options);
    require('node:module').syncBuiltinESMExports();
    import(${JSON.stringify(entry)}).then(module => module.autopilot(${JSON.stringify([...args, '--json'])}));`;
  return spawnSync(process.execPath, ['--import', resolve('packages/cli/node_modules/tsx/dist/loader.mjs'), '-e', script],
    { cwd, env: { ...process.env, VOID_WORKTREES: repo.worktrees }, encoding: 'utf8', timeout: 15000 });
}

describe('native review routing', () => {
  it.each(['pending', 'failed', 'subject', 'verdict'] as const)
  ('retains an intervening %s record when an overlapping preflight resumes', async mode => {
    const repo = repository();
    git(repo.root, 'checkout', '-q', '--detach', repo.head);
    const mission = 'mis_overlapping_primary';
    const otherMission = 'mis_overlapping_other';
    await boundNativeMission(repo, mission);
    if (mode === 'subject') await boundNativeMission(repo, otherMission);
    const { runners: built, clock } = runners(repo);
    const args = [...argv(repo.head), '--mission', mission];
    let enter: () => void = () => undefined;
    let release: () => void = () => undefined;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const resumed = new Promise<void>(resolve => { release = resolve; });
    const originalOpen = filesystem.open;
    let delayed = false;
    const opening = vi.spyOn(filesystem, 'open').mockImplementation(async (...args) => {
      if (!delayed && args[0] === join(repo.root, '.void/machine/runs', mission, 'controller-plan.json')) {
        delayed = true;
        enter();
        await resumed;
      }
      return originalOpen(...args);
    });
    syncBuiltinESMExports();
    const overlapping = nativeReviewCommand(args, built).then(
      value => ({ ok: true as const, value }), error => ({ ok: false as const, error: String(error) }));
    try {
      await entered;
      if (mode === 'failed') {
        git(repo.root, 'worktree', 'add', '-q', '--detach', worktreeOf(repo), repo.base);
      }
      const intervening = mode === 'verdict'
        ? await reviewCommand(argv(repo.head), built)
        : await nativeReviewCommand([...argv(repo.head), '--mission', mode === 'subject' ? otherMission : mission], built);
      const current = recorded(repo);
      if (mode === 'failed') {
        expect(intervening.value).toMatchObject({ outcome: 'failed' });
        git(worktreeOf(repo), 'checkout', '-q', '--detach', repo.head);
      } else if (mode !== 'verdict') {
        expect(intervening.value).toMatchObject({ outcome: 'awaiting-native-review' });
      }
      clock.value += 1000;
      release();
      const result = await overlapping;
      if (mode === 'subject') {
        expect(result).toMatchObject({ ok: false, error: expect.stringContaining('subject changed') });
        expect(recorded(repo)).toEqual(current);
      } else if (mode === 'verdict') {
        expect(result).toMatchObject({ ok: true, value: { value: current, human: expect.stringContaining('already reviewed') } });
        expect(recorded(repo)).toEqual(current);
      } else {
        expect(result).toMatchObject({ ok: true, value: { value: { outcome: 'awaiting-native-review' } } });
        const attempts = recorded(repo).attempts;
        if (mode === 'failed') {
          expect(attempts).toHaveLength(2);
          expect(attempts[0]).toEqual(current.attempts[0]);
        } else {
          expect(attempts).toEqual(current.attempts);
          clock.value = (current.attempts[0]?.startedAt ?? 0) + 30 * 60_000;
          expect((await nativeReviewCommand(args, built)).value).toMatchObject({ outcome: 'failed',
            cause: expect.stringContaining('ran out of time') });
          expect(recorded(repo).attempts).toHaveLength(1);
        }
      }
    } finally {
      release();
      await overlapping;
      opening.mockRestore();
      syncBuiltinESMExports();
    }
  });

  it('keeps title-only missions usable but refuses controlled dispatch and review before an attempt', async () => {
    const repo = repository();
    git(repo.root, 'checkout', '-q', '--detach', repo.head);
    const started = missionCli(repo.root, ['start', '--title', 'Simple task', '--json']);
    expect(started.status, started.stderr).toBe(0);
    const { missionId } = JSON.parse(started.stdout);
    const journalPath = join(repo.root, '.void/machine/runs', missionId, 'events.jsonl');
    const before = readFileSync(journalPath, 'utf8');
    const dispatch = missionCli(repo.root, ['dispatch', '--id', missionId, '--json']);
    expect(dispatch.status).toBe(1);
    expect(dispatch.stderr).toContain('MISSION_CONTROLLER_PLAN_MISSING');
    expect(dispatch.stderr).toContain('--ticket');
    const { runners: built, launches } = runners(repo);
    await expect(nativeReviewCommand([...argv(repo.head), '--mission', missionId], built))
      .rejects.toThrow(/MISSION_CONTROLLER_PLAN_MISSING.*--ticket/);
    expect(existsSync(reviewPath(repo.root, 'DEV-1', repo.head))).toBe(false);
    expect(existsSync(worktreeOf(repo))).toBe(false);
    expect(launches).toEqual([]);
    expect(readFileSync(journalPath, 'utf8')).toBe(before);
    const resumed = missionCli(repo.root, ['resume', '--id', missionId, '--json']);
    expect(resumed.stderr).toBe('');
    expect(JSON.parse(resumed.stdout).recorded).toBe(true);
  });

  it('starts, dispatches and collects one mission across assigned, installation and coordinator roots', async () => {
    const repo = repository();
    const coordinator = join(repo.worktrees, 'coordinator');
    const assigned = join(repo.worktrees, 'assigned');
    git(repo.root, 'worktree', 'add', '-q', '--detach', coordinator, repo.base);
    git(repo.root, 'worktree', 'add', '-q', '--detach', assigned, repo.base);
    await adapterFor('codex').wire({ stageRoot: repo.root, installRoot: repo.root,
      sourceRoot: resolve('packages/core'), enabledPlugins: ['harness'], enabledPacks: [],
      source: 'local', marketplaceRepo: 'acme/harness', pinVersion: '7.0.0' });
    writeFileSync(join(repo.root, '.void', 'program.md'), 'unreadable installation programme');
    writeFileSync(join(coordinator, '.void', 'program.md'), PROGRAM.replace('program: loop', 'program: coordinator'));
    writeFileSync(join(repo.root, 'unrelated.txt'), 'installation dirt');
    writeFileSync(join(coordinator, 'unrelated.txt'), 'coordinator dirt');
    const ticket = '.void/machine/tickets/DEV-1.md';
    mkdirSync(join(assigned, '.void/machine/tickets'), { recursive: true });
    const body = '# DEV-1\nAcceptance: slots are five.\n';
    writeFileSync(join(assigned, ticket), body);
    const started = missionCli(assigned, ['start', '--title', 'DEV-1', '--ticket', ticket, '--json']);
    expect(started.status, started.stderr + started.stdout).toBe(0);
    const { missionId } = JSON.parse(started.stdout);
    const first = missionCli(assigned, ['dispatch', '--id', missionId, '--json']);
    expect(first.status, first.stderr + first.stdout).toBe(0);
    expect(JSON.parse(first.stdout).action.kind, first.stdout).toBe('run-lead-writer');
    git(assigned, 'checkout', '-q', '--detach', repo.head);
    expect(missionCli(assigned, ['writer-event', '--id', missionId, '--json']).status).toBe(0);
    const dispatch = missionCli(assigned, ['dispatch', '--id', missionId, '--json']);
    expect(dispatch.status, dispatch.stderr + dispatch.stdout).toBe(0);
    const envelope = JSON.parse(dispatch.stdout).envelopes[0];
    expect(envelope.reviewSubject.reviewedCommit).toBe(repo.head);
    const native = { ...runners(repo).runners, root: coordinator, now: Date.now };
    const args = [...argv(repo.head), '--mission', missionId, '--worktree', '../assigned'];
    // Preflight must neither create the review checkout nor spend a deadline.
    await expect(nativeReviewCommand([...argv(repo.head), '--mission', missionId], native))
      .rejects.toThrow(/worktree.*HEAD/);
    const foreign = repository();
    await expect(nativeReviewCommand([...args.slice(0, -1), foreign.root], native))
      .rejects.toThrow(/same Git repository/);
    writeFileSync(join(assigned, ticket), `${body}Changed criteria.`);
    await expect(nativeReviewCommand(args, native)).rejects.toThrow(/ticket binding/);
    writeFileSync(join(assigned, ticket), body);
    expect(existsSync(reviewPath(coordinator, 'DEV-1', repo.head))).toBe(false);
    expect(existsSync(worktreeOf(repo))).toBe(false);
    const planPath = join(repo.root, '.void/machine/runs', missionId, 'controller-plan.json');
    const frozenPlan = readFileSync(planPath, 'utf8');
    writeFileSync(planPath, '{}');
    await expect(nativeReviewCommand(args, native)).rejects.toThrow(/MISSION_CONTROLLER_PLAN_INVALID/);
    writeFileSync(planPath, frozenPlan);
    const prepared = reviewCli(coordinator, args, repo);
    expect(prepared.status, prepared.stderr + prepared.stdout).toBe(0);
    expect(JSON.parse(prepared.stdout)).toMatchObject({ outcome: 'awaiting-native-review', subject: envelope.reviewSubject });
    const pending = recorded({ ...repo, root: coordinator });
    git(assigned, 'checkout', '-q', '--detach', repo.base);
    await expect(nativeReviewCommand(args, native)).rejects.toThrow(/worktree HEAD/);
    expect(recorded({ ...repo, root: coordinator }).attempts).toEqual(pending.attempts);
    git(assigned, 'checkout', '-q', '--detach', repo.head);
    const resumed = missionCli(assigned, ['resume', '--id', missionId, '--json']);
    expect(resumed.stderr).toBe('');
    expect(JSON.parse(resumed.stdout).recorded).toBe(true);
    await nativeReviewCommand(args, { ...native, now: () => native.now() + 1000 });
    expect(recorded({ ...repo, root: coordinator }).attempts).toEqual(pending.attempts);
    const contextId = '/root/review/linked';
    for (const status of ['started', 'completed'] as const) {
      const input = { envelope, contextId, ...(status === 'started' ? {} : {
        completion: { ...clean, contractVersion: envelope.contractVersion,
          review: { ...envelope.reviewSubject, writerId: 'writer:primary', reviewerId: 'reviewer:linked',
            readOnly: true, scope: { kind: 'general' }, proofIds: [], resolutions: [],
            provenance: { kind: 'native-context', contextId } } },
      }) };
      const inputPath = '.void/machine/review-input.json';
      writeFileSync(join(assigned, inputPath), JSON.stringify(input));
      const result = missionCli(assigned, ['specialist-event', '--id', missionId, '--status', status,
        '--input', inputPath, '--json']);
      expect(result.status, result.stderr + result.stdout).toBe(0);
    }
    const result = reviewCli(coordinator, args, repo);
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ verdict: { receipt: envelope.reviewSubject, verdict: { blocking: [] } } });
    const record = recorded({ ...repo, root: coordinator });
    expect(readLocalReviews(coordinator, ['DEV-1']).get('DEV-1')?.get(repo.head)).toEqual(record);
    expect(existsSync(reviewPath(repo.root, 'DEV-1', repo.head))).toBe(false);
    expect(existsSync(reviewPath(assigned, 'DEV-1', repo.head))).toBe(false);
    expect(existsSync(join(repo.root, ticket))).toBe(false);
    expect(existsSync(join(coordinator, ticket))).toBe(false);
    expect(existsSync(join(repo.root, '.void/machine/runs', missionId, 'controller-plan.json'))).toBe(true);
    expect(existsSync(join(assigned, '.void/machine/runs', missionId))).toBe(false);
    const view = native.gh(['pr', 'view', '11']);
    const observedGh = (args: readonly string[]) => {
      const line = args.join(' ');
      if (line.includes('CurrentPullRequestChecks')) return currentChecksFixture(view);
      if (line.includes('/actions/runs?')) return noWorkflowRuns;
      if (line.includes('mergeQueue(branch')) return readFileSync(new URL('queue-present.json', FIXTURES), 'utf8');
      if (line.includes('isInMergeQueue')) return readFileSync(new URL('pr-queue-membership-absent.json', FIXTURES), 'utf8');
      if (line.includes('timelineItems')) return JSON.stringify({ data: { repository: { pullRequest: {
        timelineItems: { nodes: [] },
      } } } });
      if (line.includes('pulls/11/files')) return JSON.stringify([{ filename: 'loop.ts', status: 'modified' }]);
      return native.gh(args);
    };
    const context = { root: coordinator, gh: observedGh, git: gitIn(coordinator), now: new Date().toISOString() };
    expect(runAutopilotCommand(['fingerprint', '--before', 'DEV-1'], '', context).exitCode).toBe(0);
    const tracker = JSON.stringify({ schemaVersion: 1, queue: { entries: [] }, tickets: [{
      id: 'DEV-1', status: 'In Review', humanWait: false, pullRequest: 11,
      branch: 'work/DEV-1', footprint: ['loop.ts'],
    }], recent: [], liveWorkers: [], quota: 'ok' });
    const next = runAutopilotCommand(['next', '--json'], tracker, context);
    expect(next.exitCode, next.stderr).toBe(0);
    expect(JSON.parse(next.stdout).actions).toContainEqual({ kind: 'enable-auto-merge',
      ticketId: 'DEV-1', pullRequest: 11, headSha: repo.head });
    // Merge reaches the current-check guard only after reading the coordinator's clean record.
    const pendingView = JSON.stringify({ ...JSON.parse(view),
      statusCheckRollup: [{ __typename: 'StatusContext', context: 'ci', state: 'PENDING' }] });
    const pendingGh = (args: readonly string[]) => args.join(' ').includes('CurrentPullRequestChecks')
      ? currentChecksFixture(pendingView) : observedGh(args);
    expect(() => mergeCommand(['merge', '--ticket', 'DEV-1', '--pr', '11', '--head', repo.head],
      { ...context, gh: pendingGh })).toThrow(/pending check/);
  });

  it.each(['clean', 'unresolved', 'stale', 'fresh'] as const)
  ('collects %s canonical native history and binds ticket identity and bytes', async mode => {
    const repo = repository();
    git(repo.root, 'checkout', '-q', '--detach', repo.head);
    const { runners: built, launches } = runners(repo);
    const { agents: _agents, ...nativeRunners } = built;
    const mission = 'mis_native_autopilot_1234';
    const ticketBody = '# DEV-1\nAcceptance: slots are five.\n';
    const hash = `sha256:${createHash('sha256').update(ticketBody).digest('hex')}`;
    const plan: MissionSpecialistPlan = { planHash: hash, context: { status: 'complete', issues: [] },
      specialists: [{ specialistId: 'core:independent-code-reviewer', contractVersion: 1,
        inputHash: hash, state: 'applicable', stages: ['post-implementation'] }] };
    const ticket = { path: 'tickets/DEV-1.md', contentHash: hash };
    mkdirSync(join(repo.root, 'tickets'));
    writeFileSync(join(repo.root, ticket.path), ticketBody);
    await createMission(repo.root, { missionId: mission, title: 'Review DEV-1', mode: 'team',
      teamController: { planHash: hash, routingHash: missionControllerRoutingHash(plan, ticket, repo.base),
        leadWriterId: 'writer:primary', runtime: 'codex' } });
    await writeMissionControllerPlan(repo.root, mission, plan, ticket, repo.base);
    const args = [...argv(repo.head), '--mission', mission];
    expect((await nativeReviewCommand(args, nativeRunners)).value).toMatchObject({ outcome: 'awaiting-native-review' });
    expect(recorded(repo).attempts).toHaveLength(1);
    // Before history diverges, these binding/idempotence checks have identical
    // inputs in all four modes. Prove them once; every mode still collects its own receipt.
    if (mode === 'clean') {
      expect((await nativeReviewCommand(args, nativeRunners)).value).toMatchObject({ outcome: 'awaiting-native-review' });
      expect(recorded(repo).attempts).toHaveLength(1);
      await expect(nativeReviewCommand([...argv(repo.head, 'DEV-2'), '--mission', mission], nativeRunners))
        .rejects.toThrow(/ticket binding/);
      writeFileSync(join(repo.root, ticket.path), `${ticketBody}Changed criteria.\n`);
      await expect(nativeReviewCommand(args, nativeRunners)).rejects.toThrow(/ticket binding/);
      writeFileSync(join(repo.root, ticket.path), ticketBody);
    }
    const subject = { taskId: mission, reviewedCommit: repo.head, baseCommit: repo.base, acceptanceCriteriaHash: hash };
    const envelope = { schemaVersion: 1, missionId: mission, runtime: 'codex',
      specialistId: 'core:independent-code-reviewer', agentName: 'independent-code-reviewer', contractVersion: 1,
      stage: 'post-implementation', reviewRound: 1, inputHash: hash, reviewSubject: subject,
      reviewScope: { kind: 'general' }, contextPack: compileContextPack({ diff: '+slots=5', touchedPaths: ['loop.ts'],
        artifacts: [], lens: 'full', budgetTokens: 12000, dispatch: { missionId: mission,
          specialistId: 'core:independent-code-reviewer', stage: 'post-implementation', reviewRound: 1, inputHash: hash } }) } as const;
    const proofId = 'evd_00000000-0000-4000-8000-000000000001';
    const finding = { id: 'authorization', severity: 'high', classification: 'blocking',
      summary: 'Authorization absent', evidence: [{ path: 'loop.ts', line: 1, detail: 'Role unchecked' }],
      recommendation: 'Check role', criterion: 'Authorized access only', consequence: 'Unauthorized access',
      resolutionCondition: 'Unauthorized request rejected', basis: 'initial-scope-defect' } as const;
    if (mode !== 'clean') {
      const contextId = '/root/review/prior';
      const priorHash = `sha256:${'c'.repeat(64)}`;
      const priorEnvelope = { ...envelope, inputHash: priorHash,
        reviewSubject: { ...subject, reviewedCommit: repo.base },
        contextPack: compileContextPack({ diff: '+slots=4', touchedPaths: ['loop.ts'], artifacts: [],
          lens: 'full', budgetTokens: 12000, dispatch: { missionId: mission,
            specialistId: envelope.specialistId, stage: envelope.stage, reviewRound: 1, inputHash: priorHash } }) };

      await recordSpecialistRequests(repo.root, mission, [priorEnvelope], hash);
      await recordSpecialistLifecycle(repo.root, mission, parseSpecialistLifecycleInput('started', { envelope: priorEnvelope, contextId }));
      await recordSpecialistLifecycle(repo.root, mission, parseSpecialistLifecycleInput('completed', { envelope: priorEnvelope, contextId,
        completion: { ...clean, completionId: 'cmp_prior_1234', verdict: 'changes-requested', findings: [finding],
          review: { ...priorEnvelope.reviewSubject, writerId: 'writer:primary', reviewerId: 'reviewer:prior', readOnly: true,
            scope: { kind: 'general' }, proofIds: [], resolutions: [], provenance: { kind: 'native-context', contextId } } } }));
      const project = await computeProjectState(worktreeOf(repo));
      const diffHash = mode === 'stale' ? `sha256:${'f'.repeat(64)}` : project.diffHash;
      await recordMissionEvidence(repo.root, sealEvidence({ schemaVersion: 1, evidenceId: proofId, missionId: mission,
        type: 'command', producer: 'void-harness:mission.verify', source: 'command:pnpm',
        environment: { runtime: 'node:v24', platform: 'darwin', arch: 'arm64' }, confidence: 'high',
        inputHash: hash, diffHash, startedAt: '2026-10-08T12:00:00Z', finishedAt: '2026-10-08T12:00:01Z',
        durationMs: 1000, status: 'passed', exitCode: 0, command: ['pnpm', 'test'], affectedNodes: [],
        output: { stdout: 'ok', stderr: '', truncated: false },
        dependencies: [{ kind: 'diff', key: 'git:working-tree', hash: diffHash }],
      }));
    }
    const contextId = '/root/review/actual';
    await recordSpecialistRequests(repo.root, mission, [envelope], hash);
    await recordSpecialistLifecycle(repo.root, mission, parseSpecialistLifecycleInput('started', { envelope, contextId }));
    await recordSpecialistLifecycle(repo.root, mission, parseSpecialistLifecycleInput('completed', { envelope, contextId,
      completion: { ...clean, review: { ...subject, writerId: 'writer:primary', reviewerId: 'reviewer:independent',
        readOnly: true, scope: { kind: 'general' }, proofIds: mode === 'clean' ? [] : [proofId],
        resolutions: mode === 'clean' ? [] : [{ findingId: finding.id,
          status: mode === 'unresolved' ? 'unresolved' : 'resolved', proofIds: [proofId] }],
        provenance: { kind: 'native-context', contextId } } } }));
    const result = await nativeReviewCommand(args, nativeRunners);
    if (mode === 'unresolved' || mode === 'stale') {
      expect(result.value).toMatchObject({ outcome: 'failed', cause: expect.stringContaining('historical blockers') });
      expect(recorded(repo).verdict).toBeUndefined();
    } else expect(result.value).toMatchObject({ verdict: { receipt: subject, verdict: { blocking: [] } } });
    expect(launches).toEqual([]);
  });
  it('requires canonical native review evidence instead of launching another kernel run', async () => {
    const repo = repository();
    const { runners: built, launches } = runners(repo);
    await expect(nativeReviewCommand(argv(repo.head), built))
      .rejects.toThrow(/mission/);
    expect(launches).toEqual([]);
  });
  it('refuses a native review checkout that drifted before any evidence is collected', async () => {
    const repo = repository();
    const path = worktreeOf(repo);
    mkdirSync(join(path, '..'), { recursive: true });
    git(repo.root, 'worktree', 'add', '-q', '--detach', path, repo.base);
    const { runners: built, launches } = runners(repo);
    await expect(nativeReviewCommand([...argv(repo.head), '--mission', 'mis_unknown_12345678'], built))
      .rejects.toThrow(/worktree HEAD/);
    expect(existsSync(reviewPath(repo.root, 'DEV-1', repo.head))).toBe(false);
    expect(launches).toEqual([]);
  });
});

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
    expect(recorded(repo).verdict).not.toMatchObject({ runId: orphan.runId });
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
    const session = (value: typeof first) => value.verdict !== undefined && 'sessionId' in value.verdict
      ? value.verdict.sessionId : undefined;
    expect(new Set([session(first), session(other)]).size).toBe(2);
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
