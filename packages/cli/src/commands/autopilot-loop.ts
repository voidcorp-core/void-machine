// `autopilot next | stop | fingerprint | arm | disarm | judgment`: the
// continuous loop's operator surface.
//
// Unlike the cluster subcommands, `next` observes GitHub and git itself. GitHub
// is the authority on a merge and the shared Git state is what a unit must not
// have touched, so neither is taken from an agent's report. Linear still arrives
// on stdin, from the orchestrator, because it is reachable only through MCP and
// never decides a merge. The command judges nothing: it admits what it is given
// and returns the kernel's actions.
//
// Local state is four things under `.void/machine/autopilot/`, all written
// only by an explicit command: the stop signal, one digest-only fingerprint per
// ticket, recorded before its unit begins, the head each ticket's auto-merge
// was armed on, which GitHub does not keep, and the review `autopilot review`
// recorded for each head, which is the verdict the loop merges on. No secret
// lives here.

import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { autopilotFailure } from '../lib/autopilot/errors.js';
import {
  JUDGMENT_KINDS,
  type JudgmentKind,
  renderJudgmentComment,
} from '../lib/autopilot/judgment-comment.js';
import { ticketIdSchema } from '../lib/autopilot/judgments.js';
import {
  admitLoopTracker,
  type ArmedRecord,
  decideLoop,
  type LoopAction,
  type LoopDecision,
  type LoopProgram,
  type LoopTracker,
  loopProgramOf,
  parseStopSignal,
  protectedBranches,
  type PullRequestObservation,
  pullRequestsToObserve,
  type StopSignal,
} from '../lib/autopilot/loop.js';
import {
  type GhRunner,
  type GitRunner,
  observeGithub,
  PULL_REQUEST_FIELDS,
  parsePullRequestView,
  readQueueMembership,
  readSharedState,
  resolveLoopBase,
} from '../lib/autopilot/loop-observe.js';
import { readProgramDescriptor } from '../lib/autopilot/program.js';
import {
  admitFingerprint,
  changedParts,
  fingerprintOf,
  type SharedFingerprint,
  type SharedStateReading,
} from '../lib/autopilot/shared-state.js';
import { readLocalReviews } from './autopilot-review.js';
import { flagValue } from './autopilot-usage.js';

const LOOP_SUBCOMMANDS = [
  'next',
  'stop',
  'fingerprint',
  'arm',
  'disarm',
] as const;
export type LoopSubcommand = (typeof LOOP_SUBCOMMANDS)[number];

export function isLoopSubcommand(subcommand: string): subcommand is LoopSubcommand {
  return (LOOP_SUBCOMMANDS as readonly string[]).includes(subcommand);
}

/**
 * The continuous loop's subcommands that observe or write local state, routed
 * here so the router in autopilot.ts stays a table and a switch.
 */
export function loopCommand(
  subcommand: LoopSubcommand,
  argv: readonly string[],
  stdin: string,
  context: LoopRunners,
): LoopCommandOutput {
  switch (subcommand) {
    case 'next':
      return nextCommand(stdin, context);
    case 'stop':
      return stopCommand(argv, context);
    case 'fingerprint':
      return fingerprintCommand(argv, context);
    case 'arm':
      return armCommand(argv, context);
    case 'disarm':
      return disarmCommand(argv, context);
    default:
      return subcommand satisfies never;
  }
}

/** What a loop command prints: the JSON value, and the line a human reads. */
export interface LoopCommandOutput {
  readonly value: unknown;
  readonly human: string;
}

/** The two runners the loop observes through; injected so tests run on captures. */
export interface LoopRunners {
  readonly root: string;
  /** ISO instant of the tick: how long a recorded review has been running. */
  readonly now?: string;
  readonly gh?: GhRunner;
  readonly git?: GitRunner;
}

const LOOP_DIRECTORY = join('.void', 'machine', 'autopilot');
export const STOP_SIGNAL_PATH = join(LOOP_DIRECTORY, 'stop');
const FINGERPRINT_DIRECTORY = join(LOOP_DIRECTORY, 'fingerprints');
const ARMED_DIRECTORY = join(LOOP_DIRECTORY, 'armed');
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const armedRecordSchema = z.strictObject({
  pullRequest: z.int().positive(),
  headSha: z.string().regex(SHA_PATTERN),
});

function runner<T>(value: T | undefined, name: string): T {
  if (value !== undefined) return value;
  throw autopilotFailure(
    'AUTOPILOT_CONTRACT',
    `the loop has no ${name} runner`,
    'the command was invoked without an execution context that can observe',
    'invoke autopilot through the CLI entry point rather than calling it directly',
  );
}

function instantOf(iso: string): number {
  const instant = Date.parse(iso);
  if (Number.isFinite(instant)) return instant;
  throw autopilotFailure(
    'AUTOPILOT_CONTRACT',
    'the loop clock is unreadable',
    `${JSON.stringify(iso.slice(0, 40))} is not an ISO instant`,
    'invoke autopilot through the CLI entry point, which passes the current instant',
  );
}

function readIfPresent(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

/** Write through a temporary file, so a reader never sees half a record. */
function writeAtomically(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, text, 'utf8');
  renameSync(temporary, path);
}

/**
 * Write a record that must never be replaced: the complete file is linked into
 * place, and a link onto an existing path fails, so a second writer loses
 * without ever exposing half a record. Returns false when one already exists.
 */
function writeOnce(path: string, text: string, mode = 0o644): boolean {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text, { encoding: 'utf8', mode });
  try {
    linkSync(temporary, path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false;
    throw error;
  } finally {
    unlinkSync(temporary);
  }
}

/** The file one ticket's record lives in; a name that is not a ticket reaches no path. */
function ticketFile(root: string, directory: string, ticket: string, extension: string): string {
  const parsed = ticketIdSchema.safeParse(ticket);
  if (!parsed.success) {
    throw autopilotFailure(
      'AUTOPILOT_USAGE',
      'the ticket named is not a tracker identifier',
      `${JSON.stringify(ticket.slice(0, 64))} does not name a ticket`,
      'pass the ticket identifier, for example `DEV-42`',
    );
  }
  return join(root, directory, `${parsed.data}${extension}`);
}

function fingerprintPath(root: string, ticket: string): string {
  return ticketFile(root, FINGERPRINT_DIRECTORY, ticket, '.json');
}

function armedPath(root: string, ticket: string): string {
  return ticketFile(root, ARMED_DIRECTORY, ticket, '.json');
}

/** The head a ticket's auto-merge was armed on, or undefined; a damaged record is refused. */
function recordedArm(root: string, ticket: string): ArmedRecord | undefined {
  const text = readIfPresent(armedPath(root, ticket));
  if (text === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  const parsed = armedRecordSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw autopilotFailure(
    'AUTOPILOT_INPUT',
    `the armed head recorded for ${ticket} is unreadable`,
    'a record is the pull request and the head `autopilot arm` armed it on',
    'disarm the pull request by hand and let the loop arm it again',
  );
}

function recordedFingerprint(root: string, ticket: string): SharedFingerprint | undefined {
  const text = readIfPresent(fingerprintPath(root, ticket));
  if (text === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  const admission = admitFingerprint(value);
  if (admission.ok) return admission.value;
  throw autopilotFailure(
    'AUTOPILOT_INPUT',
    `the fingerprint recorded for ${ticket} is unreadable`,
    admission.reason,
    'hand the unit to a human; a baseline recorded after the unit began proves nothing',
  );
}

function trackerFrom(stdin: string): LoopTracker {
  let value: unknown;
  try {
    value = JSON.parse(stdin);
  } catch (error) {
    throw autopilotFailure(
      'AUTOPILOT_INPUT',
      'the loop tracker observation on stdin is not valid JSON',
      error instanceof Error ? error.message : String(error),
      'pipe the Linear state the orchestrator observed, unmodified, into `autopilot next`',
    );
  }
  const admission = admitLoopTracker(value);
  if (admission.ok) return admission.value;
  throw autopilotFailure(
    'AUTOPILOT_INPUT',
    'the loop tracker observation was refused',
    admission.reason,
    'correct the named field; a refused observation is never read charitably',
  );
}

function loopProgram(root: string): LoopProgram {
  const descriptor = readProgramDescriptor(root);
  if (descriptor === undefined) {
    throw autopilotFailure(
      'AUTOPILOT_PROGRAM',
      'the loop runs under a programme and this project declares none',
      '`.void/program.md` is absent',
      'declare the programme, with its `autopilot` block and `progress` provider',
    );
  }
  return loopProgramOf(descriptor);
}

function renderAction(action: LoopAction, humanWaitLabel: string): string {
  switch (action.kind) {
    case 'assign':
      return `assign ${action.ticketId} (${action.footprint.join(', ')})`;
    case 'wait':
    case 'hand-back-to-worker':
      return `${action.kind} ${action.ticketId}: ${action.reason}`;
    case 'mark-human-wait':
      return (
        `mark-human-wait ${action.ticketId} [${humanWaitLabel}]: ` +
        `${action.reason} - ${action.detail}`
      );
    case 'enable-auto-merge':
      return `enable-auto-merge ${action.ticketId}: #${action.pullRequest} at ${action.headSha}`;
    case 'disable-auto-merge':
      return (
        `disable-auto-merge ${action.ticketId}: #${action.pullRequest} at ${action.headSha},` +
        ` armed on ${action.armedSha ?? 'an unrecorded head'}`
      );
    case 'review':
      return `review ${action.ticketId}: #${action.pullRequest} at ${action.headSha}, round ${action.round}`;
    case 'requeue':
      return (
        `requeue ${action.ticketId}: #${action.pullRequest} at ${action.headSha},` +
        ` ejected ${action.ejections}x`
      );
    case 'drain':
      return `drain: ${action.reason}`;
    case 'freeze':
      return 'freeze';
    case 'recap':
      return `recap: merged ${action.merged.join(', ') || 'none'}; waiting ${
        action.humanWait.map((entry) => `${entry.ticketId} (${entry.reason})`).join(', ') || 'none'
      }`;
    default:
      return action satisfies never;
  }
}

function renderDecision(decision: LoopDecision): string {
  const lines = decision.actions.map((action) => renderAction(action, decision.humanWaitLabel));
  for (const refusal of decision.refusals) lines.push(`refused: ${refusal}`);
  return `${lines.length === 0 ? 'nothing to do' : lines.join('\n')}\n`;
}

/**
 * `autopilot next`: programme, Linear on stdin, GitHub, git and the stop signal
 * in; the kernel's actions out.
 */
export function nextCommand(stdin: string, context: LoopRunners): LoopCommandOutput {
  const tracker = trackerFrom(stdin);
  const program = loopProgram(context.root);
  const signal: StopSignal = parseStopSignal(readIfPresent(join(context.root, STOP_SIGNAL_PATH)));
  const current = sharedReading(program, context);
  if (signal === 'now') return freezeCommand(program, tracker, current, context);
  const gh = runner(context.gh, 'gh');
  const base = resolveLoopBase(gh, program.autopilot.base);
  const pullRequests = pullRequestsToObserve(program, tracker);
  const github = observeGithub(gh, { base, pullRequests });
  const before = new Map<string, SharedFingerprint>();
  for (const ticket of tracker.tickets) {
    const recorded = recordedFingerprint(context.root, ticket.id);
    if (recorded !== undefined) before.set(ticket.id, recorded);
  }
  const armed = new Map<string, ArmedRecord>();
  for (const ticket of tracker.tickets) {
    const record = recordedArm(context.root, ticket.id);
    if (record !== undefined) armed.set(ticket.id, record);
  }
  const sharedState = { current, before };
  const reviews = readLocalReviews(context.root, tracker.tickets.map((ticket) => ticket.id));
  const now = instantOf(runner(context.now, 'clock'));
  const decision = decideLoop({ program, tracker, github, signal, sharedState, armed, reviews, now });
  return { value: decision, human: renderDecision(decision) };
}

/**
 * An immediate stop reads only what GitHub would still merge on its own: each
 * pull request in flight, for its auto-merge and its place in the merge queue,
 * and nothing else. No pull
 * request, no call. One it cannot read refuses the freeze and names the
 * pull requests to disarm by hand, rather than report a stop that GitHub
 * could still overrun.
 */
function freezeCommand(
  program: LoopProgram,
  tracker: LoopTracker,
  current: SharedStateReading,
  context: LoopRunners,
): LoopCommandOutput {
  const numbers = pullRequestsToObserve(program, tracker);
  const pullRequests = new Map<number, PullRequestObservation>();
  try {
    const gh = runner(context.gh, 'gh');
    for (const number of numbers) {
      const view = viewOf(gh, number);
      const queue = readQueueMembership(gh, number).queued ? 'queued' : 'none';
      const unread = { ejections: 0, files: [] } as const;
      pullRequests.set(number, { ...view, queue, ...unread });
    }
  } catch (error) {
    throw autopilotFailure(
      'AUTOPILOT_CONTRACT',
      'the loop cannot freeze without knowing what GitHub would still merge',
      error instanceof Error ? error.message : String(error),
      `disarm by hand in GitHub, ${numbers
        .map((number) => `#${number}: turn off its auto-merge and take it out of the merge queue`)
        .join('; ')}, then stop acting`,
    );
  }
  const github = { base: program.autopilot.base, mergeQueue: false, pullRequests };
  const sharedState = { current, before: new Map<string, SharedFingerprint>() };
  const armed = new Map<string, ArmedRecord>();
  for (const ticket of tracker.tickets) {
    const record = recordedArm(context.root, ticket.id);
    if (record !== undefined) armed.set(ticket.id, record);
  }
  // A freeze disarms and stops: no review is read, none is delegated.
  const decision = decideLoop({
    program, tracker, github, signal: 'now', sharedState, armed, reviews: new Map(), now: 0,
  });
  return { value: decision, human: renderDecision(decision) };
}

function sharedReading(program: LoopProgram, context: LoopRunners): SharedStateReading {
  const bases = protectedBranches(program.autopilot);
  return readSharedState(runner(context.git, 'git'), { bases });
}

/** `autopilot stop --drain | --now`: write the signal the loop reads each tick. */
export function stopCommand(argv: readonly string[], context: LoopRunners): LoopCommandOutput {
  const drain = argv.includes('--drain');
  const now = argv.includes('--now');
  if (drain === now) {
    throw autopilotFailure(
      'AUTOPILOT_USAGE',
      'autopilot stop needs exactly one of --drain or --now',
      drain ? 'both were given' : 'neither was given',
      'pass --drain to finish the tickets in flight, or --now to freeze everything',
    );
  }
  const signal = drain ? 'drain' : 'now';
  writeAtomically(join(context.root, STOP_SIGNAL_PATH), `${signal}\n`);
  return {
    value: { signal, path: STOP_SIGNAL_PATH },
    human: `stop signal written: ${signal} (${STOP_SIGNAL_PATH})\n`,
  };
}

/**
 * `autopilot fingerprint [--before <ticket> | --after <ticket>]`.
 *
 * Bare, it prints the current digests. `--before` records them, once, for a
 * ticket whose unit is about to start; a second record is refused. It keeps the
 * settings of the bases and the branch that deploys whole and leaves out the
 * upstream of every other branch, which units in flight set and remove; the
 * record names the branches it kept, and `--after` reads them back. `--after`
 * compares, and fails when the shared state moved or was never recorded, so a
 * worker can refuse its own push.
 */
export function fingerprintCommand(
  argv: readonly string[],
  context: LoopRunners,
): LoopCommandOutput {
  const program = loopProgram(context.root);
  const reading = sharedReading(program, context);
  const before = flagValue(argv, '--before');
  const after = flagValue(argv, '--after');
  const kept = protectedBranches(program.autopilot);
  if (before !== undefined && after !== undefined) {
    throw autopilotFailure(
      'AUTOPILOT_USAGE',
      'autopilot fingerprint takes --before or --after, not both',
      'one invocation either records a baseline or checks against it',
      'run it once with --before when the unit starts, once with --after when it ends',
    );
  }
  if (before !== undefined) {
    const path = fingerprintPath(context.root, before);
    const current = fingerprintOf(reading, kept);
    if (!writeOnce(path, `${JSON.stringify(current)}\n`)) {
      throw autopilotFailure(
        'AUTOPILOT_CONTRACT',
        `a baseline is already recorded for ${before}`,
        'a second --before would replace the state the unit started from with the state it left',
        'keep the recorded baseline; only a person who has checked the unit deletes it',
      );
    }
    return { value: { ticketId: before, recorded: current }, human: `recorded for ${before}\n` };
  }
  if (after === undefined) {
    const current = fingerprintOf(reading, kept);
    return { value: current, human: `${JSON.stringify(current)}\n` };
  }
  const recorded = recordedFingerprint(context.root, after);
  const changed =
    recorded === undefined
      ? undefined
      : changedParts(recorded, fingerprintOf(reading, recorded.protectedBranches));
  if (changed === undefined || changed.length > 0) {
    throw autopilotFailure(
      'AUTOPILOT_CONTRACT',
      `the unit of ${after} may not be published`,
      changed === undefined
        ? 'no fingerprint was recorded before the unit began'
        : `the shared Git state changed: ${changed.join(', ')}`,
      'leave the unit unpublished and hand it to a human with this report',
    );
  }
  return {
    value: { ticketId: after, unchanged: true },
    human: `${after}: shared state unchanged\n`,
  };
}

function viewOf(gh: (args: readonly string[]) => string, number: number) {
  const fields = PULL_REQUEST_FIELDS.join(',');
  return parsePullRequestView(gh(['pr', 'view', String(number), '--json', fields]));
}

/**
 * GitHub arms a pull request one of two ways, and `gh pr view` shows only the
 * first: an auto-merge request while the checks run, or, once they pass on a
 * base with a merge queue, an entry in that queue and no request at all.
 */
function armedStateOf(gh: (args: readonly string[]) => string, number: number) {
  const view = viewOf(gh, number);
  const membership = readQueueMembership(gh, number);
  return { ...view, ...membership, armed: view.autoMerge || membership.queued };
}

// gh 2.100 has no dequeue command, and `gh pr merge --disable-auto` on a queued
// pull request warns that it is already queued and exits 0 having done nothing.
// https://docs.github.com/en/graphql/reference/mutations#dequeuepullrequest
const DEQUEUE_MUTATION =
  'mutation($id: ID!) { dequeuePullRequest(input: { id: $id }) { clientMutationId } }';

interface ArmedState {
  readonly number: number;
  readonly nodeId: string;
  readonly queued: boolean;
  readonly autoMerge: boolean;
}

/**
 * Stops whatever would merge `pr` on its own. The auto-merge request goes
 * first: while it stands, GitHub may queue the pull request again the moment
 * it leaves the queue.
 */
function stopMerge(gh: (args: readonly string[]) => string, pr: ArmedState): void {
  if (pr.autoMerge) gh(['pr', 'merge', String(pr.number), '--disable-auto']);
  if (pr.queued) gh(['api', 'graphql', '-f', `id=${pr.nodeId}`, '-f', `query=${DEQUEUE_MUTATION}`]);
}

/**
 * `autopilot arm --ticket <id> --pr <n> --head <sha>`: the kernel's
 * `enable-auto-merge`. GitHub keeps no armed head, so it is recorded first,
 * then the merge is armed on exactly that head, then GitHub is read back: a
 * pull request neither holding an auto-merge nor sitting in the merge queue is
 * a failure, and one whose head moved while arming is disarmed at once. The
 * kernel disarms later whatever this record no longer vouches for.
 */
export function armCommand(argv: readonly string[], context: LoopRunners): LoopCommandOutput {
  const ticket = flagValue(argv, '--ticket');
  const head = flagValue(argv, '--head');
  if (ticket === undefined || head === undefined || !SHA_PATTERN.test(head)) {
    throw autopilotFailure(
      'AUTOPILOT_USAGE',
      'autopilot arm needs the ticket, the pull request and the full head SHA the kernel named',
      ticket === undefined ? '--ticket was not given' : '--head is missing or not a full SHA',
      'copy them from the `enable-auto-merge` action: `--ticket <id> --pr <n> --head <sha>`',
    );
  }
  const number = pullRequestNumber(argv, 'autopilot arm');
  const path = armedPath(context.root, ticket);
  const gh = runner(context.gh, 'gh');
  const before = viewOf(gh, number);
  if (before.state !== 'open' || before.headSha !== head) {
    throw autopilotFailure(
      'AUTOPILOT_CONTRACT',
      `#${number} is not the pull request the kernel approved`,
      before.state !== 'open'
        ? `#${number} is ${before.state}`
        : `its head is ${before.headSha}, not ${head}`,
      'ask `autopilot next` again; it arms only the head it just read',
    );
  }
  writeAtomically(path, `${JSON.stringify({ pullRequest: number, headSha: head })}\n`);
  gh(['pr', 'merge', String(number), '--auto', '--match-head-commit', head]);
  const after = armedStateOf(gh, number);
  // The queue can merge the head between the arming and this read.
  if (after.state === 'merged' && after.headSha === head) {
    return {
      value: { ticketId: ticket, pullRequest: number, headSha: head, merged: true },
      human: `#${number} merged on ${head}\n`,
    };
  }
  if (after.armed && after.headSha !== head) stopMerge(gh, after);
  if (!after.armed || after.headSha !== head) {
    throw autopilotFailure(
      'AUTOPILOT_CONTRACT',
      `#${number} is not armed on ${head}`,
      after.armed
        ? `its head moved to ${after.headSha} while arming; it was disarmed`
        : 'GitHub shows neither an auto-merge nor a merge queue entry',
      'ask `autopilot next` again before arming anything',
    );
  }
  return {
    value: { ticketId: ticket, pullRequest: number, headSha: head, merged: false },
    human: `#${number} armed on ${head}\n`,
  };
}

/**
 * `autopilot disarm --pr <n>`: the kernel's `disable-auto-merge`. It takes the
 * pull request out of the merge queue and turns its auto-merge off, then reads
 * GitHub back and fails while either still holds. A pull request already
 * disarmed is left alone.
 */
export function disarmCommand(argv: readonly string[], context: LoopRunners): LoopCommandOutput {
  const number = pullRequestNumber(argv, 'autopilot disarm');
  const gh = runner(context.gh, 'gh');
  const before = armedStateOf(gh, number);
  if (!before.armed) {
    return {
      value: { pullRequest: number, headSha: before.headSha, disarmed: false },
      human: `#${number} holds no auto-merge and sits in no merge queue\n`,
    };
  }
  stopMerge(gh, before);
  const after = armedStateOf(gh, number);
  if (after.armed) {
    throw autopilotFailure(
      'AUTOPILOT_CONTRACT',
      `#${number} is still armed`,
      after.queued
        ? 'GitHub still shows it in the merge queue after the dequeue'
        : 'GitHub still shows an auto-merge request after --disable-auto',
      'disarm it by hand in GitHub, then ask `autopilot next` again',
    );
  }
  return {
    value: { pullRequest: number, headSha: after.headSha, disarmed: true },
    human: `#${number} disarmed at ${after.headSha}\n`,
  };
}

/**
 * `autopilot judgment conflict-class`: the comment block for the conflict class
 * on stdin, admitted before it is printed. The worker posts exactly this, so the
 * kernel finds it on the pull request after a restart and admits it a second
 * time there. A review verdict is not rendered here: `autopilot review` records
 * it locally, bound to the session it delegated, and posts only a copy.
 */
export function judgmentCommand(argv: readonly string[], stdin: string): LoopCommandOutput {
  const value = jsonFrom(stdin, 'judgment');
  const kind = argv.slice(argv.indexOf('judgment') + 1).find((arg) => !arg.startsWith('-'));
  if (kind === 'review-verdict') {
    throw autopilotFailure(
      'AUTOPILOT_USAGE',
      'a review verdict is not rendered for posting by hand',
      '`autopilot review` records it locally, from the reviewer it delegated on the head',
      'answer the `review` action with `autopilot review --ticket <id> --pr <n> --head <sha> --round <1|2>`',
    );
  }
  const kinds = JUDGMENT_KINDS.filter((known) => known !== 'review-verdict');
  if (kind === undefined || !(kinds as readonly string[]).includes(kind)) {
    throw autopilotFailure(
      'AUTOPILOT_USAGE',
      'autopilot judgment needs the kind of judgment it renders',
      `${JSON.stringify(kind ?? '')} is not one of ${kinds.join(', ')}`,
      'run `autopilot judgment conflict-class`',
    );
  }
  const body = renderJudgmentComment(kind as JudgmentKind, value);
  return { value: { kind, body }, human: body };
}

function jsonFrom(stdin: string, command: string): unknown {
  try {
    return JSON.parse(stdin);
  } catch (error) {
    throw autopilotFailure(
      'AUTOPILOT_INPUT',
      `the ${command} on stdin is not valid JSON`,
      error instanceof Error ? error.message : String(error),
      `pipe the typed ${command}, unmodified, into \`autopilot ${command}\``,
    );
  }
}

function pullRequestNumber(argv: readonly string[], command: string): number {
  const text = flagValue(argv, '--pr');
  const number = Number(text);
  if (text !== undefined && /^[1-9][0-9]{0,9}$/.test(text)) return number;
  throw autopilotFailure(
    'AUTOPILOT_USAGE',
    `${command} needs the pull request it names`,
    text === undefined ? '--pr was not given' : `--pr ${JSON.stringify(text)} is not a number`,
    'pass the pull request number, for example `--pr 42`',
  );
}

