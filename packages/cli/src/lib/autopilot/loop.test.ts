import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePullRequestView } from './loop-observe.js';
import {
  admitLoopTracker,
  decideLoop,
  type GithubObservation,
  HUMAN_WAIT_LABEL,
  HUMAN_WAIT_REASONS,
  type LoopAction,
  type LoopInput,
  type LoopTracker,
  loopProgramOf,
  parseStopSignal,
  PROTECTED_PATHS_FLOOR,
  protectedPathsOf,
  type PullRequestObservation,
  protectedBranches,
  pullRequestsToObserve,
  type QueueEvent,
  type StopSignal,
} from './loop.js';
import { parseProgramDescriptor } from './program.js';
import { fingerprintOf, type SharedFingerprint, type SharedStateReading } from './shared-state.js';

// The kernel decides what each slot does from what Linear and GitHub say, and
// from nothing else: no memory of the previous tick, no session state. Every
// test therefore describes a complete observation and reads the actions back,
// which is also what a restart looks like to the loop.

interface ProgramSpec {
  readonly clusterSize?: number;
  readonly mergeGate?: string;
  readonly protectedPaths?: readonly string[];
}

function programText(options: ProgramSpec = {}): string {
  const declared =
    options.protectedPaths === undefined
      ? ''
      : `  protectedPaths:\n${options.protectedPaths.map((path) => `    - ${path}\n`).join('')}`;
  const gate =
    (options.mergeGate ?? 'union-reviewed') === 'human'
      ? 'mergeGate: human'
      : 'mergeGate: union-reviewed\n  deployBranch: main';
  return `---
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
    done: [Done, Canceled]
autopilot:
  schemaVersion: 1
  clusterSize: ${options.clusterSize ?? 4}
  base: develop
  ${gate}
  ownership:
    sequential:
      - pnpm-lock.yaml
      - packages/cli/core-assets/**
${declared}---
`;
}

const program = (options?: ProgramSpec) =>
  loopProgramOf(parseProgramDescriptor(programText(options)));

interface TicketSpec {
  readonly id: string;
  readonly status?: string;
  readonly humanWait?: boolean;
  readonly pullRequest?: number;
  readonly branch?: string;
  readonly footprint?: readonly string[] | undefined;
  readonly readiness?: unknown;
}

const ready = { verdict: 'ready', reason: 'Scope, footprint and acceptance are explicit.' };

/** A queued ticket, ready, owning its own directory unless told otherwise. */
function queued(id: string, footprint: readonly string[] = [`packages/${id.toLowerCase()}`]): TicketSpec {
  return { id, status: 'Todo', footprint, readiness: ready };
}

/** The head SHA `pull()` gives pull request `number`. */
const headOf = (number: number): string => String(number).padStart(40, 'a');

/** The reviewer's clean verdict on the head of pull request `number`. */
const approving = (number: number) => ({ headSha: headOf(number), round: 1, blocking: [], advisory: [] });

/** A ticket already holding a slot, as Linear reports it after `assign`. */
function started(id: string, extra: Partial<TicketSpec> = {}): TicketSpec {
  return { id, status: 'In Progress', footprint: [`packages/${id.toLowerCase()}`], ...extra };
}

interface TrackerSpec {
  readonly tickets: readonly TicketSpec[];
  readonly queue?: unknown;
  readonly recent?: readonly { ticketId: string; outcome: 'merged' | 'human-wait'; reason?: string }[];
  readonly liveWorkers?: readonly string[];
  readonly quota?: 'ok' | 'low';
}

function trackerRaw(spec: TrackerSpec): Record<string, unknown> {
  const queue = spec.queue ?? {
    entries: spec.tickets
      .filter((ticket) => ticket.status === 'Todo')
      .map((ticket) => ({
        ticketId: ticket.id,
        justification: 'Unblocks the next slice of the loop.',
        footprint: ticket.footprint ?? ['packages/x'],
      })),
  };
  return {
    schemaVersion: 1,
    queue,
    tickets: spec.tickets.map(({ humanWait, ...ticket }) => ({ humanWait: humanWait ?? false, ...ticket })),
    recent: spec.recent ?? [],
    liveWorkers: spec.liveWorkers ?? [],
    quota: spec.quota ?? 'ok',
  };
}

function tracker(spec: TrackerSpec): LoopTracker {
  const admission = admitLoopTracker(trackerRaw(spec));
  if (!admission.ok) throw new Error(admission.reason);
  return admission.value;
}

type Raw = Record<string, unknown>;
const openView = (): Raw =>
  JSON.parse(readFileSync(new URL('./__fixtures__/gh/pr-view-open.json', import.meta.url), 'utf8')) as Raw;
const statusShape = (): Raw =>
  (
    JSON.parse(
      readFileSync(new URL('./__fixtures__/gh/status-contexts.json', import.meta.url), 'utf8'),
    ) as Raw[]
  )[1] as Raw;

interface PullSpec {
  readonly number: number;
  readonly branch: string;
  readonly state?: 'OPEN' | 'MERGED' | 'CLOSED';
  readonly draft?: boolean;
  readonly base?: string;
  readonly mergeState?: string;
  readonly autoMerge?: boolean;
  readonly failingCheck?: boolean;
  /** An `independent-review` check on the head, which the loop reads as any other check. */
  readonly review?: 'SUCCESS' | 'FAILURE' | 'PENDING' | undefined;
  readonly queue?: QueueEvent;
  /** A verdict block posted as a comment by the Actions bot: text the loop never believes. */
  readonly verdict?: unknown;
  readonly conflict?: unknown;
  /** Ejections of this head from the queue; one when it was just ejected, by default. */
  readonly ejections?: number;
  /** The paths the pull request changes; one ordinary document unless given. */
  readonly files?: readonly string[];
  /** Renamed files, destination to source, as REST reports them in `previous_filename`. */
  readonly renamed?: Readonly<Record<string, string>>;
  /** How many files GitHub counts; the length of `files` unless given. */
  readonly changedFiles?: number;
}

/** A judgment block as an agent posts it, written raw so a malformed one can be posted too. */
const block = (kind: string, value: unknown): string =>
  `<!-- void-autopilot:${kind} -->\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n<!-- /void-autopilot:${kind} -->\n`;

const realComments = (): Raw[] =>
  (
    JSON.parse(
      readFileSync(new URL('./__fixtures__/gh/pr-view-comments.json', import.meta.url), 'utf8'),
    ) as { comments: Raw[] }
  ).comments;


/** A pull request read through the real parser from a real `gh pr view` capture. */
function pull(spec: PullSpec): PullRequestObservation {
  const view = openView();
  const passing = view.statusCheckRollup as Raw[];
  const [firstRun] = passing;
  const rollup = [
    ...passing,
    ...(spec.failingCheck === true ? [{ ...firstRun, name: 'validate', conclusion: 'FAILURE' }] : []),
    // The review check the job publishes on the head, with the run it came from.
    ...(spec.review === undefined
      ? []
      : [{
        ...firstRun,
        name: 'independent-review',
        status: spec.review === 'PENDING' ? 'IN_PROGRESS' : 'COMPLETED',
        conclusion: spec.review === 'PENDING' ? '' : spec.review,
      }]),
  ];
  const armed = JSON.parse(
    readFileSync(new URL('./__fixtures__/gh/pr-view-auto-merge.json', import.meta.url), 'utf8'),
  ) as Raw;
  const paths = spec.files ?? ['docs/VOID-MACHINE-VISION.md'];
  const headSha = String(spec.number).padStart(40, 'a');
  const comment = (body: string) => ({ ...realComments()[0], body });
  // The verdict comment as the review job posts it, under the Actions bot.
  const posted = (body: string) => ({ ...comment(body), author: { login: 'github-actions' } });
  const parsed = parsePullRequestView(
    JSON.stringify({
      ...view,
      number: spec.number,
      state: spec.state ?? 'OPEN',
      isDraft: spec.draft ?? false,
      headRefName: spec.branch,
      headRefOid: headSha,
      baseRefName: spec.base ?? 'develop',
      mergeStateStatus: spec.mergeState ?? 'BLOCKED',
      autoMergeRequest: spec.autoMerge === true ? armed.autoMergeRequest : view.autoMergeRequest,
      statusCheckRollup: rollup,
      changedFiles: spec.changedFiles ?? paths.length,
      comments: [
        ...realComments(),
        ...(spec.verdict === undefined ? [] : [posted(block('review-verdict', spec.verdict))]),
        ...(spec.conflict === undefined ? [] : [comment(block('conflict-class', spec.conflict))]),
      ],
    }),
  );
  const ejections = spec.ejections ?? (spec.queue === 'ejected' ? 1 : 0);
  const files = paths.map((path) => {
    const previousPath = spec.renamed?.[path];
    return previousPath === undefined ? { path } : { path, previousPath };
  });
  return { ...parsed, files, queue: spec.queue ?? 'none', ejections };
}

const RUN = 'run_00000000-0000-4000-8000-000000000001';
const SESSION = '6d5ea8bb-764f-4463-b733-8b94509eb25e';
/** The instant every decision is taken at, unless a test moves it. */
const NOW = 100_000_000;

interface LocalSpec {
  /** The head the record is for; the head of the pull request unless given. */
  readonly headSha?: string;
  /** The verdict the kernel recorded; a clean one unless given, none when `null`. */
  readonly verdict?: unknown;
  readonly attempts?: readonly Record<string, unknown>[];
}

/** What `autopilot review` records for one head of a ticket's pull request. */
function localReview(ticketId: string, number: number, spec: LocalSpec = {}): Record<string, unknown> {
  const headSha = spec.headSha ?? headOf(number);
  const verdict = spec.verdict === undefined ? { ...approving(number), headSha } : spec.verdict;
  return {
    schemaVersion: 1,
    ticketId,
    pullRequest: number,
    headSha,
    attempts: spec.attempts ?? [{ runId: RUN, startedAt: NOW - 60_000, endedAt: NOW - 1_000 }],
    ...(verdict === null ? {} : { verdict: { runId: RUN, sessionId: SESSION, recordedAt: NOW - 1_000, verdict } }),
  };
}

type LocalReviews = LoopInput['reviews'];

/** By default, a clean verdict recorded on the head each ticket's pull request has now. */
function localReviews(
  spec: TrackerSpec,
  pulls: readonly PullRequestObservation[],
  given: Readonly<Record<string, readonly Record<string, unknown>[] | undefined>> = {},
): LocalReviews {
  const reviews = new Map<string, ReadonlyMap<string, unknown>>();
  for (const ticket of spec.tickets) {
    const observed = pulls.find((candidate) => candidate.number === ticket.pullRequest);
    const records = Object.hasOwn(given, ticket.id)
      ? (given[ticket.id] ?? [])
      : observed === undefined ? [] : [localReview(ticket.id, observed.number)];
    reviews.set(ticket.id, new Map(records.map((record) => [String(record.headSha), record])));
  }
  return reviews;
}

const SHARED_READING: SharedStateReading = {
  config: 'core.bare=false\n',
  stash: '',
  tags: '',
  notes: '',
  remotes: '',
  bases: 'dddddddd refs/heads/develop\n',
  replace: '',
  hooks: '',
  info: '',
};

/** The shared Git state as it stands, and a record of it for every ticket. */
function sharedState(
  spec: TrackerSpec,
  options: {
    changed?: readonly string[];
    unrecorded?: readonly string[];
    /** Config lines another unit wrote after every baseline was recorded. */
    since?: string;
  } = {},
): LoopInput['sharedState'] {
  const before = new Map<string, SharedFingerprint>();
  for (const ticket of spec.tickets) {
    if (options.unrecorded?.includes(ticket.id) === true) continue;
    const changed = options.changed?.includes(ticket.id) === true;
    const reading = changed ? { ...SHARED_READING, stash: 'dddddddd\n' } : SHARED_READING;
    before.set(ticket.id, fingerprintOf(reading, ['develop', 'main']));
  }
  const current = { ...SHARED_READING, config: `${SHARED_READING.config}${options.since ?? ''}` };
  return { current, before };
}

function github(pulls: readonly PullRequestObservation[], mergeQueue = true): GithubObservation {
  return { base: 'develop', mergeQueue, pullRequests: new Map(pulls.map((observed) => [observed.number, observed])) };
}

function decide(
  spec: TrackerSpec,
  options: {
    pulls?: readonly PullRequestObservation[];
    mergeQueue?: boolean;
    signal?: StopSignal;
    clusterSize?: number;
    mergeGate?: string;
    protectedPaths?: readonly string[];
    changed?: readonly string[];
    unrecorded?: readonly string[];
    /** The head `autopilot arm` recorded per ticket; the head it was armed on otherwise. */
    armedOn?: Readonly<Record<string, string>>;
    /** Tickets whose armed pull request no `autopilot arm` recorded. */
    unarmed?: readonly string[];
    /** The records `autopilot review` left per ticket; a clean verdict on the current head otherwise. */
    reviews?: Readonly<Record<string, readonly Record<string, unknown>[] | undefined>>;
    now?: number;
  } = {},
): readonly LoopAction[] {
  const input: LoopInput = {
    program: program({
      ...(options.clusterSize === undefined ? {} : { clusterSize: options.clusterSize }),
      ...(options.mergeGate === undefined ? {} : { mergeGate: options.mergeGate }),
      ...(options.protectedPaths === undefined ? {} : { protectedPaths: options.protectedPaths }),
    }),
    tracker: tracker(spec),
    github: github(options.pulls ?? [], options.mergeQueue ?? true),
    signal: options.signal ?? 'none',
    sharedState: sharedState(spec, {
      ...(options.changed === undefined ? {} : { changed: options.changed }),
      ...(options.unrecorded === undefined ? {} : { unrecorded: options.unrecorded }),
    }),
    armed: armedRecords(spec, options.pulls ?? [], options),
    reviews: localReviews(spec, options.pulls ?? [], options.reviews),
    now: options.now ?? NOW,
  };
  return decideLoop(input).actions;
}

/** What `autopilot arm` recorded: by default, each armed pull request on the head it has now. */
function armedRecords(
  spec: TrackerSpec,
  pulls: readonly PullRequestObservation[],
  options: { armedOn?: Readonly<Record<string, string>>; unarmed?: readonly string[] },
): LoopInput['armed'] {
  const armed = new Map<string, { pullRequest: number; headSha: string }>();
  for (const ticket of spec.tickets) {
    const observed = pulls.find((candidate) => candidate.number === ticket.pullRequest);
    if (observed === undefined || options.unarmed?.includes(ticket.id) === true) continue;
    const headSha = options.armedOn?.[ticket.id] ?? observed.headSha;
    armed.set(ticket.id, { pullRequest: observed.number, headSha });
  }
  return armed;
}

const assigned = (actions: readonly LoopAction[]): string[] =>
  actions.flatMap((action) => (action.kind === 'assign' ? [action.ticketId] : []));

function actionFor(actions: readonly LoopAction[], ticketId: string): LoopAction | undefined {
  return actions.find((action) => 'ticketId' in action && action.ticketId === ticketId);
}

/** A pull request of ticket `id`, out of draft; `decide` records a clean verdict on its head. */
const reviewed = (id: string, number: number, extra: Partial<PullSpec> = {}): PullSpec => ({
  number,
  branch: `work/${id}`,
  ...extra,
});

describe('slot assignment', () => {
  it('gives free slots to the head of the curator queue, four at most', () => {
    const tickets = ['DEV-1', 'DEV-2', 'DEV-3', 'DEV-4', 'DEV-5', 'DEV-6'].map((id) => queued(id));
    expect(assigned(decide({ tickets }))).toEqual(['DEV-1', 'DEV-2', 'DEV-3', 'DEV-4']);
  });

  it('honours a smaller declared cluster size and the slots already held', () => {
    const tickets = [started('DEV-9'), queued('DEV-1'), queued('DEV-2')];
    expect(assigned(decide({ tickets }, { clusterSize: 2 }))).toEqual(['DEV-1']);
  });

  it('assigns in queue order, not tracker order', () => {
    const tickets = [queued('DEV-1'), queued('DEV-2')];
    const queue = {
      entries: [
        { ticketId: 'DEV-2', justification: 'Unblocks DEV-1.', footprint: ['packages/dev-2'] },
        { ticketId: 'DEV-1', justification: 'Follows DEV-2.', footprint: ['packages/dev-1'] },
      ],
    };
    expect(assigned(decide({ tickets, queue }, { clusterSize: 1 }))).toEqual(['DEV-2']);
  });

  it('skips a ticket whose footprint overlaps a held slot and takes the next', () => {
    const tickets = [
      started('DEV-9', { footprint: ['packages/cli/src'] }),
      queued('DEV-1', ['packages/cli/src/lib/loop.ts']),
      queued('DEV-2', ['packages/core']),
    ];
    expect(assigned(decide({ tickets }))).toEqual(['DEV-2']);
  });

  it('never seats two overlapping tickets in the same tick', () => {
    const tickets = [queued('DEV-1', ['packages/cli']), queued('DEV-2', ['packages/cli/src'])];
    expect(assigned(decide({ tickets }))).toEqual(['DEV-1']);
  });

  it('admits one ticket at a time on a path the program declares sequential', () => {
    const tickets = [
      queued('DEV-1', ['packages/cli/core-assets/a']),
      queued('DEV-2', ['packages/cli/core-assets/b']),
      queued('DEV-3', ['packages/core']),
    ];
    expect(assigned(decide({ tickets }))).toEqual(['DEV-1', 'DEV-3']);
  });

  it('seats nothing beside a held ticket whose footprint is unknown', () => {
    const tickets = [started('DEV-9', { footprint: undefined }), queued('DEV-1')];
    expect(assigned(decide({ tickets }))).toEqual([]);
  });

  it('gives a slot only to a ticket judged ready', () => {
    const tickets = [
      { ...queued('DEV-1'), readiness: { verdict: 'needs-enrichment', reason: 'No acceptance.' } },
      { ...queued('DEV-2'), readiness: { verdict: 'ambiguous', reason: 'Two readings.' } },
      { ...queued('DEV-3'), readiness: undefined },
      queued('DEV-4'),
    ];
    expect(assigned(decide({ tickets }))).toEqual(['DEV-4']);
  });

  it('reports a malformed readiness judgment instead of reading it', () => {
    const tickets = [{ ...queued('DEV-1'), readiness: { verdict: 'ready' } }, queued('DEV-2')];
    const decision = decideLoop({
      program: program(),
      tracker: tracker({ tickets }),
      github: github([]),
      signal: 'none',
      sharedState: sharedState({ tickets }),
      armed: new Map(),
      reviews: new Map(),
      now: NOW,
    });
    expect(assigned(decision.actions)).toEqual(['DEV-2']);
    expect(decision.refusals.join('\n')).toMatch(/DEV-1.*ticket readiness refused: reason/);
  });

  it('assigns nothing from a curator queue it cannot admit', () => {
    const tickets = [queued('DEV-1')];
    const queue = { entries: [{ ticketId: 'DEV-1', justification: 'x', footprint: [] }] };
    const decision = decideLoop({
      program: program(),
      tracker: tracker({ tickets, queue }),
      github: github([]),
      signal: 'none',
      sharedState: sharedState({ tickets }),
      armed: new Map(),
      reviews: new Map(),
      now: NOW,
    });
    expect(decision.actions).toEqual([]);
    expect(decision.refusals.join('\n')).toMatch(/curator queue refused/);
  });

  it('never re-assigns a ticket already done, in human wait or held', () => {
    const tickets = [
      { ...queued('DEV-1'), status: 'Done' },
      { ...queued('DEV-2'), humanWait: true },
      { ...queued('DEV-3'), status: 'In Review' },
      queued('DEV-4'),
    ];
    const queue = {
      entries: ['DEV-1', 'DEV-2', 'DEV-3', 'DEV-4'].map((ticketId) => ({
        ticketId,
        justification: 'Next in line.',
        footprint: [`packages/${ticketId.toLowerCase()}`],
      })),
    };
    expect(assigned(decide({ tickets, queue }))).toEqual(['DEV-4']);
  });

  it('keeps the ground of a ticket in human wait while its pull request is open', () => {
    // Under `mergeGate: human` every ready pull request waits for a person, and
    // its code is not on the base yet: an overlapping ticket seated now would
    // build on a base that lacks it, a conflict no footprint or Git would see.
    const waiting = started('DEV-1', { status: 'In Review', humanWait: true, pullRequest: 11, branch: 'work/DEV-1' });
    const overlapping = queued('DEV-2', ['packages/dev-1/src']);
    const spec = { tickets: [waiting, overlapping, queued('DEV-3')] };
    expect(pullRequestsToObserve(program(), tracker(spec))).toEqual([11]);
    const open = decide(spec, { clusterSize: 1, pulls: [pull(reviewed('DEV-1', 11))] });
    expect(assigned(open)).toEqual(['DEV-3']);
    const closed = decide(spec, { clusterSize: 1, pulls: [pull({ ...reviewed('DEV-1', 11), state: 'CLOSED' })] });
    expect(assigned(closed)).toEqual(['DEV-2']);
  });

  it('keeps the ground of a pull request handed to a human in the same tick', () => {
    const held = started('DEV-1', { pullRequest: 11, branch: 'work/DEV-1' });
    const spec = { tickets: [held, queued('DEV-2', ['packages/dev-1/src']), queued('DEV-3')] };
    const actions = decide(spec, { clusterSize: 1, mergeGate: 'human', pulls: [pull(reviewed('DEV-1', 11))] });
    expect(actionFor(actions, 'DEV-1')).toMatchObject({ kind: 'mark-human-wait', reason: 'human-merge-gate' });
    expect(assigned(actions)).toEqual(['DEV-3']);
  });

  it('does not seat a queued ticket the tracker does not report', () => {
    const queue = {
      entries: [{ ticketId: 'DEV-7', justification: 'Next.', footprint: ['packages/dev-7'] }],
    };
    expect(assigned(decide({ tickets: [], queue }))).toEqual([]);
  });
});

describe('resumption after a restart', () => {
  it('resumes a held ticket without a pull request instead of seating it again', () => {
    const tickets = [started('DEV-1'), queued('DEV-2')];
    const queue = {
      entries: ['DEV-1', 'DEV-2'].map((ticketId) => ({
        ticketId,
        justification: 'Next.',
        footprint: [`packages/${ticketId.toLowerCase()}`],
      })),
    };
    const actions = decide({ tickets, queue });
    expect(assigned(actions)).toEqual(['DEV-2']);
    expect(actionFor(actions, 'DEV-1')).toEqual({
      kind: 'hand-back-to-worker',
      ticketId: 'DEV-1',
      reason: 'resume',
    });
  });

  it('treats a live worker as a held slot even before Linear shows it started', () => {
    const tickets = [queued('DEV-1'), queued('DEV-2')];
    const actions = decide({ tickets, liveWorkers: ['DEV-1'] }, { clusterSize: 2 });
    expect(assigned(actions)).toEqual(['DEV-2']);
    expect(actionFor(actions, 'DEV-1')).toMatchObject({ kind: 'wait', reason: 'worker-active' });
  });

  it('resumes a ready ticket that already has a branch, instead of seating a second worker', () => {
    // `assign` was acted on and the worker pushed, then the orchestrator fell
    // before Linear moved the ticket: it is still ready, with a branch.
    const tickets = [{ ...queued('DEV-1'), branch: 'work/DEV-1' }, queued('DEV-2')];
    const actions = decide({ tickets }, { clusterSize: 2 });
    expect(assigned(actions)).toEqual(['DEV-2']);
    expect(actionFor(actions, 'DEV-1')).toMatchObject({ kind: 'hand-back-to-worker', reason: 'resume' });
  });

  it('reads the pull request of a ready ticket that already opened one', () => {
    const tickets = [{ ...queued('DEV-1'), pullRequest: 11, branch: 'work/DEV-1' }];
    const spec = { tickets };
    expect(pullRequestsToObserve(program(), tracker(spec))).toEqual([11]);
    const actions = decide(spec, { pulls: [pull(reviewed('DEV-1', 11))] });
    expect(assigned(actions)).toEqual([]);
    expect(actionFor(actions, 'DEV-1')).toMatchObject({ kind: 'enable-auto-merge' });
  });

  it('produces the same decisions when replayed on the same observation', () => {
    const spec = { tickets: [started('DEV-1', { pullRequest: 11, branch: 'work/DEV-1' }), queued('DEV-2')] };
    const pulls = [pull(reviewed('DEV-1', 11))];
    expect(decide(spec, { pulls })).toEqual(decide(spec, { pulls }));
  });
});

describe('a held ticket and its pull request', () => {
  function one(ticket: Partial<TicketSpec>, spec: Partial<PullSpec>, options = {}) {
    const tickets = [started('DEV-1', { pullRequest: 11, branch: 'work/DEV-1', ...ticket })];
    const actions = decide({ tickets }, { pulls: [pull({ ...reviewed('DEV-1', 11), ...spec })], ...options });
    return actionFor(actions, 'DEV-1');
  }

  it('frees the slot of a merged ticket for the queue head', () => {
    const tickets = [started('DEV-1', { pullRequest: 11, branch: 'work/DEV-1' }), queued('DEV-2')];
    const actions = decide({ tickets }, { clusterSize: 1, pulls: [pull({ ...reviewed('DEV-1', 11), state: 'MERGED' })] });
    expect(actionFor(actions, 'DEV-1')).toBeUndefined();
    expect(assigned(actions)).toEqual(['DEV-2']);
  });

  it('sends a pull request closed unmerged to a human', () => {
    expect(one({}, { state: 'CLOSED' })).toMatchObject({ kind: 'mark-human-wait', reason: 'pull-request-closed' });
  });

  it('sends a pull request on an unexpected base to a human, naming the base', () => {
    expect(one({}, { base: 'main' })).toMatchObject({ kind: 'mark-human-wait', reason: 'pull-request-off-base' });
  });

  it('sends a pull request whose branch is not the one the tracker names to a human', () => {
    expect(one({ branch: 'work/other' }, {})).toMatchObject({
      kind: 'mark-human-wait',
      reason: 'tracker-github-mismatch',
      detail: expect.stringMatching(/work\/other/),
    });
  });

  it('compares the pull request with the base as resolved, not as declared', () => {
    const tickets = [started('DEV-1', { pullRequest: 11, branch: 'work/DEV-1' })];
    const auto = loopProgramOf(parseProgramDescriptor(programText().replace('base: develop', 'base: auto')));
    const spec = { tickets };
    const decision = decideLoop({
      program: auto,
      tracker: tracker(spec),
      github: github([pull(reviewed('DEV-1', 11))]),
      signal: 'none',
      sharedState: sharedState(spec),
      armed: new Map(),
      reviews: localReviews(spec, [pull(reviewed('DEV-1', 11))]),
      now: NOW,
    });
    expect(actionFor(decision.actions, 'DEV-1')).toMatchObject({ kind: 'enable-auto-merge' });
  });

  it('never arms a merge into the branch that deploys, once `auto` resolves to it', () => {
    const tickets = [started('DEV-1', { pullRequest: 11, branch: 'work/DEV-1' })];
    const auto = loopProgramOf(parseProgramDescriptor(programText().replace('base: develop', 'base: auto')));
    const spec = { tickets };
    const onMain: GithubObservation = {
      ...github([pull({ ...reviewed('DEV-1', 11), base: 'main' })]),
      base: 'main',
    };
    const decision = decideLoop({
      program: auto,
      tracker: tracker(spec),
      github: onMain,
      signal: 'none',
      sharedState: sharedState(spec),
      armed: new Map(),
      reviews: localReviews(spec, [pull(reviewed('DEV-1', 11))]),
      now: NOW,
    });
    expect(actionFor(decision.actions, 'DEV-1')).toMatchObject({
      kind: 'mark-human-wait',
      reason: 'deploy-branch-target',
    });
  });

  it('sends a pull request it could not observe to a human', () => {
    const tickets = [started('DEV-1', { pullRequest: 11, branch: 'work/DEV-1' })];
    expect(actionFor(decide({ tickets }), 'DEV-1')).toMatchObject({
      kind: 'mark-human-wait',
      reason: 'github-unreadable',
    });
  });

  it('leaves a live worker alone whatever its pull request says', () => {
    const tickets = [started('DEV-1', { pullRequest: 11, branch: 'work/DEV-1' })];
    const pulls = [pull({ ...reviewed('DEV-1', 11), failingCheck: true })];
    const actions = decide({ tickets, liveWorkers: ['DEV-1'] }, { pulls });
    expect(actionFor(actions, 'DEV-1')).toMatchObject({ kind: 'wait', reason: 'worker-active' });
  });

  it('resumes a draft nobody is working on', () => {
    expect(one({}, { draft: true })).toMatchObject({ kind: 'hand-back-to-worker', reason: 'resume' });
  });

  it('hands failing checks back to the worker', () => {
    expect(one({}, { failingCheck: true })).toMatchObject({
      kind: 'hand-back-to-worker',
      reason: 'checks-failed',
    });
  });

  describe('the local verdict on the head', () => {
    const finding = { location: 'packages/cli/src/a.ts:3', scenario: 'A merged ticket keeps its slot.', correction: 'Free the slot on merge.' };
    const blockingOn = (headSha: string, round: 1 | 2 = 1) => ({ headSha, round, blocking: [finding], advisory: [] });
    const review = { kind: 'review', ticketId: 'DEV-1', pullRequest: 11, headSha: headOf(11), round: 1 };

    it('delegates a review when no verdict is recorded for the head', () => {
      expect(one({}, {}, { reviews: { 'DEV-1': [] } })).toEqual(review);
    });

    it('ignores a verdict recorded on another head: a head moved after its verdict is reviewed again', () => {
      const older = localReview('DEV-1', 11, { headSha: headOf(12) });
      expect(one({}, {}, { reviews: { 'DEV-1': [older] } })).toEqual(review);
      // After a blocked head, the next one is reviewed as round 2.
      const blocked = localReview('DEV-1', 11, { headSha: headOf(12), verdict: blockingOn(headOf(12)) });
      expect(one({}, {}, { reviews: { 'DEV-1': [blocked] } })).toEqual({ ...review, round: 2 });
    });

    it('arms the auto-merge on the exact head a clean verdict was recorded on', () => {
      expect(one({}, {})).toEqual({ kind: 'enable-auto-merge', ticketId: 'DEV-1', pullRequest: 11, headSha: headOf(11) });
    });

    it('hands a blocking verdict back to the worker, two rounds at most', () => {
      const first = [localReview('DEV-1', 11, { verdict: blockingOn(headOf(11)) })];
      expect(one({}, {}, { reviews: { 'DEV-1': first } })).toEqual({
        kind: 'hand-back-to-worker', ticketId: 'DEV-1', reason: 'review-blocking', pullRequest: 11,
      });
      const second = [
        localReview('DEV-1', 11, { headSha: headOf(12), verdict: blockingOn(headOf(12)) }),
        localReview('DEV-1', 11, { verdict: blockingOn(headOf(11), 2) }),
      ];
      expect(one({}, {}, { reviews: { 'DEV-1': second } })).toMatchObject({
        kind: 'mark-human-wait', reason: 'review-rounds-exhausted',
      });
    });

    it('counts the rounds from the heads the verdicts blocked, whatever round a verdict announces', () => {
      const announcedTwo = [localReview('DEV-1', 11, { verdict: blockingOn(headOf(11), 2) })];
      expect(one({}, {}, { reviews: { 'DEV-1': announcedTwo } })).toMatchObject({ reason: 'review-blocking' });
      // Another pull request of the ticket is another review: its rounds are its own.
      const elsewhere = { ...localReview('DEV-1', 13, { headSha: headOf(13), verdict: blockingOn(headOf(13)) }) };
      const current = localReview('DEV-1', 11, { verdict: blockingOn(headOf(11)) });
      expect(one({}, {}, { reviews: { 'DEV-1': [elsewhere, current] } })).toMatchObject({ reason: 'review-blocking' });
    });

    it('waits while a review of the head runs, and delegates again once it outlived its window', () => {
      const running = [localReview('DEV-1', 11, { verdict: null, attempts: [{ runId: RUN, startedAt: NOW - 60_000 }] })];
      expect(one({}, {}, { reviews: { 'DEV-1': running } })).toEqual({
        kind: 'wait', ticketId: 'DEV-1', reason: 'awaiting-review',
      });
      const interrupted = [localReview('DEV-1', 11, {
        verdict: null, attempts: [{ runId: RUN, startedAt: NOW - 3 * 60 * 60_000 }],
      })];
      expect(one({}, {}, { reviews: { 'DEV-1': interrupted } })).toEqual(review);
    });

    it('delegates again after a reviewer that failed or returned nothing, then asks a human', () => {
      const failed = (count: number) => [localReview('DEV-1', 11, {
        verdict: null,
        attempts: Array.from({ length: count }, (_, index) => ({
          runId: RUN, startedAt: NOW - 60_000 + index, endedAt: NOW - 1_000, failure: 'The reviewer returned no verdict.',
        })),
      })];
      expect(one({}, {}, { reviews: { 'DEV-1': failed(1) } })).toEqual(review);
      expect(one({}, {}, { reviews: { 'DEV-1': failed(2) } })).toMatchObject({
        kind: 'mark-human-wait', reason: 'review-failed', detail: expect.stringContaining('no verdict'),
      });
    });

    it('never merges on a record it cannot read, or one that names another head', () => {
      const cases: Record<string, unknown>[] = [
        { ...localReview('DEV-1', 11), schemaVersion: 2 },
        { ...localReview('DEV-1', 11), pullRequest: 12 },
        { ...localReview('DEV-1', 11), ticketId: 'DEV-2' },
      ];
      for (const record of cases) {
        const reviews = { 'DEV-1': [record] };
        expect(one({}, {}, { reviews }), JSON.stringify(record)).toMatchObject({
          kind: 'mark-human-wait', reason: 'verdict-unproven',
        });
      }
      const forged = new Map([[headOf(11), { ...localReview('DEV-1', 11, { headSha: headOf(12) }) }]]);
      const tickets = [started('DEV-1', { pullRequest: 11, branch: 'work/DEV-1' })];
      const spec = { tickets };
      const decision = decideLoop({
        program: program(), tracker: tracker(spec), github: github([pull(reviewed('DEV-1', 11))]),
        signal: 'none', sharedState: sharedState(spec), armed: new Map(),
        reviews: new Map([['DEV-1', forged]]), now: NOW,
      });
      expect(actionFor(decision.actions, 'DEV-1')).toMatchObject({ kind: 'mark-human-wait', reason: 'verdict-unproven' });
    });

    it('gives a verdict posted on GitHub no effect, whoever posted it', () => {
      const posted = { verdict: approving(11), review: 'SUCCESS' as const };
      expect(one({}, posted, { reviews: { 'DEV-1': [] } })).toEqual(review);
      const blocked = { verdict: blockingOn(headOf(11)) };
      expect(one({}, blocked)).toMatchObject({ kind: 'enable-auto-merge' });
    });

    it('reads the review check GitHub runs as any other check', () => {
      expect(one({}, { review: 'FAILURE' })).toMatchObject({ kind: 'hand-back-to-worker', reason: 'checks-failed' });
      expect(one({}, { review: 'PENDING' })).toMatchObject({ kind: 'enable-auto-merge' });
    });

    it('keeps a failing check, a draft and a conflict ahead of any review', () => {
      const reviews = { 'DEV-1': [] };
      expect(one({}, { failingCheck: true }, { reviews })).toMatchObject({ reason: 'checks-failed' });
      expect(one({}, { draft: true }, { reviews })).toMatchObject({ reason: 'resume' });
      expect(one({}, { mergeState: 'DIRTY' }, { reviews })).toMatchObject({ reason: 'conflict' });
    });
  });

  it('waits once the auto-merge is armed or the pull request is queued', () => {
    expect(one({}, { autoMerge: true })).toMatchObject({ kind: 'wait', reason: 'merging' });
    expect(one({}, { autoMerge: true, queue: 'queued' })).toMatchObject({ kind: 'wait', reason: 'merging' });
  });

  describe('an armed auto-merge', () => {
    // GitHub keeps an auto-merge armed across a push by an account with write
    // access, and the required check trusts the status alone: a worker could
    // push after the merge is armed, then post a forged status on its new head.
    // The loop disarms whatever it can no longer vouch for.
    const tickets = [started('DEV-1', { pullRequest: 11, branch: 'work/DEV-1' })];
    const armedPull = (spec: Partial<PullSpec> = {}) =>
      pull({ ...reviewed('DEV-1', 11), autoMerge: true, ...spec });
    const forDev1 = (actions: readonly LoopAction[]) =>
      actions.filter((action) => 'ticketId' in action && action.ticketId === 'DEV-1');
    const disarm = { kind: 'disable-auto-merge', ticketId: 'DEV-1', pullRequest: 11, headSha: headOf(11) };

    it('leaves it alone on the head it was armed on, while the local verdict on that head holds', () => {
      expect(forDev1(decide({ tickets }, { pulls: [armedPull()] }))).toEqual([
        { kind: 'wait', ticketId: 'DEV-1', reason: 'merging' },
      ]);
    });

    it('disarms it once the head moved, then hands the ticket back to its worker', () => {
      const actions = decide({ tickets }, { pulls: [armedPull()], armedOn: { 'DEV-1': 'b'.repeat(40) } });
      expect(forDev1(actions)).toEqual([
        { ...disarm, armedSha: 'b'.repeat(40) },
        { kind: 'hand-back-to-worker', ticketId: 'DEV-1', reason: 'head-moved-after-arming', pullRequest: 11 },
      ]);
    });

    it('disarms it when no clean local verdict holds the armed head, then asks a human', () => {
      const blocking = { ...approving(11), blocking: [{ location: 'a.ts:1', scenario: 'Breaks.', correction: 'Fix.' }] };
      for (const records of [[], [localReview('DEV-1', 11, { verdict: blocking })]]) {
        const actions = decide({ tickets }, { pulls: [armedPull()], reviews: { 'DEV-1': records } });
        const [first, second] = forDev1(actions);
        expect(first).toEqual({ ...disarm, armedSha: headOf(11) });
        expect(second).toMatchObject({ kind: 'mark-human-wait', reason: 'armed-verdict-unproven' });
      }
    });

    it('disarms one armed outside `autopilot arm`, whose head nobody recorded, then asks a human', () => {
      const [first, second] = forDev1(decide({ tickets }, { pulls: [armedPull()], unarmed: ['DEV-1'] }));
      expect(first).toEqual(disarm);
      expect(second).toMatchObject({ kind: 'mark-human-wait', reason: 'arming-unrecorded' });
    });
  });

  it('re-queues an ejected head that still passes, twice at most, then asks a human', () => {
    // zed 64434: two `failed_checks` ejections with no commit between, then a
    // re-queue that merged. The worker has nothing to fix; the loop re-queues.
    expect(one({}, { queue: 'ejected', ejections: 1 })).toEqual({
      kind: 'requeue',
      ticketId: 'DEV-1',
      pullRequest: 11,
      headSha: headOf(11),
      ejections: 1,
    });
    expect(one({}, { queue: 'ejected', ejections: 2 })).toMatchObject({ kind: 'requeue', ejections: 2 });
    expect(one({}, { queue: 'ejected', ejections: 3 })).toMatchObject({
      kind: 'mark-human-wait',
      reason: 'ejections-exhausted',
    });
  });

  it('hands an ejected head back to its worker when its own checks fail', () => {
    expect(one({}, { queue: 'ejected', failingCheck: true })).toMatchObject({
      kind: 'hand-back-to-worker',
      reason: 'checks-failed',
    });
  });

  it('routes a conflict by the class the worker gave it', () => {
    expect(one({}, { mergeState: 'DIRTY' })).toMatchObject({ kind: 'hand-back-to-worker', reason: 'conflict' });
    const mechanical = { headSha: headOf(11), class: 'mechanical', reason: 'Both sides appended to one list.' };
    expect(one({}, { conflict: mechanical, mergeState: 'DIRTY' })).toMatchObject({
      kind: 'hand-back-to-worker',
      reason: 'conflict',
    });
    const semantic = { headSha: headOf(11), class: 'semantic', reason: 'Both sides changed the merge grant.' };
    expect(one({}, { conflict: semantic, mergeState: 'DIRTY' })).toMatchObject({
      kind: 'mark-human-wait',
      reason: 'semantic-conflict',
    });
    expect(one({}, { conflict: { headSha: headOf(11), class: 'semantic' }, mergeState: 'DIRTY' })).toMatchObject({
      kind: 'mark-human-wait',
      reason: 'conflict-class-unreadable',
    });
    // A class given on an older head answered an older conflict: ask again.
    expect(one({}, { conflict: { ...semantic, headSha: headOf(12) }, mergeState: 'DIRTY' })).toMatchObject({
      kind: 'hand-back-to-worker',
      reason: 'conflict',
    });
  });

  it('takes the conflict class from GitHub and the verdict from the local record, never from the tracker', () => {
    const raw = trackerRaw({ tickets: [started('DEV-1', { pullRequest: 11, branch: 'work/DEV-1' })] });
    const tickets = (raw.tickets as Record<string, unknown>[]).map((ticket) => ({ ...ticket, review: approving(11) }));
    expect(admitLoopTracker({ ...raw, tickets })).toMatchObject({ ok: false, reason: expect.stringMatching(/review/) });
  });

  it('leaves the merge to a human under a human merge gate', () => {
    expect(one({}, {}, { mergeGate: 'human' })).toMatchObject({
      kind: 'mark-human-wait',
      reason: 'human-merge-gate',
    });
  });

  it('delegates no review under a human merge gate', () => {
    // The person who merges is the review, and the pull request is theirs as
    // soon as it is ready.
    const human = { mergeGate: 'human', reviews: { 'DEV-1': [] } };
    expect(one({}, {}, human)).toMatchObject({ kind: 'mark-human-wait', reason: 'human-merge-gate' });
  });

  it('keeps a draft, a conflict, a failing check and a protected path ahead of the human merge gate', () => {
    const human = { mergeGate: 'human', reviews: { 'DEV-1': [] } };
    const unreviewed = {};
    expect(one({}, { ...unreviewed, draft: true }, human)).toMatchObject({
      kind: 'hand-back-to-worker',
      reason: 'resume',
    });
    expect(one({}, { ...unreviewed, mergeState: 'DIRTY' }, human)).toMatchObject({
      kind: 'hand-back-to-worker',
      reason: 'conflict',
    });
    expect(one({}, { ...unreviewed, failingCheck: true }, human)).toMatchObject({
      kind: 'hand-back-to-worker',
      reason: 'checks-failed',
    });
    expect(one({}, { ...unreviewed, files: ['.void/program.md'] }, human)).toMatchObject({
      kind: 'mark-human-wait',
      reason: 'protected-path',
    });
  });

  it('frees the slot of a ticket sent to a human in the same tick', () => {
    const tickets = [started('DEV-1', { pullRequest: 11, branch: 'work/DEV-1' }), queued('DEV-2')];
    const pulls = [pull({ ...reviewed('DEV-1', 11), state: 'CLOSED' })];
    expect(assigned(decide({ tickets }, { clusterSize: 1, pulls }))).toEqual(['DEV-2']);
  });
});

describe('protected paths', () => {
  // A change to the machinery that judges a merge is never merged by that
  // machinery: the workflows, the verdict check, the programme and the hooks
  // go to a person, whatever the review said.
  const tickets = [started('DEV-1', { pullRequest: 12, branch: 'work/DEV-1' })];
  const touching = (files: readonly string[], extra: Partial<PullSpec> = {}) =>
    pull(reviewed('DEV-1', 12, { files, ...extra }));

  it('never arms a merge on a pull request that touches a protected path', () => {
    for (const file of [
      '.github/workflows/ci.yml',
      '.github/actions/void-enforce/action.yml',
      'scripts/independent-review-check.mjs',
      '.void/program.md',
      'packages/core/hooks/_void-hook.mjs',
      // What actually runs here: the installed runner, and the files that wire
      // it into each runtime or scope what it enforces.
      '.void/hooks/_void-hook.mjs',
      '.claude/settings.json',
      '.codex/hooks.json',
      '.void/config.json',
    ]) {
      const action = actionFor(decide({ tickets }, { pulls: [touching(['docs/a.md', file])] }), 'DEV-1');
      expect(action).toMatchObject({ kind: 'mark-human-wait', reason: 'protected-path' });
      expect(action).toMatchObject({ detail: expect.stringContaining(file) });
    }
  });

  it('holds back the refusal to merge into the branch that deploys', () => {
    // `sameBranch` is the one guard a verdict cannot override: relaxed and
    // merged by the loop, it would let the loop merge into production.
    const file = 'packages/cli/src/lib/autopilot/branch-identity.ts';
    const action = actionFor(decide({ tickets }, { pulls: [touching([file])] }), 'DEV-1');
    expect(action).toMatchObject({ kind: 'mark-human-wait', reason: 'protected-path' });
  });

  it('holds back the files a judging workflow runs from outside .github', () => {
    // promotion.yml audits a promotion with the script develop carries, and
    // void-enforce replays the auto-merge contract and the enforcement floor
    // from the pull request itself; ci.yml's required verdict is aggregated by
    // verify.mjs. Merged by the loop, a weakened copy of any of them would
    // judge every later merge or promotion.
    for (const file of [
      'scripts/promotion-authority.mjs',
      'scripts/auto-merge-contract.mjs',
      'scripts/verify.mjs',
      'packages/core/enforce/ci-enforce.sh',
    ]) {
      const action = actionFor(decide({ tickets }, { pulls: [touching(['docs/a.md', file])] }), 'DEV-1');
      expect(action, file).toMatchObject({ kind: 'mark-human-wait', reason: 'protected-path' });
    }
  });

  it('holds back what judges a publication, and the contracts it reads', () => {
    // release.yml runs these from the commit being released: a copy relaxed on
    // develop reaches main through a promotion a person judges by its feature.
    for (const file of [
      'scripts/prepare-release-artifact.mjs',
      'scripts/verify-release-publication.mjs',
      'scripts/release-artifact-contract.mjs',
      'scripts/release-provenance-contract.mjs',
    ]) {
      const action = actionFor(decide({ tickets }, { pulls: [touching(['docs/a.md', file])] }), 'DEV-1');
      expect(action, file).toMatchObject({ kind: 'mark-human-wait', reason: 'protected-path' });
    }
  });

  it('holds back the code that decides to believe a verdict, the floor included', () => {
    for (const file of [
      'packages/cli/src/lib/autopilot/loop.ts',
      'packages/cli/src/lib/autopilot/loop-observe.ts',
      'packages/cli/src/commands/autopilot-loop.ts',
      'scripts/independent-review-run.mjs',
      '.github/review/prompt.md',
      '.github/workflows/independent-review.yml',
    ]) {
      const action = actionFor(decide({ tickets }, { pulls: [touching(['docs/a.md', file])] }), 'DEV-1');
      expect(action, file).toMatchObject({ kind: 'mark-human-wait', reason: 'protected-path' });
    }
  });

  it('holds back the local chain of judgment: the reviewer, its delegation and its programme', () => {
    // The verdict the loop merges on is produced on this machine: the kernel
    // delegates the reviewer, the agents command drives it, the programme
    // grants the merge and `judgments.ts` admits the verdict. The reviewer
    // runs in a worktree of the head, so the runtime configuration it loads
    // there (its agent definition, settings, MCP servers) judges too.
    for (const file of [
      'packages/void-machine/src/core/delegation.ts',
      'packages/void-machine/src/adapters/runtime/claude-session.ts',
      'packages/cli/src/commands/agents.ts',
      'packages/cli/src/lib/autopilot/program.ts',
      'packages/cli/src/lib/autopilot/judgments.ts',
      'packages/cli/src/commands/autopilot-review.ts',
      'packages/mission-engine/src/specialist/completion.ts',
      'packages/core/agents/independent-code-reviewer.md',
      'packages/cli/core-assets/specialists/independent-code-reviewer.yaml',
      '.claude/agents/independent-code-reviewer.md',
      '.claude/settings.local.json',
      '.mcp.json',
    ]) {
      const action = actionFor(decide({ tickets }, { pulls: [touching(['docs/a.md', file])] }), 'DEV-1');
      expect(action, file).toMatchObject({ kind: 'mark-human-wait', reason: 'protected-path' });
    }
  });

  it('holds back a real pull request that rewrote the programme', () => {
    const captured = (
      JSON.parse(readFileSync(new URL('./__fixtures__/gh/pr-view-files.json', import.meta.url), 'utf8')) as {
        files: { path: string }[];
      }
    ).files.map((file) => file.path);
    // The capture itself: the programme and the installed runner are both in it.
    expect(captured).toEqual(expect.arrayContaining(['.void/program.md', '.void/hooks/_void-hook.mjs']));
    const action = actionFor(decide({ tickets }, { pulls: [touching(captured)] }), 'DEV-1');
    expect(action).toMatchObject({ kind: 'mark-human-wait', reason: 'protected-path' });
  });

  it('adds the paths the programme declares to the floor, never in place of it', () => {
    const protectedPaths = ['docs/decisions-log/**'];
    const decision = decide({ tickets }, { pulls: [touching(['docs/decisions-log/x.md'])], protectedPaths });
    expect(actionFor(decision, 'DEV-1')).toMatchObject({ reason: 'protected-path' });
    const floor = decide({ tickets }, { pulls: [touching(['.github/workflows/ci.yml'])], protectedPaths });
    expect(actionFor(floor, 'DEV-1')).toMatchObject({ reason: 'protected-path' });
    expect(protectedPathsOf(program({ protectedPaths }).autopilot)).toEqual([
      ...PROTECTED_PATHS_FLOOR,
      'docs/decisions-log/**',
    ]);
  });

  it('holds back a rename that moves a protected file away, by its source', () => {
    // gh reports only where a renamed file lands; the verdict check leaving
    // `scripts/` would break every later review job on the base.
    const moved = 'scripts/ci/independent-review-check.mjs';
    const renamed = { [moved]: 'scripts/independent-review-check.mjs' };
    const action = actionFor(decide({ tickets }, { pulls: [touching([moved], { renamed })] }), 'DEV-1');
    expect(action).toMatchObject({ kind: 'mark-human-wait', reason: 'protected-path' });
    expect(action).toMatchObject({ detail: expect.stringContaining('scripts/independent-review-check.mjs') });
  });

  it('holds back a rename that moves a file onto protected ground, by its destination', () => {
    const renamed = { '.github/workflows/new.yml': 'docs/a.yml' };
    const pulls = [touching(['.github/workflows/new.yml'], { renamed })];
    expect(actionFor(decide({ tickets }, { pulls }), 'DEV-1')).toMatchObject({ reason: 'protected-path' });
  });

  it('hands a protected path to a person before any review: the reviewer would run its configuration', () => {
    // The reviewer runs in a worktree of the head, where Claude loads the
    // project's agents, settings, hooks and MCP servers: a head that changes
    // them is never checked out for a review.
    for (const file of ['.claude/settings.json', '.claude/agents/independent-code-reviewer.md', '.mcp.json']) {
      const action = actionFor(decide({ tickets }, { pulls: [touching([file])], reviews: { 'DEV-1': [] } }), 'DEV-1');
      expect(action, file).toMatchObject({ kind: 'mark-human-wait', reason: 'protected-path' });
    }
  });

  it('treats a file list GitHub cut short as touching a protected path', () => {
    const action = actionFor(
      decide({ tickets }, { pulls: [touching(['docs/a.md'], { changedFiles: 140 })] }),
      'DEV-1',
    );
    expect(action).toMatchObject({ kind: 'mark-human-wait', reason: 'protected-path' });
  });

  it('arms the merge of a pull request that stays off protected ground', () => {
    const action = actionFor(decide({ tickets }, { pulls: [touching(['docs/a.md', '.void/notes.md'])] }), 'DEV-1');
    expect(action).toMatchObject({ kind: 'enable-auto-merge' });
  });
});

describe('promotion', () => {
  it('never arms a pull request whose head is a branch the loop merges into or ships from', () => {
    // A ticket that names no branch accepts any head, so the head itself is
    // checked: develop into main is a promotion, and a promotion is a person's.
    for (const head of ['develop', 'main']) {
      const tickets = [started('DEV-1', { pullRequest: 12 })];
      const pulls = [pull(reviewed('DEV-1', 12, { branch: head }))];
      expect(actionFor(decide({ tickets }, { pulls }), 'DEV-1'), head).toMatchObject({
        kind: 'mark-human-wait',
        reason: 'promotion-pull-request',
      });
    }
  });
});

describe('the human-wait label', () => {
  const tickets = [started('DEV-1', { pullRequest: 11, branch: 'work/DEV-1' })];
  const pulls = [pull({ ...reviewed('DEV-1', 11), state: 'CLOSED' })];
  const input = (text: string): LoopInput => ({
    program: loopProgramOf(parseProgramDescriptor(text)),
    tracker: tracker({ tickets }),
    github: github(pulls),
    signal: 'none',
    sharedState: sharedState({ tickets }),
    armed: new Map(),
    reviews: localReviews({ tickets }, pulls),
    now: NOW,
  });

  it('names one label for every ticket handed to a person, the declared one first', () => {
    expect(HUMAN_WAIT_LABEL).toBe('void:human-wait');
    expect(decideLoop(input(programText())).humanWaitLabel).toBe(HUMAN_WAIT_LABEL);
    const declared = programText().replace('base: develop', 'base: develop\n  humanWaitLabel: needs-human');
    expect(decideLoop(input(declared)).humanWaitLabel).toBe('needs-human');
  });
});

describe('shared repository state', () => {
  const tickets = [started('DEV-1', { pullRequest: 11, branch: 'work/DEV-1' })];
  const pulls = [pull(reviewed('DEV-1', 11))];

  it('refuses to publish a unit that changed the shared Git state', () => {
    const actions = decide({ tickets }, { pulls, changed: ['DEV-1'] });
    expect(actionFor(actions, 'DEV-1')).toMatchObject({
      kind: 'mark-human-wait',
      reason: 'shared-state-changed',
      detail: expect.stringMatching(/stash/),
    });
  });

  it('refuses to publish a unit whose state before it was never recorded', () => {
    const actions = decide({ tickets }, { pulls, unrecorded: ['DEV-1'] });
    expect(actionFor(actions, 'DEV-1')).toMatchObject({
      kind: 'mark-human-wait',
      reason: 'shared-fingerprint-missing',
    });
  });

  it("ignores the upstream the worker set on its own branch, and only that one", () => {
    const input = (config: string): LoopInput => ({
      program: program(),
      tracker: tracker({ tickets }),
      github: github(pulls),
      signal: 'none',
      sharedState: { ...sharedState({ tickets }), current: { ...SHARED_READING, config } },
      armed: new Map(),
      reviews: localReviews({ tickets }, pulls),
      now: NOW,
    });
    const own = `${SHARED_READING.config}branch.work/DEV-1.remote=origin\n`;
    expect(actionFor(decideLoop(input(own)).actions, 'DEV-1')).toMatchObject({ kind: 'enable-auto-merge' });
    const base = `${SHARED_READING.config}branch.develop.merge=refs/heads/work/DEV-1\n`;
    expect(actionFor(decideLoop(input(base)).actions, 'DEV-1')).toMatchObject({
      kind: 'mark-human-wait',
      reason: 'shared-state-changed',
    });
  });

  it('arms a unit whose neighbour set and removed the upstream of its own branch', () => {
    const since = 'branch.work/DEV-2.remote=origin\nbranch.work/DEV-2.merge=refs/heads/develop\n';
    const input: LoopInput = {
      program: program(),
      tracker: tracker({ tickets }),
      github: github(pulls),
      signal: 'none',
      sharedState: sharedState({ tickets }, { since }),
      armed: new Map(),
      reviews: localReviews({ tickets }, pulls),
      now: NOW,
    };
    expect(actionFor(decideLoop(input).actions, 'DEV-1')).toMatchObject({ kind: 'enable-auto-merge' });
    const moved = { ...input, sharedState: sharedState({ tickets }, { since: 'branch.develop.merge=refs/heads/work/DEV-2\n' }) };
    expect(actionFor(decideLoop(moved).actions, 'DEV-1')).toMatchObject({
      kind: 'mark-human-wait',
      reason: 'shared-state-changed',
    });
  });

  it('protects the local refs of every branch the loop may merge into or ship from', () => {
    expect(protectedBranches(program().autopilot)).toEqual(['develop', 'main']);
    const auto = loopProgramOf(parseProgramDescriptor(programText({ mergeGate: 'human' }).replace('base: develop', 'base: auto')));
    expect(protectedBranches(auto.autopilot)).toEqual(['develop', 'main']);
    const human = program({ mergeGate: 'human' });
    expect(protectedBranches(human.autopilot)).toEqual(['develop']);
  });

  it('publishes a unit that left the shared state as it found it', () => {
    expect(actionFor(decide({ tickets }, { pulls }), 'DEV-1')).toMatchObject({ kind: 'enable-auto-merge' });
  });
});

describe('serial merges without a merge queue', () => {
  const tickets = [
    started('DEV-1', { pullRequest: 11, branch: 'work/DEV-1' }),
    started('DEV-2', { pullRequest: 12, branch: 'work/DEV-2' }),
  ];

  it('lets one pull request merge at a time, the oldest first', () => {
    const pulls = [pull(reviewed('DEV-1', 11)), pull(reviewed('DEV-2', 12))];
    const actions = decide({ tickets }, { pulls, mergeQueue: false });
    expect(actionFor(actions, 'DEV-1')).toMatchObject({ kind: 'enable-auto-merge', pullRequest: 11 });
    expect(actionFor(actions, 'DEV-2')).toMatchObject({ kind: 'wait', reason: 'serial-merge-turn' });
  });

  it('keeps the turn with a pull request already merging', () => {
    const pulls = [pull(reviewed('DEV-1', 11)), pull(reviewed('DEV-2', 12, { autoMerge: true }))];
    const actions = decide({ tickets }, { pulls, mergeQueue: false });
    expect(actionFor(actions, 'DEV-1')).toMatchObject({ kind: 'wait', reason: 'serial-merge-turn' });
    expect(actionFor(actions, 'DEV-2')).toMatchObject({ kind: 'wait', reason: 'merging' });
  });

  it('updates the pull request whose turn it is when its base moved', () => {
    const pulls = [pull(reviewed('DEV-1', 11, { mergeState: 'BEHIND' })), pull(reviewed('DEV-2', 12))];
    const actions = decide({ tickets }, { pulls, mergeQueue: false });
    expect(actionFor(actions, 'DEV-1')).toMatchObject({ kind: 'hand-back-to-worker', reason: 'update-on-base' });
    expect(actionFor(actions, 'DEV-2')).toMatchObject({ kind: 'wait', reason: 'serial-merge-turn' });
  });

  it('leaves a base that moved to the merge queue when there is one', () => {
    const pulls = [pull(reviewed('DEV-1', 11, { mergeState: 'BEHIND' })), pull(reviewed('DEV-2', 12))];
    const actions = decide({ tickets }, { pulls, mergeQueue: true });
    expect(actionFor(actions, 'DEV-1')).toMatchObject({ kind: 'enable-auto-merge' });
    expect(actionFor(actions, 'DEV-2')).toMatchObject({ kind: 'enable-auto-merge' });
  });
});

describe('stopping', () => {
  it('freezes everything on an immediate stop', () => {
    const tickets = [started('DEV-1'), queued('DEV-2')];
    expect(decide({ tickets }, { signal: 'now' })).toEqual([{ kind: 'freeze' }]);
  });

  it('drains on request: no new ticket, held ones carried to their end', () => {
    const tickets = [started('DEV-1'), queued('DEV-2')];
    const actions = decide({ tickets }, { signal: 'drain' });
    expect(assigned(actions)).toEqual([]);
    expect(actions).toContainEqual({ kind: 'drain', reason: 'requested' });
    expect(actionFor(actions, 'DEV-1')).toMatchObject({ kind: 'hand-back-to-worker' });
    expect(actions.some((action) => action.kind === 'recap')).toBe(false);
  });

  it('writes the recap once a drain holds no slot any more', () => {
    const tickets = [started('DEV-1', { pullRequest: 11, branch: 'work/DEV-1' }), queued('DEV-2')];
    const pulls = [pull({ ...reviewed('DEV-1', 11), state: 'MERGED' })];
    const recent = [{ ticketId: 'DEV-0', outcome: 'human-wait' as const, reason: 'branch-missing' }];
    const actions = decide({ tickets, recent }, { signal: 'drain', pulls });
    expect(actions).toContainEqual({
      kind: 'recap',
      merged: ['DEV-1'],
      humanWait: [{ ticketId: 'DEV-0', reason: 'branch-missing' }],
    });
  });

  it('names in the recap why each ticket sent to a human this tick went there', () => {
    const tickets = [started('DEV-1', { pullRequest: 11, branch: 'work/DEV-1' })];
    const pulls = [pull({ ...reviewed('DEV-1', 11), base: 'main' })];
    const actions = decide({ tickets }, { signal: 'drain', pulls });
    expect(actions).toContainEqual({
      kind: 'recap',
      merged: [],
      humanWait: [{ ticketId: 'DEV-1', reason: 'pull-request-off-base' }],
    });
  });

  it('refuses a ticket recorded in human wait without the reason it went there', () => {
    const raw = trackerRaw({ tickets: [], recent: [{ ticketId: 'DEV-0', outcome: 'human-wait' }] });
    expect(admitLoopTracker(raw)).toMatchObject({ ok: false, reason: expect.stringMatching(/reason/) });
  });

  it('keeps no catch-all cause: every way to a human names its own', () => {
    expect(HUMAN_WAIT_REASONS).not.toContain('ambiguous-state');
    expect(HUMAN_WAIT_REASONS).toEqual(expect.arrayContaining([
      'github-unreadable',
      'tracker-github-mismatch',
      'branch-missing',
      'verdict-unproven',
      'shared-fingerprint-missing',
    ]));
  });

  it('drains when the quota runs low', () => {
    const actions = decide({ tickets: [queued('DEV-1')], quota: 'low' });
    expect(assigned(actions)).toEqual([]);
    expect(actions).toContainEqual({ kind: 'drain', reason: 'quota-low' });
  });

  it('drains after three consecutive tickets sent to a human', () => {
    const recent = [
      { ticketId: 'DEV-7', outcome: 'merged' as const },
      { ticketId: 'DEV-8', outcome: 'human-wait' as const, reason: 'semantic-conflict' },
      { ticketId: 'DEV-9', outcome: 'human-wait' as const, reason: 'branch-missing' },
    ];
    const tickets = [started('DEV-1', { pullRequest: 11, branch: 'work/DEV-1' }), queued('DEV-2')];
    const pulls = [pull({ ...reviewed('DEV-1', 11), state: 'CLOSED' })];
    const actions = decide({ tickets, recent }, { pulls });
    expect(actions).toContainEqual({ kind: 'drain', reason: 'human-wait-streak' });
    expect(assigned(actions)).toEqual([]);
    // Two in a row is not three: a merge in between resets the count.
    const broken = [...recent.slice(1), { ticketId: 'DEV-6', outcome: 'merged' as const }];
    expect(assigned(decide({ tickets, recent: broken }, { pulls }))).toEqual(['DEV-2']);
  });

  it('does not count a pull request that only waits for a human merge in the streak', () => {
    // Under `mergeGate: human` every ready pull request waits for a person by
    // design; counting those would stop the loop after three good tickets.
    const gate = (ticketId: string) => ({ ticketId, outcome: 'human-wait' as const, reason: 'human-merge-gate' });
    const recent = [gate('DEV-7'), gate('DEV-8'), gate('DEV-9')];
    const tickets = [started('DEV-1', { pullRequest: 11, branch: 'work/DEV-1' }), queued('DEV-2')];
    const pulls = [pull(reviewed('DEV-1', 11))];
    const actions = decide({ tickets, recent }, { pulls, mergeGate: 'human' });
    expect(actions).not.toContainEqual({ kind: 'drain', reason: 'human-wait-streak' });
    expect(assigned(actions)).toEqual(['DEV-2']);
    // A wait for any other reason still counts, around the merge gates.
    const mixed = [
      { ticketId: 'DEV-6', outcome: 'human-wait' as const, reason: 'semantic-conflict' },
      gate('DEV-7'),
      { ticketId: 'DEV-8', outcome: 'human-wait' as const, reason: 'github-unreadable' },
    ];
    const closed = [pull({ ...reviewed('DEV-1', 11), state: 'CLOSED' })];
    expect(decide({ tickets, recent: mixed }, { pulls: closed })).toContainEqual({
      kind: 'drain',
      reason: 'human-wait-streak',
    });
  });

  it('drains when no queued ticket is ready or can be made ready', () => {
    const tickets = [
      { ...queued('DEV-1'), readiness: { verdict: 'ambiguous', reason: 'Two readings.' } },
    ];
    expect(decide({ tickets })).toContainEqual({ kind: 'drain', reason: 'backlog-exhausted' });
  });

  it('keeps going while a ticket only waits for enrichment or a collision', () => {
    const enriching = [{ ...queued('DEV-1'), readiness: { verdict: 'needs-enrichment', reason: 'x.' } }];
    expect(decide({ tickets: enriching }).some((action) => action.kind === 'drain')).toBe(false);
    const colliding = [started('DEV-9', { footprint: ['packages'] }), queued('DEV-1')];
    expect(decide({ tickets: colliding }).some((action) => action.kind === 'drain')).toBe(false);
  });
});

describe('no action leaves an armed merge the loop cannot vouch for', () => {
  // GitHub merges an armed pull request on whatever head its checks pass, and
  // keeps it armed across a push by an account with write access. Whatever the
  // loop does with a ticket, then, it either still vouches for the armed head
  // (the head `autopilot arm` recorded, a verdict proven on it, nothing left
  // but the merge) or it disarms first. Each case is one way out of a tick.
  interface ArmedCase {
    readonly ticket?: Partial<TicketSpec>;
    readonly spec?: Partial<PullSpec>;
    readonly live?: boolean;
    /** The ticket names no branch, so any head is accepted and the head itself is judged. */
    readonly unbranched?: boolean;
    readonly options?: Parameters<typeof decide>[1];
    /** What the loop does while it keeps the merge armed on a head it vouches for. */
    readonly keeps?: LoopAction['kind'];
  }
  const blocking = {
    headSha: headOf(11),
    round: 1,
    blocking: [{ location: 'a.ts:1', scenario: 'A pushed head merges unread.', correction: 'Disarm.' }],
    advisory: [],
  };
  const failedTwice = localReview('DEV-1', 11, { verdict: null, attempts: [
    { runId: RUN, startedAt: 1, endedAt: 2, failure: 'No verdict.' },
    { runId: RUN, startedAt: 3, endedAt: 4, failure: 'No verdict.' },
  ] });
  const semantic = { headSha: headOf(11), class: 'semantic', reason: 'Both sides changed the grant.' };
  const cases: Readonly<Record<string, ArmedCase>> = {
    'proven and current': { keeps: 'wait' },
    'draining, proven and current': { options: { signal: 'drain' }, keeps: 'wait' },
    // The job that lets a proven head through ran before the verdict landed.
    'head moved after arming': { options: { armedOn: { 'DEV-1': 'b'.repeat(40) } } },
    'armed outside autopilot arm': { options: { unarmed: ['DEV-1'] } },
    'no local verdict': { options: { reviews: { 'DEV-1': [] } } },
    'blocking local verdict': { options: { reviews: { 'DEV-1': [localReview('DEV-1', 11, { verdict: blocking })] } } },
    'reviewer failed twice': { options: { reviews: { 'DEV-1': [failedTwice] } } },
    'worker active': { live: true },
    'checks failed': { spec: { failingCheck: true } },
    'mechanical conflict': { spec: { mergeState: 'DIRTY' } },
    'semantic conflict': { spec: { mergeState: 'DIRTY', conflict: semantic } },
    'back to draft': { spec: { draft: true } },
    'unexpected base': { spec: { base: 'main' } },
    'unexpected branch': { ticket: { branch: 'work/other' } },
    'promotion head': { unbranched: true, spec: { branch: 'develop' } },
    'review check failing on GitHub': { spec: { review: 'FAILURE' } },
    'ticket in human wait': { ticket: { humanWait: true } },
    'immediate stop': { options: { signal: 'now' } },
  };

  // GitHub arms a pull request one of two ways: an auto-merge request while its
  // checks run, or, once they pass on a base with a merge queue, an entry in
  // that queue and no request at all. Both merge without anyone acting again.
  const armings: Readonly<Record<string, Partial<PullSpec>>> = {
    'an auto-merge request': { autoMerge: true },
    'a merge queue entry': { autoMerge: false, queue: 'queued' },
  };

  function run(
    armedCase: ArmedCase,
    arming: Partial<PullSpec> = { autoMerge: true },
  ): readonly LoopAction[] {
    const branch = armedCase.unbranched === true ? {} : { branch: 'work/DEV-1' };
    const ticket = { ...started('DEV-1', { pullRequest: 11, ...branch }), ...armedCase.ticket };
    const spec = { tickets: [ticket], liveWorkers: armedCase.live === true ? ['DEV-1'] : [] };
    const pulls = [pull({ ...reviewed('DEV-1', 11), ...arming, ...armedCase.spec })];
    return decide(spec, { pulls, ...armedCase.options });
  }

  const table = Object.entries(armings).flatMap(([armingName, arming]) =>
    Object.entries(cases).map(([name, armedCase]) => ({ armingName, arming, name, armedCase })),
  );
  for (const { armingName, arming, name, armedCase } of table) {
    it(`${armedCase.keeps === undefined ? 'disarms' : 'keeps'} ${armingName}: ${name}`, () => {
      const actions = run(armedCase, arming);
      const disarms = actions.flatMap((action, index) =>
        action.kind === 'disable-auto-merge' && action.pullRequest === 11 ? [index] : [],
      );
      if (armedCase.keeps !== undefined) {
        expect(disarms).toEqual([]);
        expect(actionFor(actions, 'DEV-1')?.kind).toBe(armedCase.keeps);
        return;
      }
      expect(disarms).toHaveLength(1);
      // Disarmed before anyone acts on the ticket, and before the loop freezes.
      const acting = actions.findIndex(
        (action) =>
          action.kind !== 'disable-auto-merge' &&
          (action.kind === 'freeze' || ('ticketId' in action && action.ticketId === 'DEV-1')),
      );
      expect(acting === -1 || (disarms[0] as number) < acting).toBe(true);
    });
  }

  it('disarms before it freezes, and freezes all the same', () => {
    expect(run(cases['immediate stop'] as ArmedCase).map((action) => action.kind)).toEqual([
      'disable-auto-merge',
      'freeze',
    ]);
  });
});

describe('boundaries', () => {
  it('refuses a malformed tracker observation with the field at fault', () => {
    const raw = trackerRaw({ tickets: [queued('DEV-1')] });
    const admission = admitLoopTracker({ ...raw, quota: 'plenty' });
    expect(admission).toMatchObject({ ok: false });
    expect(admission.ok ? '' : admission.reason).toMatch(/quota/);
    expect(admitLoopTracker({ ...raw, extra: true }).ok).toBe(false);
    const twice = { ...raw, tickets: [...(raw.tickets as unknown[]), ...(raw.tickets as unknown[])] };
    expect(admitLoopTracker(twice).ok ? '' : 'refused').toBe('refused');
  });

  it('refuses a program that did not consent to autopilot', () => {
    const withheld = programText().replace('  schemaVersion: 1\n  clusterSize', '  enabled: false\n  schemaVersion: 1\n  clusterSize');
    expect(() => loopProgramOf(parseProgramDescriptor(withheld))).toThrow(/autopilot/);
  });

  it('reads the stop signal and refuses one it does not know', () => {
    expect(parseStopSignal(undefined)).toBe('none');
    expect(parseStopSignal('drain\n')).toBe('drain');
    expect(parseStopSignal(' now ')).toBe('now');
    expect(() => parseStopSignal('pause')).toThrow(/stop signal/);
  });

  it('observes the pull requests of held tickets and of undone tickets in human wait', () => {
    const tickets = [
      started('DEV-1', { pullRequest: 11 }),
      started('DEV-2'),
      { ...queued('DEV-3'), pullRequest: 13 },
      started('DEV-4', { pullRequest: 14, humanWait: true }),
      started('DEV-5', { status: 'Done', pullRequest: 15, humanWait: true }),
      { ...queued('DEV-6'), status: 'Backlog', pullRequest: 16 },
    ];
    const observed = pullRequestsToObserve(program(), tracker({ tickets, liveWorkers: ['DEV-3'] }));
    expect(observed).toEqual([11, 13, 14]);
  });
});
