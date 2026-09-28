// tdd-cover: e2e packages/void-machine/test/delegation-core.test.ts
/**
 * Delegated agent runs: states, admission and transitions. Pure. The live state of a session
 * always comes from its runtime; a run only records the transitions the kernel accepted.
 */

export const RUN_STATES = ['admitted', 'dispatched', 'working', 'turn-ended', 'waiting-human',
  'accepted', 'retired', 'failed', 'stopped', 'reconciling'] as const;
export type RunState = typeof RUN_STATES[number];
export type RunRole = 'work' | 'review';
export type RuntimeName = 'claude';

export const DELEGATION_LIMITS = {
  /** Open runs one mission may hold; the caller bounds its own parallelism below it. */
  activeRunsPerMission: 4,
  /** How long a run may stay unlisted, from its entry into reconciling, before it fails. */
  reconcileWindowMs: 60_000,
  /** How long a finished turn may wait for its Stop-hook result, from the first done seen. */
  resultGraceMs: 30_000,
  pollIntervalMs: 5_000,
} as const;

export interface AgentRunRequest {
  readonly runId: string;
  readonly missionId: string;
  readonly ticket: string | undefined;
  readonly runtime: RuntimeName;
  readonly agentType: string | undefined;
  readonly role: RunRole;
  readonly model: string | undefined;
  readonly cwd: string;
  readonly brief: string;
}

export type TransitionEvent = 'admitted' | 'dispatched' | 'lost' | 'refused' | 'observed'
  | 'turn-ended' | 'result-missing' | 'sent' | 'accepted' | 'retired' | 'stopped';

export interface RunTransition {
  readonly seq: number;
  readonly at: number;
  readonly from?: RunState;
  readonly to: RunState;
  readonly event: TransitionEvent;
  readonly cause: string;
  readonly action: string;
  readonly waitingFor?: string;
}

/** A runtime's reading of one session. Unreadable never means absent. */
export type RunObservation =
  | { readonly kind: 'present'; readonly state: 'working' | 'blocked' | 'done' | 'failed' | 'stopped';
    readonly waitingFor?: string;
    /** Whether the session's process is busy right now; absent once the process has exited. */
    readonly status?: 'busy' | 'waiting' | 'idle' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly cause: string };

/**
 * The Stop-hook result as the kernel admits it: which turn it belongs to, never its text, and
 * how much background work (tasks, scheduled wakeups) would resume that turn.
 */
export interface RunResultStamp { readonly recordedAt: number; readonly pendingWork: number }

export interface RunView {
  readonly state: RunState;
  readonly last: RunTransition;
  /** When the current turn began: admission, or the last send. */
  readonly turnStartedAt: number;
  readonly admittedAt: number;
}

export type Decision =
  | { readonly ok: true; readonly transition: RunTransition }
  | { readonly ok: false; readonly cause: string; readonly action: string };

export type DispatchOutcome =
  | { readonly kind: 'acknowledged' }
  | { readonly kind: 'lost'; readonly cause: string }
  | { readonly kind: 'refused'; readonly cause: string; readonly action: string };

const CLOSED: ReadonlySet<RunState> = new Set(['accepted', 'retired', 'failed', 'stopped']);

export function isOpen(state: RunState): boolean {
  return !CLOSED.has(state);
}

/** Reads a transition log; an empty or out-of-order log is a corrupt registry. */
export function runView(log: readonly RunTransition[]): RunView {
  const first = log[0];
  if (first === undefined || first.to !== 'admitted') throw new Error('run history is empty');
  let turnStartedAt = first.at;
  log.forEach((transition, index) => {
    if (transition.seq !== index + 1) throw new Error('run history is out of order');
    if (transition.event === 'sent') turnStartedAt = transition.at;
  });
  const last = log[log.length - 1] ?? first;
  return { state: last.to, last, turnStartedAt, admittedAt: first.at };
}

function next(view: RunView, now: number, to: RunState, event: TransitionEvent,
  cause: string, action: string, waitingFor?: string): RunTransition {
  return { seq: view.last.seq + 1, at: now, from: view.state, to, event, cause, action,
    ...(waitingFor === undefined ? {} : { waitingFor }) };
}

function refuse(cause: string, action: string): Decision {
  return { ok: false, cause, action };
}

export function admitRun(openRuns: number, now: number): Decision {
  const cap = DELEGATION_LIMITS.activeRunsPerMission;
  if (openRuns >= cap) {
    return refuse(`the mission already holds ${String(cap)} open runs`,
      'wait for one to end, or accept or stop one with void-machine agents accept|stop <runId>');
  }
  return { ok: true, transition: { seq: 1, at: now, to: 'admitted', event: 'admitted',
    cause: 'run admitted', action: 'the launch is in progress' } };
}

export function recordDispatch(view: RunView, outcome: DispatchOutcome, now: number): Decision {
  if (view.state !== 'admitted') return refuse(`run is ${view.state}, not admitted`, 'none');
  if (outcome.kind === 'acknowledged') {
    return { ok: true, transition: next(view, now, 'dispatched', 'dispatched',
      'the runtime acknowledged the launch', 'wait with void-machine agents wait <runId>') };
  }
  if (outcome.kind === 'lost') {
    return { ok: true, transition: next(view, now, 'reconciling', 'lost', outcome.cause,
      'the session is looked up by name; it is never launched twice') };
  }
  return { ok: true, transition: next(view, now, 'failed', 'refused', outcome.cause, outcome.action) };
}

export interface ObservationInput {
  readonly observation: RunObservation;
  readonly now: number;
  readonly result?: RunResultStamp;
  /** First time this turn was seen done without its result, kept by the observer. */
  readonly doneSince?: number;
}
export interface ObservationStep {
  readonly transition?: RunTransition;
  readonly doneSince?: number;
}

function observedAbsent(view: RunView, now: number): ObservationStep {
  const lost = 'the session is no longer listed by its runtime';
  if (view.state === 'admitted' || view.state === 'reconciling') {
    const since = view.state === 'admitted' ? view.admittedAt : view.last.at;
    if (now - since < DELEGATION_LIMITS.reconcileWindowMs) return {};
    return { transition: next(view, now, 'failed', 'observed',
      `${lost} after ${String(DELEGATION_LIMITS.reconcileWindowMs / 1000)} s of reconciliation`,
      'inspect claude agents; stop the run, and dispatch a new one only once no session remains') };
  }
  return { transition: next(view, now, 'reconciling', 'observed', lost,
    'the session is looked up by name; it is never launched twice') };
}

function observedDone(view: RunView, input: ObservationInput): ObservationStep {
  if (view.state === 'turn-ended') return {};
  const doneSince = input.doneSince ?? input.now;
  if (input.now - doneSince < DELEGATION_LIMITS.resultGraceMs) return { doneSince };
  return { transition: next(view, input.now, 'turn-ended', 'result-missing',
    'the agent ended its turn but the delegation-result hook recorded no final message',
    'send a message asking for the final result: void-machine agents send <runId>') };
}

/** A final result of this turn, from a session that is not busy, ends the turn. */
function endedByResult(view: RunView, input: ObservationInput): ObservationStep | undefined {
  const { observation, result, now } = input;
  if (observation.kind !== 'present' || observation.status === 'busy') return undefined;
  if (observation.state === 'failed' || observation.state === 'stopped') return undefined;
  if (result === undefined || result.recordedAt < view.turnStartedAt || result.pendingWork > 0) return undefined;
  if (view.state === 'turn-ended') return {};
  // Claude reads a turn that ends on a question as blocked, and may keep reading working
  // long after an idle turn ended: the Stop-hook result is the reliable end of a turn.
  const question = observation.state === 'blocked';
  return { transition: next(view, now, 'turn-ended', 'turn-ended',
    question ? 'the agent ended its turn with a question; its final message is collected'
      : 'the agent ended its turn and its final message is collected',
    question ? 'answer with void-machine agents send <runId>, or accept the result'
      : 'read it with void-machine agents status <runId>, then accept or send') };
}

export function observeRun(view: RunView, input: ObservationInput): ObservationStep {
  const { observation, now } = input;
  if (!isOpen(view.state) || observation.kind === 'unreadable') return {};
  if (observation.kind === 'absent') return observedAbsent(view, now);
  const ended = endedByResult(view, input);
  if (ended !== undefined) return ended;
  switch (observation.state) {
    case 'working':
      return view.state === 'working' ? {} : { transition: next(view, now, 'working', 'observed',
        'the agent is working', 'wait with void-machine agents wait <runId>') };
    case 'blocked': {
      const waitingFor = observation.waitingFor ?? 'input needed';
      if (view.state === 'waiting-human' && view.last.waitingFor === waitingFor) return {};
      return { transition: next(view, now, 'waiting-human', 'observed',
        `the agent waits for a person: ${waitingFor}`,
        'decide in the agent session: void-machine agents attach <runId>', waitingFor) };
    }
    case 'done':
      return observedDone(view, input);
    case 'failed':
      return { transition: next(view, now, 'failed', 'observed', 'the session ended with an error',
        'inspect it with void-machine agents attach <runId>') };
    case 'stopped':
      return { transition: next(view, now, 'stopped', 'observed', 'the session was stopped',
        'dispatch a new run if the work is still needed') };
    default: {
      const unknown: never = observation.state;
      return unknown;
    }
  }
}

export function sendRun(view: RunView, now: number): Decision {
  if (view.state !== 'turn-ended') {
    return refuse(`run is ${view.state}; only a run whose turn ended accepts a message`,
      'wait with void-machine agents wait <runId>');
  }
  return { ok: true, transition: next(view, now, 'working', 'sent', 'a message started a new turn',
    'wait with void-machine agents wait <runId>') };
}

export function acceptRun(view: RunView, result: RunResultStamp | undefined, now: number): Decision {
  if (view.state !== 'turn-ended') {
    return refuse(`run is ${view.state}; only a run whose turn ended can be accepted`,
      'wait with void-machine agents wait <runId>');
  }
  if (result === undefined || result.recordedAt < view.turnStartedAt) {
    return refuse('no final message was collected for the current turn',
      'send a message asking for the final result: void-machine agents send <runId>');
  }
  return { ok: true, transition: next(view, now, 'accepted', 'accepted',
    'the coordinator accepted the collected result', 'none') };
}

export function retireRun(view: RunView, now: number): Decision {
  if (view.state !== 'accepted') return refuse(`run is ${view.state}, not accepted`, 'none');
  return { ok: true, transition: next(view, now, 'retired', 'retired',
    'the run is closed; its surface, if any, is closed', 'none') };
}

export function stopRun(view: RunView, now: number): Decision {
  if (!isOpen(view.state)) return refuse(`run is already ${view.state}`, 'none');
  return { ok: true, transition: next(view, now, 'stopped', 'stopped',
    'the coordinator stopped the run', 'dispatch a new run if the work is still needed') };
}

export interface RunStatus {
  readonly state: RunState;
  readonly cause: string;
  readonly action: string;
  readonly waitingFor?: string;
}

/** Cause and next action come from the last accepted transition, refined by the result. */
export function describeRun(view: RunView, facts: { readonly resultCollected: boolean }): RunStatus {
  const { state, last } = view;
  const waiting = last.waitingFor === undefined ? {} : { waitingFor: last.waitingFor };
  if (state === 'turn-ended') {
    return { state, ...waiting,
      cause: facts.resultCollected ? 'the agent ended its turn and its final message is collected'
        : last.cause,
      action: facts.resultCollected
        ? 'accept with void-machine agents accept <runId>, or reply with void-machine agents send <runId>'
        : 'send a message asking for the final result: void-machine agents send <runId>' };
  }
  return { state, cause: last.cause, action: last.action, ...waiting };
}
