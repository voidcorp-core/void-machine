import { canonicalJsonHash, validNativeContextId, type CanonicalEvent, type JsonValue } from '@voidcorp/mission-engine';

export interface SpecialistActivity {
  readonly kind: 'specialist' | 'advisory';
  readonly specialist: string;
  readonly sourceMissionId: string;
  readonly attribution: 'mission' | 'shared-session';
  readonly runtime: 'claude' | 'codex' | 'unknown';
  readonly nativeContextId: string;
  readonly task: string;
  readonly observedState: 'running' | 'completed' | 'failed' | 'unknown';
  readonly provenance: 'runtime-receipt' | 'coordinator-observed';
  readonly lastEventId: string;
  readonly lastObservedAt: string;
  readonly outcome?: 'completed' | 'failed';
  readonly reason?: string;
}
interface Observation { row: SpecialistActivity; readonly started: boolean; readonly dispatch?: string }
const MAX_ACTIVITY_ROWS = 200;
const MAX_TEXT_ROWS = 20;

function field(event: CanonicalEvent, name: string): JsonValue | undefined {
  const value = event.payload;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value).find(([key]) => key === name)?.[1] : undefined;
}
function dispatchIdentity(event: CanonicalEvent): string | undefined {
  const stage = field(event, 'stage');
  const round = field(event, 'reviewRound');
  const version = field(event, 'contractVersion');
  const hash = field(event, 'inputHash');
  if (!['pre-implementation', 'post-implementation'].includes(String(stage))
    || typeof round !== 'number' || !Number.isSafeInteger(round) || round < 1
    || typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1
    || typeof hash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(hash)) return undefined;
  return canonicalJsonHash([event.missionId, event.source, event.subject, event.causationId ?? '',
    stage ?? '', round, version, hash, field(event, 'reviewSubject') ?? '', field(event, 'reviewScope') ?? '']);
}
function task(event: CanonicalEvent, advisory: boolean): string {
  if (advisory) return 'advisory';
  const stage = field(event, 'stage');
  const round = field(event, 'reviewRound');
  return ['pre-implementation', 'post-implementation'].includes(String(stage))
    && typeof round === 'number' && Number.isSafeInteger(round) && round > 0
    ? `${stage} / round ${round}` : 'specialist work (task unknown)';
}

/** Read-only last observations, never a second execution state machine or a liveness check. */
export function projectSpecialistActivity(input: {
  readonly missionId: string;
  readonly events: readonly CanonicalEvent[];
  readonly endedScopes?: readonly string[];
  readonly incomplete?: boolean;
}): { readonly activity: readonly SpecialistActivity[]; readonly activityOmitted: number } {
  const observations: Observation[] = [];
  const starts = new Map<string, Observation>();
  const invocationEvents = new Map<string, Observation>();
  const ended = new Set(input.endedScopes ?? []);
  for (const event of input.events) {
    if (event.kind === 'mission.closed') ended.add(event.missionId);
    const advisory = event.kind === 'usage.advisory.started' && event.source === 'coordinator-observed';
    if (!advisory && !['specialist.started', 'specialist.completed', 'specialist.failed'].includes(event.kind)) continue;
    const specialist = /^core:([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(event.subject)?.[1];
    if (specialist === undefined) continue;
    const rawRuntime = advisory ? field(event, 'runtime') : /^runtime:(claude|codex)$/.exec(event.source)?.[1];
    const runtime = rawRuntime === 'claude' || rawRuntime === 'codex' ? rawRuntime : 'unknown';
    if (advisory && runtime === 'unknown') continue;
    const context = field(event, 'contextId');
    const nativeContextId = validNativeContextId(context) ? context : 'unknown';
    const dispatch = advisory ? undefined : dispatchIdentity(event);
    const key = dispatch !== undefined && nativeContextId !== 'unknown'
      ? canonicalJsonHash([dispatch, nativeContextId]) : undefined;
    const reference = field(event, 'reviewInvocationEventId');
    const referenced = typeof reference === 'string' ? invocationEvents.get(`${event.missionId}:${reference}`) : undefined;
    const previous = reference !== undefined
      ? referenced !== undefined && referenced.dispatch === dispatch
        && (nativeContextId === 'unknown' || referenced.row.nativeContextId === nativeContextId) ? referenced : undefined
      : key === undefined ? undefined : starts.get(key);
    const terminal = event.kind === 'specialist.completed' ? 'completed'
      : event.kind === 'specialist.failed' ? 'failed' : undefined;
    if (terminal !== undefined && previous?.started && dispatch !== undefined && runtime !== 'unknown') {
      previous.row = { ...previous.row, observedState: terminal, outcome: terminal,
        lastEventId: event.eventId, lastObservedAt: event.ts };
      continue;
    }
    const started = !advisory && event.kind === 'specialist.started';
    const reason = advisory ? 'start observed; no advisory completion telemetry'
      : terminal !== undefined ? 'terminal without matching start'
      : dispatch === undefined || runtime === 'unknown' ? 'dispatch metadata unavailable' : undefined;
    const observation: Observation = { started, ...(dispatch === undefined ? {} : { dispatch }), row: {
      kind: advisory ? 'advisory' : 'specialist', specialist, sourceMissionId: event.missionId,
      attribution: event.missionId === input.missionId ? 'mission' : 'shared-session', runtime,
      nativeContextId, task: task(event, advisory), observedState: reason === undefined ? 'running' : 'unknown',
      provenance: advisory ? 'coordinator-observed' : 'runtime-receipt',
      lastEventId: event.eventId, lastObservedAt: event.ts,
      ...(terminal === undefined ? {} : { outcome: terminal }), ...(reason === undefined ? {} : { reason }),
    } };
    observations.push(observation);
    if (started) {
      invocationEvents.set(`${event.missionId}:${event.eventId}`, observation);
      if (key !== undefined) starts.set(key, observation);
    }
  }
  const activity = observations.slice(0, MAX_ACTIVITY_ROWS).map(({ row }) => {
    if (row.observedState !== 'running') return row;
    const reason = input.incomplete ? 'journal incomplete'
      : ended.has(input.missionId) || ended.has(row.sourceMissionId) ? 'observation ended without a terminal receipt' : undefined;
    return reason === undefined ? row : { ...row, observedState: 'unknown' as const, reason };
  });
  return { activity, activityOmitted: Math.max(0, observations.length - activity.length) };
}

const cell = (value: string): string => value.replace(/[\\|[\]`<>]/g, '\\$&');
export function renderSpecialistActivity(report: {
  readonly activity: readonly SpecialistActivity[]; readonly activityOmitted: number;
}): readonly string[] {
  if (report.activity.length === 0) return ['Specialist activity unknown: no linked execution observations.'];
  const visible = report.activity.slice(0, MAX_TEXT_ROWS);
  const omitted = report.activityOmitted + report.activity.length - visible.length;
  return [
    'Specialist activity (last recorded observation, not live presence)',
    '| Kind / provenance | Specialist | Task | Observed state | Native identity | Source scope |',
    '| --- | --- | --- | --- | --- | --- |',
    ...visible.map(row => `| ${row.kind} / ${row.provenance} | ${row.specialist} | ${cell(row.task)} | `
      + `${row.observedState}${row.reason === undefined ? '' : ` (${row.reason})`} | `
      + `${row.runtime}:${cell(row.nativeContextId)} | ${row.attribution}:${cell(row.sourceMissionId)} |`),
    ...(omitted > 0 ? [`${omitted} activity observation(s) omitted; JSON includes up to ${MAX_ACTIVITY_ROWS} rows.`] : []),
  ];
}
