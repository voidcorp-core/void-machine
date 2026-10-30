import { describe, expect, it } from 'vitest';
import { canonicalJsonHash } from '../evidence/canonical-json.js';
import { parseEvent, replayEventLog, serializeEvent } from '../events/index.js';
import type { CanonicalEvent } from '../events/types.js';
import { event } from '../test/events.js';
import { orchestrateMissionTeam, type MissionSpecialistPlan } from './controller.js';
import { projectMissionLifecycle } from './mission-lifecycle.js';
import { planStoppedMissionRecovery } from './mission-recovery.js';
import { planSpecialistContractMigration, validatedSpecialistContractMigrations } from './specialist-contract-migration.js';

const HASH = `sha256:${'a'.repeat(64)}`;
const NEXT = `sha256:${'b'.repeat(64)}`;
const VISUAL = 'core:visual-craft-director';
const plan: MissionSpecialistPlan = { planHash: HASH, context: { status: 'complete', issues: [] },
  specialists: [{ specialistId: VISUAL, contractVersion: 2, inputHash: HASH,
    state: 'applicable', stages: ['post-implementation'] }] };
const declaration = { id: 'visual-craft-director-v2-v3', specialistId: VISUAL,
  fromVersion: 2, toVersion: 3, fromContractSha256: HASH, toContractSha256: NEXT,
  fromContractPath: 'contract-history/visual-craft-director/v2.yaml', policy: 'fresh-review-required' };
const stream = (events: readonly CanonicalEvent[]) => replayEventLog(events.map(serializeEvent).join('\n'));
function fixture(completed = false) {
  const events = [event({ kind: 'mission.started', subject: 'mission', payload: {
    title: 'Historical migration', mode: 'team', planHash: HASH, leadWriterId: 'writer:primary', runtime: 'codex' } }),
  event({ seq: 2, eventId: 'evt_initial_writer', kind: 'lead-writer.completed', subject: 'writer:primary',
    payload: { writerId: 'writer:primary', planHash: HASH, actionKind: 'run-lead-writer' } }),
  event({ seq: 3, eventId: 'evt_old_visual_request', kind: 'specialist.requested',
    source: 'void-harness:mission.dispatch', subject: VISUAL, payload: {
      stage: 'post-implementation', reviewRound: 1, inputHash: HASH, contractVersion: 2,
      runtime: 'codex', planHash: HASH } })];
  if (completed) events.push(event({ seq: 4, eventId: 'evt_old_visual_started',
    kind: 'specialist.started', subject: VISUAL, payload: { stage: 'post-implementation',
      reviewRound: 1, inputHash: HASH, contractVersion: 2, contextId: 'context_old_visual' } }),
  event({ seq: 5, eventId: 'evt_old_visual_completed', kind: 'specialist.completed', subject: VISUAL,
    payload: { stage: 'post-implementation', reviewRound: 1, inputHash: HASH,
      contextId: 'context_old_visual', completion: { schemaVersion: 1, specialistId: VISUAL,
        contractVersion: 2, completionId: 'completion_old_visual', verdict: 'blocked', findings: [],
        evidenceRequests: ['Confirm visual applicability before certification.'],
        limitations: ['No rendered surface or current visual captures were supplied.'] } } }));
  const request: { schemaVersion: 1; expectedEpisodeId: string; expectedJournalHash: string;
    migrationId: string; recovery?: { closureEventId: string } } = { schemaVersion: 1,
    expectedEpisodeId: events[0]!.eventId, expectedJournalHash: canonicalJsonHash(events), migrationId: declaration.id };
  return { events, request,
  observation: { declaration, observedFromContractSha256: HASH, observedToContractSha256: NEXT,
    nativeAgentSha256: NEXT, nativeContractVersion: 3, reviewSubjectHash: HASH, targetInputHash: NEXT,
    plan, currentInputHashes: { [VISUAL]: HASH }, maxRounds: 2, expectedSource: 'runtime:codex' as const } };
}
function migrate(value: ReturnType<typeof fixture>) {
  const decision = planSpecialistContractMigration({ stream: stream(value.events),
    request: value.request, observation: value.observation });
  expect(decision).toMatchObject({ kind: 'migrate' });
  if (decision.kind !== 'migrate') throw new Error('Expected migration admission');
  const parsed = parseEvent({ ...event({ seq: value.events.length + 1,
    eventId: 'evt_visual_migration', kind: 'specialist.contract-migrated',
    source: 'void-harness:mission.migrate-specialist', subject: VISUAL }), payload: decision.receipt });
  if (!parsed.ok) throw new Error('Expected canonical migration receipt');
  return { decision, migrated: [...value.events, parsed.value] };
}
function decide(events: readonly CanonicalEvent[]) {
  return orchestrateMissionTeam({ plan, stream: stream(events), evidenceContext: { dependencies: {} },
    currentInputHashesByStage: { 'pre-implementation': {}, 'post-implementation': { [VISUAL]: NEXT } },
    maxReviewRounds: 2, specialistRuntime: { status: 'available', limitations: [] } });
}

describe('open specialist contract migration', () => {
  it('reopens a controller stop before first post review with one authenticated migration and no budget credit', () => {
    const value = fixture();
    value.events.pop();
    value.events.push(event({ seq: 3, eventId: 'evt_contract_mismatch_stop', kind: 'mission.closed',
      source: 'void-harness:mission.dispatch', subject: 'mission',
      payload: { reason: 'controller-stop', episodeId: value.request.expectedEpisodeId } }));
    value.request.expectedJournalHash = canonicalJsonHash(value.events);
    value.request.recovery = { closureEventId: 'evt_contract_mismatch_stop' };
    const { decision, migrated } = migrate(value);
    expect(decision.receipt).toMatchObject({ reviewRound: 1, remainingRounds: 2,
      recovery: { closureEventId: 'evt_contract_mismatch_stop', previousEpisodeId: value.request.expectedEpisodeId } });
    expect(projectMissionLifecycle(migrated)).toEqual({ status: 'open', episodeId: 'evt_visual_migration' });
    expect(validatedSpecialistContractMigrations(migrated, plan).ok).toBe(true);
    expect(planSpecialistContractMigration({ stream: stream(migrated), request: value.request,
      observation: value.observation }).kind).toBe('already-migrated');
  });
  it.each(['completed', 'interrupted', 'abandoned', 'post-review-attempt', 'writer-inflight', 'effect-inflight', 'implicit', 'wrong-closure'])(
    'does not reopen %s as a contract transition', cause => {
      const value = fixture();
      if (cause !== 'post-review-attempt') value.events.pop();
      if (cause === 'writer-inflight') value.events.push(event({ seq: value.events.length + 1,
        eventId: 'evt_writer_pending', kind: 'lead-writer.requested', subject: 'writer:primary',
        payload: { actionKind: 'run-correction', writerId: 'writer:primary', planHash: HASH } }));
      if (cause === 'effect-inflight') value.events.push(event({ seq: value.events.length + 1,
        eventId: 'evt_effect_pending', kind: 'orchestration.node-started', subject: 'node_pending', payload: {} }));
      value.events.push(event({ seq: value.events.length + 1, eventId: 'evt_refused_stop', kind: 'mission.closed',
        source: 'void-harness:mission.dispatch', subject: 'mission', payload: {
          reason: ['completed', 'interrupted', 'abandoned'].includes(cause) ? cause : 'controller-stop',
          episodeId: value.request.expectedEpisodeId } }));
      value.request.expectedJournalHash = canonicalJsonHash(value.events);
      if (cause !== 'implicit') value.request.recovery = { closureEventId: cause === 'wrong-closure' ? 'evt_other' : 'evt_refused_stop' };
      expect(planSpecialistContractMigration({ stream: stream(value.events), request: value.request,
        observation: value.observation }).kind).toBe('refused');
    });

  it('supersedes only queued old requests and preserves the original plan and journal', () => {
    const value = fixture();
    const before = canonicalJsonHash(value.events);
    const { decision, migrated } = migrate(value);
    expect(decision.receipt).toMatchObject({ supersededRequestEventIds: ['evt_old_visual_request'],
      supersededCompletionEventIds: [], reviewRound: 1, remainingRounds: 2 });
    expect(canonicalJsonHash(value.events)).toBe(before);
    const projection = validatedSpecialistContractMigrations(migrated, plan);
    expect(projection.ok).toBe(true);
    if (!projection.ok) throw new Error('Expected valid projection');
    expect(projection.plan.specialists[0]?.contractVersion).toBe(3);
    expect(plan.specialists[0]?.contractVersion).toBe(2);
    expect(planSpecialistContractMigration({ stream: stream(migrated), request: value.request,
      observation: value.observation }).kind).toBe('already-migrated');
    const replay = event({ seq: migrated.length + 1, eventId: 'evt_illegal_old_start',
      kind: 'specialist.started', subject: VISUAL, payload: { stage: 'post-implementation',
        reviewRound: 1, contractVersion: 2, inputHash: HASH, contextId: 'context_old_replayed' } });
    expect(validatedSpecialistContractMigrations([...migrated, replay], plan).ok).toBe(false);
  });
  it.each(['stale-journal', 'stale-episode', 'inflight', 'native-mismatch', 'archive-mismatch', 'budget'])(
    'refuses %s without a migration receipt', cause => {
      const value = fixture(true);
      if (cause === 'stale-journal') value.request.expectedJournalHash = NEXT;
      if (cause === 'stale-episode') value.request.expectedEpisodeId = 'evt_other_episode';
      if (cause === 'inflight') { value.events.pop(); value.request.expectedJournalHash = canonicalJsonHash(value.events); }
      if (cause === 'native-mismatch') value.observation.nativeContractVersion = 2;
      if (cause === 'archive-mismatch') value.observation.observedFromContractSha256 = NEXT;
      if (cause === 'budget') value.observation.maxRounds = 1;
      expect(planSpecialistContractMigration({ stream: stream(value.events), request: value.request,
        observation: value.observation }).kind).toBe('refused');
    },
  );
  it('refuses migration while a peer specialist is started without its terminal receipt', () => {
    const value = fixture(true);
    const peer = 'core:test-qa-engineer';
    value.observation.plan = { ...plan, specialists: [...plan.specialists, {
      specialistId: peer, contractVersion: 2, state: 'applicable', stages: ['post-implementation'],
    }] };
    const payload = { stage: 'post-implementation', reviewRound: 1, inputHash: HASH,
      contractVersion: 2, runtime: 'codex', planHash: HASH };
    value.events.push(event({ seq: 6, eventId: 'evt_peer_request', kind: 'specialist.requested',
      source: 'void-harness:mission.dispatch', subject: peer, payload }),
    event({ seq: 7, eventId: 'evt_peer_started', kind: 'specialist.started', subject: peer,
      payload: { ...payload, contextId: 'context_peer_inflight' } }));
    value.request.expectedJournalHash = canonicalJsonHash(value.events);
    const original = canonicalJsonHash(value.events);
    const result = planSpecialistContractMigration({ stream: stream(value.events),
      request: value.request, observation: { ...value.observation,
        currentInputHashes: { ...value.observation.currentInputHashes, [peer]: HASH } } });
    expect(result).toMatchObject({ kind: 'refused', code: 'specialist-inflight' });
    expect(canonicalJsonHash(value.events)).toBe(original);
  });
  it('archives a pre-recovery peer start while preserving its authentic episode history', () => {
    const value = fixture(true);
    value.events.push(event({ seq: 6, eventId: 'evt_historical_qa_request',
      kind: 'specialist.requested', source: 'void-harness:mission.dispatch', subject: 'core:test-qa-engineer',
      payload: { stage: 'post-implementation', reviewRound: 2, inputHash: NEXT,
        contractVersion: 2, runtime: 'codex', planHash: HASH } }),
    event({ seq: 7, eventId: 'evt_historical_qa_start', kind: 'specialist.started',
      subject: 'core:test-qa-engineer', payload: { stage: 'post-implementation', reviewRound: 2,
        inputHash: NEXT, contractVersion: 2, contextId: 'context_historical_qa' } }),
    event({ seq: 8, eventId: 'evt_historical_closure', kind: 'mission.closed',
      payload: { reason: 'controller-stop' } }));
    const artifact = { path: 'docs/visual-applicability.md', sha256: HASH };
    const recovery = planStoppedMissionRecovery({ stream: stream(value.events), request: {
      schemaVersion: 1, closureEventId: 'evt_historical_closure',
      expectedJournalHash: canonicalJsonHash(value.events), disposition: { kind: 'review-blocker',
        completionEventIds: ['evt_old_visual_completed'], resolutionArtifact: artifact } },
    observation: { stage: 'post-implementation', contractVersions: { [VISUAL]: 2 },
      currentInputHashes: { [VISUAL]: HASH }, maxRounds: 2, expectedSource: 'runtime:codex',
      resolutionArtifact: artifact } });
    expect(recovery).toMatchObject({ kind: 'recover' });
    if (recovery.kind !== 'recover') throw new Error('Authentic recovery admission required');
    const recovered = parseEvent({ ...event({ seq: 9, eventId: 'evt_authentic_recovery',
      kind: 'mission.recovered', source: 'void-harness:mission.recover' }), payload: recovery.receipt });
    if (!recovered.ok) throw new Error('Canonical recovery receipt required');
    value.events.push(recovered.value);
    value.request.expectedEpisodeId = recovered.value.eventId;
    value.request.expectedJournalHash = canonicalJsonHash(value.events);
    const before = canonicalJsonHash(value.events);
    const { decision } = migrate(value);
    expect(decision.receipt).toMatchObject({ episodeId: recovered.value.eventId,
      reviewRound: 2, remainingRounds: 1 });
    expect(canonicalJsonHash(value.events)).toBe(before);
    expect(value.events.find(item => item.eventId === 'evt_historical_qa_start')?.kind)
      .toBe('specialist.started');
  });
  it('admits only the fresh v3 assessment while retaining old author obligations and the consumed round', () => {
    const value = fixture(true);
    const { decision, migrated } = migrate(value);
    expect(decision.receipt).toMatchObject({ reviewRound: 2, remainingRounds: 1,
      supersededCompletionEventIds: ['evt_old_visual_completed'],
      pendingAuthorObligationIds: [expect.any(String)] });
    const assessment = decide(migrated);
    expect(assessment.action).toEqual({ kind: 'invoke-specialists', specialistIds: [VISUAL],
      stage: 'post-implementation', reviewRound: 2 });
    expect(assessment.verdict.status).not.toBe('verified');
    const failed = event({ seq: migrated.length + 1, eventId: 'evt_new_review_failed',
      kind: 'specialist.failed', subject: VISUAL, payload: { stage: 'post-implementation',
        reviewRound: 2, inputHash: NEXT, contractVersion: 3, contextId: 'context_fresh_visual',
        reason: 'Review failed' } });
    expect(decide([...migrated, failed])).toMatchObject({ action: { kind: 'stop' },
      review: { status: 'blocked' } });
    const altered = migrated.map(item => item.kind === 'specialist.contract-migrated'
      ? { ...item, source: 'runtime:codex' } : item);
    expect(validatedSpecialistContractMigrations(altered, plan).ok).toBe(false);
  });
});
