import { createHash } from 'node:crypto';
import { writeSequencedEventOnce } from '@voidcorp/hook-runner';
import {
  canonicalJson, canonicalJsonHash, type CanonicalEvent, parseRecoveredReviewBindings,
  validatedReviewWriterBindingResponse,
  type MissionRecoveryObservation, type MissionRecoveryRequest,parseEventLine, planStoppedMissionRecovery,
} from '@voidcorp/mission-engine';
import { inspectMission } from './store.js';
import { readBoundedProjectFile } from '../safe-read.js';

/** Admission and compare-and-append share the existing journal lock; no effect is replayed. */
export async function recordStoppedMissionRecovery(
  root: string, missionId: string, request: MissionRecoveryRequest,
  observation: MissionRecoveryObservation,
): Promise<{ readonly recorded: boolean; readonly recoveryEventId: string }> {
  const inspected = await inspectMission(root, missionId, { dependencies: {} });
  const decision = planStoppedMissionRecovery({ stream: inspected.stream, request, observation });
  if (decision.kind === 'refused') {
    throw new Error(`MISSION_RECOVERY_REFUSED: ${decision.code}: ${decision.reasons.join('; ')}`);
  }
  if (decision.kind === 'already-recovered') {
    return { recorded: false, recoveryEventId: decision.recoveryEventId };
  }
  const eventId = `evt_${createHash('sha256').update(canonicalJson({ missionId,
    closureEventId: request.closureEventId, requestHash: decision.receipt.requestHash })).digest('hex')}`;
  const candidate = parseEventLine(canonicalJson({ schemaVersion: 1,
    seq: inspected.stream.lastSeq + 1, eventId, missionId, ts: new Date().toISOString(),
    source: 'void-harness:mission.recover', kind: 'mission.recovered', subject: 'mission',
    correlationId: missionId, payload: decision.receipt }));
  if (!candidate.ok) throw new Error(`MISSION_RECOVERY_INVALID: ${candidate.issue.message}`);
  const result = await writeSequencedEventOnce({ root, missionId, eventId,
    draft: { source: candidate.value.source, kind: candidate.value.kind,
      subject: candidate.value.subject, correlationId: missionId, payload: candidate.value.payload },
    validate: events => {
      if (canonicalJsonHash(events) !== request.expectedJournalHash) {
        throw new Error('MISSION_RECOVERY_REFUSED: stale-journal: re-observe the journal before recovery');
      }
    },
  });
  return { recorded: result.appended, recoveryEventId: result.event.eventId };
}
function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => key in value);
}
function eventId(value: unknown): value is string {
  return typeof value === 'string' && /^evt_[A-Za-z0-9_-]{8,100}$/.test(value);
}
function hash(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}
function invalid(): never {
  throw new Error('MISSION_RECOVERY_INVALID: provide the exact bounded recovery request without observations or overrides');
}
function correctionPairs(value: unknown): value is Extract<MissionRecoveryRequest['disposition'], {
  readonly kind: 'command-correction';
}>['pairs'] {
  return Array.isArray(value) && value.length > 0 && value.length <= 64
    && value.every(pair => record(pair) && exact(pair, ['failedEventId', 'replacementEventId'])
      && eventId(pair['failedEventId']) && eventId(pair['replacementEventId']));
}
export function parseMissionRecoveryRequest(value: unknown): MissionRecoveryRequest {
  if (!record(value) || !exact(value, ['schemaVersion', 'closureEventId', 'expectedJournalHash', 'disposition'])
    || value['schemaVersion'] !== 1 || !eventId(value['closureEventId'])
    || !hash(value['expectedJournalHash']) || !record(value['disposition'])) invalid();
  const disposition = value['disposition'];
  const base = { schemaVersion: 1 as const, closureEventId: value['closureEventId'],
    expectedJournalHash: value['expectedJournalHash'] };
  if (disposition['kind'] === 'review-writer-binding') {
    if (!exact(disposition, ['kind', 'responseEventId']) || !eventId(disposition['responseEventId'])) invalid();
    return { ...base, disposition: { kind: 'review-writer-binding', responseEventId: disposition['responseEventId'] } };
  }
  if (disposition['kind'] === 'controller-defect') {
    const defect = disposition['defect'];
    if (!exact(disposition, ['kind', 'defect'])
      || (defect !== 'partial-fanout-round' && defect !== 'stale-input-dispatch'
        && defect !== 'opaque-native-context' && defect !== 'targeted-review-context')) invalid();
    return { ...base, disposition: { kind: 'controller-defect', defect } };
  }
  if (disposition['kind'] === 'evidence-disposition') {
    const ids = disposition['responseEventIds'];
    if (!exact(disposition, ['kind', 'responseEventIds']) || !Array.isArray(ids)
      || ids.length < 1 || ids.length > 64 || !ids.every(eventId)
      || new Set(ids).size !== ids.length) invalid();
    return { ...base, disposition: { kind: 'evidence-disposition', responseEventIds: ids } };
  }
  const commandCorrection = disposition['kind'] === 'command-correction';
  const ids = disposition['completionEventIds'];
  if (disposition['kind'] === 'preparation-invocation') {
    if (!exact(disposition, ['kind', 'completionEventIds']) || !Array.isArray(ids)
      || ids.length < 1 || ids.length > 64 || !ids.every(eventId)
      || new Set(ids).size !== ids.length) invalid();
    return { ...base, disposition: { kind: 'preparation-invocation', completionEventIds: ids } };
  }
  const artifact = disposition['resolutionArtifact'];
  if ((!commandCorrection && disposition['kind'] !== 'review-blocker' && disposition['kind'] !== 'review-provenance')
    || !exact(disposition, ['kind', commandCorrection ? 'pairs' : 'completionEventIds', 'resolutionArtifact'])
    || !record(artifact) || !exact(artifact, ['path', 'sha256'])
    || typeof artifact['path'] !== 'string' || artifact['path'].length < 1
    || artifact['path'].length > 500 || artifact['path'].includes('\0')
    || /^(?:[A-Za-z]:|[/\\])/.test(artifact['path'])
    || artifact['path'].replaceAll('\\', '/').split('/').includes('..') || !hash(artifact['sha256'])) invalid();
  if (commandCorrection) {
    const pairs = disposition['pairs'];
    if (!correctionPairs(pairs)) invalid();
    return { ...base, disposition: { kind: 'command-correction', pairs,
      resolutionArtifact: { path: artifact['path'], sha256: artifact['sha256'] } } };
  }
  if ((disposition['kind'] !== 'review-blocker' && disposition['kind'] !== 'review-provenance')
    || !Array.isArray(ids) || ids.length < 1 || ids.length > 64 || !ids.every(eventId)
    || new Set(ids).size !== ids.length) invalid();
  return { ...base, disposition: { kind: disposition['kind'], completionEventIds: ids,
    resolutionArtifact: { path: artifact['path'], sha256: artifact['sha256'] } } };
}

/** Reobserve recovery artifacts before admission without changing their original bounds. */
export async function observeRecoveryArtifacts(
  root: string, request: MissionRecoveryRequest, events: readonly CanonicalEvent[],
) {
  const provenance = request.disposition.kind !== 'review-provenance' ? undefined
    : await readRecoveryReviewBindings(root, request.disposition.resolutionArtifact.path);
  if (request.disposition.kind === 'review-writer-binding') {
    const amendment = validatedReviewWriterBindingResponse(events, request.disposition.responseEventId);
    const artifact = amendment && record(amendment.response.payload)
      ? amendment.response.payload['responseArtifact'] : undefined;
    const path = record(artifact) ? artifact['path'] : undefined;
    if (typeof path !== 'string' || canonicalJsonHash(await recoveryResolutionArtifact(root, path)) !== canonicalJsonHash(artifact)) {
      throw Error('MISSION_RECOVERY_INVALID: retained author response artifact changed or is absent');
    }
  }
  const resolutionArtifact = provenance?.artifact ?? ((request.disposition.kind === 'review-blocker'
    || request.disposition.kind === 'command-correction')
    ? await recoveryResolutionArtifact(root, request.disposition.resolutionArtifact.path) : undefined);
  return { provenance, resolutionArtifact };
}

async function readRecoveryReviewBindings(root: string, path: string) {
  const loaded = await readBoundedProjectFile({ root, inputPath: path, maxBytes: 64 * 1024,
    pathEscapeMessage: 'MISSION_RECOVERY_PROVENANCE: artifact escapes project root',
    invalidMessage: 'MISSION_RECOVERY_PROVENANCE: artifact must be a bounded stable file' });
  const value: unknown = JSON.parse(loaded.body);
  const bindings = record(value) && Object.keys(value).length === 1
    ? parseRecoveredReviewBindings(value['bindings']) : undefined;
  if (bindings === undefined) throw new Error('MISSION_RECOVERY_PROVENANCE: exact original review bindings are required');
  return { bindings, artifact: { path, sha256: `sha256:${createHash('sha256').update(loaded.body).digest('hex')}` } };
}

async function recoveryResolutionArtifact(root: string, path: string) {
  const loaded = await readBoundedProjectFile({ root, inputPath: path, maxBytes: 100_000,
    pathEscapeMessage: 'MISSION_RECOVERY_INVALID: resolution artifact escaped the project',
    invalidMessage: 'MISSION_RECOVERY_INVALID: unsafe or oversized resolution artifact' });
  return { path, sha256: `sha256:${createHash('sha256').update(loaded.body).digest('hex')}` };
}

