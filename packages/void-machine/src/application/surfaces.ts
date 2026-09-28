// tdd-cover: e2e packages/void-machine/test/agents-presentation.test.ts
import { createCmuxSurface } from '../adapters/presentation/cmux.js';
import { socketReady } from '../adapters/presentation/command.js';
import { createHerdrSurface } from '../adapters/presentation/herdr.js';
import { createNoSurface } from '../adapters/presentation/none.js';
import { createTmuxSurface } from '../adapters/presentation/tmux.js';
import { type RunRole, isOpen, runView } from '../core/delegation.js';
import {
  PRESENTATION_LIMITS, type SurfaceCause, type SurfaceKind, detectSurface, surfaceCause,
} from '../core/presentation.js';
import type { DelegationStore } from '../runtime/delegation.js';
import {
  type SurfaceClosing, type SurfacePort, type SurfaceRecord, type SurfaceRef, heldSurface,
} from '../runtime/presentation.js';

/**
 * The life of a run's surface beside the run itself: planned under the mission lock, opened and
 * closed outside it, and never able to change a run, a worktree or a piece of evidence.
 */

export interface Surfaces {
  /** Where this process shows a new run: the multiplexer it runs in, `none` outside any. */
  readonly detected: SurfacePort;
  /** The adapter that reaches a recorded surface, on the server the record names. */
  readonly reach: (kind: SurfaceKind) => SurfacePort;
}

export interface SurfaceContext {
  readonly store: DelegationStore;
  readonly surfaces: Surfaces;
  readonly clock: { now(): number };
  /** Runs an action under the run's mission lock; a busy mission is a refusal. */
  readonly locked: <T>(missionId: string, action: () => Promise<T>) => Promise<T | { readonly ok: false }>;
}

/** The record a dispatch starts from, decided under the lock: nothing to show, or an open to come. */
export function plannedSurface(surfaces: Surfaces, command: readonly string[] | undefined, now: number)
  : SurfaceRecord {
  if (surfaces.detected.kind === 'none') return { state: 'none', cause: surfaceCause('not-detected', 'detection') };
  if (command === undefined) return { state: 'none', cause: surfaceCause('no-display-command', 'runtime') };
  return { state: 'opening', at: now };
}

export interface ShownRun {
  readonly runId: string;
  readonly missionId: string;
  readonly role: RunRole;
  readonly ticket: string | undefined;
  readonly cwd: string;
}

/**
 * Opens the planned surface and records it. A run that closed while the surface was opening gets
 * it closed at once: its closer found `opening` and left the surface to this call.
 */
export async function showRun(context: SurfaceContext, run: ShownRun, command: readonly string[])
  : Promise<SurfaceRecord> {
  const opened = await context.surfaces.detected.open({ runId: run.runId, role: run.role, ticket: run.ticket,
    cwd: run.cwd, command });
  const record: SurfaceRecord = opened.ok ? { state: 'open', ref: opened.ref }
    : { state: 'failed', cause: opened.cause, ...(opened.orphan === undefined ? {} : { orphan: opened.orphan }) };
  const written = await context.locked(run.missionId, async () => {
    await context.store.writeSurface(run.runId, record);
    const current = await context.store.read(run.runId);
    return { ok: true as const, closed: current === undefined || !isOpen(runView(current.transitions).state) };
  });
  if (!written.ok) {
    // Unrecorded, the surface would have no owner left to close it: close it now, and keep it as an
    // orphan when that fails. The record is replaced whole, so no lock is needed to leave `opening`.
    const ref = heldSurface(record);
    const cleanup = ref === undefined ? undefined : await context.surfaces.reach(ref.kind).close(ref);
    const settled = cleanup?.outcome === 'closed' || cleanup?.outcome === 'already-absent';
    const failed: SurfaceRecord = { state: 'failed', cause: surfaceCause('deadline', 'record', 'the mission stayed busy'),
      ...(ref === undefined || settled ? {} : { orphan: ref }) };
    await context.store.writeSurface(run.runId, failed);
    return failed;
  }
  if (!written.closed) return record;
  await closeRunSurface(context, run.runId);
  const after = await context.store.readSurface(run.runId);
  return after.kind === 'recorded' ? after.record : record;
}

function afterClose(record: SurfaceRecord, ref: SurfaceRef, closing: SurfaceClosing): SurfaceRecord {
  if (closing.outcome === 'closed' || closing.outcome === 'already-absent') {
    return { state: 'closed', ref, outcome: closing.outcome };
  }
  return record.state === 'open' ? { state: 'open', ref, lastClose: closing } : record;
}

/**
 * Closes the surface a closed run still holds, if any. Called once the run's terminal transition
 * is recorded, outside the lock; its outcome is reported, and never undoes that transition.
 */
export async function closeRunSurface(context: SurfaceContext, runId: string)
  : Promise<SurfaceClosing | undefined> {
  const reading = await context.store.readSurface(runId);
  if (reading.kind !== 'recorded') return undefined;
  const ref = heldSurface(reading.record);
  if (ref === undefined || ref.runId !== runId) return undefined;
  const closing = await context.surfaces.reach(ref.kind).close(ref);
  await context.store.writeSurface(runId, afterClose(reading.record, ref, closing));
  return closing;
}

export type SurfaceSummary =
  | SurfaceRecord
  | { readonly state: 'closed-outside' | 'foreign'; readonly ref: SurfaceRef; readonly note: string }
  | { readonly state: 'unknown'; readonly cause: SurfaceCause; readonly ref?: SurfaceRef };

async function summarize(context: SurfaceContext, runId: string, inspect: boolean)
  : Promise<SurfaceSummary | undefined> {
  const reading = await context.store.readSurface(runId);
  if (reading.kind === 'absent') return undefined;
  if (reading.kind !== 'recorded') return { state: 'unknown', cause: surfaceCause('record-corrupt', 'surface.json') };
  const { record } = reading;
  if (record.state !== 'open') return record;
  if (!inspect) return { state: 'unknown', ref: record.ref, cause: surfaceCause('deadline', 'status', 'not inspected') };
  const presence = await context.surfaces.reach(record.ref.kind).inspect(record.ref);
  if (presence.state === 'open') return record;
  if (presence.state === 'unknown') return { state: 'unknown', ref: record.ref, cause: presence.cause };
  return presence.state === 'closed'
    ? { state: 'closed-outside', ref: record.ref, note: 'the pane was closed outside void-machine; the run continues' }
    : { state: 'foreign', ref: record.ref, note: 'the recorded pane now shows something else; it is left alone' };
}

/** Each run's surface, the open ones inspected live and concurrently, within a bounded count. */
export async function surfaceSummaries(context: SurfaceContext, runIds: readonly string[])
  : Promise<ReadonlyMap<string, SurfaceSummary>> {
  const summaries = await Promise.all(runIds.map((runId, index) =>
    summarize(context, runId, index < PRESENTATION_LIMITS.inspectionsPerStatus)
      .then((summary) => [runId, summary] as const)));
  return new Map(summaries.filter((entry): entry is readonly [string, SurfaceSummary] => entry[1] !== undefined));
}

/** The surfaces a process running in `env` can reach, the detected one first. */
export function surfacesFor(env: NodeJS.ProcessEnv): Surfaces {
  const herdrBinary = env['HERDR_BIN_PATH']?.startsWith('/') === true ? env['HERDR_BIN_PATH'] : 'herdr';
  const adapters: Readonly<Record<SurfaceKind, SurfacePort>> = {
    herdr: createHerdrSurface({ executable: herdrBinary, env }),
    cmux: createCmuxSurface({ executable: 'cmux', env }),
    tmux: createTmuxSurface({ executable: 'tmux', env }),
  };
  const kind = detectSurface(env, { socketReady });
  return { detected: kind === 'none' ? createNoSurface() : adapters[kind], reach: (known) => adapters[known] };
}
