import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { reduceEvidenceObligations, sealEvidence, type MissionSpecialistPlan } from '@voidcorp/mission-engine';
import { wireCodexAgents } from '../codex-agents.js';
import { resolveProjectRoots } from '../project-roots.js';
import { dispatchMissionSpecialists, planMission } from '../../commands/mission.js';
import { recordSpecialistLifecycle } from './specialist-lifecycle.js';
import { createMission, inspectMission, missionControllerRoutingHash, recordMissionEvidence, writeMissionControllerPlan } from './store.js';

import { computeProjectState } from './project-state.js';
import { requestSpecialistEvidence, recordSpecialistEvidence } from './specialist-evidence.js';

const CORE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../core');
const ID = 'mis_0123456789abcdef0123456789abcdef';

it('dispatches after a fresh author discharge and blocks again when its Git proof becomes stale', async () => {
  const root = await mkdtemp(join(tmpdir(), 'void-evidence-dispatch-'));
  vi.stubEnv('CODEX_SESSION_ID', 'fixture-native-routing-session');
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    await wireCodexAgents(root, CORE);
    const body = '# Review CLI API\n\nReview the CLI API boundary and its implementation.\n';
    await writeFile(join(root, 'DEV-TEST.md'), body);
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'routing-fixture', scripts: { test: 'vitest run' } }));
    execFileSync('git', ['add', 'DEV-TEST.md', 'package.json'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Void Test', '-c', 'user.email=void@example.test',
      'commit', '--quiet', '-m', 'test: seed routing fixture'], { cwd: root });
    await writeFile(join(root, 'runtime.ts'), 'export const ready = true;\n');
    execFileSync('git', ['add', 'runtime.ts'], { cwd: root });
    const initial = await planMission(root, 'DEV-TEST.md');
    expect(initial.context).toEqual({ status: 'complete', issues: [] });
    const plan: MissionSpecialistPlan = { planHash: initial.planHash, context: initial.context,
      specialists: initial.specialists.map(value => ({ specialistId: value.specialistId,
        contractVersion: value.contractVersion, inputHash: value.proof.inputHash,
        state: value.state, stages: value.stages })) };
    const ticket = { path: 'DEV-TEST.md', contentHash: `sha256:${createHash('sha256').update(body).digest('hex')}` };
    await createMission(root, { missionId: ID, title: 'Recovery routing', mode: 'team',
      teamController: { planHash: plan.planHash, routingHash: missionControllerRoutingHash(plan, ticket),
        leadWriterId: 'writer:primary', runtime: 'codex', runtimeAttested: true } });
    await writeMissionControllerPlan(root, ID, plan, ticket);
    const roots = resolveProjectRoots(root);
    const input = { kind: 'dispatch' as const, missionId: ID, json: true };
    const dispatched = await dispatchMissionSpecialists(roots, input);
    expect(dispatched.action).toMatchObject({ kind: 'invoke-specialists' });
    expect(dispatched.envelopes.length).toBeGreaterThan(1);
    for (const [index, envelope] of dispatched.envelopes.entries()) {
      const contextId = `context_routing_${index}`;
      await recordSpecialistLifecycle(root, ID, { status: 'started', envelope, contextId });
      await recordSpecialistLifecycle(root, ID, { status: 'completed', envelope, contextId,
        completion: { schemaVersion: 1, specialistId: envelope.specialistId,
          contractVersion: envelope.contractVersion, completionId: `completion_routing_${index}`,
          verdict: 'pass', findings: [], evidenceRequests: index === 0 ? ['Prove the current implementation.'] : [], limitations: [] } });
    }
    const events = (await inspectMission(root, ID, { dependencies: {} })).stream.events;
    const obligation = reduceEvidenceObligations({ events, expectedSource: 'runtime:codex',
      phase: 'pre-implementation', proofs: [], evidenceContext: { dependencies: {} } }).obligations[0];
    if (!obligation) throw new Error('Expected original author obligation.');
    // A dispatch before the author response must not make evidence-request impossible.
    const pending = await dispatchMissionSpecialists(roots, input);
    expect(pending.action).toMatchObject({ kind: 'await-evidence' });
    expect(pending.envelopes).toHaveLength(0);
    expect(await dispatchMissionSpecialists(roots, input)).toEqual(pending);
    const waiting = (await inspectMission(root, ID, { dependencies: {} })).stream.events;
    expect(waiting).toEqual(events);
    expect(waiting.some(value => value.kind === 'mission.closed')).toBe(false);
    const project = await computeProjectState(root);
    const proof = sealEvidence({ schemaVersion: 1,
      evidenceId: 'evd_00000000-0000-4000-8000-000000000001', missionId: ID,
      type: 'command', producer: 'fixture:verification', source: 'command:fixture',
      environment: { runtime: 'node', platform: 'test', arch: 'test' }, confidence: 'high',
      inputHash: initial.inputHash, diffHash: project.diffHash,
      startedAt: '2026-09-19T00:00:00.000Z', finishedAt: '2026-09-19T00:00:01.000Z',
      durationMs: 1_000, status: 'passed', exitCode: 0, command: ['fixture'], affectedNodes: [],
      output: { stdout: 'passed', stderr: '', truncated: false },
      dependencies: [{ kind: 'diff', key: 'git:working-tree', hash: project.diffHash }] });
    await recordMissionEvidence(root, proof);
    const proofEvent = (await inspectMission(root, ID, { dependencies: {} })).stream.events
      .find(value => value.kind === 'evidence.recorded');
    if (!proofEvent) throw new Error('Expected canonical proof event.');
    const request = await requestSpecialistEvidence(roots, ID, { operation: 'discharge',
      completionEventId: obligation.completionEventId, contextId: 'context_discharge',
      obligationIds: [obligation.obligationId] });
    const response = { requestEventId: request.eventId, contextId: 'context_discharge' };
    await recordSpecialistEvidence(roots, ID, 'started', response);
    await recordSpecialistEvidence(roots, ID, 'completed', { ...response, items: [{
      obligationId: obligation.obligationId, proofEventIds: [proofEvent.eventId],
      reason: 'The current canonical verification satisfies this request.',
    }] });
    expect((await computeProjectState(root)).diffHash).toBe(project.diffHash);
    const fresh = await dispatchMissionSpecialists(roots, input);
    expect(fresh.action).toMatchObject({ kind: 'run-lead-writer' });
    await writeFile(join(root, 'runtime.ts'), 'export const ready = false;\n');
    expect((await computeProjectState(root)).diffHash).not.toBe(project.diffHash);
    const stale = await dispatchMissionSpecialists(roots, input);
    expect(stale.action).toMatchObject({ kind: 'stop',
      reasons: expect.arrayContaining([expect.stringMatching(/evidence|proof|obligation/i)]) });
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true });
  }
});
