import type { EventStreamState } from '../events/reducer.js';
import { validatedRecoveredReviewEvents } from '../orchestration/mission-recovery.js';
import { reduceFindings } from '../findings/reducer.js';
import { assessEvidence } from './invalidation.js';
import { parseEvidence } from './schema.js';
import type { Evidence, EvidenceContext } from './types.js';

export type MissionVerdictStatus =
  | 'unverified'
  | 'verified'
  | 'shipped-with-exception'
  | 'blocked'
  | 'degraded';

export interface MissionVerdict {
  readonly missionId: string;
  readonly title: string;
  readonly mode: 'fast' | 'team' | 'fortress' | 'unknown';
  readonly status: MissionVerdictStatus;
  readonly freshEvidence: number;
  readonly staleEvidence: number;
  readonly tamperedEvidence: number;
  readonly failedEvidence: number;
  readonly openBlockers: number;
  readonly acceptedExceptions: number;
  readonly reasons: readonly string[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function missionMetadata(stream: EventStreamState): {
  title: string;
  mode: MissionVerdict['mode'];
  valid: boolean;
} {
  const started = stream.events.find((event) => event.kind === 'mission.started');
  const payload = record(started?.payload);
  const title = payload?.['title'];
  const mode = payload?.['mode'];
  return {
    title: typeof title === 'string' && title !== '' ? title : 'Unknown mission',
    mode: mode === 'fast' || mode === 'team' || mode === 'fortress'
      ? mode
      : 'unknown',
    valid: started !== undefined
      && typeof title === 'string'
      && title !== ''
      && (mode === 'fast' || mode === 'team' || mode === 'fortress'),
  };
}

export function deriveMissionVerdict(
  stream: EventStreamState,
  context: EvidenceContext,
): MissionVerdict {
  const metadata = missionMetadata(stream);
  const findings = reduceFindings(stream.events);
  const referenceMissionId = stream.events[0]?.missionId;
  const missionStartedCount = stream.events.filter((event) =>
    event.kind === 'mission.started'
  ).length;
  const crossMissionEvents = referenceMissionId === undefined
    || stream.events.some((event) =>
      event.missionId !== referenceMissionId
      || event.correlationId !== referenceMissionId
    )
    || (
      context.missionId !== undefined
      && referenceMissionId !== context.missionId
    );
  // Recovery admission never computes a verdict; its authenticated projection is the sole authority.
  const recovered = stream.events.some(event => event.kind === 'mission.recovered')
    ? validatedRecoveredReviewEvents(stream.events) : { ok: true as const, events: stream.events };
  const effectiveEventIds = new Set(recovered.ok ? recovered.events.map(event => event.eventId) : []);
  const evidenceIds = new Set<string>();
  const evidenceByInput = new Map<string, { readonly eventId: string; readonly proof: Evidence }>();
  let tamperedEvidence = 0;
  let duplicateEvidence = 0;
  for (const event of stream.events) {
    if (event.kind !== 'evidence.recorded') continue;
    const parsed = parseEvidence(record(event.payload)?.['evidence']);
    if (!parsed.ok) {
      tamperedEvidence += 1;
      continue;
    }
    if (
      parsed.value.missionId !== event.missionId
      || parsed.value.evidenceId !== event.subject
    ) {
      tamperedEvidence += 1;
      continue;
    }
    if (evidenceIds.has(parsed.value.evidenceId)) {
      duplicateEvidence += 1;
      continue;
    }
    evidenceIds.add(parsed.value.evidenceId);
    evidenceByInput.set(parsed.value.inputHash, { eventId: event.eventId, proof: parsed.value });
  }
  // Select current inputs before correction: an older superseded failure must not reappear.
  // Every original proof above still undergoes integrity and duplicate checks.
  const evidence = [...evidenceByInput.values()]
    .filter(entry => !recovered.ok || effectiveEventIds.has(entry.eventId))
    .map(entry => entry.proof);
  const assessments = evidence.map((proof) => ({
    proof,
    assessment: assessEvidence(proof, context),
  }));
  const fresh = assessments.filter((entry) =>
    entry.assessment.status === 'fresh'
  );
  const freshPassed = fresh.filter((entry) => entry.proof.status === 'passed');
  const failedEvidence = fresh.filter((entry) =>
    entry.proof.status === 'failed'
  ).length;
  const staleEvidence = assessments.filter((entry) =>
    entry.assessment.status === 'stale'
  ).length;
  const openBlockers = findings.findings.filter((finding) =>
    finding.blocking && finding.status === 'open'
  ).length;
  const acceptedExceptions = findings.findings.filter((finding) =>
    finding.status === 'excepted'
  ).length;
  const integrityIssues = [
    ...(recovered.ok ? [] : recovered.reasons),
    ...(metadata.valid ? [] : ['mission metadata is absent or invalid']),
    ...(missionStartedCount === 1
      ? []
      : [`expected one mission.started event, found ${missionStartedCount}`]),
    ...(crossMissionEvents ? ['cross-mission event linkage was observed'] : []),
    ...(stream.continuity === 'partial'
      ? ['event stream continuity is partial']
      : []),
    ...(stream.duplicateEventIds > 0
      ? ['duplicate event IDs were observed']
      : []),
    ...(tamperedEvidence > 0 ? ['evidence integrity failed'] : []),
    ...(duplicateEvidence > 0 ? ['duplicate evidence IDs were observed'] : []),
    ...findings.issues
      .filter((issue) => issue.code !== 'non-waivable-exception')
      .map((issue) => `finding ledger issue: ${issue.code}`),
  ];
  const reasons = [
    ...integrityIssues,
    ...(openBlockers > 0 ? [`${openBlockers} blocker(s) remain open`] : []),
    ...(failedEvidence > 0
      ? [`${failedEvidence} fresh verification(s) failed`]
      : []),
    ...(staleEvidence > 0
      ? [`${staleEvidence} proof(s) are stale`]
      : []),
    ...(freshPassed.length === 0 ? ['no fresh successful proof'] : []),
    ...(acceptedExceptions > 0
      ? [`${acceptedExceptions} exception(s) accepted`]
      : []),
  ];
  let status: MissionVerdictStatus;
  if (openBlockers > 0 || failedEvidence > 0) {
    status = 'blocked';
  } else if (integrityIssues.length > 0) {
    status = 'degraded';
  } else if (freshPassed.length === 0) {
    status = 'unverified';
  } else if (acceptedExceptions > 0) {
    status = 'shipped-with-exception';
  } else {
    status = 'verified';
  }
  return {
    missionId: stream.events[0]?.missionId ?? 'mis_unknown',
    title: metadata.title,
    mode: metadata.mode,
    status,
    freshEvidence: freshPassed.length,
    staleEvidence,
    tamperedEvidence,
    failedEvidence,
    openBlockers,
    acceptedExceptions,
    reasons,
  };
}
