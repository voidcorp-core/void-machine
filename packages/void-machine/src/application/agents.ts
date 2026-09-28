// tdd-cover: e2e packages/void-machine/test/agents-application.test.ts
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClaudeSessionRuntime } from '../adapters/runtime/claude-session.js';
import { MISSION_ID, RUN_ID, createRunRegistry, resolveMachineRoot } from '../adapters/store/run-registry.js';
import {
  type Decision, type RunRole, type RunStatus, acceptRun, admitRun, isOpen, recordDispatch, retireRun, runView,
  sendRun, stopRun,
} from '../core/delegation.js';
import {
  type AgentRuntimePort, type DelegationClock, type DelegationStore, type LaunchOutcome, type LaunchPlan,
  type RunRecord,
  type WaitOutcome, currentResult, refOf, statusOf, waitForTransitions,
} from '../runtime/delegation.js';
import type { SurfaceClosing, SurfaceRecord } from '../runtime/presentation.js';
import {
  type SurfaceContext, type SurfaceSummary, type Surfaces, closeRunSurface, plannedSurface, showRun,
  surfaceSummaries, surfacesFor,
} from './surfaces.js';

/**
 * `void-machine agents`: the one path by which a coordinator launches, follows and closes a
 * delegated agent. When a multiplexer hosts the caller, each run is also shown in a surface of
 * its own, opened at dispatch and closed when the run retires or stops; the surface is only a view.
 */

export interface AgentsContext {
  readonly store: DelegationStore;
  readonly runtime: AgentRuntimePort;
  readonly surfaces: Surfaces;
  readonly clock: DelegationClock;
  /** Identifies this process in mission locks. */
  readonly owner: string;
  readonly newRunId: () => string;
  readonly newMissionId: () => string;
}

export type Refusal = { readonly ok: false; readonly cause: string; readonly action: string };
export interface RunSummary {
  readonly runId: string;
  readonly missionId: string;
  readonly ticket?: string;
  readonly role: RunRole;
  readonly agentType?: string;
  readonly status: RunStatus;
  readonly result?: { readonly text: string; readonly truncated: boolean };
  readonly attach?: string;
  readonly surface?: SurfaceSummary;
}

const AGENT_TYPE = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,99}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/;
const TICKET = /^[A-Z][A-Z0-9]{0,9}-\d{1,9}$/;
const MAX_BRIEF_BYTES = 1_048_576;
const LOCK_ATTEMPTS = 80;
const LOCK_RETRY_MS = 250;

function refusal(cause: string, action: string): Refusal {
  return { ok: false, cause, action };
}

export interface DispatchInput {
  readonly role: RunRole;
  readonly agentType?: string | undefined;
  readonly model?: string | undefined;
  readonly ticket?: string | undefined;
  readonly missionId?: string | undefined;
  readonly cwd: string;
  readonly brief: string;
}

function invalidInput(input: DispatchInput): Refusal | undefined {
  const usage = 'correct the option and dispatch again';
  if (input.role === 'review' && input.agentType === undefined) {
    return refusal('a review run needs the native agent type whose tools it keeps (--type)', usage);
  }
  if (input.agentType !== undefined && !AGENT_TYPE.test(input.agentType)) return refusal('--type is not an agent name', usage);
  if (input.model !== undefined && !MODEL.test(input.model)) return refusal('--model is not a model name', usage);
  if (input.ticket !== undefined && !TICKET.test(input.ticket)) return refusal('--ticket is not a ticket key', usage);
  if (input.missionId !== undefined && !MISSION_ID.test(input.missionId)) return refusal('--mission is not a mission id', usage);
  const size = Buffer.byteLength(input.brief, 'utf8');
  if (size === 0 || size > MAX_BRIEF_BYTES) return refusal('the brief must hold 1 byte to 1 MiB', usage);
  try {
    if (!statSync(input.cwd).isDirectory()) return refusal(`${input.cwd} is not a directory`, usage);
  } catch {
    return refusal(`${input.cwd} does not exist`, usage);
  }
  return undefined;
}

async function withMissionLock<T>(context: AgentsContext, missionId: string,
  action: () => Promise<T>): Promise<T | Refusal> {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    const lock = await context.store.lock(missionId, context.owner);
    if (lock !== undefined) {
      try { return await action(); } finally { await lock.release(); }
    }
    await context.clock.sleep(LOCK_RETRY_MS);
  }
  return refusal(`mission ${missionId} stayed busy for ${String(LOCK_ATTEMPTS * LOCK_RETRY_MS / 1000)} s`,
    'retry the command; another agents command or wait is observing this mission');
}

async function record(context: AgentsContext, runId: string, decision: Decision): Promise<Refusal | undefined> {
  if (!decision.ok) return refusal(decision.cause, decision.action);
  if (await context.store.append(runId, decision.transition) === 'conflict') {
    return refusal('another command recorded a transition first', 'read the run with void-machine agents status');
  }
  return undefined;
}

function plan(run: Pick<RunRecord, 'name' | 'role' | 'agentType' | 'model' | 'cwd'>,
  file: { readonly path: string; readonly directory: string }): LaunchPlan {
  return { name: run.name, role: run.role, agentType: run.agentType, model: run.model, cwd: run.cwd,
    instructionPath: file.path, instructionDirectory: file.directory };
}

function surfaceContext(context: AgentsContext): SurfaceContext {
  return { store: context.store, surfaces: context.surfaces, clock: context.clock,
    locked: (missionId, action) => withMissionLock(context, missionId, action) };
}

export type DispatchReceipt =
  | { readonly ok: true; readonly runId: string; readonly missionId: string; readonly status: RunStatus;
    readonly surface: SurfaceRecord }
  | Refusal;

export async function dispatchAgent(context: AgentsContext, input: DispatchInput): Promise<DispatchReceipt> {
  const invalid = invalidInput(input);
  if (invalid !== undefined) return invalid;
  const cwd = realpathSync(resolve(input.cwd));
  const ready = await context.runtime.preflight(cwd);
  if (!ready.ok) return refusal(ready.cause, ready.action);
  const missionId = input.missionId ?? context.newMissionId();
  const runId = context.newRunId();
  const run = { runId, missionId, name: `vm-${runId}`, role: input.role, runtime: 'claude' as const, cwd,
    agentType: input.agentType, ticket: input.ticket, model: input.model };
  let launched: LaunchOutcome | undefined;
  // The runtime's display command exists once the launch is acknowledged with a handle.
  const display = (launch: LaunchOutcome | undefined) => launch?.kind === 'acknowledged'
    ? context.runtime.attachCommand({ name: run.name, handle: launch.handle }) : undefined;
  const outcome = await withMissionLock(context, missionId, async (): Promise<DispatchReceipt> => {
    const open = (await context.store.list(missionId)).filter((known) => isOpen(runView(known.transitions).state));
    const admission = admitRun(open.length, context.clock.now());
    if (!admission.ok) return refusal(admission.cause, admission.action);
    const brief = await context.store.create(run, admission.transition, input.brief);
    const launch = await context.runtime.dispatch(plan(run, brief));
    launched = launch;
    if (launch.kind !== 'lost' && launch.handle !== undefined) {
      await context.store.bind(runId, { handle: launch.handle });
    }
    const recorded = await context.store.read(runId);
    if (recorded === undefined) return refusal('the run record could not be read back', 'inspect .void/machine/runs');
    const failed = await record(context, runId, recordDispatch(runView(recorded.transitions), launch, context.clock.now()));
    if (failed !== undefined) return failed;
    if (launch.kind === 'refused') {
      if (launch.handle !== undefined) await context.runtime.stop({ name: run.name, handle: launch.handle });
      return refusal(launch.cause, launch.action);
    }
    const surface = plannedSurface(context.surfaces, display(launch), context.clock.now());
    await context.store.writeSurface(runId, surface);
    const latest = await context.store.read(runId);
    return latest === undefined ? refusal('the run record could not be read back', 'inspect .void/machine/runs')
      : { ok: true, runId, missionId, status: statusOf(latest, undefined), surface };
  });
  const command = outcome.ok ? display(launched) : undefined;
  if (!outcome.ok || outcome.surface.state !== 'opening' || command === undefined) return outcome;
  // A slow multiplexer never holds the mission: the surface opens once the lock is released.
  return { ...outcome, surface: await showRun(surfaceContext(context), { runId, missionId, role: input.role,
    ticket: input.ticket, cwd }, command) };
}

async function readRun(context: AgentsContext, runId: string): Promise<RunRecord | Refusal> {
  if (!RUN_ID.test(runId)) return refusal(`${runId} is not a run id`, 'use the runId printed by dispatch');
  return await context.store.read(runId)
    ?? refusal(`no run ${runId} is recorded here`, 'run the command from the repository that dispatched it');
}

export async function waitAgents(context: AgentsContext, runIds: readonly string[],
  options: { readonly any: boolean; readonly timeoutMs: number }): Promise<WaitOutcome> {
  return waitForTransitions(runIds, options, { registry: context.store, runtime: context.runtime,
    clock: context.clock, owner: context.owner });
}

async function summary(context: AgentsContext, run: RunRecord, surface: SurfaceSummary | undefined)
  : Promise<RunSummary> {
  const result = currentResult(run, await context.store.result(run.runId));
  const attach = context.runtime.attachCommand(refOf(run));
  return { runId: run.runId, missionId: run.missionId, role: run.role,
    ...(run.ticket === undefined ? {} : { ticket: run.ticket }),
    ...(run.agentType === undefined ? {} : { agentType: run.agentType }),
    status: statusOf(run, result),
    ...(result === undefined ? {} : { result: { text: result.text, truncated: result.truncated } }),
    ...(attach === undefined ? {} : { attach: attach.join(' ') }),
    ...(surface === undefined ? {} : { surface }) };
}

export async function agentStatus(context: AgentsContext, runId?: string)
  : Promise<{ readonly ok: true; readonly runs: readonly RunSummary[] } | Refusal> {
  const ids = runId === undefined ? await context.store.runIds() : [runId];
  const records: RunRecord[] = [];
  for (const id of ids) {
    const run = await readRun(context, id);
    if ('ok' in run) {
      if (runId !== undefined) return run;
      continue;
    }
    records.push(run);
  }
  const surfaces = await surfaceSummaries(surfaceContext(context), records.map((run) => run.runId));
  const runs: RunSummary[] = [];
  for (const run of records) runs.push(await summary(context, run, surfaces.get(run.runId)));
  return { ok: true, runs };
}

export type CommandReceipt = { readonly ok: true; readonly runId: string; readonly status: RunStatus;
  readonly surface?: SurfaceClosing } | Refusal;

export async function sendAgent(context: AgentsContext, runId: string, message: string): Promise<CommandReceipt> {
  if (message.length === 0 || Buffer.byteLength(message, 'utf8') > MAX_BRIEF_BYTES) {
    return refusal('the message must hold 1 byte to 1 MiB', 'correct the message file and send again');
  }
  const known = await readRun(context, runId);
  if ('ok' in known) return known;
  return withMissionLock(context, known.missionId, async (): Promise<CommandReceipt> => {
    const run = await readRun(context, runId);
    if ('ok' in run) return run;
    const decision = sendRun(runView(run.transitions), context.clock.now());
    if (!decision.ok) return refusal(decision.cause, decision.action);
    const file = await context.store.writeMessage(runId, message);
    const launch = await context.runtime.send(refOf(run), plan(run, file));
    if (launch.kind === 'refused') return refusal(launch.cause, launch.action);
    // A session continued as a copy answers under a new handle: follow it, and let the next
    // observation bind its session and claim its result.
    if (launch.kind === 'acknowledged' && launch.handle !== run.binding?.handle) {
      await context.store.bind(runId, { handle: launch.handle });
      // The original would idle beside its copy until the supervisor reclaims it.
      if (run.binding !== undefined) await context.runtime.stop(refOf(run));
    }
    const failed = await record(context, runId, decision);
    if (failed !== undefined) return failed;
    const latest = await readRun(context, runId);
    return 'ok' in latest ? latest : { ok: true, runId, status: statusOf(latest, undefined) };
  });
}

export type AcceptReceipt = { readonly ok: true; readonly runId: string; readonly state: 'retired';
  readonly result: { readonly text: string; readonly truncated: boolean }; readonly surface?: SurfaceClosing }
  | Refusal;

/** Closes what a closed run still shows, once its transition is recorded and the lock released. */
async function withSurfaceClosed<T extends { readonly ok: boolean }>(context: AgentsContext, runId: string,
  receipt: T): Promise<T | (T & { readonly surface: SurfaceClosing })> {
  if (!receipt.ok) return receipt;
  const closing = await closeRunSurface(surfaceContext(context), runId);
  return closing === undefined ? receipt : { ...receipt, surface: closing };
}

export async function acceptAgent(context: AgentsContext, runId: string): Promise<AcceptReceipt> {
  const known = await readRun(context, runId);
  if ('ok' in known) return known;
  return withSurfaceClosed(context, runId, await withMissionLock(context, known.missionId, async (): Promise<AcceptReceipt> => {
    const run = await readRun(context, runId);
    if ('ok' in run) return run;
    const result = currentResult(run, await context.store.result(runId));
    const now = context.clock.now();
    const accepted = acceptRun(runView(run.transitions),
      result === undefined ? undefined : { recordedAt: result.recordedAt, pendingWork: result.pendingWork }, now);
    const failed = await record(context, runId, accepted);
    if (failed !== undefined || !accepted.ok || result === undefined) {
      return failed ?? refusal('no result is collected', 'send a message asking for the final result');
    }
    const after = await readRun(context, runId);
    if ('ok' in after) return after;
    const retiredFailure = await record(context, runId, retireRun(runView(after.transitions), now));
    if (retiredFailure !== undefined) return retiredFailure;
    // A review session has nothing left to do once its verdict is taken.
    if (run.role === 'review') await context.runtime.stop(refOf(run));
    return { ok: true, runId, state: 'retired', result: { text: result.text, truncated: result.truncated } };
  }));
}

export async function stopAgent(context: AgentsContext, runId: string): Promise<CommandReceipt> {
  const known = await readRun(context, runId);
  if ('ok' in known) return known;
  return withSurfaceClosed(context, runId, await withMissionLock(context, known.missionId, async (): Promise<CommandReceipt> => {
    const run = await readRun(context, runId);
    if ('ok' in run) return run;
    const decision = stopRun(runView(run.transitions), context.clock.now());
    if (!decision.ok) return refusal(decision.cause, decision.action);
    let ref = refOf(run);
    if (ref.handle === undefined) {
      const reading = await context.runtime.observe([ref]);
      const found = reading.kind === 'read' ? reading.sessions.get(run.name)?.binding : undefined;
      if (found !== undefined) ref = { ...ref, ...found };
    }
    if (ref.handle !== undefined) {
      const stopped = await context.runtime.stop(ref);
      if (!stopped.ok) return refusal(stopped.cause, stopped.action);
    }
    const failed = await record(context, runId, decision);
    if (failed !== undefined) return failed;
    const latest = await readRun(context, runId);
    return 'ok' in latest ? latest : { ok: true, runId, status: statusOf(latest, undefined) };
  }));
}

export async function attachAgent(context: AgentsContext, runId: string)
  : Promise<{ readonly ok: true; readonly command: readonly string[] } | Refusal> {
  const run = await readRun(context, runId);
  if ('ok' in run) return run;
  const command = context.runtime.attachCommand(refOf(run));
  return command === undefined
    ? refusal('the run has no native session to attach yet', 'wait with void-machine agents wait <runId>')
    : { ok: true, command };
}

/** Composes the file registry and the Claude runtime for a process running in `cwd`. */
export function agentsContext(options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv;
  readonly home: string; readonly updateCommand: string }): AgentsContext | Refusal {
  const root = resolveMachineRoot(options.cwd);
  if (!root.ok) return refusal(root.cause, root.action);
  return {
    store: createRunRegistry({ machineRoot: root.root }),
    runtime: createClaudeSessionRuntime({ executable: 'claude', env: options.env, home: options.home,
      updateCommand: options.updateCommand }),
    surfaces: surfacesFor(options.env),
    clock: { now: Date.now, sleep: (ms) => new Promise((done) => { setTimeout(done, ms); }) },
    owner: `agents-${String(process.pid)}-${randomUUID()}`,
    newRunId: () => `run_${randomUUID()}`,
    newMissionId: () => `mis_${randomUUID()}`,
  };
}
