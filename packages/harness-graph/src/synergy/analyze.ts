import { analyze } from '../analyze/index.js';
import {
  analyzeBehavior,
  activationNames,
  isSyntheticBehaviorSession,
  FIRING_KIND,
  within,
} from '../behavior/index.js';
import type { ActivationEvent } from '../behavior/types.js';
import { analyzeCost } from '../cost/analyze.js';
import type { GraphModel } from '../model/types.js';
import type { OutcomeEvent } from '../outcome/types.js';
import type { SpecialistLifecycleEvent } from './lifecycle.js';

export type SynergyProposalKind =
  | 'repair-telemetry'
  | 'repair'
  | 'wire'
  | 'tune-or-fuse'
  | 'retirement-review';

export interface SynergyProposal {
  readonly kind: SynergyProposalKind;
  readonly component: string;
  readonly evidence: string;
  readonly risk: string;
  readonly learnCandidate: true;
}

export interface SynergyOptions {
  readonly minSessions?: number;
  readonly minEvents?: number;
  readonly retirementMinSessions?: number;
  readonly sinceMs?: number;
  readonly lifecycle?: readonly SpecialistLifecycleEvent[];
}

export interface SynergyReport {
  readonly sufficient: boolean;
  readonly retirementEvidenceSufficient: boolean;
  readonly stats: {
    readonly events: number;
    readonly sessions: number;
    readonly excludedEvents: number;
    readonly excludedSessions: number;
  };
  readonly proposals: readonly SynergyProposal[];
}

const DEFAULT_RETIREMENT_MIN_SESSIONS = 20;
const PRIORITY: Readonly<Record<SynergyProposalKind, number>> = {
  'repair-telemetry': 5,
  repair: 4,
  'retirement-review': 3,
  wire: 2,
  'tune-or-fuse': 1,
};

function proposal(
  kind: SynergyProposalKind,
  component: string,
  evidence: string,
  risk: string,
): SynergyProposal {
  return { kind, component, evidence, risk, learnCandidate: true };
}

function addBest(
  proposals: Map<string, SynergyProposal>,
  candidate: SynergyProposal,
): void {
  const current = proposals.get(candidate.component);
  if (current === undefined || PRIORITY[candidate.kind] > PRIORITY[current.kind]) {
    proposals.set(candidate.component, candidate);
  }
}

function lifecycleRepairs(
  events: readonly SpecialistLifecycleEvent[],
): readonly SynergyProposal[] {
  const byDispatch = new Map<string, SpecialistLifecycleEvent[]>();
  for (const event of events) {
    if (isSyntheticBehaviorSession(event.sessionId)) continue;
    const key = [
      event.sessionId,
      event.runtime,
      event.specialistId,
      event.contractVersion,
      event.stage,
      event.reviewRound,
      event.inputHash,
    ].join('|');
    const dispatch = byDispatch.get(key) ?? [];
    dispatch.push(event);
    byDispatch.set(key, dispatch);
  }
  const totals = new Map<string, {
    startedWithoutRequest: number;
    terminalWithoutStart: number;
    requestedWithoutStart: number;
    startedWithoutTerminal: number;
    failed: number;
  }>();
  for (const dispatch of byDispatch.values()) {
    const ordered = [...dispatch].sort((left, right) => left.seq - right.seq);
    const first = ordered[0];
    if (first === undefined) continue;
    const total = totals.get(first.name) ?? {
      startedWithoutRequest: 0,
      terminalWithoutStart: 0,
      requestedWithoutStart: 0,
      startedWithoutTerminal: 0,
      failed: 0,
    };
    for (const event of ordered) {
      if (event.status === 'requested' && event.missionClosed) {
        const started = ordered.some((candidate) =>
          candidate.status === 'started' && candidate.seq > event.seq);
        if (!started) total.requestedWithoutStart += 1;
      }
      if (event.status === 'started') {
        const requested = ordered.some((candidate) =>
          candidate.status === 'requested' && candidate.seq < event.seq);
        if (!requested) total.startedWithoutRequest += 1;
        const terminal = ordered.some((candidate) =>
          (candidate.status === 'completed' || candidate.status === 'failed')
          && candidate.contextId === event.contextId
          && candidate.seq > event.seq);
        if (event.missionClosed && !terminal) total.startedWithoutTerminal += 1;
      }
      if (event.status === 'completed' || event.status === 'failed') {
        const started = ordered.some((candidate) =>
          candidate.status === 'started'
          && candidate.contextId === event.contextId
          && candidate.seq < event.seq);
        if (!started) total.terminalWithoutStart += 1;
        if (event.status === 'failed') total.failed += 1;
      }
    }
    totals.set(first.name, total);
  }
  const proposals: SynergyProposal[] = [];
  for (const [name, counts] of totals) {
    if (counts.startedWithoutRequest > 0) {
      proposals.push(proposal(
        'repair',
        `agent:${name}`,
        `${counts.startedWithoutRequest} specialist start(s) had no prior matching request.`,
        'Unbound lifecycle evidence can certify work the mission controller never requested.',
      ));
    } else if (counts.terminalWithoutStart > 0) {
      proposals.push(proposal(
        'repair',
        `agent:${name}`,
        `${counts.terminalWithoutStart} terminal specialist event(s) had no matching started context.`,
        'Forged or misattributed completion evidence can create a false green mission.',
      ));
    } else if (counts.requestedWithoutStart > 0) {
      proposals.push(proposal(
        'repair',
        `agent:${name}`,
        `${counts.requestedWithoutStart} closed specialist request(s) never started.`,
        'The controller promised a specialist review that the runtime never launched.',
      ));
    } else if (counts.startedWithoutTerminal > 0) {
      proposals.push(proposal(
        'repair',
        `agent:${name}`,
        `${counts.startedWithoutTerminal} started specialist dispatch(es) never reached a terminal state before mission closure.`,
        'Incomplete specialist work consumes runtime without producing usable review evidence.',
      ));
    } else if (counts.failed > 0) {
      proposals.push(proposal(
        'repair',
        `agent:${name}`,
        `${counts.failed} specialist dispatch(es) ended in an explicit failure.`,
        'Repeated failures waste runtime work and can hide a missing review lens.',
      ));
    }
  }
  return proposals;
}

/** Combine structure, human behavior, cost and outcomes into bounded HITL proposals.
 * Silence never deletes a component: retirement only becomes reviewable after a
 * stronger window than the ordinary behavior threshold. */
export function analyzeSynergy(
  model: GraphModel,
  activations: readonly ActivationEvent[],
  outcomes: readonly OutcomeEvent[],
  options: SynergyOptions = {},
): SynergyReport {
  const humanActivations = activations.filter((event) =>
    !isSyntheticBehaviorSession(event.sessionId) && within(event, options.sinceMs));
  const humanOutcomes = outcomes.filter((event) =>
    !isSyntheticBehaviorSession(event.sessionId));
  const behavior = analyzeBehavior(model, activations, options);
  const retirementMinSessions = options.retirementMinSessions
    ?? DEFAULT_RETIREMENT_MIN_SESSIONS;
  // Tool activity cannot demonstrate that skill/agent instrumentation ran.
  // Count only sessions with an observation in the component's own family.
  const familySessions = new Map<ActivationEvent['kind'], Set<string>>();
  for (const event of humanActivations) {
    const sessions = familySessions.get(event.kind) ?? new Set<string>();
    sessions.add(event.sessionId);
    familySessions.set(event.kind, sessions);
  }
  const observedSessions = (kind: ActivationEvent['kind'] | undefined): number =>
    kind === undefined ? 0 : (familySessions.get(kind)?.size ?? 0);
  const retirementEvidenceSufficient = behavior.sufficient
    && model.nodes.some((node) => observedSessions(FIRING_KIND[node.type]) >= retirementMinSessions);
  const proposals = new Map<string, SynergyProposal>();
  if (!behavior.sufficient) {
    return {
      sufficient: false,
      retirementEvidenceSufficient: false,
      stats: behavior.stats,
      proposals: Object.freeze([...proposals.values()].sort((left, right) =>
        left.component.localeCompare(right.component) || left.kind.localeCompare(right.kind))),
    };
  }

  for (const candidate of lifecycleRepairs(options.lifecycle ?? [])) {
    addBest(proposals, candidate);
  }

  const usedSkills = new Set(humanActivations
    .filter((event) => event.kind === 'skill')
    .flatMap((event) => activationNames(event.kind, event.name)));
  const structural = analyze(model, { usedSkillNames: usedSkills });
  const cost = analyzeCost(model, humanActivations, {
    ...(options.minSessions === undefined ? {} : { minSessions: options.minSessions }),
    ...(options.minEvents === undefined ? {} : { minEvents: options.minEvents }),
    ...(options.sinceMs === undefined ? {} : { sinceMs: options.sinceMs }),
    outcomes: humanOutcomes,
  });
  const telemetryNodes = new Set<string>();

  for (const finding of behavior.findings.filter((item) => item.kind === 'telemetry-gap')) {
    for (const nodeId of finding.nodes) telemetryNodes.add(nodeId);
    const families = [...new Set(finding.nodes.map((nodeId) => nodeId.split(':')[0]))];
    for (const family of families) {
      addBest(proposals, proposal(
        'repair-telemetry',
        `${family}:*`,
        finding.evidence,
        'Retirement decisions are unsafe until installed names join to observed activations.',
      ));
    }
  }

  for (const finding of behavior.findings.filter((item) => item.kind === 'should-have-fired')) {
    for (const nodeId of finding.nodes) {
      if (telemetryNodes.has(nodeId)) continue;
      addBest(proposals, proposal(
        'repair',
        nodeId,
        finding.evidence,
        'A missed declared trigger can silently remove a required workflow pass.',
      ));
    }
  }

  const orphanNodes = new Set(structural
    .filter((finding) => finding.kind === 'orphan')
    .flatMap((finding) => finding.nodes));
  const deadNodes = new Set(behavior.findings
    .filter((finding) => finding.kind === 'dead-node')
    .flatMap((finding) => finding.nodes));

  for (const row of cost.rows) {
    if (telemetryNodes.has(row.nodeId)) continue;
    if (row.outcome !== undefined && row.outcome.error > 0) {
      addBest(proposals, proposal(
        'repair',
        row.nodeId,
        `${row.outcome.error}/${row.outcome.completions} observed completions ended in error.`,
        'A failing component may hide missing review coverage or waste repeated runtime work.',
      ));
      continue;
    }
    if (deadNodes.has(row.nodeId) || row.flags.includes('dead-hook')) {
      const node = model.nodes.find((candidate) => candidate.id === row.nodeId);
      const observedFamilySessions = observedSessions(node === undefined ? undefined : FIRING_KIND[node.type]);
      if (retirementEvidenceSufficient && observedFamilySessions >= retirementMinSessions) {
        addBest(proposals, proposal(
          'retirement-review',
          row.nodeId,
          `0 observed invocations across ${observedFamilySessions} human sessions with observations in this component family.`,
          'Family observations do not prove complete runtime coverage. Check missing instrumentation, the trigger and the purpose before proposing removal.',
        ));
      } else if (orphanNodes.has(row.nodeId)) {
        addBest(proposals, proposal(
          'wire',
          row.nodeId,
          'The component is structurally orphaned and has no observed activation in the current window.',
          'The missing edge may be the defect; removal before wiring is tested could discard useful coverage.',
        ));
      }
      continue;
    }
    if (orphanNodes.has(row.nodeId)) {
      addBest(proposals, proposal(
        'wire',
        row.nodeId,
        `The component fired ${row.invocations} time(s) but has no declared graph relation.`,
        'Undeclared composition makes ownership and downstream impact invisible.',
      ));
      continue;
    }
    if (row.flags.includes('underused') && row.flags.includes('low-yield')) {
      addBest(proposals, proposal(
        'tune-or-fuse',
        row.nodeId,
        `${row.invocations} invocation(s) for ${row.staticTokens} static tokens in the observed window.`,
        'Fusion can increase accidental trigger overlap; compare responsibilities before changing the boundary.',
      ));
    }
  }

  return {
    sufficient: true,
    retirementEvidenceSufficient,
    stats: behavior.stats,
    proposals: Object.freeze([...proposals.values()].sort((left, right) =>
      left.component.localeCompare(right.component) || left.kind.localeCompare(right.kind))),
  };
}
