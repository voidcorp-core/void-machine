import { replayEventLog, serializeEvent } from '../events/index.js';
import type { CanonicalEvent, JsonValue } from '../events/types.js';
import { canonicalJsonHash } from '../evidence/canonical-json.js';
import { sealEvidence } from '../evidence/schema.js';
import { evidenceDraft } from './evidence.js';
import { event } from './events.js';

export const REVIEWER = 'core:independent-code-reviewer' as const;
export const CONTEXT = '/root/independent_reviewer';
export const PLAN_HASH = `sha256:${'a'.repeat(64)}`;
export const DIFF_HASH = `sha256:${'d'.repeat(64)}`;
export const finding = { id: 'stale-history', severity: 'high', classification: 'blocking',
  criterion: 'History reflects the current execution', consequence: 'Stale continuation is rendered',
  resolutionCondition: 'Regression test proves refresh', basis: 'initial-scope-defect',
  summary: 'Continuation uses stale history', recommendation: 'Refresh history before rendering',
  evidence: [{ path: 'src/history.ts', line: 8, detail: 'The completed execution was not refreshed' }],
} as const;
export const findingId = `fnd_${canonicalJsonHash({ evidence: finding.evidence,
  sourceId: finding.id, classification: finding.classification }).slice('sha256:'.length, 29)}`;

/** Synthetic, complete protocol fixture; never an attestation about a real review. */
export function targetedReviewFixture(corrections = 1) {
  const events: CanonicalEvent[] = [];
  const add = (kind: string, subject: string, payload: JsonValue, source = 'runtime:codex', causationId?: string) => {
    const value = event({ seq: events.length + 1, eventId: `evt_targeted_${events.length + 1}`,
      kind, subject, source, payload, ...(causationId === undefined ? {} : { causationId }) });
    events.push(value);
    return value;
  };
  add('mission.started', 'mission', { mode: 'team', title: 'Review correction', planHash: PLAN_HASH,
    leadWriterId: 'writer:primary', runtime: 'codex', runtimeAttested: true,
    reviewPolicy: 'bounded-corrections-v1' }, 'void-harness:mission');
  const proofIds: string[] = [];
  let subject = { taskId: event().missionId, baseCommit: 'a'.repeat(40),
    reviewedCommit: 'b'.repeat(40), acceptanceCriteriaHash: PLAN_HASH };
  for (let batch = 0; batch <= corrections; batch++) {
    const actionKind = batch === 0 ? 'run-lead-writer' : 'run-correction';
    const writer = { writerId: 'writer:primary', planHash: PLAN_HASH, actionKind, implementationRound: batch + 1 };
    const requested = add('lead-writer.requested', 'writer:primary', { ...writer,
      ...(batch === 0 ? {} : { findingIds: [findingId] }) }, 'void-harness:mission.dispatch');
    if (batch > 0) {
      const draft = evidenceDraft({ evidenceId: `evd_targeted_proof_${batch}`, diffHash: DIFF_HASH,
        dependencies: [{ kind: 'diff', key: 'git:working-tree', hash: DIFF_HASH }] });
      const proof = sealEvidence(draft);
      add('evidence.recorded', draft.evidenceId, JSON.parse(JSON.stringify({ evidence: proof })), 'void-harness:mission.verify');
      proofIds.push(draft.evidenceId);
    }
    add('lead-writer.completed', 'writer:primary', { ...writer, requestEventId: requested.eventId }, 'writer:primary', requested.eventId);
    subject = { ...subject, reviewedCommit: (batch + 11).toString(16).repeat(40) };
    const scope = batch === 0 ? { kind: 'general' as const }
      : { kind: 'targeted' as const, findingIds: [finding.id], affectedPaths: ['src/history.ts'] };
    const common = { stage: 'post-implementation', contractVersion: 1, reviewRound: batch + 1,
      inputHash: `sha256:${(batch + 11).toString(16).repeat(64)}`, reviewSubject: subject, reviewScope: scope };
    add('specialist.requested', REVIEWER, { ...common, runtime: 'codex', planHash: PLAN_HASH }, 'void-harness:mission.dispatch');
    add('specialist.started', REVIEWER, { ...common, contextId: CONTEXT });
    const passed = batch === corrections && batch > 0;
    add('specialist.completed', REVIEWER, { ...common, contextId: CONTEXT, completion: {
      schemaVersion: 1, specialistId: REVIEWER, contractVersion: 1, completionId: `cmp_targeted_${batch}`,
      verdict: passed ? 'pass' : 'changes-requested', findings: batch === 0 ? [finding] : [], evidenceRequests: [],
      limitations: ['Unchanged conclusions remain valid.'], review: { ...subject,
        reviewerId: CONTEXT, writerId: 'writer:primary', readOnly: true, scope, proofIds: [...proofIds],
        resolutions: batch === 0 ? [] : [{ findingId: finding.id, status: passed ? 'resolved' : 'unresolved',
          proofIds: [proofIds.at(-1)!] }], provenance: { kind: 'native-context', contextId: CONTEXT },
      },
    } });
  }
  const lastWriter = events.filter(e => e.kind === 'lead-writer.completed').at(-1)!;
  const currentHash = `sha256:${(corrections + 11).toString(16).repeat(64)}`;
  return { events, proofIds, subject, input: { events, stage: 'post-implementation' as const,
    expectedSource: 'runtime:codex' as const, stageStartSeqExclusive: 3, afterSeqExclusive: lastWriter.seq,
    requiredSpecialists: [REVIEWER], contractVersions: { [REVIEWER]: 1 }, currentInputHashes: { [REVIEWER]: currentHash },
    maxRounds: 3, maxCorrectionBatches: 2 as const, validProofIds: proofIds } };
}

export function stoppedTargetedReview(corrections = 1) {
  const fixture = targetedReviewFixture(corrections);
  const closure = event({ seq: fixture.events.length + 1, eventId: 'evt_targeted_closure',
    kind: 'mission.closed', source: 'void-harness:mission.dispatch', subject: 'mission', payload: { reason: 'controller-stop' } });
  const events = [...fixture.events, closure];
  return { ...fixture, events, recovery: { stream: replayEventLog(events.map(serializeEvent).join('\n')),
    request: { schemaVersion: 1 as const, closureEventId: closure.eventId, expectedJournalHash: canonicalJsonHash(events),
      disposition: { kind: 'controller-defect' as const, defect: 'targeted-review-context' as const } },
    observation: { stage: 'post-implementation' as const, expectedSource: 'runtime:codex' as const,
      reviewPolicy: 'bounded-corrections-v1' as const, maxRounds: 2, reviewSubject: fixture.subject,
      contractVersions: { [REVIEWER]: 1 }, currentInputHashes: fixture.input.currentInputHashes,
      evidenceDependencies: { 'git:working-tree': DIFF_HASH } },
  } };
}
