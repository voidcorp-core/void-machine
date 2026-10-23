import { activationName } from '@voidcorp/harness-graph';
import type { CanonicalEvent, JsonValue } from '@voidcorp/mission-engine';
import type { CatalogEntry } from '../cheatsheet/catalog.js';

type UsageKind = 'skill' | 'hook' | 'specialist';
export interface UsageRow {
  readonly type: UsageKind;
  readonly name: string;
  readonly catalogued: boolean;
  readonly observedHits: number | 'unknown';
  readonly outcomes: Readonly<Record<string, number>>;
  readonly runtimeHits: Readonly<Record<string, number | 'unknown'>>;
}
export interface MissionUsage {
  readonly missionId: string;
  readonly rows: readonly UsageRow[];
  readonly notes: readonly string[];
}

function field(payload: JsonValue, key: string): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const value = Object.entries(payload).find(([name]) => name === key)?.[1];
  return typeof value === 'string' ? value : undefined;
}

function observation(event: CanonicalEvent): {
  type: UsageKind; hit: boolean; outcome?: string;
} | undefined {
  if (event.subject.startsWith('skill:') && event.source === 'runtime:claude') {
    if (event.kind === 'runtime.tool.started' && field(event.payload, 'category') === 'skill') {
      return { type: 'skill', hit: true };
    }
    if (event.kind === 'runtime.tool.completed') {
      return { type: 'skill', hit: false, outcome: field(event.payload, 'status') ?? 'unknown' };
    }
  }
  if (event.subject.startsWith('hook:') && event.kind === 'hook.completed') {
    return { type: 'hook', hit: true, outcome: field(event.payload, 'status') ?? 'unknown' };
  }
  if (event.subject.startsWith('core:') && event.kind === 'specialist.started') {
    return { type: 'specialist', hit: true };
  }
  if (event.subject.startsWith('core:') && ['specialist.completed', 'specialist.failed'].includes(event.kind)) {
    return { type: 'specialist', hit: false, outcome: event.kind.slice('specialist.'.length) };
  }
  return undefined;
}

/** Observed lower bounds only. No time-window inference, script parsing or lifecycle triple counts. */
export function projectMissionUsage(input: {
  readonly missionId: string;
  readonly events: readonly CanonicalEvent[];
  readonly catalog: readonly CatalogEntry[];
  readonly hookSubjects: Readonly<Record<string, string>>;
}): MissionUsage {
  const rows = new Map<string, { type: UsageKind; name: string; catalogued: boolean;
    observedHits: number; outcomes: Record<string, number>; runtimeHits: Record<string, number> }>();
  for (const entry of input.catalog) {
    if (entry.type !== 'skill' && entry.type !== 'hook' && entry.type !== 'specialist') continue;
    rows.set(`${entry.type}:${entry.name}`, { type: entry.type, name: entry.name,
      catalogued: true, observedHits: 0, outcomes: {}, runtimeHits: {} });
  }
  const channels = new Set<UsageKind>();
  const seen = new Set<string>();
  const runtimeChannels = new Set<string>();
  for (const event of input.events) {
    if (event.missionId !== input.missionId || seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    const observed = observation(event);
    if (observed === undefined) continue;
    const rawName = event.subject.slice(event.subject.indexOf(':') + 1);
    const name = observed.type === 'skill'
      ? activationName('skill', rawName.startsWith('core/') ? rawName.slice(5) : rawName)
      : input.hookSubjects[event.subject] ?? rawName;
    if (!/^[a-zA-Z0-9]+(?:[-:/][a-zA-Z0-9]+)*$/.test(name)) continue;
    const runtime = /^runtime:(claude|codex|unknown)$/.test(event.source)
      ? event.source.slice('runtime:'.length) : 'unattributed';
    runtimeChannels.add(`${observed.type}:${runtime}`);
    channels.add(observed.type);
    const key = `${observed.type}:${name}`;
    const row = rows.get(key) ?? { type: observed.type, name, catalogued: false,
      observedHits: 0, outcomes: {}, runtimeHits: {} };
    if (observed.hit) {
      row.observedHits += 1;
      row.runtimeHits[runtime] = (row.runtimeHits[runtime] ?? 0) + 1;
    }
    if (observed.outcome !== undefined) {
      const outcome = ['ok', 'error', 'skipped', 'degraded', 'blocked', 'completed', 'failed'].includes(observed.outcome)
        ? observed.outcome : 'unknown';
      row.outcomes[outcome] = (row.outcomes[outcome] ?? 0) + 1;
    }
    rows.set(key, row);
  }
  return { missionId: input.missionId,
    rows: [...rows.values()].map(row => ({ ...row,
      observedHits: channels.has(row.type) ? row.observedHits : 'unknown' as const,
      runtimeHits: Object.fromEntries([...new Set(['claude', 'codex', ...Object.keys(row.runtimeHits)])]
        .map(runtime => [runtime, runtimeChannels.has(`${row.type}:${runtime}`)
          ? row.runtimeHits[runtime] ?? 0 : 'unknown' as const])),
    })).sort((a, b) => `${a.type}:${a.name}`.localeCompare(`${b.type}:${b.name}`, 'en')),
    notes: [
      ...(!channels.has('hook') && !channels.has('skill') ? ['hook/skill telemetry not linked to this mission.'] : []),
      ...(['skill', 'hook', 'specialist'] as const).filter(kind => !channels.has(kind))
        .map(kind => `${kind}: unknown; no linked execution telemetry.`),
      'Hits are observed lower bounds. Zero means no recorded hit, not proof of non-use; gaps remain possible.',
      'Codex SKILL.md reads are loads, not observable native skill invocations; no skill hits are inferred from them.',
      'Counts do not prove applicability, instruction compliance, TDD or code quality. Missing telemetry is not a delivery gate.',
    ],
  };
}

export function renderMissionUsage(report: MissionUsage): string {
  const observed = report.rows.filter(row => (typeof row.observedHits === 'number' && row.observedHits > 0)
    || Object.keys(row.outcomes).length > 0);
  return [
    'Usage recap (explicit mission linkage only)',
    ...report.notes.map(note => `- ${note}`),
    ...(['skill', 'hook', 'specialist'] as const).map(kind => {
      const rows = report.rows.filter(row => row.type === kind);
      return `${kind}: ${rows.filter(row => row.observedHits === 0).length} zero observed, `
        + `${rows.filter(row => row.observedHits === 'unknown').length} unknown catalogue entries.`;
    }),
    ...(observed.length === 0 ? ['No linked execution observations. Full inventory: void-machine cheatsheet --format markdown.'] : [
      '| Kind | Name | Observed hits | Outcomes | Telemetry |',
      '| --- | --- | --- | --- | --- |',
      ...observed.map(row => `| ${row.type} | ${row.name} | ${row.observedHits} | `
        + `${Object.entries(row.outcomes).map(([status, count]) => `${status}=${count}`).join(', ') || '-'} | `
        + `${Object.entries(row.runtimeHits).map(([runtime, hits]) => `${runtime}=${hits}`).join(', ')}`
        + `${row.catalogued ? '' : '; outside current catalogue'} |`),
    ]),
  ].join('\n');
}
