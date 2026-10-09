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

function opaqueContextHistory(contextId = '/root/proof1_qa'): readonly CanonicalEvent[] {
  const binding = { stage: 'pre-implementation', reviewRound: 1, inputHash: HASH, contractVersion: 1 };
  return [
    { ...entry(1, 'mission.started', { planHash: HASH, runtime: 'codex', runtimeAttested: true, mode: 'team' }), source: 'void-harness:mission' },
    { ...entry(2, 'specialist.requested', { ...binding, runtime: 'codex', planHash: HASH }),
      subject: SPECIALIST, source: 'void-harness:mission.dispatch' },
    { ...entry(3, 'specialist.started', { ...binding, contextId }), subject: SPECIALIST },
    { ...entry(4, 'specialist.completed', { ...binding, contextId, completion: {
      schemaVersion: 1, specialistId: SPECIALIST, contractVersion: 1, completionId: 'proof1_qa_completion',
      verdict: 'pass', findings: [], evidenceRequests: [], limitations: [],
    } }), subject: SPECIALIST },
    { ...entry(5, 'mission.closed', { reason: 'controller-stop' }), source: 'void-harness:mission.dispatch' },
  ];
}

function opaqueContextInput(events = opaqueContextHistory()) {
  const candidate = input([...events]);
  return { ...candidate, request: { ...candidate.request, closureEventId: id(5),
    disposition: { kind: 'controller-defect' as const, defect: 'opaque-native-context' as const } },
  observation: { ...candidate.observation, currentInputHashes: { [SPECIALIST]: HASH } } };
}

describe('recovery of the proven opaque context validator defect', () => {
  it('refuses a required specialist entirely absent from the dispatched panel', () => {
    const candidate = opaqueContextInput();
    expect(planStoppedMissionRecovery({ ...candidate, observation: { ...candidate.observation,
      contractVersions: { [SPECIALIST]: 1, 'core:security-engineer': 2 },
      currentInputHashes: { [SPECIALIST]: HASH, 'core:security-engineer': HASH },
    } })).toMatchObject({ kind: 'refused', code: 'incomplete-required-panel' });
  });

  it('preserves the complete four-specialist preparation with its exact required panel', () => {
    const specialists = [
      ['core:observability-sre-engineer', 1], ['core:product-challenger', 1],
      ['core:security-engineer', 2], ['core:test-qa-engineer', 2],
    ] as const;
    const original = opaqueContextHistory();
    const [start, requested, started, completed, closure] = original;
    if (!start || !requested || !started || !completed || !closure) throw new Error('Complete fixture required');
    const retarget = (event: CanonicalEvent, specialist: string, version: number): CanonicalEvent => {
      const payload = event.payload as Readonly<Record<string, JsonValue>>;
      return { ...event, subject: specialist, payload: { ...payload, contractVersion: version,
        ...(event.kind === 'specialist.requested' ? {} : { contextId: `/root/proof1_${specialist.slice(5)}` }),
        ...(event.kind !== 'specialist.completed' ? {} : { completion: {
          ...(payload['completion'] as Readonly<Record<string, JsonValue>>), specialistId: specialist,
          contractVersion: version, completionId: `proof1_${specialist.slice(5)}`,
        } }),
      } };
    };
    const events = [start, ...specialists.map(([id, version]) => retarget(requested, id, version)),
      ...specialists.flatMap(([id, version]) => [retarget(started, id, version), retarget(completed, id, version)]),
      closure].map((event, index) => ({ ...event, seq: index + 1, eventId: id(index + 1) }));
    const candidate = opaqueContextInput(events);
    expect(planStoppedMissionRecovery({ ...candidate,
      request: { ...candidate.request, closureEventId: id(14) }, observation: { ...candidate.observation,
        contractVersions: Object.fromEntries(specialists),
        currentInputHashes: Object.fromEntries(specialists.map(([id]) => [id, HASH])),
      },
    })).toMatchObject({ kind: 'recover', receipt: { nextAction: 'verification', consumedRounds: 1,
      preservedCompletionEventIds: [id(7), id(9), id(11), id(13)], invalidatedCompletionEventIds: [],
    } });
  });

  it('preserves original receipts and round budget and replays the exact admission', () => {
    const candidate = opaqueContextInput();
    const before = canonicalJsonHash(candidate.stream.events);
    const result = planStoppedMissionRecovery(candidate);
    expect(result).toMatchObject({ kind: 'recover', receipt: {
      preservedCompletionEventIds: [id(4)], invalidatedCompletionEventIds: [],
      inadmissibleCompletionEventIds: [], roundCorrections: [], consumedRounds: 1, remainingRounds: 1,
      nextAction: 'verification',
    } });
    expect(canonicalJsonHash(candidate.stream.events)).toBe(before);
    if (result.kind !== 'recover') throw new Error('Expected recovery of the validator defect');
    const recovered = parseEvent({ ...entry(6, 'mission.recovered'),
      source: 'void-harness:mission.recover', payload: result.receipt });
    if (!recovered.ok) throw new Error('Expected canonical recovery receipt');
    const events = [...candidate.stream.events, recovered.value];
    expect(validatedRecoveredReviewEvents(events)).toEqual({ ok: true, events });
    expect(planStoppedMissionRecovery({ ...candidate,
      stream: replayEventLog(events.map(serializeEvent).join('\n')) })).toMatchObject({ kind: 'already-recovered' });
  });

  it.each(['context_accepted_before', '', ' ', `/root/${String.fromCharCode(0)}bad`,
    `/root/${String.fromCharCode(159)}bad`, 'a'.repeat(161)])('refuses unproven or invalid context %j', contextId => {
    expect(planStoppedMissionRecovery(opaqueContextInput(opaqueContextHistory(contextId))))
      .toMatchObject({ kind: 'refused', code: 'unproven-controller-defect' });
  });

  it.each([
    ['missing start', 3, { kind: 'runtime.tool.started' }],
    ['wrong runtime', 3, { source: 'runtime:claude' }],
    ['wrong request source', 2, { source: 'runtime:codex' }],
    ['non-controller closure', 5, { source: 'void-harness:mission' }],
  ] as const)('refuses %s instead of approving absent provenance', (_label, seq, patch) => {
    const events = opaqueContextHistory().map(item => item.seq === seq ? { ...item, ...patch } : item);
    expect(planStoppedMissionRecovery(opaqueContextInput(events)))
      .toMatchObject({ kind: 'refused', code: 'unproven-controller-defect' });
  });

  it('refuses stale inputs and contract changes without invalidating old receipts', () => {
    const candidate = opaqueContextInput();
    for (const observation of [
      { ...candidate.observation, currentInputHashes: { [SPECIALIST]: `sha256:${'b'.repeat(64)}` } },
      { ...candidate.observation, contractVersions: { [SPECIALIST]: 2 } },
      { ...candidate.observation, stage: 'post-implementation' as const },
    ]) expect(planStoppedMissionRecovery({ ...candidate, observation }))
      .toMatchObject({ kind: 'refused', code: 'unproven-controller-defect' });
  });

  it.each([
    ['unmatched started identity', 3, { contextId: '/root/someone_else' }],
    ['unmatched started input', 3, { inputHash: `sha256:${'b'.repeat(64)}` }],
    ['unmatched request plan', 2, { planHash: `sha256:${'b'.repeat(64)}` }],
    ['unmatched request contract', 2, { contractVersion: 2 }],
    ['later review round', 4, { reviewRound: 2 }],
    ['unattested runtime', 1, { runtimeAttested: false }],
  ] as const)('refuses %s', (_label, seq, patch) => {
    const events = opaqueContextHistory().map(item => item.seq !== seq ? item : {
      ...item, payload: { ...(item.payload as Readonly<Record<string, JsonValue>>), ...patch },
    });
    expect(planStoppedMissionRecovery(opaqueContextInput(events))).toMatchObject({ kind: 'refused' });
  });

  it.each([
    { verdict: 'degraded', limitations: ['Missing evidence'] },
    { evidenceRequests: ['Run real conformance'] },
    { limitations: ['No real observation'] },
  ])('never upgrades unresolved evidence %j', patch => {
    const events = opaqueContextHistory().map(item => item.kind !== 'specialist.completed' ? item : {
      ...item, payload: { ...(item.payload as Readonly<Record<string, JsonValue>>), completion: {
        ...((item.payload as Readonly<Record<string, JsonValue>>)['completion'] as Readonly<Record<string, JsonValue>>), ...patch,
      } },
    });
    expect(planStoppedMissionRecovery(opaqueContextInput(events)))
      .toMatchObject({ kind: 'refused', code: 'unproven-controller-defect' });
  });

  it('refuses an incomplete or repeated preparation panel', () => {
    const history = opaqueContextHistory();
    const [, requested, started, completed, closure] = history;
    if (!requested || !started || !completed || !closure) throw new Error('Complete fixture required');
    for (const extra of [
      { ...requested, subject: 'core:security-engineer' },
      started,
      completed,
      { ...requested, kind: 'lead-writer.completed' },
    ]) {
      const events = [...history.slice(0, -1), extra, closure]
        .map((item, index) => ({ ...item, seq: index + 1, eventId: id(index + 1) }));
      const candidate = opaqueContextInput(events);
      expect(planStoppedMissionRecovery({ ...candidate,
        request: { ...candidate.request, closureEventId: id(events.length) } }))
        .toMatchObject({ kind: 'refused', code: 'unproven-controller-defect' });
    }
  });
});
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


function reclosedPreparation() {
  const closed = blockerHistory();
  const candidate = input(closed);
  const originalInput = { ...candidate,
    request: { ...candidate.request, closureEventId: id(3) },
    observation: { ...candidate.observation, currentInputHashes: { [SPECIALIST]: HASH } },
  };
  const first = planStoppedMissionRecovery(originalInput);
  if (first.kind !== 'recover') throw new Error('Expected initial recovery');
  const reopened = [...closed, recoveryEvent(closed, first.receipt)];
  const events = [...reopened, { ...entry(5, 'mission.closed', {
    reason: 'controller-stop', episodeId: id(4),
  }), source: 'void-harness:mission.dispatch' }];
  return { ...originalInput,
    stream: replayEventLog(events.map(serializeEvent).join('\n')),
    request: { ...originalInput.request, closureEventId: id(5),
      expectedJournalHash: canonicalJsonHash(events) },
  };
}

it('recovers preparation reclosed on pending proof without demanding an impossible writer completion', () => {
  const secondInput = reclosedPreparation();
  const events = secondInput.stream.events;
  const before = canonicalJsonHash(events);
  const second = planStoppedMissionRecovery(secondInput);
  expect(second).toMatchObject({ kind: 'recover', receipt: {
    consumedRounds: 1, remainingRounds: 1, nextAction: 'clarification',
    preservedCompletionEventIds: [id(2)], invalidatedCompletionEventIds: [],
  } });
  expect(canonicalJsonHash(events)).toBe(before);
  if (second.kind !== 'recover') throw new Error('Expected pending-proof recovery');
  const recovered = [...events, recoveryEvent(events, second.receipt)];
  expect(validatedRecoveredReviewEvents(recovered).ok).toBe(true);
  expect(planStoppedMissionRecovery({ ...secondInput,
    stream: replayEventLog(recovered.map(serializeEvent).join('\n')),
  })).toMatchObject({ kind: 'already-recovered' });
});


it.each(['abandoned', 'interrupted'])('preserves explicit human closure after clarification: %s', reason => {
  const candidate = reclosedPreparation();
  const events = candidate.stream.events.map(item => item.seq === 5
    ? { ...item, payload: { reason, episodeId: id(4) } } : item);
  expect(planStoppedMissionRecovery({ ...candidate,
    stream: replayEventLog(events.map(serializeEvent).join('\n')),
    request: { ...candidate.request, expectedJournalHash: canonicalJsonHash(events) },
  })).toMatchObject({ kind: 'refused', code: 'unsupported-closure' });
});

it.each(['human.decision', 'runtime.unknown'])('requires reconciliation for intervening %s', kind => {
  const candidate = reclosedPreparation();
  const events = [...candidate.stream.events.slice(0, 4), entry(5, kind),
    { ...entry(6, 'mission.closed', { reason: 'controller-stop', episodeId: id(4) }),
      source: 'void-harness:mission.dispatch' }];
  expect(planStoppedMissionRecovery({ ...candidate,
    stream: replayEventLog(events.map(serializeEvent).join('\n')),
    request: { ...candidate.request, closureEventId: id(6), expectedJournalHash: canonicalJsonHash(events) },
  })).toMatchObject({ kind: 'refused', code: 'no-recovery-progress' });
});

it('retains the real review budget when recovering a premature evidence closure', () => {
  const candidate = reclosedPreparation();
  expect(planStoppedMissionRecovery({ ...candidate,
    observation: { ...candidate.observation, maxRounds: 1 },
  })).toMatchObject({ kind: 'refused', code: 'review-budget-exhausted' });
});

it('refuses manual controller-stop as proof of the legacy dispatch defect', () => {
  const candidate = reclosedPreparation();
  const events = candidate.stream.events.map(item => item.seq === 5
    ? { ...item, source: 'void-harness:mission.close' } : item);
  expect(planStoppedMissionRecovery({ ...candidate,
    stream: replayEventLog(events.map(serializeEvent).join('\n')),
    request: { ...candidate.request, expectedJournalHash: canonicalJsonHash(events) },
  })).toMatchObject({ kind: 'refused', code: 'no-recovery-progress' });
});


it('refuses a third clarification recovery without progress after consuming the one-time exception', () => {
  const secondInput = reclosedPreparation();
  const second = planStoppedMissionRecovery(secondInput);
  if (second.kind !== 'recover') throw new Error('Expected the first exceptional recovery');
  const recovered = [...secondInput.stream.events,
    recoveryEvent(secondInput.stream.events, second.receipt)];
  const events = [...recovered, { ...entry(7, 'mission.closed', {
    reason: 'controller-stop', episodeId: id(6),
  }), source: 'void-harness:mission.dispatch' }];
  const before = canonicalJsonHash(events);
  const thirdInput = { ...secondInput,
    stream: replayEventLog(events.map(serializeEvent).join('\n')),
    request: { ...secondInput.request, closureEventId: id(7), expectedJournalHash: before },
  };
  expect(validatedRecoveredReviewEvents(events).ok).toBe(true);
  expect(planStoppedMissionRecovery(thirdInput))
    .toMatchObject({ kind: 'refused', code: 'no-recovery-progress' });
  expect(canonicalJsonHash(events)).toBe(before);
});
