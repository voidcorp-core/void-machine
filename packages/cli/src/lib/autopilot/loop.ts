// The deterministic kernel of the continuous loop: what each slot does next.
//
// Pure. It reads one complete observation (the programme, the tracker state the
// orchestrator hands over, GitHub as `gh` reported it, the stop signal) and
// returns typed actions. It remembers nothing between ticks, so a restart is an
// ordinary tick: the slots are rebuilt from Linear and GitHub, and a ticket that
// already holds one is resumed rather than seated twice.
//
// Agents keep their freedom over the work; every judgment they return is admitted
// by `judgments.ts` before it moves a slot, and one that does not fit is a
// refusal, never a default. Policy stays here: four slots at most, collisions by
// footprint and by `sequential` path, two review rounds, the stop conditions,
// one merge at a time without a merge queue, an ambiguous state to a human.
//
// There is one merge mode. Once a head carries a clean verdict, its checks have
// settled and its branch is up to date, the loop merges it into the
// integration branch itself, unless a person holds the merges, and never into
// the branch that deploys.
//
// The review verdict is local: `autopilot review` delegates a fresh-context,
// read-only reviewer on the exact head and records what it found, bound to that
// head and to the session the runtime listed. Nothing read on GitHub decides a
// merge: on a public repository anyone can comment, and a check GitHub runs is
// one more check.

import { z } from 'zod';
import { autopilotFailure } from './errors.js';
import { areaClaims, areasOverlap, type CompiledArea, compileArea } from './footprint-area.js';
import {
  type Admission,
  admitConflictClass,
  admitCuratorQueue,
  admitLocalReview,
  admitTicketReadiness,
  type CuratorQueueEntry,
  FOOTPRINT_AREAS_MAX,
  footprintAreaSchema,
  type LocalReview,
  type ReviewVerdict,
  ticketIdSchema,
} from './judgments.js';
import type { MergeHold } from './merge-hold.js';
import type { AutopilotConfig, ProgramDescriptor, ProgressStates } from './program.js';
import {
  changedParts,
  fingerprintOf,
  type SharedFingerprint,
  type SharedStateReading,
} from './shared-state.js';
import { sameBranch } from './branch-identity.js';
import { PRODUCT_COMMAND } from '@voidcorp/hook-runner';

/** A tracker scope larger than this is a backlog dump, not a loop observation. */
export const TRACKED_TICKETS_MAX = 256;
/**
 * The tracker label of a ticket handed to a person, unless the programme names
 * another in `autopilot.humanWaitLabel`. One name, so the orchestrator that sets
 * it and the one that reads it back after a restart can never disagree.
 */
export const HUMAN_WAIT_LABEL = 'void:human-wait';
/**
 * Paths the loop never merges itself: the machinery that decides whether a
 * change may merge. The workflows and actions run the required checks and
 * the review itself, the review scripts publish and verify it, the programme grants
 * the merge, and the hooks hold the enforcement floor. A change to any of them merged by the loop
 * would be the loop approving its own judge. A programme adds to this floor
 * through `autopilot.protectedPaths`; nothing removes from it.
 */
export const PROTECTED_PATHS_FLOOR = [
  '.github/**',
  'scripts/independent-review-check.mjs',
  'scripts/independent-review-run.mjs',
  // What a judging workflow runs from outside `.github`: the promotion audit
  // runs develop's own copy, void-enforce replays the auto-merge contract and
  // the enforcement floor from the pull request, and ci.yml's required verdict
  // is aggregated by verify.mjs.
  'scripts/promotion-authority.mjs',
  'scripts/auto-merge-contract.mjs',
  'scripts/verify.mjs',
  'packages/core/enforce/**',
  // What judges a publication: release.yml runs these from the commit it
  // releases, and the contracts they read decide what may reach npm.
  'scripts/prepare-release-artifact.mjs',
  'scripts/verify-release-publication.mjs',
  'scripts/release-artifact-contract.mjs',
  'scripts/release-provenance-contract.mjs',
  '.void/program.md',
  'packages/core/hooks/**',
  // What decides to believe a verdict and to arm a merge, this floor included,
  // and the one command that writes and proves a verdict.
  'packages/cli/src/lib/autopilot/loop.ts',
  'packages/cli/src/lib/autopilot/loop-observe.ts',
  // Decides whether the base is the branch that deploys, the one merge refused
  // whatever the verdict says.
  'packages/cli/src/lib/autopilot/branch-identity.ts',
  'packages/cli/src/commands/autopilot-loop.ts',
  // The local chain of judgment: the kernel delegates the reviewer and binds
  // its result to the session it launched, the agents command drives it, the
  // programme grants the merge, `judgments.ts` admits the verdict and the hold
  // parser decides whether a person keeps the merges.
  'packages/void-machine/src/**',
  'packages/cli/src/commands/agents.ts',
  'packages/cli/src/lib/autopilot/program.ts',
  'packages/cli/src/lib/autopilot/judgments.ts',
  'packages/cli/src/lib/autopilot/merge-hold.ts',
  // The command that delegates the reviewer and records its verdict, the
  // parser that reads the reviewer's answer, and the reviewer's own definition,
  // from its source to the copy the package ships.
  'packages/cli/src/commands/autopilot-review.ts',
  'packages/cli/src/commands/autopilot.ts',
  // Decides whether a changed file lies on protected ground at all.
  'packages/cli/src/lib/autopilot/footprint-area.ts',
  'packages/mission-engine/src/specialist/completion.ts',
  'packages/core/agents/independent-code-reviewer.md',
  'packages/core/specialists/independent-code-reviewer.yaml',
  'packages/cli/core-assets/agents/independent-code-reviewer.md',
  'packages/cli/core-assets/specialists/independent-code-reviewer.yaml',
  // The sources above run only after a release and a reinstall; these run now.
  // The installed runner, the files that wire it into Claude and Codex, and the
  // configuration that scopes what it enforces. The reviewer runs in a worktree
  // of the head and loads its runtime configuration there: its agent
  // definition, its settings and the MCP servers it may start.
  '.void/hooks/**',
  '.claude/**',
  '.mcp.json',
  '.codex/**',
  '.void/config.json',
] as const;
/** Outcomes kept for the recap; the stop rule reads only the last three. */
export const RECENT_MAX = 64;
const LIVE_WORKERS_MAX = 16;
/**
 * An ejected head that still passes is re-queued this many times. Ejections
 * without a commit usually come from a neighbour of the group or an unstable
 * check; past this, the same head keeps failing on the combined commit and a
 * person has to look.
 */
const EJECTIONS_PER_HEAD_MAX = 2;
/** A blocking review is answered twice at most; the third failure goes to a human. */
const REVIEW_ROUNDS_MAX = 2;
/**
 * A reviewer that fails or returns no verdict is delegated again once on the
 * same head. The attempts are recorded, so the count survives a restart; past
 * it, the review fails for a reason another run does not reach.
 */
export const REVIEW_ATTEMPTS_MAX = 2;
/**
 * How long a recorded review attempt is believed to be running. `autopilot
 * review` stops its reviewer well before; an attempt older than this was
 * interrupted, and counts as failed.
 */
export const REVIEW_RUNNING_MS = 45 * 60_000;
/** Three tickets in a row handed to a human means the loop is no longer helping. */
const HUMAN_WAIT_STREAK_MAX = 3;

export type StopSignal = 'none' | 'drain' | 'now';
export type QueueEvent = 'none' | 'queued' | 'ejected';

/** One pull request as `loop-observe` read it from `gh`. */
export interface PullRequestObservation {
  readonly number: number;
  readonly state: 'open' | 'merged' | 'closed';
  readonly draft: boolean;
  readonly headRef: string;
  readonly headSha: string;
  readonly baseRef: string;
  /** GitHub reports a conflict with the base (`mergeStateStatus: DIRTY`). */
  readonly conflicted: boolean;
  /**
   * The base moved on: GitHub reports `mergeStateStatus: BEHIND`, which it does
   * only under a protection that requires it, or the base has commits the head
   * lacks.
   */
  readonly behind: boolean;
  /** An auto-merge request is pending. A queued pull request holds none: see `queue`. */
  readonly autoMerge: boolean;
  /**
   * Every check GitHub reports on the head, whatever runs it. `none` is a head
   * no check runs on: a project without CI merges on its local verdict alone.
   */
  readonly checks: 'none' | 'pending' | 'passing' | 'failing';
  /** The last merge queue event not followed by a commit. */
  readonly queue: QueueEvent;
  /** Ejections of the current head from the merge queue since its last commit. */
  readonly ejections: number;
  /**
   * The last conflict class posted as a comment, raw: admitted where it is
   * consumed, like every judgment. GitHub keeps it across a restart.
   */
  readonly conflict?: unknown;
  /** The files the pull request changes, as far as they could be read. */
  readonly files: readonly ChangedFile[];
  /** How many files GitHub counts: more than `files` means the list was cut short. */
  readonly changedFiles: number;
}

/** One changed file; a rename carries where it came from, which is ground it changes too. */
export interface ChangedFile {
  readonly path: string;
  readonly previousPath?: string;
}

export interface GithubObservation {
  /** The branch the loop merges into, `auto` already resolved. */
  readonly base: string;
  /**
   * The repository's default branch, the one that deploys when the programme
   * names none. Undefined when GitHub reports none.
   */
  readonly defaultBranch: string | undefined;
  /** False when the base has no merge queue: merges then run one at a time. */
  readonly mergeQueue: boolean;
  readonly pullRequests: ReadonlyMap<number, PullRequestObservation>;
}

export interface LoopProgram {
  readonly autopilot: AutopilotConfig;
  readonly states: ProgressStates;
}

const trackerTicketSchema = z.strictObject({
  id: ticketIdSchema,
  /** The provider-native status, mapped to a role by the programme. */
  status: z.string().min(1).max(64),
  humanWait: z.boolean(),
  pullRequest: z.int().positive().max(2_147_483_647).optional(),
  branch: z.string().min(1).max(255).optional(),
  footprint: z.array(footprintAreaSchema).min(1).max(FOOTPRINT_AREAS_MAX).optional(),
  // A raw judgment, admitted where it is consumed so one malformed answer
  // refuses its own decision rather than the whole observation. The review
  // verdict and the conflict class are not here: they live on the pull request,
  // and the kernel reads them from GitHub.
  readiness: z.unknown().optional(),
});

// Each way to a human names its own cause, so a recap can tell a GitHub read
// that failed from a tracker that disagrees with GitHub or a verdict nobody
// proved. `branch-missing` is the one the orchestrator records itself: the
// kernel never observes worktrees or worker branches.
export const HUMAN_WAIT_REASONS = [
  'github-unreadable',
  'tracker-github-mismatch',
  'pull-request-off-base',
  'branch-missing',
  'verdict-unproven',
  'review-failed',
  'conflict-class-unreadable',
  'shared-fingerprint-missing',
  'arming-unrecorded',
  'pull-request-closed',
  'semantic-conflict',
  'review-rounds-exhausted',
  'human-merge-hold',
  'deploy-branch-target',
  'shared-state-changed',
  'ejections-exhausted',
  'protected-path',
  'promotion-pull-request',
  'armed-verdict-unproven',
] as const;
export type HumanWaitReason = (typeof HUMAN_WAIT_REASONS)[number];

// The reason a ticket went to a human is required: the recap repeats it, and
// the streak skips only the waits a human hold asks for.
const recentOutcomeSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ ticketId: ticketIdSchema, outcome: z.literal('merged') }),
  z.strictObject({
    ticketId: ticketIdSchema,
    outcome: z.literal('human-wait'),
    reason: z.enum(HUMAN_WAIT_REASONS),
  }),
]);

const loopTrackerSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    queue: z.unknown(),
    tickets: z.array(trackerTicketSchema).max(TRACKED_TICKETS_MAX),
    recent: z.array(recentOutcomeSchema).max(RECENT_MAX),
    liveWorkers: z.array(ticketIdSchema).max(LIVE_WORKERS_MAX),
    quota: z.enum(['ok', 'low']),
  })
  .superRefine((tracker, context) => {
    const seen = new Set<string>();
    tracker.tickets.forEach((ticket, index) => {
      if (seen.has(ticket.id)) {
        context.addIssue({
          code: 'custom',
          path: ['tickets', index, 'id'],
          message: `reports ${ticket.id} a second time`,
        });
      }
      seen.add(ticket.id);
    });
  });

export type LoopTracker = z.infer<typeof loopTrackerSchema>;
type TrackerTicket = LoopTracker['tickets'][number];

export type WaitReason =
  | 'worker-active'
  | 'awaiting-review'
  | 'merging'
  | 'serial-merge-turn'
  | 'checks-pending';
export type HandBackReason =
  | 'resume'
  | 'checks-failed'
  | 'review-blocking'
  | 'conflict'
  | 'head-moved-after-arming';
/** A ticket the run sent to a human, and why: what the recap reports. */
export interface HumanWaitEntry {
  readonly ticketId: string;
  readonly reason: HumanWaitReason;
}

export type DrainReason = 'requested' | 'quota-low' | 'human-wait-streak' | 'backlog-exhausted';

export type LoopAction =
  | { readonly kind: 'assign'; readonly ticketId: string; readonly footprint: readonly string[] }
  | { readonly kind: 'wait'; readonly ticketId: string; readonly reason: WaitReason }
  | {
      readonly kind: 'hand-back-to-worker';
      readonly ticketId: string;
      readonly reason: HandBackReason;
      readonly pullRequest?: number;
    }
  | {
      readonly kind: 'mark-human-wait';
      readonly ticketId: string;
      readonly reason: HumanWaitReason;
      readonly detail: string;
    }
  | {
      /** `autopilot merge`: merge exactly this head into the base, now. */
      readonly kind: 'merge';
      readonly ticketId: string;
      readonly pullRequest: number;
      readonly headSha: string;
    }
  | {
      /** Bring the base into the branch; the head moves, and is reviewed again. */
      readonly kind: 'update-branch';
      readonly ticketId: string;
      readonly pullRequest: number;
      readonly headSha: string;
    }
  | {
      readonly kind: 'enable-auto-merge';
      readonly ticketId: string;
      readonly pullRequest: number;
      readonly headSha: string;
    }
  | {
      readonly kind: 'disable-auto-merge';
      readonly ticketId: string;
      readonly pullRequest: number;
      /** The head the pull request has now. */
      readonly headSha: string;
      /** The head `autopilot arm` recorded, when it recorded one. */
      readonly armedSha?: string;
    }
  | {
      /** `autopilot review`: delegate a reviewer on exactly this head and record its verdict. */
      readonly kind: 'review';
      readonly ticketId: string;
      readonly pullRequest: number;
      readonly headSha: string;
      /** The round the kernel counted: 2 once another head of this pull request was blocked. */
      readonly round: 1 | 2;
    }
  | {
      readonly kind: 'requeue';
      readonly ticketId: string;
      readonly pullRequest: number;
      readonly headSha: string;
      /** How many times the queue already ejected this head. */
      readonly ejections: number;
    }
  | { readonly kind: 'drain'; readonly reason: DrainReason }
  | { readonly kind: 'freeze' }
  | {
      readonly kind: 'recap';
      readonly merged: readonly string[];
      readonly humanWait: readonly HumanWaitEntry[];
    };

/**
 * The shared Git state as git reports it now, and the fingerprint recorded
 * before each ticket's unit began. The current state stays a reading, not a
 * digest, because each record leaves out the upstream of its own branch.
 */
export interface SharedStateObservation {
  readonly current: SharedStateReading;
  readonly before: ReadonlyMap<string, SharedFingerprint>;
}

/** What `autopilot arm` recorded when it armed a ticket's pull request. */
export interface ArmedRecord {
  readonly pullRequest: number;
  readonly headSha: string;
}

export interface LoopInput {
  readonly program: LoopProgram;
  readonly tracker: LoopTracker;
  readonly github: GithubObservation;
  readonly signal: StopSignal;
  readonly sharedState: SharedStateObservation;
  /** The armed head of each ticket, by ticket, as `autopilot arm` recorded it. */
  readonly armed: ReadonlyMap<string, ArmedRecord>;
  /**
   * What `autopilot review` recorded, by ticket, then by the head each record
   * is filed under, raw: admitted where it is consumed.
   */
  readonly reviews: ReadonlyMap<string, ReadonlyMap<string, unknown>>;
  /** The instant of this tick, in milliseconds: how old a running review is. */
  readonly now: number;
  /** Whether a person holds the merges, read from the machine's state this tick. */
  readonly mergeHold: MergeHold;
}

export interface LoopDecision {
  readonly actions: readonly LoopAction[];
  /** Judgments refused this tick, each naming its ticket and field. */
  readonly refusals: readonly string[];
  /** The label a `mark-human-wait` sets, and whose presence is `humanWait`. */
  readonly humanWaitLabel: string;
  /** Who merges this tick: the loop, or a person holding the merges. */
  readonly merges: 'automatic' | 'by-human';
}

/** The programme's consent and state roles, or a refusal naming what is missing. */
export function loopProgramOf(descriptor: ProgramDescriptor): LoopProgram {
  if (descriptor.autopilot === undefined || descriptor.progress === undefined) {
    throw autopilotFailure(
      'AUTOPILOT_PROGRAM',
      'the programme does not consent to the autopilot loop',
      descriptor.autopilotConsentWithheld
        ? '`autopilot.enabled` is false'
        : 'the programme declares no `autopilot` block or no `progress` source',
      'declare an `autopilot` block and a `progress` provider in `.void/program.md`',
    );
  }
  if (descriptor.autopilot.schemaVersion === 1) throw legacyProgramme(descriptor.autopilot);
  return { autopilot: descriptor.autopilot, states: descriptor.progress.states };
}

/**
 * A 4.0 programme, refused with the migration its gate calls for. A former
 * human gate is told to hold the merges first: removing the key alone would
 * hand the next merge to the machine.
 */
function legacyProgramme(autopilot: AutopilotConfig) {
  const gate = autopilot.legacyMergeGate;
  const migrate = 'then set `autopilot.schemaVersion: 2`';
  const fix = gate === 'union-reviewed'
    ? 'remove `mergeGate`: the loop now merges on its own into the integration branch, never into '
      + `\`deployBranch\` or the default branch; ${migrate}`
    : `first run \`${PRODUCT_COMMAND} autopilot merges --by-human\` to keep every merge yours, then `
      + `remove \`mergeGate\`, ${migrate.slice('then '.length)}`;
  return autopilotFailure(
    'AUTOPILOT_PROGRAM',
    'the programme is written for the 4.0 merge gate, which no longer exists',
    gate === undefined
      ? '`autopilot.schemaVersion` is 1'
      : `\`autopilot.schemaVersion\` is 1 and \`mergeGate\` is ${gate}`,
    fix,
  );
}

export function admitLoopTracker(value: unknown): Admission<LoopTracker> {
  const parsed = loopTrackerSchema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues
    .map((issue) => {
      const field = issue.path.length === 0 ? '(root)' : issue.path.join('.');
      return `${field}: ${issue.message}`;
    })
    .join('; ');
  return { ok: false, reason: `tracker observation refused: ${issues}` };
}

/**
 * The local branches a unit must never move: every base `auto` can resolve to,
 * and the branch that deploys. Moving one locally changes what the next
 * worktree, or the next promotion, starts from.
 */
export function protectedBranches(autopilot: AutopilotConfig): string[] {
  const bases = autopilot.base === 'auto' ? ['develop', 'main'] : [autopilot.base];
  const deploy = autopilot.deployBranch === undefined ? [] : [autopilot.deployBranch];
  return [...new Set([...bases, ...deploy])];
}

/** The floor, then what the programme adds to it. */
export function protectedPathsOf(autopilot: AutopilotConfig): string[] {
  return [...new Set([...PROTECTED_PATHS_FLOOR, ...autopilot.protectedPaths])];
}

/**
 * Why the loop must leave this pull request to a person, or nothing: the first
 * changed file on protected ground, or a file list too short to say.
 */
function protectedPathReason(pr: PullRequestObservation, autopilot: AutopilotConfig) {
  if (pr.files.length < pr.changedFiles) {
    return `#${pr.number} changes ${pr.changedFiles} files and only ${pr.files.length} could be read`;
  }
  const areas = protectedPathsOf(autopilot).map(compileArea);
  const touched = pr.files.flatMap((file) =>
    file.previousPath === undefined ? [file.path] : [file.previousPath, file.path],
  );
  const file = touched.find((path) => areas.some((area) => areaClaims(area, path)));
  return file === undefined ? undefined : `#${pr.number} changes ${file}, which only a person merges`;
}

/** The stop file holds `drain` or `now`; absent is no stop, anything else is refused. */
export function parseStopSignal(text: string | undefined): StopSignal {
  if (text === undefined) return 'none';
  const value = text.trim();
  if (value === 'drain' || value === 'now') return value;
  throw autopilotFailure(
    'AUTOPILOT_INPUT',
    'the stop signal is unreadable',
    `the stop file holds ${JSON.stringify(value.slice(0, 40))}, not \`drain\` or \`now\``,
    `write it with \`${PRODUCT_COMMAND} autopilot stop --drain\` or \`--now\`, or delete the file`,
  );
}

type Role = 'ready' | 'started' | 'review' | 'done' | 'other';

function roleOf(states: ProgressStates, status: string): Role {
  if (states.done.includes(status)) return 'done';
  if (states.review.includes(status)) return 'review';
  if (states.started.includes(status)) return 'started';
  if (states.ready.includes(status)) return 'ready';
  return 'other';
}

/**
 * The tickets holding a slot: started or in review and not handed to a human,
 * plus any ticket a worker is live on, plus a ready ticket that already has a
 * branch or a pull request. The last two are what stop a restart from seating
 * twice a ticket Linear has not caught up with yet: the live worker list dies
 * with the orchestrator, the branch a worker pushed does not.
 */
function heldTickets(program: LoopProgram, tracker: LoopTracker): readonly TrackerTicket[] {
  const live = new Set<string>(tracker.liveWorkers);
  return tracker.tickets.filter((ticket) => {
    if (live.has(ticket.id)) return true;
    if (ticket.humanWait) return false;
    const role = roleOf(program.states, ticket.status);
    if (role === 'started' || role === 'review') return true;
    return role === 'ready' && (ticket.branch !== undefined || ticket.pullRequest !== undefined);
  });
}

/**
 * The pull requests the loop needs GitHub to report, in tracker order: those of
 * the held tickets, and of every ticket in human wait that is not done, whose
 * open pull request still reserves its ground.
 */
export function pullRequestsToObserve(program: LoopProgram, tracker: LoopTracker): number[] {
  const held = new Set(heldTickets(program, tracker));
  return tracker.tickets.flatMap((ticket) => {
    if (ticket.pullRequest === undefined) return [];
    const waiting = ticket.humanWait && roleOf(program.states, ticket.status) !== 'done';
    return held.has(ticket) || waiting ? [ticket.pullRequest] : [];
  });
}

/**
 * Tickets that hold no slot but still hold ground: not done, and an open pull
 * request whose code is not on the base yet. A ticket handed to a human frees
 * its slot, never its footprint.
 */
function reservedTickets(
  input: LoopInput,
  stillHeld: readonly TrackerTicket[],
): readonly TrackerTicket[] {
  const holding = new Set(stillHeld);
  return input.tracker.tickets.filter((ticket) => {
    if (holding.has(ticket) || ticket.pullRequest === undefined) return false;
    if (roleOf(input.program.states, ticket.status) === 'done') return false;
    return input.github.pullRequests.get(ticket.pullRequest)?.state === 'open';
  });
}

/** `disarm`, when present, runs before `action`: the merge is stopped before anyone acts. */
type SlotOutcome =
  | { readonly outcome: 'held'; readonly action: LoopAction; readonly disarm?: LoopAction }
  | { readonly outcome: 'merged' }
  | { readonly outcome: 'human-wait'; readonly action: LoopAction; readonly disarm?: LoopAction };

/** An outcome that acts on its ticket: every one but a merge. */
type ActingOutcome = Exclude<SlotOutcome, { readonly outcome: 'merged' }>;

function held(action: LoopAction): ActingOutcome {
  return { outcome: 'held', action };
}

function toHuman(ticketId: string, reason: HumanWaitReason, detail: string): ActingOutcome {
  return { outcome: 'human-wait', action: { kind: 'mark-human-wait', ticketId, reason, detail } };
}

function handBack(ticketId: string, reason: HandBackReason, pullRequest?: number): ActingOutcome {
  return held({
    kind: 'hand-back-to-worker',
    ticketId,
    reason,
    ...(pullRequest === undefined ? {} : { pullRequest }),
  });
}

function wait(ticketId: string, reason: WaitReason): SlotOutcome {
  return held({ kind: 'wait', ticketId, reason });
}

interface SlotContext {
  readonly input: LoopInput;
  readonly live: ReadonlySet<string>;
  /** The one pull request allowed to merge when the base has no merge queue. */
  readonly serialTurn: number | undefined;
}

function conflictOutcome(ticket: TrackerTicket, pr: PullRequestObservation): SlotOutcome {
  if (pr.conflict === undefined) return handBack(ticket.id, 'conflict', pr.number);
  const admission = admitConflictClass(pr.conflict);
  if (!admission.ok) return toHuman(ticket.id, 'conflict-class-unreadable', admission.reason);
  // A class given on another head answered another conflict: the worker classifies this one.
  if (admission.value.headSha !== pr.headSha) return handBack(ticket.id, 'conflict', pr.number);
  if (admission.value.class === 'semantic') {
    return toHuman(ticket.id, 'semantic-conflict', admission.value.reason);
  }
  return handBack(ticket.id, 'conflict', pr.number);
}

/** The local review of the head a pull request has now, or why it cannot be believed. */
type HeadReview =
  | { readonly kind: 'none' }
  | { readonly kind: 'unproven'; readonly detail: string }
  | { readonly kind: 'recorded'; readonly review: LocalReview };

function headReviewOf(ticket: TrackerTicket, pr: PullRequestObservation, input: LoopInput): HeadReview {
  const raw = input.reviews.get(ticket.id)?.get(pr.headSha);
  if (raw === undefined) return { kind: 'none' };
  const admission = admitLocalReview(raw);
  if (!admission.ok) return { kind: 'unproven', detail: admission.reason };
  const review = admission.value;
  if (review.headSha !== pr.headSha || review.pullRequest !== pr.number || review.ticketId !== ticket.id) {
    const detail =
      `the review filed under ${pr.headSha} is for ${review.ticketId} #${review.pullRequest} at ${review.headSha}`;
    return { kind: 'unproven', detail };
  }
  return { kind: 'recorded', review };
}

/**
 * Whether `raw` is a clean verdict recorded for exactly this ticket, pull
 * request and head: what `autopilot merge` and `autopilot arm` prove again
 * before they act, rather than trust the tick that asked for it.
 */
export function provesCleanVerdict(
  raw: unknown,
  target: { readonly ticketId: string; readonly pullRequest: number; readonly headSha: string },
): boolean {
  const admission = admitLocalReview(raw);
  if (!admission.ok) return false;
  const review = admission.value;
  const bound = review.ticketId === target.ticketId
    && review.pullRequest === target.pullRequest
    && review.headSha === target.headSha;
  const verdict = review.verdict?.verdict;
  return bound && verdict !== undefined && verdict.blocking.length === 0;
}

/**
 * Whether a clean verdict is recorded on the head, the one thing a merge rests
 * on. The same predicate the commands prove again, so the two cannot drift.
 */
function holdsCleanVerdict(ticket: TrackerTicket, pr: PullRequestObservation, input: LoopInput): boolean {
  const raw = input.reviews.get(ticket.id)?.get(pr.headSha);
  return provesCleanVerdict(raw, { ticketId: ticket.id, pullRequest: pr.number, headSha: pr.headSha });
}

/**
 * The review rounds a pull request used: its distinct heads a recorded verdict
 * blocked. Counted from the records, not from the round a verdict announces,
 * so a reviewer with no memory of the first round cannot reset the bound.
 */
function reviewRoundsOf(ticket: TrackerTicket, pr: PullRequestObservation, input: LoopInput): number {
  const blocked = new Set<string>();
  for (const raw of input.reviews.get(ticket.id)?.values() ?? []) {
    const admission = admitLocalReview(raw);
    if (!admission.ok || admission.value.pullRequest !== pr.number) continue;
    const verdict = admission.value.verdict?.verdict;
    if (verdict !== undefined && verdict.blocking.length > 0) blocked.add(admission.value.headSha);
  }
  return blocked.size;
}

function blockingOutcome(
  ticket: TrackerTicket,
  pr: PullRequestObservation,
  verdict: ReviewVerdict,
  input: LoopInput,
): SlotOutcome {
  if (reviewRoundsOf(ticket, pr, input) >= REVIEW_ROUNDS_MAX) {
    const first = verdict.blocking[0]?.scenario ?? '';
    return toHuman(ticket.id, 'review-rounds-exhausted', `still blocking after two rounds: ${first}`);
  }
  return handBack(ticket.id, 'review-blocking', pr.number);
}

/**
 * No verdict on the head yet: a review runs, or one is delegated. An attempt
 * that ended without a verdict, or outlived its window, failed; the second
 * failure on one head goes to a person with the last cause.
 */
function unjudgedOutcome(
  ticket: TrackerTicket,
  pr: PullRequestObservation,
  review: LocalReview | undefined,
  input: LoopInput,
): SlotOutcome {
  const attempts = review?.attempts ?? [];
  const running = (attempt: LocalReview['attempts'][number]) =>
    attempt.endedAt === undefined && input.now - attempt.startedAt < REVIEW_RUNNING_MS;
  if (attempts.some(running)) return wait(ticket.id, 'awaiting-review');
  if (attempts.length >= REVIEW_ATTEMPTS_MAX) {
    const cause = attempts.at(-1)?.failure ?? 'the review was interrupted';
    return toHuman(ticket.id, 'review-failed', `#${pr.number} at ${pr.headSha}: ${cause}`);
  }
  const round = reviewRoundsOf(ticket, pr, input) === 0 ? 1 : 2;
  return held({ kind: 'review', ticketId: ticket.id, pullRequest: pr.number, headSha: pr.headSha, round });
}

function localReviewOutcome(
  ticket: TrackerTicket,
  pr: PullRequestObservation,
  context: SlotContext,
): SlotOutcome {
  const { input } = context;
  // Checked before a review, not only before a merge: the reviewer runs in a
  // worktree of the head, where its runtime loads the project's agents,
  // settings, hooks and MCP servers. A head that changes them is never run.
  const guarded = protectedPathReason(pr, input.program.autopilot);
  if (guarded !== undefined) return toHuman(ticket.id, 'protected-path', guarded);
  const head = headReviewOf(ticket, pr, input);
  if (head.kind === 'unproven') return toHuman(ticket.id, 'verdict-unproven', head.detail);
  const verdict = head.kind === 'recorded' ? head.review.verdict?.verdict : undefined;
  if (verdict === undefined) {
    return unjudgedOutcome(ticket, pr, head.kind === 'recorded' ? head.review : undefined, input);
  }
  if (verdict.blocking.length > 0) return blockingOutcome(ticket, pr, verdict, input);
  return mergeOutcome(ticket, pr, context);
}

/**
 * Publication is refused when the unit changed what its neighbours share, and
 * when nobody recorded that state before it began: an unrecorded baseline cannot
 * tell a clean unit from one that changed everything.
 */
function sharedStateOutcome(
  ticket: TrackerTicket,
  shared: SharedStateObservation,
): SlotOutcome | undefined {
  const before = shared.before.get(ticket.id);
  if (before === undefined) {
    const detail = 'no shared Git state fingerprint was recorded before the unit began';
    return toHuman(ticket.id, 'shared-fingerprint-missing', detail);
  }
  const changed = changedParts(before, fingerprintOf(shared.current, before.protectedBranches));
  if (changed.length === 0) return undefined;
  const detail = `the unit changed the shared Git state: ${changed.join(', ')}`;
  return toHuman(ticket.id, 'shared-state-changed', detail);
}

/**
 * The head carries a clean verdict: what stands between it and the base. Each
 * refusal names its cause, and the hold comes only now, after the review, so a
 * person is handed a pull request that is ready rather than one nobody read.
 */
function mergeOutcome(
  ticket: TrackerTicket,
  pr: PullRequestObservation,
  context: SlotContext,
): SlotOutcome {
  if (isArmed(pr)) return wait(ticket.id, 'merging');
  const { input } = context;
  const { autopilot } = input.program;
  const guarded = protectedPathReason(pr, autopilot);
  if (guarded !== undefined) return toHuman(ticket.id, 'protected-path', guarded);
  const deploying = deployTargetReason(pr, input);
  if (deploying !== undefined) return toHuman(ticket.id, 'deploy-branch-target', deploying);
  const sharedStateRefusal = sharedStateOutcome(ticket, input.sharedState);
  if (sharedStateRefusal !== undefined) return sharedStateRefusal;
  if (pr.checks === 'pending') return wait(ticket.id, 'checks-pending');
  if (input.mergeHold.held) return toHuman(ticket.id, 'human-merge-hold', heldDetail(pr, input.mergeHold));
  const target = { ticketId: ticket.id, pullRequest: pr.number, headSha: pr.headSha };
  if (!input.github.mergeQueue) {
    if (context.serialTurn !== pr.number) return wait(ticket.id, 'serial-merge-turn');
    if (pr.behind) return held({ kind: 'update-branch', ...target });
    return held({ kind: 'merge', ...target });
  }
  if (pr.queue !== 'ejected') return held({ kind: 'enable-auto-merge', ...target });
  if (pr.ejections > EJECTIONS_PER_HEAD_MAX) {
    const detail = `#${pr.number} was ejected ${pr.ejections} times on ${pr.headSha}`;
    return toHuman(ticket.id, 'ejections-exhausted', detail);
  }
  return held({ kind: 'requeue', ...target, ejections: pr.ejections });
}

function heldDetail(pr: PullRequestObservation, hold: Extract<MergeHold, { held: true }>): string {
  return `#${pr.number} is reviewed on ${pr.headSha} and ready; ${hold.detail}`;
}

/**
 * Why the base is the branch that deploys, or nothing. The programme names it,
 * or the repository's default branch is it. `auto` is only resolved at tick
 * time and can land there; a name that cannot be compared, or no default branch
 * at all, counts as that branch: a false refusal is a merge a person does.
 */
function deployTargetReason(pr: PullRequestObservation, input: LoopInput): string | undefined {
  const { base, defaultBranch } = input.github;
  const declared = input.program.autopilot.deployBranch;
  const deploying = declared ?? defaultBranch;
  if (sameBranch(base, deploying) === 'different') return undefined;
  if (declared !== undefined) return `#${pr.number} targets ${base}, the branch the programme says deploys`;
  return defaultBranch === undefined
    ? `#${pr.number} targets ${base}, and GitHub reports no default branch to tell the branch that deploys`
    : `#${pr.number} targets ${base}, the repository default branch, which deploys when the programme `
      + 'names none; declare `autopilot.deployBranch` if another branch ships';
}

/**
 * Whether GitHub merges `pr` without anyone acting again. It arms a pull request
 * one of two ways: an auto-merge request while the checks run, or, once they
 * pass on a base with a merge queue, an entry in that queue and no request.
 */
function isArmed(pr: PullRequestObservation): boolean {
  return pr.autoMerge || pr.queue === 'queued';
}

/** The pull request a ticket carries, when GitHub reports it open and armed. */
function armedPullOf(
  ticket: TrackerTicket,
  github: GithubObservation,
): PullRequestObservation | undefined {
  const number = ticket.pullRequest;
  const pr = number === undefined ? undefined : github.pullRequests.get(number);
  return pr?.state === 'open' && isArmed(pr) ? pr : undefined;
}

/** Stop the merge of `pr`, naming the head `autopilot arm` recorded for it, if any. */
function disarmOf(ticket: TrackerTicket, pr: PullRequestObservation, input: LoopInput): LoopAction {
  const record = input.armed.get(ticket.id);
  const armedSha = record?.pullRequest === pr.number ? record.headSha : undefined;
  return {
    kind: 'disable-auto-merge',
    ticketId: ticket.id,
    pullRequest: pr.number,
    headSha: pr.headSha,
    ...(armedSha === undefined ? {} : { armedSha }),
  };
}

/**
 * Whether the loop still vouches for an armed merge: armed by `autopilot arm`
 * on the head the pull request has now, and a verdict proven on that head.
 */
function vouches(ticket: TrackerTicket, pr: PullRequestObservation, input: LoopInput): boolean {
  const record = input.armed.get(ticket.id);
  if (record?.pullRequest !== pr.number || record.headSha !== pr.headSha) return false;
  return holdsCleanVerdict(ticket, pr, input);
}

/**
 * Why an armed merge is stopped, when that decides where the ticket goes. GitHub
 * keeps an auto-merge armed across a push by anyone with write access and
 * exposes no armed head, and the required check reads only what a key-holder
 * can sign, so the head is the one `autopilot arm` recorded and the verdict is
 * the one the loop proves. A moved head goes back to its worker, since it has
 * not been reviewed; an armed head no verdict proves, or an arming nobody
 * recorded, goes to a human. `withDisarm` stops every other armed merge.
 */
function armedOutcome(
  ticket: TrackerTicket,
  pr: PullRequestObservation,
  context: SlotContext,
): SlotOutcome | undefined {
  if (!isArmed(pr)) return undefined;
  const { input } = context;
  const disarm = disarmOf(ticket, pr, input);
  const record = input.armed.get(ticket.id);
  if (record === undefined || record.pullRequest !== pr.number) {
    const detail = `#${pr.number} is armed and no \`autopilot arm\` recorded its head`;
    return { ...toHuman(ticket.id, 'arming-unrecorded', detail), disarm };
  }
  if (record.headSha !== pr.headSha) {
    return { ...handBack(ticket.id, 'head-moved-after-arming', pr.number), disarm };
  }
  if (!vouches(ticket, pr, input)) {
    const detail = `#${pr.number} is armed on ${pr.headSha} and no clean local verdict holds that head`;
    return { ...toHuman(ticket.id, 'armed-verdict-unproven', detail), disarm };
  }
  // Armed before the person took the merges back: GitHub would still merge it.
  if (input.mergeHold.held) {
    return { ...toHuman(ticket.id, 'human-merge-hold', heldDetail(pr, input.mergeHold)), disarm };
  }
  return undefined;
}

/**
 * The only place an armed merge survives a tick: the loop vouches for its head
 * and hands it to nobody, it waits for the merge. Every other outcome, a worker at work, a hand-back, a human wait,
 * runs while someone may push and GitHub could merge a head nobody proved, so
 * it carries the disarm, which runs first.
 */
function withDisarm(ticket: TrackerTicket, slot: SlotOutcome, input: LoopInput): SlotOutcome {
  if (slot.outcome === 'merged' || slot.disarm !== undefined) return slot;
  const pr = armedPullOf(ticket, input.github);
  if (pr === undefined) return slot;
  const { action } = slot;
  const watched = action.kind === 'wait' && action.reason === 'merging';
  if (watched && vouches(ticket, pr, input)) return slot;
  return { ...slot, disarm: disarmOf(ticket, pr, input) };
}

function openPullOutcome(
  ticket: TrackerTicket,
  pr: PullRequestObservation,
  context: SlotContext,
): SlotOutcome {
  if (pr.state === 'closed') {
    return toHuman(ticket.id, 'pull-request-closed', `#${pr.number} was closed without a merge`);
  }
  const armed = armedOutcome(ticket, pr, context);
  if (armed !== undefined) return armed;
  // A head the loop merges into, or that ships, is a promotion, never a ticket:
  // promoting develop to main is a release action a person takes.
  const { defaultBranch } = context.input.github;
  const promoting = [
    ...protectedBranches(context.input.program.autopilot),
    ...(defaultBranch === undefined ? [] : [defaultBranch]),
  ];
  if (promoting.includes(pr.headRef)) {
    const detail = `#${pr.number} promotes ${pr.headRef} into ${pr.baseRef}`;
    return toHuman(ticket.id, 'promotion-pull-request', detail);
  }
  const base = context.input.github.base;
  if (pr.baseRef !== base) {
    const detail = `#${pr.number} targets ${pr.baseRef}, the loop merges into ${base}`;
    return toHuman(ticket.id, 'pull-request-off-base', detail);
  }
  if (ticket.branch !== undefined && pr.headRef !== ticket.branch) {
    const detail =
      `the tracker names ${ticket.branch} for the ticket, #${pr.number} comes from ${pr.headRef}`;
    return toHuman(ticket.id, 'tracker-github-mismatch', detail);
  }
  if (pr.draft) return handBack(ticket.id, 'resume', pr.number);
  if (pr.conflicted) return conflictOutcome(ticket, pr);
  if (pr.checks === 'failing') return handBack(ticket.id, 'checks-failed', pr.number);
  return localReviewOutcome(ticket, pr, context);
}

function slotOutcome(ticket: TrackerTicket, context: SlotContext): SlotOutcome {
  const number = ticket.pullRequest;
  const pr = number === undefined ? undefined : context.input.github.pullRequests.get(number);
  if (number !== undefined && pr === undefined) {
    return toHuman(ticket.id, 'github-unreadable', `pull request #${number} was not observed`);
  }
  if (pr?.state === 'merged') return { outcome: 'merged' };
  if (context.live.has(ticket.id)) return wait(ticket.id, 'worker-active');
  if (pr === undefined) return handBack(ticket.id, 'resume');
  return openPullOutcome(ticket, pr, context);
}

/**
 * Whose turn it is to merge when the base has no merge queue.
 *
 * A pull request already merging keeps the turn; otherwise the oldest open one
 * takes it. Read from GitHub alone, so the turn survives a restart unchanged.
 */
function serialTurnOf(
  tickets: readonly TrackerTicket[],
  github: GithubObservation,
): number | undefined {
  const open = tickets
    .flatMap((ticket) => {
      const number = ticket.pullRequest;
      const pr = number === undefined ? undefined : github.pullRequests.get(number);
      return pr !== undefined && pr.state === 'open' && !pr.draft ? [pr] : [];
    })
    .sort((left, right) => left.number - right.number);
  return (open.find(isArmed) ?? open[0])?.number;
}

interface Claim {
  readonly areas: readonly CompiledArea[];
  /** Indices of the `sequential` paths this claim touches. */
  readonly sequential: ReadonlySet<number>;
}

function claimOf(areas: readonly string[], sequential: readonly CompiledArea[]): Claim {
  const compiled = areas.map(compileArea);
  const touched = new Set<number>();
  sequential.forEach((path, index) => {
    if (compiled.some((area) => areasOverlap(area, path))) touched.add(index);
  });
  return { areas: compiled, sequential: touched };
}

function claimsCollide(left: Claim, right: Claim): boolean {
  if ([...left.sequential].some((index) => right.sequential.has(index))) return true;
  return left.areas.some((area) => right.areas.some((other) => areasOverlap(area, other)));
}

interface Assignment {
  readonly actions: readonly LoopAction[];
  /** No queued ticket is ready or preparable: the loop has nothing left to take. */
  readonly exhausted: boolean;
}

type Candidacy = 'skip' | 'preparable' | 'ready';

function candidacyOf(
  entry: CuratorQueueEntry,
  input: LoopInput,
  heldIds: ReadonlySet<string>,
  refusals: string[],
): Candidacy {
  const ticket = input.tracker.tickets.find((candidate) => candidate.id === entry.ticketId);
  if (ticket === undefined || heldIds.has(ticket.id) || ticket.humanWait) return 'skip';
  if (roleOf(input.program.states, ticket.status) === 'done') return 'skip';
  if (ticket.readiness === undefined) return 'preparable';
  const admission = admitTicketReadiness(ticket.readiness);
  if (!admission.ok) {
    refusals.push(`${ticket.id}: ${admission.reason}`);
    return 'preparable';
  }
  if (admission.value.verdict === 'ready') return 'ready';
  return admission.value.verdict === 'needs-enrichment' ? 'preparable' : 'skip';
}

function assignSlots(
  input: LoopInput,
  stillHeld: readonly TrackerTicket[],
  heldIds: ReadonlySet<string>,
  refusals: string[],
): Assignment {
  const queue = admitCuratorQueue(input.tracker.queue);
  if (!queue.ok) {
    refusals.push(queue.reason);
    return { actions: [], exhausted: false };
  }
  const entries = queue.value.entries;
  const sequential = input.program.autopilot.ownership.sequential.map(compileArea);
  const claims: Claim[] = [];
  for (const ticket of [...stillHeld, ...reservedTickets(input, stillHeld)]) {
    const queued = entries.find((entry) => entry.ticketId === ticket.id);
    const footprint = ticket.footprint ?? queued?.footprint;
    // A held or reserved ticket whose ground nobody declared could collide with anything.
    if (footprint === undefined) return { actions: [], exhausted: false };
    claims.push(claimOf(footprint, sequential));
  }
  let free = input.program.autopilot.clusterSize - stillHeld.length;
  const actions: LoopAction[] = [];
  let open = false;
  for (const entry of entries) {
    const candidacy = candidacyOf(entry, input, heldIds, refusals);
    if (candidacy !== 'skip') open = true;
    if (candidacy !== 'ready' || free <= 0) continue;
    const claim = claimOf(entry.footprint, sequential);
    if (claims.some((other) => claimsCollide(claim, other))) continue;
    claims.push(claim);
    actions.push({ kind: 'assign', ticketId: entry.ticketId, footprint: entry.footprint });
    free -= 1;
  }
  return { actions, exhausted: !open };
}

interface Outcome {
  readonly outcome: 'merged' | 'human-wait';
  readonly reason?: HumanWaitReason | undefined;
}

/**
 * Tickets sent to a human since the last merge. A pull request that only waits
 * for a person holding the merges is neither: the loop did its part, the person
 * asked to merge themselves, so it neither counts nor resets the streak.
 */
function trailingHumanWaits(outcomes: readonly Outcome[]): number {
  let count = 0;
  for (const entry of [...outcomes].reverse()) {
    if (entry.outcome === 'merged') return count;
    if (entry.reason !== 'human-merge-hold') count += 1;
  }
  return count;
}

export function decideLoop(input: LoopInput): LoopDecision {
  const humanWaitLabel = input.program.autopilot.humanWaitLabel ?? HUMAN_WAIT_LABEL;
  const merges = input.mergeHold.held ? 'by-human' : 'automatic';
  // Freezing means nothing moves, a merge GitHub would run included: every
  // armed pull request is disarmed first, the proven ones too.
  if (input.signal === 'now') {
    const disarms = disarmsOf(input.tracker.tickets, input);
    return { actions: [...disarms, { kind: 'freeze' }], refusals: [], humanWaitLabel, merges };
  }
  const refusals: string[] = [];
  const holding = heldTickets(input.program, input.tracker);
  const context: SlotContext = {
    input,
    live: new Set<string>(input.tracker.liveWorkers),
    serialTurn: serialTurnOf(holding, input.github),
  };
  const outcomes = holding.map((ticket) => ({
    ticket,
    slot: withDisarm(ticket, slotOutcome(ticket, context), input),
  }));
  // A ticket that holds no slot, in human wait above all, is merged by a
  // person: an auto-merge still armed on it is one the loop no longer watches.
  const unheld = disarmsOf(
    input.tracker.tickets.filter((ticket) => !holding.includes(ticket)),
    input,
  );
  const slotActions = [
    ...unheld,
    ...outcomes.flatMap(({ slot }) =>
      'action' in slot ? [...(slot.disarm === undefined ? [] : [slot.disarm]), slot.action] : [],
    ),
  ];
  const whose = (outcome: SlotOutcome['outcome']) =>
    outcomes.filter(({ slot }) => slot.outcome === outcome).map(({ ticket }) => ticket);
  const stillHeld = whose('held');
  const merged = whose('merged').map((ticket) => ticket.id);
  const recent = input.tracker.recent;
  const waited: HumanWaitEntry[] = slotActions.flatMap((action) =>
    action.kind === 'mark-human-wait' ? [{ ticketId: action.ticketId, reason: action.reason }] : [],
  );
  const history: Outcome[] = [
    ...recent,
    ...merged.map(() => ({ outcome: 'merged' as const })),
    ...waited.map(({ reason }) => ({ outcome: 'human-wait' as const, reason })),
  ];
  let drain: DrainReason | undefined;
  if (input.signal === 'drain') drain = 'requested';
  else if (input.tracker.quota === 'low') drain = 'quota-low';
  else if (trailingHumanWaits(history) >= HUMAN_WAIT_STREAK_MAX) drain = 'human-wait-streak';
  const actions: LoopAction[] = [...slotActions];
  if (drain === undefined) {
    const heldIds = new Set(holding.map((ticket) => ticket.id));
    const assignment = assignSlots(input, stillHeld, heldIds, refusals);
    actions.push(...assignment.actions);
    if (assignment.exhausted) drain = 'backlog-exhausted';
  }
  if (drain !== undefined) {
    actions.push({ kind: 'drain', reason: drain });
    if (stillHeld.length === 0) actions.push(recapOf(recent, merged, waited));
  }
  return { actions, refusals, humanWaitLabel, merges };
}

function disarmsOf(tickets: readonly TrackerTicket[], input: LoopInput): LoopAction[] {
  return tickets.flatMap((ticket) => {
    const pr = armedPullOf(ticket, input.github);
    return pr === undefined ? [] : [disarmOf(ticket, pr, input)];
  });
}

function recapOf(
  recent: LoopTracker['recent'],
  merged: readonly string[],
  waited: readonly HumanWaitEntry[],
): LoopAction {
  const earlierMerged = recent.flatMap((entry) =>
    entry.outcome === 'merged' ? [entry.ticketId] : [],
  );
  const earlierWaited = recent.flatMap((entry) =>
    entry.outcome === 'human-wait' ? [{ ticketId: entry.ticketId, reason: entry.reason }] : [],
  );
  return {
    kind: 'recap',
    merged: [...earlierMerged, ...merged],
    humanWait: [...earlierWaited, ...waited],
  };
}
