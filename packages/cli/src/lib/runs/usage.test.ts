import { describe, expect, it } from 'vitest';
import type { CanonicalEvent } from '@voidcorp/mission-engine';
import type { CatalogEntry } from '../cheatsheet/catalog.js';
import { projectMissionUsage, renderMissionUsage } from './usage.js';

const missionId = 'mis_0123456789abcdef';
const entry = (type: 'skill' | 'hook' | 'specialist', name: string): CatalogEntry => ({
  id: type === 'specialist' ? `core:${name}` : `${type}:${name}`, type, name,
  description: 'Example', pack: 'core', runtimes: ['claude', 'codex'],
  invocations: [], triggers: [], relatedIds: [],
});
const catalog = [entry('skill', 'void-tdd'), entry('skill', 'void-debug'),
  entry('hook', 'tdd-guard'), entry('specialist', 'test-qa-engineer')];
function event(seq: number, kind: string, subject: string, extra: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return { schemaVersion: 1, eventId: `evt_0000000${seq}`, seq, missionId,
    ts: '2026-10-23T10:00:00.000Z', source: 'runtime:claude', kind, subject,
    correlationId: missionId, payload: {}, ...extra };
}
const project = (events: readonly CanonicalEvent[]) => projectMissionUsage({
  missionId, events, catalog, hookSubjects: { 'hook:tdd-order': 'tdd-guard' },
});

describe('mission usage observations', () => {
  it('counts starts and hook completions once by event ID, with outcomes separate from hits', () => {
    const start = event(1, 'runtime.tool.started', 'skill:void-tdd', { payload: { category: 'skill' } });
    const report = project([start, start,
      event(2, 'runtime.tool.completed', 'skill:void-tdd', { payload: { status: 'ok' } }),
      event(3, 'specialist.requested', 'core:test-qa-engineer'),
      event(4, 'specialist.started', 'core:test-qa-engineer'),
      event(5, 'specialist.completed', 'core:test-qa-engineer'),
      event(6, 'hook.completed', 'hook:tdd-order', { payload: { status: 'skipped' } }),
      event(7, 'hook.completed', 'hook:tdd-order', { payload: { status: 'blocked' } }),
      event(8, 'hook.completed', 'hook:tdd-order', { payload: { status: 'ok' } }),
    ]);
    expect(report.rows.find(row => row.name === 'void-tdd')).toMatchObject({ observedHits: 1, outcomes: { ok: 1 } });
    expect(report.rows.find(row => row.name === 'test-qa-engineer')).toMatchObject({ observedHits: 1, outcomes: { completed: 1 } });
    expect(report.rows.find(row => row.name === 'tdd-guard')).toMatchObject({ observedHits: 3, outcomes: { skipped: 1, blocked: 1, ok: 1 } });
    expect(report.rows.find(row => row.name === 'void-debug')).toMatchObject({ observedHits: 0 });
  });

  it('does not turn requests, foreign missions, Codex file loads or missing telemetry into hits', () => {
    const report = project([
      event(1, 'specialist.requested', 'core:test-qa-engineer'),
      event(2, 'runtime.tool.started', 'skill:void-tdd', { missionId: 'mis_foreign123', payload: { category: 'skill' } }),
      event(3, 'runtime.tool.started', 'tool:exec_command', { source: 'runtime:codex', payload: { fileGlobs: ['.agents/skills/void-tdd/SKILL.md'] } }),
    ]);
    expect(report.rows.every(row => row.observedHits === 'unknown')).toBe(true);
    expect(report.notes.join(' ')).toContain('hook/skill telemetry not linked');
    expect(renderMissionUsage(report)).toContain('unknown');
    expect(renderMissionUsage(report)).toContain('Codex');
  });

  it('keeps specialist positives visible when skill and hook telemetry are unlinked', () => {
    const report = project([event(1, 'specialist.started', 'core:test-qa-engineer', { source: 'runtime:codex' })]);
    expect(report.rows.find(row => row.type === 'specialist')?.observedHits).toBe(1);
    expect(report.rows.filter(row => row.type !== 'specialist').every(row => row.observedHits === 'unknown')).toBe(true);
    expect(renderMissionUsage(report)).toContain('hook/skill telemetry not linked');
  });

  it('reports completions without starts as outcomes, never as invented starts', () => {
    const report = project([event(1, 'specialist.failed', 'core:test-qa-engineer')]);
    expect(report.rows.find(row => row.type === 'specialist')).toMatchObject({ observedHits: 0, outcomes: { failed: 1 } });
    expect(report.notes.join(' ')).toContain('not proof of non-use');
  });

  it('joins local namespace aliases and retains foreign provider identity', () => {
    const report = project(['harness:void-tdd', 'core/void-tdd', 'superpowers:void-tdd'].map((name, index) =>
      event(index + 1, 'runtime.tool.started', `skill:${name}`, { payload: { category: 'skill' } })));
    expect(report.rows.find(row => row.name === 'void-tdd')?.observedHits).toBe(2);
    expect(report.rows.find(row => row.name === 'superpowers:void-tdd'))
      .toMatchObject({ observedHits: 1, catalogued: false });
  });

  it('keeps mixed-runtime skill observations separate and the text recap compact', () => {
    const report = project([
      event(1, 'runtime.tool.started', 'skill:void-tdd', { payload: { category: 'skill' } }),
      event(2, 'runtime.tool.started', 'tool:exec_command', { source: 'runtime:codex' }),
    ]);
    expect(report.rows.find(row => row.name === 'void-tdd')?.runtimeHits)
      .toEqual({ claude: 1, codex: 'unknown' });
    const text = renderMissionUsage(report);
    expect(text).toContain('claude=1, codex=unknown');
    expect(text).not.toContain('| skill | void-debug |');
    expect(text).toContain('skill: 1 zero observed');
    expect(renderMissionUsage(project([]))).not.toContain('| skill |');
  });

  it('accepts only explicit separately scoped events and deduplicates source plus event ID', () => {
    const direct = event(1, 'hook.completed', 'hook:tdd-order', { payload: { status: 'ok' } });
    const linked = { ...direct, missionId: 'mis_source00000001' };
    const report = projectMissionUsage({ missionId, events: [direct, linked], catalog,
      hookSubjects: { 'hook:tdd-order': 'tdd-guard' },
      linkedScopes: [{ missionId: linked.missionId, events: [linked, linked] }] });
    expect(report.rows.find(row => row.name === 'tdd-guard')?.observedHits).toBe(2);
    expect(linked.missionId).toBe('mis_source00000001');
  });

  it('renders advisory receipts distinctly and never credits formal specialist starts', () => {
    const report = project([event(1, 'usage.advisory.started', 'core:test-qa-engineer', {
      source: 'coordinator-observed', payload: { runtime: 'codex', contextId: '/root/expert' },
    })]);
    expect(report.rows.find(row => row.type === 'advisory')).toMatchObject({ observedHits: 1, runtimeHits: { codex: 1 } });
    expect(report.rows.find(row => row.type === 'specialist')?.observedHits).toBe('unknown');
    expect(renderMissionUsage(report)).toContain('| advisory |');
  });

  it('retains observed names missing from the current catalogue without dumping event payloads', () => {
    const report = project([event(1, 'hook.completed', 'hook:legacy-rule', { payload: { status: 'degraded', secret: 'PRIVATE_CANARY' } })]);
    expect(report.rows.find(row => row.name === 'legacy-rule')).toMatchObject({ observedHits: 1, catalogued: false });
    expect(JSON.stringify(report)).not.toContain('PRIVATE_CANARY');
  });
});
