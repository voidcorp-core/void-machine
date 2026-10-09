import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { canonicalJsonHash, type MissionSpecialistPlan } from '@voidcorp/mission-engine';
import { wireCodexAgents } from '../codex-agents.js';
import { resolveProjectRoots } from '../project-roots.js';
import { dispatchMissionSpecialists, planMission, recoverStoppedMission, recordMissionClosure } from '../../commands/mission.js';
import { recordSpecialistLifecycle } from './specialist-lifecycle.js';
import { parseMissionRecoveryRequest } from './mission-recovery.js';
import { appendMissionEvent, createMission, inspectMission, missionControllerRoutingHash, writeMissionControllerPlan } from './store.js';

const CORE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../core');
const ID = 'mis_0123456789abcdef0123456789abcdef';

it.each(['fresh', 'historically-stopped'] as const)(
  'uses actual opaque lifecycle receipts for %s preparation without re-emitting them', async mode => {
    const root = await mkdtemp(join(tmpdir(), 'void-opaque-context-'));
    vi.stubEnv('CODEX_SESSION_ID', 'fixture-native-opaque-session');
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: root });
      await wireCodexAgents(root, CORE);
      const body = '# PROOF-1\n\nCreate proof-1.txt containing DEV-930 proof 1.\n';
      await writeFile(join(root, 'PROOF-1.md'), body);
      await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'opaque-context-fixture', private: true }));
      execFileSync('git', ['add', 'PROOF-1.md', 'package.json'], { cwd: root });
      execFileSync('git', ['-c', 'user.name=Void Test', '-c', 'user.email=void@example.test',
        'commit', '--quiet', '-m', 'test: seed opaque context fixture'], { cwd: root });
      const initial = await planMission(root, 'PROOF-1.md');
      expect(initial.context).toEqual({ status: 'complete', issues: [] });
      const plan: MissionSpecialistPlan = { planHash: initial.planHash, context: initial.context,
        specialists: initial.specialists.map(value => ({ specialistId: value.specialistId,
          contractVersion: value.contractVersion, inputHash: value.proof.inputHash,
          state: value.state, stages: value.stages })) };
      const ticket = { path: 'PROOF-1.md', contentHash: `sha256:${createHash('sha256').update(body).digest('hex')}` };
      await createMission(root, { missionId: ID, title: 'Opaque context recovery', mode: 'team',
        teamController: { planHash: plan.planHash, routingHash: missionControllerRoutingHash(plan, ticket),
          leadWriterId: 'writer:primary', runtime: 'codex', runtimeAttested: true } });
      await writeMissionControllerPlan(root, ID, plan, ticket);
      const roots = resolveProjectRoots(root);
      const input = { kind: 'dispatch' as const, missionId: ID, json: true };
      const dispatched = await dispatchMissionSpecialists(roots, input);
      expect(dispatched.envelopes.length).toBeGreaterThan(1);
      for (const [index, envelope] of dispatched.envelopes.entries()) {
        const contextId = `/root/proof1_${index}`;
        await recordSpecialistLifecycle(root, ID, { status: 'started', envelope, contextId });
        await recordSpecialistLifecycle(root, ID, { status: 'completed', envelope, contextId,
          completion: { schemaVersion: 1, specialistId: envelope.specialistId,
            contractVersion: envelope.contractVersion, completionId: `proof1_completion_${index}`,
            verdict: 'pass', findings: [], evidenceRequests: [], limitations: [] } });
      }
      if (mode === 'historically-stopped') {
        // Fixture of the original dispatch closure, not a replacement receipt.
        await recordMissionClosure(root, ID, 'controller-stop', 'void-harness:mission.dispatch');
        const path = join(root, '.void/machine/runs', ID, 'events.jsonl');
        const before = await readFile(path, 'utf8');
        const stream = (await inspectMission(root, ID, { dependencies: {} })).stream;
        const request = parseMissionRecoveryRequest({ schemaVersion: 1,
          closureEventId: stream.events.at(-1)?.eventId, expectedJournalHash: canonicalJsonHash(stream.events),
          disposition: { kind: 'controller-defect', defect: 'opaque-native-context' } });
        expect(await recoverStoppedMission(roots, ID, request)).toMatchObject({ recorded: true });
        const after = await readFile(path, 'utf8');
        expect(after.startsWith(before)).toBe(true);
        const recovered = (await inspectMission(root, ID, { dependencies: {} })).stream.events;
        expect(recovered).toHaveLength(stream.events.length + 1);
        expect(recovered.at(-1)).toMatchObject({ kind: 'mission.recovered', payload: {
          preservedCompletionEventIds: stream.events.filter(event => event.kind === 'specialist.completed').map(event => event.eventId),
          invalidatedCompletionEventIds: [], inadmissibleCompletionEventIds: [], roundCorrections: [],
          consumedRounds: 1, nextAction: 'verification',
        } });
        expect(await recoverStoppedMission(roots, ID, request)).toMatchObject({ recorded: false });
        expect(await readFile(path, 'utf8')).toBe(after);
      }
      expect((await dispatchMissionSpecialists(roots, input)).action.kind).toBe('run-lead-writer');
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true });
    }
  });

it('keeps live preparation B authoritative after recovery instead of implementing from the old PASS panel A', async () => {
  const root = await mkdtemp(join(tmpdir(), 'void-recovery-routing-'));
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
    const original = (await inspectMission(root, ID, { dependencies: {} })).stream.events;
    for (const [index, initialEnvelope] of dispatched.envelopes.entries()) {
      // Reproduce the historical partial-panel bug: a never-started peer was
      // redispatched as round 2 after an earlier peer completed round 1.
      const envelope = index === 0 ? initialEnvelope : { ...initialEnvelope, reviewRound: 2 };
      if (index > 0) {
        const requested = original.find(event => event.kind === 'specialist.requested'
          && event.subject === envelope.specialistId);
        if (!requested || typeof requested.payload !== 'object' || requested.payload === null) {
          throw new Error('Real initial dispatch request required.');
        }
        await appendMissionEvent(root, ID, { source: 'void-harness:mission.dispatch',
          kind: 'specialist.requested', subject: envelope.specialistId, correlationId: ID,
          payload: { ...requested.payload, reviewRound: 2 } });
      }
      const contextId = `context_routing_${index}`;
      await recordSpecialistLifecycle(root, ID, { status: 'started', envelope, contextId });
      await recordSpecialistLifecycle(root, ID, { status: 'completed', envelope, contextId,
        completion: { schemaVersion: 1, specialistId: envelope.specialistId,
          contractVersion: envelope.contractVersion, completionId: `completion_routing_${index}`,
          verdict: 'pass', findings: [], evidenceRequests: [], limitations: [] } });
    }
    await recordMissionClosure(root, ID, 'controller-stop');
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'routing-fixture',
      scripts: { test: 'vitest run', lint: 'tsc --noEmit' } }));
    const changed = await planMission(root, 'DEV-TEST.md');
    expect(changed.inputHash).not.toBe(initial.inputHash);
    const stream = (await inspectMission(root, ID, { dependencies: {} })).stream;
    const closure = stream.events.at(-1);
    if (!closure) throw new Error('Controller closure required.');
    const recovered = await recoverStoppedMission(roots, ID, { schemaVersion: 1,
      closureEventId: closure.eventId, expectedJournalHash: canonicalJsonHash(stream.events),
      disposition: { kind: 'controller-defect', defect: 'partial-fanout-round' } });
    expect(recovered.recorded).toBe(true);
    const receipt = (await inspectMission(root, ID, { dependencies: {} })).stream.events.at(-1)?.payload;
    expect(receipt).toMatchObject({ preservedCompletionEventIds: [],
      invalidatedCompletionEventIds: expect.any(Array), observation: {
        currentInputHashes: Object.fromEntries(changed.specialists.map(value =>
          [value.specialistId, value.proof.inputHash])) } });
    const resumed = await dispatchMissionSpecialists(roots, input);
    expect(resumed.action.kind).toBe('run-preparation-correction');
    expect(resumed.action.kind).not.toBe('run-lead-writer');
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true });
  }
});
