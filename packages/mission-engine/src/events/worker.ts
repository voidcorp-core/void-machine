// tdd-cover: e2e packages/cli/src/commands/agents-workers.test.ts
import type { CanonicalEvent } from './types.js';

export type WorkerState = 'running' | 'blocked' | 'done' | 'failed';
export type WorkerOutcome = 'succeeded' | 'failed' | 'stopped';
export interface WorkerDispatch {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly missionId: string;
  readonly ticket: string;
  readonly role: 'work' | 'review';
  readonly runtime: 'claude' | 'codex';
  readonly worktree: string;
  readonly branch: string;
  readonly headSha?: string;
  readonly attachCommand: readonly string[] | 'unknown';
}
export type WorkerEvent =
  | { readonly kind: 'worker.dispatched'; readonly payload: WorkerDispatch }
  | { readonly kind: 'worker.state'; readonly payload: {
    readonly schemaVersion: 1; readonly runId: string; readonly state: WorkerState;
    readonly observedAt: string; readonly reason?: string;
  } }
  | { readonly kind: 'worker.finished'; readonly payload: {
    readonly schemaVersion: 1; readonly runId: string; readonly outcome: WorkerOutcome;
  } };
export interface WorkerSnapshot extends WorkerDispatch {
  readonly state: WorkerState | 'unknown';
  readonly observedAt: string;
}
export type WorkerParse = { readonly ok: true; readonly event: WorkerEvent }
  | { readonly ok: false; readonly issue: string };
const invalid = (issue: string): WorkerParse => ({ ok: false, issue });
const label = (value: unknown, max = 256): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max
  && [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
type WorkerFields = Partial<Record<keyof WorkerDispatch | 'state' | 'observedAt' | 'reason' | 'outcome', unknown>>;
const object = (value: unknown): value is WorkerFields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const absolute = (value: unknown): value is string => label(value, 4096)
  && (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\/.test(value));
const date = (value: unknown): value is string => label(value, 30)
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === (value.length === 20 ? value.replace('Z', '.000Z') : value);

function dispatch(raw: WorkerFields, runId: string): WorkerParse {
  if (!label(raw.missionId) || !/^mis_[A-Za-z0-9_-]{8,100}$/.test(raw.missionId)
    || !label(raw.ticket, 128) || !absolute(raw.worktree) || !label(raw.branch)
    || (raw.role !== 'work' && raw.role !== 'review')
    || (raw.runtime !== 'claude' && raw.runtime !== 'codex')) return invalid('invalid dispatch metadata');
  const attach = raw.attachCommand;
  if (attach !== 'unknown' && (!Array.isArray(attach) || attach.length < 1
    || attach.length > 32 || !attach.every(arg => label(arg, 4096)))) {
    return invalid('attachCommand must be a bounded argv array or unknown');
  }
  if ((raw.headSha !== undefined && (!label(raw.headSha) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(raw.headSha)))
    || (raw.branch === 'detached' && raw.headSha === undefined)) return invalid('detached branch requires headSha');
  return { ok: true, event: { kind: 'worker.dispatched', payload: {
    schemaVersion: 1, runId, missionId: raw.missionId, ticket: raw.ticket,
    role: raw.role, runtime: raw.runtime, worktree: raw.worktree, branch: raw.branch,
    ...(typeof raw.headSha === 'string' ? { headSha: raw.headSha } : {}),
    attachCommand: attach === 'unknown' ? attach : [...attach],
  } } };
}

/** Additive fields are ignored; changing meaning requires another payload schemaVersion. */
export function parseWorkerEvent(kind: unknown, payload: unknown): WorkerParse {
  if (!object(payload) || payload.schemaVersion !== 1) return invalid('unsupported worker schemaVersion');
  if (!label(payload.runId, 128) || !/^run_[A-Za-z0-9_-]{8,124}$/.test(payload.runId)) {
    return invalid('runId must be run_<opaque-id>');
  }
  const runId = payload.runId;
  if (kind === 'worker.dispatched') return dispatch(payload, runId);
  if (kind === 'worker.state') {
    const state = payload.state;
    if ((state !== 'running' && state !== 'blocked' && state !== 'done' && state !== 'failed')
      || !date(payload.observedAt) || (payload.reason !== undefined && !label(payload.reason, 400))) {
      return invalid('invalid worker state observation');
    }
    return { ok: true, event: { kind, payload: { schemaVersion: 1, runId,
      state, observedAt: payload.observedAt,
      ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}),
    } } };
  }
  if (kind === 'worker.finished') {
    const outcome = payload.outcome;
    if (outcome !== 'succeeded' && outcome !== 'failed' && outcome !== 'stopped') return invalid('invalid worker outcome');
    return { ok: true, event: { kind, payload: { schemaVersion: 1, runId, outcome } } };
  }
  return invalid('unsupported worker event kind');
}

interface RecordedWorker { readonly view: WorkerSnapshot; readonly outcome?: WorkerOutcome }
function applyWorker(current: RecordedWorker | undefined, event: WorkerEvent, ts: string)
  : RecordedWorker | string {
  if (event.kind === 'worker.dispatched') {
    if (current !== undefined) return 'worker already dispatched';
    return { view: { ...event.payload, state: 'unknown', observedAt: ts } };
  }
  if (current === undefined) return 'worker must be dispatched first';
  if (current.outcome !== undefined) return 'worker is already finished';
  if (event.kind === 'worker.state') {
    if (current.view.state === 'done' || current.view.state === 'failed') return 'worker state is terminal';
    if (current.view.state !== 'unknown' && Date.parse(event.payload.observedAt) < Date.parse(current.view.observedAt)) {
      return 'worker observation is older than the previous state';
    }
    return { view: { ...current.view, state: event.payload.state, observedAt: event.payload.observedAt } };
  }
  const expected = event.payload.outcome === 'succeeded' ? 'done' : 'failed';
  if (current.view.state !== expected) return 'worker outcome contradicts its terminal state';
  return { ...current, outcome: event.payload.outcome };
}

/** Pure projection; corrupt observations are reported without discarding readable workers. */
export function projectWorkers(events: readonly CanonicalEvent[], missionId: string)
  : { readonly workers: readonly WorkerSnapshot[]; readonly issues: readonly string[] } {
  const records = new Map<string, RecordedWorker>();
  const issues: string[] = [];
  for (const event of events) {
    if (event.missionId !== missionId) { issues.push('event belongs to another mission'); continue; }
    if (!event.kind.startsWith('worker.')) continue;
    const parsed = parseWorkerEvent(event.kind, event.payload);
    if (!parsed.ok) { issues.push(`${event.eventId}: ${parsed.issue}`); continue; }
    const worker = parsed.event;
    if (event.subject !== worker.payload.runId || event.correlationId !== missionId
      || (worker.kind === 'worker.dispatched' && worker.payload.missionId !== missionId)) {
      issues.push(`${event.eventId}: worker identity mismatch`); continue;
    }
    const next = applyWorker(records.get(worker.payload.runId), worker, event.ts);
    if (typeof next === 'string') issues.push(`${event.eventId}: ${next}`);
    else records.set(worker.payload.runId, next);
  }
  return { workers: [...records.values()].filter(record => record.outcome === undefined)
    .map(record => record.view), issues };
}
