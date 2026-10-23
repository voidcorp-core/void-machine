import { describe, expect, it } from 'vitest';
import type { CanonicalEvent } from '@voidcorp/mission-engine';
import { projectMissionUsage, renderMissionUsage } from './usage.js';

const missionId = 'mis_activity000001';
const dispatch = { stage: 'post-implementation', reviewRound: 1, contractVersion: 1,
  inputHash: `sha256:${'a'.repeat(64)}` };
function event(seq: number, kind: string, contextId = '/root/reviewer',
  extra: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return { schemaVersion: 1, seq, eventId: `evt_activity_${seq}`, missionId,
    ts: '2026-10-23T18:00:00.000Z', source: 'runtime:codex', kind,
    subject: 'core:devex-docs-engineer', correlationId: missionId,
    payload: { ...dispatch, contextId }, ...extra };
}
const project = (events: readonly CanonicalEvent[], extra = {}) => projectMissionUsage({
  missionId, events, catalog: [], hookSubjects: {}, ...extra,
});

describe('observed specialist activity from the usage stream', () => {
  it('shows the recorded start, native identity and bounded task without claiming live presence', () => {
    const report = project([event(1, 'specialist.started')]);
    expect(report.activity).toEqual([expect.objectContaining({ kind: 'specialist',
      specialist: 'devex-docs-engineer', nativeContextId: '/root/reviewer', runtime: 'codex',
      sourceMissionId: missionId, attribution: 'mission', task: 'post-implementation / round 1',
      observedState: 'running' })]);
    expect(renderMissionUsage(report)).toContain('Observed state');
    expect(renderMissionUsage(report)).toContain('not live presence');
  });

  it('matches terminal receipts to two same-role contexts and keeps counts unchanged', () => {
    const started = event(1, 'specialist.started', '/root/one');
    const report = project([started, started, event(2, 'specialist.started', '/root/two'),
      event(3, 'specialist.completed', '/root/one'), event(4, 'specialist.failed', '/root/two')]);
    expect(report.activity).toEqual([expect.objectContaining({ nativeContextId: '/root/one', observedState: 'completed' }),
      expect.objectContaining({ nativeContextId: '/root/two', observedState: 'failed' })]);
    expect(report.rows[0]).toMatchObject({ observedHits: 2, outcomes: { completed: 1, failed: 1 } });
  });

  it('does not match another dispatch or runtime merely because the context name agrees', () => {
    const report = project([event(1, 'specialist.started'),
      event(2, 'specialist.completed', '/root/reviewer', { payload: { ...dispatch, reviewRound: 2, contextId: '/root/reviewer' } }),
      event(3, 'specialist.completed', '/root/reviewer', { source: 'runtime:claude' })]);
    expect(report.activity.map(row => row.observedState)).toEqual(['running', 'unknown', 'unknown']);
    expect(report.rows[0]).toMatchObject({ observedHits: 1, outcomes: { completed: 2 } });
  });

  it('does not infer a runtime from an arbitrary source suffix', () => {
    const spoofed = project([event(1, 'specialist.started', '/root/reviewer', { source: 'forged::codex' })]);
    expect(spoofed.activity[0]).toMatchObject({ runtime: 'unknown', observedState: 'unknown' });
  });

  it('does not ignore a conflicting invocation reference', () => {
    const one = event(1, 'specialist.started', '/root/one');
    const two = event(2, 'specialist.started', '/root/two');
    const report = project([one, two, event(3, 'specialist.completed', '/root/one', {
      payload: { ...dispatch, contextId: '/root/one', reviewInvocationEventId: two.eventId },
    })]);
    expect(report.activity.map(row => row.observedState)).toEqual(['running', 'running', 'unknown']);
  });

  it('uses an exact invocation event reference when artifact provenance has no native identity', () => {
    const start = event(1, 'specialist.started', '', { payload: { ...dispatch, reviewerId: 'reviewer:independent' } });
    const report = project([start, event(2, 'specialist.completed', '', {
      payload: { ...dispatch, reviewInvocationEventId: start.eventId } })]);
    expect(report.activity).toEqual([expect.objectContaining({ nativeContextId: 'unknown', observedState: 'completed' })]);
  });

  it('shows an orphan outcome as unknown activity and never manufactures a start', () => {
    const report = project([event(1, 'specialist.completed')]);
    expect(report.activity[0]).toMatchObject({ observedState: 'unknown', reason: 'terminal without matching start' });
    expect(report.rows[0]).toMatchObject({ observedHits: 0, outcomes: { completed: 1 } });
  });

  it('keeps advisory starts separate with an unknown outcome and no fabricated task text', () => {
    const report = project([event(1, 'usage.advisory.started', '/root/advice', {
      source: 'coordinator-observed', payload: { runtime: 'codex', contextId: '/root/advice', prompt: 'PRIVATE_PROMPT_CANARY' },
    })]);
    expect(report.activity[0]).toMatchObject({ kind: 'advisory', nativeContextId: '/root/advice',
      observedState: 'unknown', task: 'advisory', reason: 'start observed; no advisory completion telemetry' });
    expect(JSON.stringify(report)).not.toContain('PRIVATE_PROMPT_CANARY');
    expect(report.rows[0]).toMatchObject({ type: 'advisory', observedHits: 1 });
  });

  it.each(['interrupted', 'abandoned'])('marks unfinished activity unknown after an observed %s closure', reason => {
    const report = project([event(1, 'specialist.started'), event(2, 'specialist.started', '/root/done'),
      event(3, 'specialist.completed', '/root/done'), event(4, 'mission.closed', '', { subject: 'mission', payload: { reason } })]);
    expect(report.activity.map(row => row.observedState)).toEqual(['unknown', 'completed']);
    expect(report.activity[0]?.reason).toBe('observation ended without a terminal receipt');
  });

  it('does not infer running state through a damaged journal', () => {
    const report = project([event(1, 'specialist.started')], { incomplete: true });
    expect(report.activity[0]).toMatchObject({ observedState: 'unknown', reason: 'journal incomplete' });
  });

  it('distinguishes exact native identity from shared-session attribution and a closed interval', () => {
    const source = 'mis_source000001';
    const report = project([event(1, 'specialist.started')], {
      linkedScopes: [{ missionId: source, events: [event(1, 'specialist.started', '/root/reviewer', { missionId: source })] }],
      endedScopes: [source],
    });
    expect(report.activity).toEqual([expect.objectContaining({ attribution: 'mission', observedState: 'running' }),
      expect.objectContaining({ sourceMissionId: source, attribution: 'shared-session',
        nativeContextId: '/root/reviewer', observedState: 'unknown' })]);
    expect(report.rows[0]?.observedHits).toBe(2);
  });

  it('keeps absent execution telemetry unknown instead of displaying a planned invocation as running', () => {
    const report = project([event(1, 'specialist.requested')]);
    expect(report.activity).toEqual([]);
    expect(renderMissionUsage(report)).toContain('Specialist activity unknown: no linked execution observations.');
  });

  it('bounds activity output, reports omitted observations and excludes unsafe identities', () => {
    const report = project(Array.from({ length: 205 }, (_, i) => event(i + 1, 'specialist.started', `/root/context-${i}`)));
    expect(report.activity).toHaveLength(200);
    expect(report.activityOmitted).toBe(5);
    expect(renderMissionUsage(report)).toContain('185 activity observation(s) omitted');
    expect(report.rows[0]?.observedHits).toBe(205);
    const unsafe = project([event(1, 'specialist.started', '\u001b[31m'),
      event(2, 'specialist.started', '/root/a|[x](url)')]);
    expect(unsafe.activity[0]?.nativeContextId).toBe('unknown');
    expect(renderMissionUsage(unsafe)).not.toContain('\u001b');
    expect(renderMissionUsage(unsafe)).toContain('/root/a\\|\\[x\\](url)');
  });
});
