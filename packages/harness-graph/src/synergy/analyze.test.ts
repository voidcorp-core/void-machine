import { describe, expect, it } from 'vitest';
import type { ActivationEvent } from '../behavior/types.js';
import type { GraphModel, GraphNode } from '../model/types.js';
import type { OutcomeEvent } from '../outcome/types.js';
import { analyzeSynergy } from './analyze.js';
import type { SpecialistLifecycleEvent } from './lifecycle.js';

function node(id: string, staticTokens = 600): GraphNode {
  const separator = id.indexOf(':');
  return {
    id,
    type: id.slice(0, separator) as GraphNode['type'],
    name: id.slice(separator + 1),
    description: '',
    lines: 1,
    staticTokens,
    pack: null,
    source: 'fixture',
  };
}

function event(
  session: number,
  kind: ActivationEvent['kind'] = 'tool',
  name = 'Edit',
): ActivationEvent {
  return {
    ts: '2026-08-21T00:00:00Z',
    kind,
    name,
    sessionId: `mis_human_${String(session).padStart(8, '0')}`,
    trigger: { tool: kind === 'tool' ? name : '', fileGlobs: [], ext: [] },
  };
}

const sessions = (count: number): ActivationEvent[] =>
  Array.from({ length: count }, (_, index) => event(index));

describe('analyzeSynergy', () => {
  it('repairs telemetry before judging an unobserved installed agent family', () => {
    const model: GraphModel = {
      version: 1,
      nodes: [node('agent:security-engineer'), node('agent:test-qa-engineer')],
      edges: [],
    };

    const report = analyzeSynergy(model, sessions(25), [], {
      minSessions: 3,
      minEvents: 20,
      retirementMinSessions: 20,
    });

    expect(report.proposals).toEqual([
      expect.objectContaining({
        kind: 'repair-telemetry',
        component: 'agent:*',
      }),
    ]);
  });

  it('proposes a retirement review only after a strong human window', () => {
    const model: GraphModel = {
      version: 1,
      nodes: [node('agent:security-engineer'), node('agent:test-qa-engineer')],
      edges: [{
        from: 'skill:void-implement',
        to: 'agent:test-qa-engineer',
        kind: 'composes',
        origin: 'declared',
        evidence: 'fixture',
      }],
    };
    const activations = [
      ...sessions(25),
      ...Array.from({ length: 25 }, (_, index) => event(index, 'agent', 'test-qa-engineer')),
    ];

    const report = analyzeSynergy(model, activations, [], {
      minSessions: 3,
      minEvents: 20,
      retirementMinSessions: 20,
    });

    expect(report.proposals).toContainEqual(expect.objectContaining({
      kind: 'retirement-review',
      component: 'agent:security-engineer',
    }));
    expect(report.proposals).not.toContainEqual(expect.objectContaining({
      kind: 'repair-telemetry',
    }));
  });

  it('does not treat tool-only sessions as evidence of agent non-use', () => {
    const model: GraphModel = {
      version: 1,
      nodes: [node('agent:security-engineer'), node('agent:test-qa-engineer')],
      edges: [],
    };
    const report = analyzeSynergy(model, [...sessions(25), event(0, 'agent', 'test-qa-engineer')], [], {
      minSessions: 3, minEvents: 20, retirementMinSessions: 20,
    });
    expect(report.proposals).not.toContainEqual(expect.objectContaining({ kind: 'retirement-review' }));
  });

  it('proposes tuning for a costly component with little observed use', () => {
    const model: GraphModel = {
      version: 1,
      nodes: [node('skill:void-large-review', 2_500), node('skill:void-neighbor')],
      edges: [{
        from: 'skill:void-large-review',
        to: 'skill:void-neighbor',
        kind: 'composes',
        origin: 'declared',
        evidence: 'fixture',
      }],
    };
    const activations = [...sessions(4), event(0, 'skill', 'void-large-review')];

    const report = analyzeSynergy(model, activations, [], {
      minSessions: 3,
      minEvents: 1,
      retirementMinSessions: 20,
    });

    expect(report.proposals).toContainEqual(expect.objectContaining({
      kind: 'tune-or-fuse',
      component: 'skill:void-large-review',
    }));
    expect(report.proposals).not.toContainEqual(expect.objectContaining({
      kind: 'retirement-review',
      component: 'skill:void-large-review',
    }));
  });

  it('proposes repair when a spawned agent completes with an error', () => {
    const model: GraphModel = {
      version: 1,
      nodes: [node('agent:security-engineer')],
      edges: [],
    };
    const activations = [...sessions(4), event(0, 'agent', 'security-engineer')];
    const outcomes: OutcomeEvent[] = [{
      event: 'PostToolUse',
      ts: '2026-08-21T00:00:01Z',
      kind: 'agent',
      name: 'security-engineer',
      status: 'error',
      sessionId: 'mis_human_00000000',
    }];

    const report = analyzeSynergy(model, activations, outcomes, {
      minSessions: 3,
      minEvents: 1,
      retirementMinSessions: 20,
    });

    expect(report.proposals).toContainEqual(expect.objectContaining({
      kind: 'repair',
      component: 'agent:security-engineer',
    }));
  });

  it('repairs a declared skill trigger that matched but never fired', () => {
    const triggered = { ...node('skill:void-triggered'), triggers: { tools: ['Edit'] } };
    const model: GraphModel = { version: 1, nodes: [triggered], edges: [] };

    const report = analyzeSynergy(model, sessions(3), [], {
      minSessions: 3,
      minEvents: 1,
      retirementMinSessions: 20,
    });

    expect(report.proposals).toContainEqual(expect.objectContaining({
      kind: 'repair',
      component: 'skill:void-triggered',
      evidence: expect.stringContaining('trigger matched'),
    }));
  });

  it('suppresses trigger conclusions while the whole skill family has a telemetry gap', () => {
    const first = { ...node('skill:void-first'), triggers: { tools: ['Edit'] } };
    const second = node('skill:void-second');
    const model: GraphModel = { version: 1, nodes: [first, second], edges: [] };

    const report = analyzeSynergy(model, sessions(3), [], {
      minSessions: 3,
      minEvents: 1,
      retirementMinSessions: 20,
    });

    expect(report.proposals).toContainEqual(expect.objectContaining({
      kind: 'repair-telemetry',
      component: 'skill:*',
    }));
    expect(report.proposals).not.toContainEqual(expect.objectContaining({
      kind: 'repair',
      component: 'skill:void-first',
    }));
  });

  it('returns observation only when the human evidence window is too small', () => {
    const model: GraphModel = {
      version: 1,
      nodes: [node('agent:security-engineer')],
      edges: [],
    };

    const report = analyzeSynergy(model, sessions(2), [], {
      minSessions: 3,
      minEvents: 20,
      retirementMinSessions: 20,
    });

    expect(report.sufficient).toBe(false);
    expect(report.proposals).toEqual([]);
  });

  it('does not turn an incomplete lifecycle into a proposal below the evidence window', () => {
    const model: GraphModel = {
      version: 1,
      nodes: [node('agent:security-engineer')],
      edges: [],
    };
    const lifecycle: SpecialistLifecycleEvent[] = [{
      seq: 1,
      sessionId: 'mis_human_00000000',
      runtime: 'codex',
      specialistId: 'core:security-engineer',
      name: 'security-engineer',
      contractVersion: 1,
      stage: 'pre-implementation',
      reviewRound: 1,
      inputHash: `sha256:${'a'.repeat(64)}`,
      missionClosed: false,
      status: 'requested',
    }];
    const outcomes: OutcomeEvent[] = [{
      event: 'Stop',
      ts: '2026-08-21T00:00:02Z',
      sessionId: 'mis_human_00000000',
    }];

    const report = analyzeSynergy(model, sessions(1), outcomes, {
      minSessions: 3,
      minEvents: 20,
      lifecycle,
    });

    expect(report.sufficient).toBe(false);
    expect(report.proposals).toEqual([]);
  });

  it('does not diagnose an in-flight dispatch as a missing trigger', () => {
    const model: GraphModel = {
      version: 1,
      nodes: [node('agent:security-engineer')],
      edges: [],
    };
    const lifecycle: SpecialistLifecycleEvent[] = [{
      seq: 1,
      sessionId: 'mis_human_00000000',
      runtime: 'codex',
      specialistId: 'core:security-engineer',
      name: 'security-engineer',
      contractVersion: 1,
      stage: 'pre-implementation',
      reviewRound: 1,
      inputHash: `sha256:${'a'.repeat(64)}`,
      missionClosed: false,
      status: 'requested',
    }];

    const report = analyzeSynergy(model, sessions(1), [], {
      minSessions: 3,
      minEvents: 20,
      lifecycle,
    });

    expect(report.proposals).toEqual([]);
  });

  it('repairs a terminal event that lacks its exact requested and started identity', () => {
    const model: GraphModel = {
      version: 1,
      nodes: [node('agent:security-engineer')],
      edges: [],
    };
    const lifecycle: SpecialistLifecycleEvent[] = [{
      seq: 3,
      sessionId: 'mis_human_00000000',
      runtime: 'codex',
      specialistId: 'core:security-engineer',
      name: 'security-engineer',
      contractVersion: 1,
      stage: 'pre-implementation',
      reviewRound: 1,
      inputHash: `sha256:${'a'.repeat(64)}`,
      contextId: 'ctx_security_0001',
      missionClosed: false,
      status: 'completed',
    }];

    const report = analyzeSynergy(model, sessions(3), [], {
      minSessions: 3,
      minEvents: 1,
      lifecycle,
    });

    expect(report.proposals).toContainEqual(expect.objectContaining({
      kind: 'repair',
      component: 'agent:security-engineer',
      evidence: expect.stringContaining('no matching started'),
    }));
  });

  it('repairs a closed specialist request that the runtime never started', () => {
    const model: GraphModel = {
      version: 1,
      nodes: [node('agent:security-engineer')],
      edges: [],
    };
    const lifecycle: SpecialistLifecycleEvent[] = [{
      seq: 2,
      sessionId: 'mis_human_00000000',
      runtime: 'codex',
      specialistId: 'core:security-engineer',
      name: 'security-engineer',
      contractVersion: 1,
      stage: 'pre-implementation',
      reviewRound: 1,
      inputHash: `sha256:${'a'.repeat(64)}`,
      missionClosed: true,
      status: 'requested',
    }];

    const report = analyzeSynergy(model, sessions(3), [], {
      minSessions: 3,
      minEvents: 1,
      lifecycle,
    });

    expect(report.proposals).toContainEqual(expect.objectContaining({
      kind: 'repair',
      component: 'agent:security-engineer',
      evidence: expect.stringContaining('never started'),
    }));
  });

  it('repairs started specialist work left incomplete when the mission closes', () => {
    const model: GraphModel = {
      version: 1,
      nodes: [node('agent:security-engineer')],
      edges: [],
    };
    const common = {
      sessionId: 'mis_human_00000000',
      runtime: 'codex' as const,
      specialistId: 'core:security-engineer' as const,
      name: 'security-engineer',
      contractVersion: 1,
      stage: 'pre-implementation' as const,
      reviewRound: 1,
      inputHash: `sha256:${'a'.repeat(64)}`,
      missionClosed: true,
    };
    const lifecycle: SpecialistLifecycleEvent[] = [
      { ...common, seq: 2, status: 'requested' },
      { ...common, seq: 3, contextId: 'ctx_security_0001', status: 'started' },
    ];

    const report = analyzeSynergy(model, sessions(3), [], {
      minSessions: 3,
      minEvents: 1,
      lifecycle,
    });

    expect(report.proposals).toContainEqual(expect.objectContaining({
      kind: 'repair',
      component: 'agent:security-engineer',
      evidence: expect.stringContaining('never reached a terminal state'),
    }));
  });
});
