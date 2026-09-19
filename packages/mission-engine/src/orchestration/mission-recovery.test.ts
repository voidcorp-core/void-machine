import { describe, expect, it } from 'vitest';
import { parseEvent, replayEventLog, serializeEvent } from '../events/index.js';
import type { CanonicalEvent, JsonValue } from '../events/types.js';
import { sealEvidence } from '../evidence/schema.js';
import { evidenceDraft } from '../test/evidence.js';
import { canonicalJsonHash } from '../evidence/canonical-json.js';
import { event } from '../test/events.js';
import { planStoppedMissionRecovery, validatedRecoveredReviewEvents, type MissionRecoveryRequest } from './mission-recovery.js';

const id = (seq: number) => `evt_00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
const HASH = `sha256:${'a'.repeat(64)}`;
const SPECIALIST = 'core:test-qa-engineer';
function entry(seq: number, kind: string, payload: JsonValue = {}): CanonicalEvent {
  return event({ seq, eventId: id(seq), kind, subject: 'mission', payload });
}
function history(reason = 'controller-stop') {
  return [entry(1, 'mission.started'), entry(2, 'mission.closed', { reason })];
}
function request(events: readonly CanonicalEvent[]): MissionRecoveryRequest {
  return {
    schemaVersion: 1, closureEventId: id(2), expectedJournalHash: canonicalJsonHash(events),
    disposition: { kind: 'review-blocker', completionEventIds: [id(2)],
      resolutionArtifact: { path: 'docs/clarification.md', sha256: HASH } },
  };
}
function input(events = history()) {
  return {
    stream: replayEventLog(events.map(serializeEvent).join('\n')),
    request: request(events),
    observation: {
      resolutionArtifact: { path: 'docs/clarification.md', sha256: HASH },
      stage: 'pre-implementation' as const, contractVersions: { [SPECIALIST]: 1 },
      currentInputHashes: {}, maxRounds: 2, expectedSource: 'runtime:codex' as const,
    },
  };
}

describe('explicit stopped mission recovery', () => {
  it.each(['completed', 'abandoned', 'interrupted'])('refuses %s rather than resetting history', (reason) => {
    expect(planStoppedMissionRecovery(input(history(reason)))).toMatchObject({ kind: 'refused' });
  });
  it('refuses a stale journal hash before authorizing any continuation', () => {
    const candidate = input();
    expect(planStoppedMissionRecovery({ ...candidate,
      request: { ...candidate.request, expectedJournalHash: HASH },
    })).toMatchObject({ kind: 'refused', code: 'stale-journal' });
  });
  it('refuses absent completion evidence even if an operator supplied a resolution artifact', () => {
    expect(planStoppedMissionRecovery(input())).toMatchObject({ kind: 'refused', code: 'missing-review-blocker' });
  });
  it('refuses claiming a controller defect without journal proof', () => {
    const candidate = input();
    expect(planStoppedMissionRecovery({ ...candidate,
      request: { ...candidate.request, disposition: { kind: 'controller-defect', defect: 'partial-fanout-round' } },
    })).toMatchObject({ kind: 'refused', code: 'unproven-controller-defect' });
  });
  it('refuses ambiguous external effects instead of replaying them', () => {
    const events = [entry(1, 'mission.started'),
      { ...entry(2, 'orchestration.node-defined', { tier: 'critical', inputHash: HASH,
        independenceEssential: true, sideEffectKey: 'effect:publish' }), subject: 'publish' },
      { ...entry(3, 'orchestration.node-started', { attempt: 'initial' }), subject: 'publish' },
      entry(4, 'mission.closed', { reason: 'controller-stop' })];
    const candidate = input(events);
    expect(planStoppedMissionRecovery({ ...candidate,
      request: { ...candidate.request, closureEventId: id(4) },
    })).toMatchObject({ kind: 'refused', code: 'ambiguous-effect' });
  });
});

function blockerHistory() {
  return [entry(1, 'mission.started'),
    { ...entry(2, 'specialist.completed', {
      stage: 'pre-implementation', reviewRound: 1, inputHash: HASH, contextId: 'context-review-1',
      completion: { schemaVersion: 1, specialistId: SPECIALIST, contractVersion: 1,
        completionId: 'completion-review-1', verdict: 'degraded', findings: [],
        evidenceRequests: ['Clarify supported provider capability before implementation'],
        limitations: ['Provider capability is not established'],
      },
    }), subject: SPECIALIST }, entry(3, 'mission.closed', { reason: 'controller-stop' })];
}

it('reopens a proven blocker for clarification without approving the review or discarding history', () => {
  const events = blockerHistory();
  const candidate = input(events);
  const result = planStoppedMissionRecovery({ ...candidate,
    request: { ...candidate.request, closureEventId: id(3) },
    observation: { ...candidate.observation, currentInputHashes: { [SPECIALIST]: HASH } },
  });
  expect(result).toMatchObject({ kind: 'recover', receipt: {
    closureEventId: id(3), previousEpisodeId: id(1), priorJournalHash: canonicalJsonHash(events),
    priorJournalLastSeq: 3, preservedCompletionEventIds: [id(2)], invalidatedCompletionEventIds: [],
    consumedRounds: 1, remainingRounds: 1, nextAction: 'clarification',
  } });
  expect(events[1]?.payload).toMatchObject({ completion: { verdict: 'degraded' } });
});

it('does not treat a PASS without any outstanding request as a review blocker', () => {
  const events = blockerHistory();
  const candidate = input(events.map(item => item.kind === 'specialist.completed' ? {
    ...item, payload: { stage: 'pre-implementation', reviewRound: 1, inputHash: HASH,
      contextId: 'context-review-1', completion: { schemaVersion: 1, specialistId: SPECIALIST,
        contractVersion: 1, completionId: 'completion-review-1', verdict: 'pass', findings: [],
        evidenceRequests: [], limitations: [] } },
  } : item));
  expect(planStoppedMissionRecovery({ ...candidate,
    request: { ...candidate.request, closureEventId: id(3) },
  })).toMatchObject({ kind: 'refused', code: 'missing-review-blocker' });
});

it('refuses a changed resolution artifact instead of trusting the request digest', () => {
  const events = blockerHistory();
  const candidate = input(events);
  expect(planStoppedMissionRecovery({ ...candidate,
    request: { ...candidate.request, closureEventId: id(3) },
    observation: { ...candidate.observation, resolutionArtifact: { path: 'docs/clarification.md', sha256: `sha256:${'b'.repeat(64)}` } },
  })).toMatchObject({ kind: 'refused', code: 'stale-resolution-artifact' });
});

function partialFanoutHistory(): readonly CanonicalEvent[] {
  const peer = 'core:security-engineer';
  const requested = (seq: number, subject: string, reviewRound: number) => ({
    ...entry(seq, 'specialist.requested', { stage: 'pre-implementation', reviewRound,
      inputHash: HASH, contractVersion: 1, runtime: 'codex', planHash: HASH }),
    subject, source: 'void-harness:mission.dispatch',
  });
  const completed = (seq: number, subject: string, reviewRound: number) => ({
    ...entry(seq, 'specialist.completed', { stage: 'pre-implementation', reviewRound,
      inputHash: HASH, contextId: `context-completion-${seq}`,
      completion: { schemaVersion: 1, specialistId: subject, contractVersion: 1,
        completionId: `completion-${seq}`, verdict: 'pass', findings: [], evidenceRequests: [], limitations: [] },
    }), subject,
  });
  return [entry(1, 'mission.started'), requested(2, SPECIALIST, 1), requested(3, peer, 1),
    completed(4, SPECIALIST, 1), requested(5, peer, 2), completed(6, peer, 2),
    entry(7, 'mission.closed', { reason: 'controller-stop' })];
}
function fanoutInput(events = partialFanoutHistory()) {
  const candidate = input([...events]);
  return { ...candidate,
    request: { ...candidate.request, closureEventId: id(events.length),
      disposition: { kind: 'controller-defect' as const, defect: 'partial-fanout-round' as const } },
    observation: { ...candidate.observation,
      contractVersions: { [SPECIALIST]: 1, 'core:security-engineer': 1 },
      currentInputHashes: { [SPECIALIST]: HASH, 'core:security-engineer': HASH },
    },
  };
}
it('repairs only the false partial fanout charge while retaining original events and bounded budget', () => {
  const candidate = fanoutInput();
  expect(planStoppedMissionRecovery(candidate)).toMatchObject({ kind: 'recover', receipt: {
    consumedRounds: 1, remainingRounds: 1, nextAction: 'correction',
    preservedCompletionEventIds: [id(4), id(6)], invalidatedCompletionEventIds: [],
    roundCorrections: [{ eventId: id(6), fromRound: 2, toRound: 1 }],
  } });
  expect(candidate.stream.events[5]?.payload).toMatchObject({ reviewRound: 2 });
});

it('does not forgive a real failed attempt as partial fanout', () => {
  const history = partialFanoutHistory();
  const changed = history.map(item => item.seq === 3
    ? { ...item, kind: 'specialist.failed', source: 'runtime:codex' } : item);
  expect(planStoppedMissionRecovery(fanoutInput(changed)))
    .toMatchObject({ kind: 'refused', code: 'unproven-controller-defect' });
});

it('does not remap a peer that already ran before redispatch', () => {
  const history = partialFanoutHistory();
  const changed = history.map(item => item.seq === 3
    ? { ...item, kind: 'specialist.started', source: 'runtime:codex' } : item);
  expect(planStoppedMissionRecovery(fanoutInput(changed)))
    .toMatchObject({ kind: 'refused', code: 'unproven-controller-defect' });
});

it('invalidates stale review evidence rather than reusing it after recovery', () => {
  const candidate = fanoutInput();
  expect(planStoppedMissionRecovery({ ...candidate,
    observation: { ...candidate.observation,
      currentInputHashes: { [SPECIALIST]: HASH, 'core:security-engineer': `sha256:${'b'.repeat(64)}` },
    },
  })).toMatchObject({ kind: 'recover', receipt: {
    preservedCompletionEventIds: [id(4)], invalidatedCompletionEventIds: [id(6)], nextAction: 'correction',
  } });
});

it('refuses a true exhausted review budget rather than resetting it', () => {
  const candidate = fanoutInput();
  expect(planStoppedMissionRecovery({ ...candidate,
    observation: { ...candidate.observation, maxRounds: 1 },
  })).toMatchObject({ kind: 'refused', code: 'review-budget-exhausted' });
});

it('requires every current input hash used by the applicable review plan', () => {
  const candidate = fanoutInput();
  expect(planStoppedMissionRecovery({ ...candidate,
    observation: { ...candidate.observation, currentInputHashes: {} },
  })).toMatchObject({ kind: 'refused', code: 'inconsistent-review' });
});

it('does not reuse a role completion when its current contract differs', () => {
  const candidate = fanoutInput();
  expect(planStoppedMissionRecovery({ ...candidate,
    observation: { ...candidate.observation, contractVersions: { [SPECIALIST]: 2, 'core:security-engineer': 1 } },
  })).toMatchObject({ kind: 'refused', code: 'inconsistent-review' });
});

function recoveryEvent(events: readonly CanonicalEvent[], receipt: unknown): CanonicalEvent {
  const payload: JsonValue = JSON.parse(JSON.stringify(receipt));
  return { ...entry(events.length + 1, 'mission.recovered', payload), source: 'void-harness:mission.recover' };
}

it('returns the existing receipt on an identical replay, without another episode or reset', () => {
  const candidate = fanoutInput();
  const original = planStoppedMissionRecovery(candidate);
  expect(original.kind).toBe('recover');
  if (original.kind !== 'recover') return;
  const events = [...candidate.stream.events, recoveryEvent(candidate.stream.events, original.receipt)];
  expect(planStoppedMissionRecovery({ ...candidate,
    stream: replayEventLog(events.map(serializeEvent).join('\n')),
  })).toEqual({ kind: 'already-recovered', receipt: original.receipt, recoveryEventId: id(8) });
});

it('refuses a conflicting second recovery request for the same closure', () => {
  const candidate = fanoutInput();
  const original = planStoppedMissionRecovery(candidate);
  expect(original.kind).toBe('recover');
  if (original.kind !== 'recover') return;
  const events = [...candidate.stream.events, recoveryEvent(candidate.stream.events, original.receipt)];
  expect(planStoppedMissionRecovery({ ...candidate,
    stream: replayEventLog(events.map(serializeEvent).join('\n')),
    request: { ...candidate.request, disposition: { kind: 'controller-defect', defect: 'stale-input-dispatch' } },
  })).toMatchObject({ kind: 'refused', code: 'conflicting-recovery' });
});

it('refuses a forged historical recovery receipt even when closure identity matches', () => {
  const candidate = fanoutInput();
  const original = planStoppedMissionRecovery(candidate);
  expect(original.kind).toBe('recover');
  if (original.kind !== 'recover') return;
  const events = [...candidate.stream.events,
    recoveryEvent(candidate.stream.events, { ...original.receipt, consumedRounds: 0, remainingRounds: 2 })];
  expect(planStoppedMissionRecovery({ ...candidate,
    stream: replayEventLog(events.map(serializeEvent).join('\n')),
  })).toMatchObject({ kind: 'refused', code: 'invalid-recovery-receipt' });
});

it('requires renewed observation when identical replay has stale current inputs', () => {
  const candidate = fanoutInput();
  const original = planStoppedMissionRecovery(candidate);
  expect(original.kind).toBe('recover');
  if (original.kind !== 'recover') return;
  const events = [...candidate.stream.events, recoveryEvent(candidate.stream.events, original.receipt)];
  expect(planStoppedMissionRecovery({ ...candidate,
    stream: replayEventLog(events.map(serializeEvent).join('\n')),
    observation: { ...candidate.observation, currentInputHashes: { [SPECIALIST]: `sha256:${'c'.repeat(64)}` } },
  })).toMatchObject({ kind: 'refused', code: 'stale-recovery-observation' });
});


it('refuses an outstanding writer request whose effects have not been reconciled', () => {
  const events = [entry(1, 'mission.started'), entry(2, 'lead-writer.requested', {
    writerId: 'writer:primary', actionKind: 'run-correction', implementationRound: 1, planHash: HASH,
  }), entry(3, 'mission.closed', { reason: 'controller-stop' })];
  const candidate = input(events);
  expect(planStoppedMissionRecovery({ ...candidate,
    request: { ...candidate.request, closureEventId: id(3) },
  })).toMatchObject({ kind: 'refused', code: 'ambiguous-effect' });
});

function staleDispatchInput() {
  const changedHash = `sha256:${'b'.repeat(64)}`;
  const requestEvent = (seq: number, round: number, inputHash: string) => ({
    ...entry(seq, 'specialist.requested', { stage: 'post-implementation', reviewRound: round,
      inputHash, contractVersion: 1, runtime: 'codex', planHash: HASH }),
    subject: SPECIALIST, source: 'void-harness:mission.dispatch',
  });
  const completionEvent = (seq: number, round: number, inputHash: string) => ({
    ...entry(seq, 'specialist.completed', { stage: 'post-implementation', reviewRound: round,
      inputHash, contextId: `context-completion-${seq}`, completion: { schemaVersion: 1,
        specialistId: SPECIALIST, contractVersion: 1, completionId: `completion-${seq}`,
        verdict: 'pass', findings: [], evidenceRequests: [], limitations: [] },
    }), subject: SPECIALIST,
  });
  const events = [entry(1, 'mission.started'), entry(2, 'lead-writer.completed', { actionKind: 'run-lead-writer' }),
    requestEvent(3, 1, HASH), completionEvent(4, 1, HASH),
    requestEvent(5, 2, changedHash), completionEvent(6, 2, changedHash),
    entry(7, 'mission.closed', { reason: 'controller-stop' })];
  const candidate = input(events);
  return { ...candidate, request: { ...candidate.request, closureEventId: id(7),
    disposition: { kind: 'controller-defect' as const, defect: 'stale-input-dispatch' as const } },
    observation: { ...candidate.observation, stage: 'post-implementation' as const,
      currentInputHashes: { [SPECIALIST]: changedHash } },
  };
}

it('invalidates an envelope issued across changed inputs without a writer boundary and requests correction', () => {
  const candidate = staleDispatchInput();
  expect(planStoppedMissionRecovery(candidate)).toMatchObject({ kind: 'recover', receipt: {
    consumedRounds: 1, remainingRounds: 1, nextAction: 'correction', roundCorrections: [],
    preservedCompletionEventIds: [], invalidatedCompletionEventIds: [id(4), id(6)],
  } });
  expect(candidate.stream.events[5]?.kind).toBe('specialist.completed');
});

it('never reclassifies a changed envelope as valid fresh evidence', () => {
  const candidate = staleDispatchInput();
  const original = planStoppedMissionRecovery(candidate);
  expect(original.kind).toBe('recover');
  if (original.kind !== 'recover') return;
  const events = [...candidate.stream.events, recoveryEvent(candidate.stream.events, original.receipt)];
  const projected = validatedRecoveredReviewEvents(events);
  expect(projected.ok).toBe(true);
  if (!projected.ok) return;
  expect(projected.events.some(item => item.eventId === id(6))).toBe(false);
  expect(projected.events.find(item => item.eventId === id(4))?.payload).toMatchObject({ inputHash: HASH });
  expect(events.some(item => item.eventId === id(6) && item.kind === 'specialist.completed')).toBe(true);
});

it('projects only proved correction and keeps the historical request and completion binding consistent', () => {
  const candidate = fanoutInput();
  const original = planStoppedMissionRecovery(candidate);
  expect(original.kind).toBe('recover');
  if (original.kind !== 'recover') return;
  const events = [...candidate.stream.events, recoveryEvent(candidate.stream.events, original.receipt)];
  const result = validatedRecoveredReviewEvents(events);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.events.find(item => item.eventId === id(5))?.payload).toMatchObject({ reviewRound: 1 });
  expect(result.events.find(item => item.eventId === id(6))?.payload).toMatchObject({ reviewRound: 1 });
  expect(events[4]?.payload).toMatchObject({ reviewRound: 2 });
});

it('rejects forged recovery projections rather than teaching the controller to trust payload mappings', () => {
  const candidate = fanoutInput();
  const original = planStoppedMissionRecovery(candidate);
  expect(original.kind).toBe('recover');
  if (original.kind !== 'recover') return;
  const events = [...candidate.stream.events, recoveryEvent(candidate.stream.events, {
    ...original.receipt, roundCorrections: [{ eventId: id(4), fromRound: 1, toRound: 0 }],
  })];
  expect(validatedRecoveredReviewEvents(events)).toMatchObject({ ok: false });
});

it('does not allow a second recovery episode without any intervening corrective progress', () => {
  const candidate = fanoutInput();
  const original = planStoppedMissionRecovery(candidate);
  expect(original.kind).toBe('recover');
  if (original.kind !== 'recover') return;
  const events = [...candidate.stream.events, recoveryEvent(candidate.stream.events, original.receipt),
    entry(9, 'mission.closed', { reason: 'controller-stop', episodeId: id(8) })];
  expect(planStoppedMissionRecovery({ ...candidate,
    stream: replayEventLog(events.map(serializeEvent).join('\n')),
    request: { ...candidate.request, closureEventId: id(9), expectedJournalHash: canonicalJsonHash(events) },
  })).toMatchObject({ kind: 'refused', code: 'no-recovery-progress' });
});

it('refuses an otherwise valid replay receipt attached to another mission journal', () => {
  const candidate = fanoutInput();
  const original = planStoppedMissionRecovery(candidate);
  expect(original.kind).toBe('recover');
  if (original.kind !== 'recover') return;
  const receipt = recoveryEvent(candidate.stream.events, original.receipt);
  const events = [...candidate.stream.events, { ...receipt,
    missionId: 'mis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    correlationId: 'mis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  }];
  expect(planStoppedMissionRecovery({ ...candidate,
    stream: replayEventLog(events.map(serializeEvent).join('\n')),
  })).toMatchObject({ kind: 'refused', code: 'invalid-journal' });
  expect(validatedRecoveredReviewEvents(events)).toMatchObject({ ok: false });
});

function preparationObligationAtPost(due: string, disposition = 'pending') {
  const text = 'Provide the implemented invariant matrix and its actual verification result.';
  const completion = { schemaVersion: 1, specialistId: SPECIALIST, contractVersion: 1,
    completionId: 'completion-preparation-proof', verdict: 'pass', findings: [],
    evidenceRequests: disposition === 'no-request' ? [] : [text], limitations: [] };
  const binding = { completionEventId: id(2), completionHash: canonicalJsonHash(completion),
    specialistId: SPECIALIST, nativeContextId: 'context-classify-pre-proof', requestId: id(3) };
  const events = [entry(1, 'mission.started'), { ...entry(2, 'specialist.completed', {
    stage: 'pre-implementation', reviewRound: 2, inputHash: HASH, contextId: 'context-original-pre-proof', completion,
  }), subject: SPECIALIST }, { ...entry(3, 'specialist.evidence-classification-requested', binding),
    source: 'void-harness:mission.dispatch', subject: SPECIALIST },
  { ...entry(4, 'specialist.evidence-classified', { ...binding, items: [{ requestIndex: 0,
    requestText: text, requestTextHash: canonicalJsonHash(text), due, reason: 'Required at the declared implementation phase.' }] }),
    subject: SPECIALIST, causationId: id(3), source: disposition === 'unauthorized' ? 'writer:primary' : 'runtime:codex' }];
  if (disposition === 'no-request') events.splice(2);
  if (disposition === 'discharged') {
    const proof = sealEvidence(evidenceDraft({ dependencies: [{ kind: 'diff', key: 'git:working-tree', hash: HASH }] }));
    const obligationId = canonicalJsonHash({ completionEventId: id(2), completionId: completion.completionId,
      requestIndex: 0, requestTextHash: canonicalJsonHash(text) });
    events.push({ ...entry(5, 'evidence.recorded', { evidence: { ...proof, environment: { ...proof.environment },
      output: { ...proof.output }, dependencies: proof.dependencies.map(value => ({ ...value })) } }), subject: proof.evidenceId },
      { ...entry(6, 'specialist.evidence-discharge-requested', { ...binding, requestId: id(6),
        nativeContextId: 'context-discharge-pre-proof', obligationIds: [obligationId] }),
        source: 'void-harness:mission.dispatch', subject: SPECIALIST },
      { ...entry(7, 'specialist.evidence-discharged', { ...binding, requestId: id(6),
        nativeContextId: 'context-discharge-pre-proof', items: [{ obligationId, proofEventIds: [id(5)],
          reason: 'Actual canonical verification satisfies the original request.' }] }),
        subject: SPECIALIST, causationId: id(6) });
  }
  events.push({ ...entry(events.length + 1, 'lead-writer.completed', {
    actionKind: 'run-lead-writer', implementationRound: 2, writerId: 'writer:primary' }), subject: 'writer:primary' });
  const closureSeq = events.length + 1;
  events.push(entry(closureSeq, 'mission.closed', { reason: 'controller-stop' }));
  const candidate = input(events);
  return { ...candidate, request: { ...candidate.request, closureEventId: id(closureSeq) },
    observation: { ...candidate.observation, stage: 'post-implementation' as const,
      currentInputHashes: { [SPECIALIST]: HASH }, evidenceDependencies: { 'git:working-tree': HASH } } };
}

it.each(['current-review', 'post-implementation'])('recovers for a preparation obligation currently due at post stage: %s', due => {
  const candidate = preparationObligationAtPost(due);
  const before = canonicalJsonHash(candidate.stream.events);
  const result = planStoppedMissionRecovery(candidate);
  expect(result).toMatchObject({ kind: 'recover', receipt: { consumedRounds: 0, remainingRounds: 2,
    nextAction: 'clarification', preservedCompletionEventIds: [], invalidatedCompletionEventIds: [] } });
  expect(canonicalJsonHash(candidate.stream.events)).toBe(before);
  if (result.kind !== 'recover') throw new Error('Expected clarification admission');
  const recorded = parseEvent({ ...entry(candidate.stream.events.length + 1, 'mission.recovered'),
    source: 'void-harness:mission.recover', payload: result.receipt });
  if (!recorded.ok) throw new Error('Expected canonical recovery receipt');
  expect(validatedRecoveredReviewEvents([...candidate.stream.events, recorded.value]).ok).toBe(true);
});

it.each(['completion', 'no-request', 'unauthorized', 'discharged'])('refuses an ineligible preparation obligation at post stage: %s', cause => {
  const candidate = preparationObligationAtPost(cause === 'completion' ? 'completion' : 'post-implementation', cause);
  expect(planStoppedMissionRecovery(candidate).kind).toBe('refused');
});
