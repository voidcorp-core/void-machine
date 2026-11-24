import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { canonicalJsonHash, type MissionSpecialistPlan } from '@voidcorp/mission-engine';
import { wireCodexAgents } from '../codex-agents.js';
import { specialistCapabilityFor } from '../runtime-adapters.js';
import { resolveProjectRoots } from '../project-roots.js';
import { planMission, recoverStoppedMission, recordMissionClosure } from '../../commands/mission.js';
import { appendMissionEvent, createMission, inspectMission, missionControllerRoutingHash, writeMissionControllerPlan } from './store.js';

const CORE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../core/dist');
const ID = 'mis_0123456789abcdef0123456789abcdef';
it('recovers with an authentic healthy degraded Codex installation without promoting its capability', async () => {
  const root = await mkdtemp(join(tmpdir(), 'void-recovery-native-'));
  vi.stubEnv('CODEX_SESSION_ID', 'fixture-native-session');
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    await wireCodexAgents(root, CORE);
    const body = '# Clarify native review\n\nReview the CLI API boundary.\n';
    await writeFile(join(root, 'DEV-TEST.md'), body);
    const resolution = 'Verification belongs after implementation.\n';
    await writeFile(join(root, 'resolution.md'), resolution);
    const live = await planMission(root, 'DEV-TEST.md');
    const plan: MissionSpecialistPlan = { planHash: live.planHash, context: live.context,
      specialists: live.specialists.map(value => ({ specialistId: value.specialistId,
        contractVersion: value.contractVersion, inputHash: value.proof.inputHash,
        state: value.state, stages: value.stages })) };
    const ticket = { path: 'DEV-TEST.md', contentHash: `sha256:${createHash('sha256').update(body).digest('hex')}` };
    await createMission(root, { missionId: ID, title: 'Native recovery', mode: 'team',
      teamController: { planHash: plan.planHash, routingHash: missionControllerRoutingHash(plan, ticket),
        leadWriterId: 'writer:primary', runtime: 'codex', runtimeAttested: true } });
    await writeMissionControllerPlan(root, ID, plan, ticket);
    const specialist = plan.specialists.find(value => value.state === 'applicable');
    if (!specialist?.inputHash) throw new Error('Applicable canonical specialist required.');
    const completed = await appendMissionEvent(root, ID, { source: 'runtime:codex',
      kind: 'specialist.completed', subject: specialist.specialistId, correlationId: ID, payload: {
        stage: 'pre-implementation', reviewRound: 1, inputHash: specialist.inputHash,
        contextId: 'context_native_review', completion: { schemaVersion: 1,
          specialistId: specialist.specialistId, contractVersion: specialist.contractVersion,
          completionId: 'completion_native_review', verdict: 'degraded', findings: [],
          evidenceRequests: ['Clarify proof timing.'], limitations: ['Proof timing is unresolved.'] },
      } });
    await recordMissionClosure(root, ID, 'controller-stop');
    const stream = (await inspectMission(root, ID, { dependencies: {} })).stream;
    const closure = stream.events.at(-1);
    if (!closure) throw new Error('Expected closure.');
    const request = { schemaVersion: 1 as const, closureEventId: closure.eventId,
      expectedJournalHash: canonicalJsonHash(stream.events), disposition: { kind: 'review-blocker' as const,
        completionEventIds: [completed.eventId], resolutionArtifact: { path: 'resolution.md',
          sha256: `sha256:${createHash('sha256').update(resolution).digest('hex')}` } } };
    expect(await specialistCapabilityFor(root, 'codex')).toMatchObject({ status: 'degraded' });
    const result = await recoverStoppedMission(resolveProjectRoots(root), ID, request);
    expect(result).toMatchObject({ recorded: true, provenance: {
      capability: { status: 'degraded', limitations: expect.any(Array) } } });
    expect((await specialistCapabilityFor(root, 'codex')).status).toBe('degraded');
    await rm(join(root, '.codex/agents/test-qa-engineer.toml'));
    await expect(recoverStoppedMission(resolveProjectRoots(root), ID, request))
      .rejects.toThrow('MISSION_RECOVERY_CAPABILITY');
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true });
  }
});
