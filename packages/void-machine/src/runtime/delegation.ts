// tdd-cover: e2e packages/void-machine/test/delegation-driver.test.ts
import {
  DELEGATION_LIMITS, type RunObservation, type RunRole, type RunStatus, type RunTransition,
  type RuntimeName, describeRun, isOpen, observeRun, runView,
} from '../core/delegation.js';
import type { SurfaceRecord } from './presentation.js';

/**
 * The delegation driver: ports it needs and the bounded observation loop. Pure: the registry,
 * the runtime and the clock are injected, so the loop never touches a process or a file.
 */

export interface SessionBinding {
  /** The runtime's short handle, known from the launch acknowledgement. */
  readonly handle: string;
  /** The full native session identifier, known once the runtime lists the session. */
  readonly sessionId?: string;
}

export interface RunRecord {
  readonly runId: string;
  readonly missionId: string;
  readonly name: string;
  readonly role: RunRole;
  readonly runtime: RuntimeName;
  readonly cwd: string;
  readonly agentType: string | undefined;
  readonly ticket: string | undefined;
  readonly model: string | undefined;
  readonly binding?: SessionBinding;
  readonly transitions: readonly RunTransition[];
}

/** A Stop-hook result as read back: untrusted text, bounded, tied to one native session. */
export interface RunResult {
  readonly sessionId: string;
  readonly recordedAt: number;
  /** Background tasks and scheduled wakeups that would resume the turn, as the hook saw them. */
  readonly pendingWork: number;
  readonly text: string;
  readonly truncated: boolean;
}

export interface MissionLock { release(): Promise<void> }

export interface RunRegistry {
  list(missionId: string): Promise<readonly RunRecord[]>;
  read(runId: string): Promise<RunRecord | undefined>;
  /** Appends only when `transition.seq` follows the last recorded one. */
  append(runId: string, transition: RunTransition): Promise<'appended' | 'conflict'>;
  bind(runId: string, binding: SessionBinding): Promise<void>;
  result(runId: string): Promise<RunResult | undefined>;
  /** Tries once; undefined while another owner holds a live lease on the mission. */
  lock(missionId: string, owner: string): Promise<MissionLock | undefined>;
}

/** A file handed to a delegated agent, and the only directory it is granted for it. */
export interface InstructionFile {
  readonly path: string;
  readonly directory: string;
}

/** The registry a command writes through: creation and instruction files, beside the driver's needs. */
export interface DelegationStore extends RunRegistry {
  /** Records the run and its first transition, and writes its brief. */
  create(run: Omit<RunRecord, 'transitions' | 'binding'>, first: RunTransition, brief: string)
    : Promise<InstructionFile>;
  /** Writes the next message of a run as a new instruction file. */
  writeMessage(runId: string, text: string): Promise<InstructionFile>;
  /** Every recorded run identifier, bounded, for a status without a run. */
  runIds(): Promise<readonly string[]>;
  /** The surface a run is shown in; a record that does not parse is corrupt, never absent. */
  readSurface(runId: string): Promise<SurfaceReading>;
  /** Replaces the surface record whole; readers see the old or the new one, never half. */
  writeSurface(runId: string, record: SurfaceRecord): Promise<void>;
}

export type SurfaceReading =
  | { readonly kind: 'recorded'; readonly record: SurfaceRecord }
  | { readonly kind: 'absent' | 'corrupt' };

export interface NativeRunRef {
  readonly name: string;
  readonly handle?: string;
  readonly sessionId?: string;
}
export interface SessionState {
  readonly observation: RunObservation;
  readonly binding?: { readonly handle: string; readonly sessionId: string };
}
/** Sessions keyed by run name; a run missing from the map is absent. */
export type SessionReading = ReadonlyMap<string, SessionState>;
export type RuntimeReading =
  | { readonly kind: 'read'; readonly sessions: SessionReading }
  | { readonly kind: 'unreadable'; readonly cause: string };

export interface LaunchPlan {
  readonly name: string;
  readonly role: RunRole;
  readonly agentType: string | undefined;
  readonly model: string | undefined;
  readonly cwd: string;
  /** A file the agent reads first; the prompt itself never carries caller text. */
  readonly instructionPath: string;
  readonly instructionDirectory: string;
}
export type LaunchOutcome =
  | { readonly kind: 'acknowledged'; readonly handle: string }
  | { readonly kind: 'lost'; readonly cause: string }
  | { readonly kind: 'refused'; readonly cause: string; readonly action: string; readonly handle?: string };
export type Preflight =
  | { readonly ok: true }
  | { readonly ok: false; readonly cause: string; readonly action: string };

export interface AgentRuntimePort {
  preflight(cwd: string): Promise<Preflight>;
  dispatch(plan: LaunchPlan): Promise<LaunchOutcome>;
  observe(refs: readonly NativeRunRef[]): Promise<RuntimeReading>;
  send(ref: NativeRunRef, plan: LaunchPlan): Promise<LaunchOutcome>;
  stop(ref: NativeRunRef): Promise<Preflight>;
  attachCommand(ref: NativeRunRef): readonly string[] | undefined;
}

export interface DelegationClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export function refOf(run: RunRecord): NativeRunRef {
  return { name: run.name, ...run.binding };
}

/** The result counts only when it comes from the session this run is bound to. */
export function boundResult(run: RunRecord, result: RunResult | undefined): RunResult | undefined {
  const sessionId = run.binding?.sessionId;
  return sessionId !== undefined && result?.sessionId === sessionId ? result : undefined;
}

/** The bound result of the current turn, the only one `accept` takes. */
export function currentResult(run: RunRecord, result: RunResult | undefined): RunResult | undefined {
  const bound = boundResult(run, result);
  return bound !== undefined && bound.recordedAt >= runView(run.transitions).turnStartedAt
    ? bound : undefined;
}

export function statusOf(run: RunRecord, result: RunResult | undefined): RunStatus {
  return describeRun(runView(run.transitions),
    { resultCollected: currentResult(run, result) !== undefined });
}

export interface ObserveDependencies {
  readonly registry: RunRegistry;
  readonly runtime: Pick<AgentRuntimePort, 'observe'>;
  readonly clock: DelegationClock;
  /** First time each run's turn was seen done without its result, kept across ticks. */
  readonly doneSince: Map<string, number>;
}
export type ObserveOutcome = { readonly kind: 'observed' } | { readonly kind: 'unreadable'; readonly cause: string };

async function bindIfNew(registry: RunRegistry, run: RunRecord,
  state: SessionState | undefined): Promise<RunRecord> {
  const found = state?.binding;
  if (found === undefined) return run;
  if (run.binding?.handle === found.handle && run.binding.sessionId === found.sessionId) return run;
  await registry.bind(run.runId, found);
  return { ...run, binding: found };
}

/** One tick for one mission. The caller holds the mission lock. */
export async function observeMission(missionId: string, deps: ObserveDependencies): Promise<ObserveOutcome> {
  const open = (await deps.registry.list(missionId))
    .filter((run) => isOpen(runView(run.transitions).state));
  if (open.length === 0) return { kind: 'observed' };
  const reading = await deps.runtime.observe(open.map(refOf));
  if (reading.kind === 'unreadable') return reading;
  for (const listed of open) {
    const state = reading.sessions.get(listed.name);
    const run = await bindIfNew(deps.registry, listed, state);
    const result = boundResult(run, await deps.registry.result(run.runId));
    const since = deps.doneSince.get(run.runId);
    const step = observeRun(runView(run.transitions), {
      observation: state?.observation ?? { kind: 'absent' }, now: deps.clock.now(),
      ...(result === undefined ? {} : { result: { recordedAt: result.recordedAt,
        pendingWork: result.pendingWork } }),
      ...(since === undefined ? {} : { doneSince: since }),
    });
    if (step.doneSince === undefined) deps.doneSince.delete(run.runId);
    else deps.doneSince.set(run.runId, step.doneSince);
    if (step.transition !== undefined) await deps.registry.append(run.runId, step.transition);
  }
  return { kind: 'observed' };
}

export interface RunProgress {
  readonly runId: string;
  readonly transitions: readonly RunTransition[];
  readonly status: RunStatus;
}
export type WaitOutcome =
  | { readonly kind: 'transitioned'; readonly runs: readonly RunProgress[] }
  | { readonly kind: 'timed-out'; readonly runs: readonly RunProgress[];
    readonly lastObservationError?: string }
  | { readonly kind: 'unknown-run'; readonly runId: string };

export interface WaitDependencies {
  readonly registry: RunRegistry;
  readonly runtime: Pick<AgentRuntimePort, 'observe'>;
  readonly clock: DelegationClock;
  /** Identifies this waiter in the mission lock. */
  readonly owner: string;
}

async function progress(registry: RunRegistry, cursor: ReadonlyMap<string, number>)
  : Promise<RunProgress[]> {
  const runs: RunProgress[] = [];
  for (const [runId, seen] of cursor) {
    const run = await registry.read(runId);
    if (run === undefined) continue;
    runs.push({ runId, transitions: run.transitions.slice(seen),
      status: statusOf(run, await registry.result(runId)) });
  }
  return runs;
}

function settled(runs: readonly RunProgress[], any: boolean): readonly RunProgress[] | undefined {
  const moved = runs.filter((run) => run.transitions.length > 0);
  if (any) return moved.length > 0 ? moved : undefined;
  return moved.length === runs.length ? runs : undefined;
}

async function tick(missions: readonly string[], deps: WaitDependencies,
  doneSince: Map<string, number>): Promise<string | undefined> {
  let error: string | undefined;
  for (const missionId of missions) {
    const lock = await deps.registry.lock(missionId, deps.owner);
    if (lock === undefined) continue;
    try {
      const outcome = await observeMission(missionId, { ...deps, doneSince });
      if (outcome.kind === 'unreadable') error = outcome.cause;
    } finally {
      await lock.release();
    }
  }
  return error;
}

/**
 * Waits until every run (or, with `any`, one run) records a transition after the call, or the
 * timeout elapses. Only the lock holder observes; every waiter reads the same log.
 */
export async function waitForTransitions(runIds: readonly string[],
  options: { readonly any: boolean; readonly timeoutMs: number }, deps: WaitDependencies)
  : Promise<WaitOutcome> {
  const cursor = new Map<string, number>();
  const missions = new Set<string>();
  for (const runId of runIds) {
    const run = await deps.registry.read(runId);
    if (run === undefined) return { kind: 'unknown-run', runId };
    cursor.set(runId, run.transitions.length);
    missions.add(run.missionId);
  }
  const doneSince = new Map<string, number>();
  const deadline = deps.clock.now() + options.timeoutMs;
  const ticks = Math.ceil(options.timeoutMs / DELEGATION_LIMITS.pollIntervalMs) + 1;
  let lastError: string | undefined;
  for (let count = 0; count < ticks; count += 1) {
    lastError = await tick([...missions], deps, doneSince) ?? lastError;
    const done = settled(await progress(deps.registry, cursor), options.any);
    if (done !== undefined) return { kind: 'transitioned', runs: done };
    if (deps.clock.now() >= deadline) break;
    await deps.clock.sleep(DELEGATION_LIMITS.pollIntervalMs);
  }
  const runs = await progress(deps.registry, cursor);
  return { kind: 'timed-out', runs, ...(lastError === undefined ? {} : { lastObservationError: lastError }) };
}
