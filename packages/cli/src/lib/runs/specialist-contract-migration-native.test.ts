import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { canonicalJsonHash, compileContextPack, compileMissionPlan, mergePolicies, projectMissionLifecycle, reduceEvidenceObligations,
  type MissionSpecialistPlan } from '@voidcorp/mission-engine';
import { loadProjectPolicies } from '../policy-loader.js';
import { loadProfiles } from '../profile-loader.js';
import { loadSpecialists, parseSpecialistYaml } from '../specialists/load.js';
import { detectProfileInput, detectStack } from '../stack.js';
import * as paths from '../paths.js';
import { wireCodexAgents } from '../codex-agents.js';
import { resolveProjectRoots } from '../project-roots.js';
import { dispatchMissionSpecialists, migrateMissionSpecialist, planMission, recoverStoppedMission, recordMissionClosure } from '../../commands/mission.js';
import { appendMissionEvent, createMission, eventLogPath, inspectMission,
  missionControllerRoutingHash, writeMissionControllerPlan } from './store.js';
import { recordSpecialistLifecycle, recordSpecialistRequests } from './specialist-lifecycle.js';
import { requestSpecialistEvidence, recordSpecialistEvidence } from './specialist-evidence.js';
import { verifyMissionCommand } from './verify.js';
const SOURCE_CORE = fileURLToPath(new URL('../../../../core/dist/', import.meta.url));
const ID = 'mis_native_migration_0123456789';
const VISUAL = 'core:visual-craft-director' as const;

it.each([false, true, 'closed-before-review'] as const)('migrates an isolated native mission and retains the original author obligation (recover after migration: %s)', async (recoverAfterMigration) => {
  const root = await mkdtemp(join(tmpdir(), 'void-native-migration-'));
  vi.stubEnv('CODEX_SESSION_ID', 'fixture-native-migration');
  const CORE = await mkdtemp(join(tmpdir(), 'void-migration-v3-core-'));
  await cp(SOURCE_CORE, CORE, { recursive: true });
  await cp(join(CORE, 'contract-history/visual-craft-director/v3.yaml'), join(CORE, 'specialists/visual-craft-director.yaml'));
  vi.spyOn(paths, 'findCoreSource').mockResolvedValue(CORE);
  try {
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git(['init', '--quiet']);
    await writeFile(join(root, '.gitignore'), '.void/\n');
    await writeFile(join(root, 'runtime.ts'), 'export const version = 1;\n');
    await writeFile(join(root, 'package.json'), '{"name":"migration-fixture","private":true}\n');
    const body = '# Visual review of a CLI migration\n\nReview runtime.ts; no rendered interface is introduced.\n';
    await writeFile(join(root, 'ticket.md'), body);
    await wireCodexAgents(root, CORE);
    git(['add', '.']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Fixture base']);
    const baseCommit = git(['rev-parse', 'HEAD']).trim();
    const live = await planMission(root, 'ticket.md');
    const catalog = await loadSpecialists(CORE);
    const archived = parseSpecialistYaml(await readFile(join(CORE, 'contract-history/visual-craft-director/v2.yaml'), 'utf8'), 'v2.yaml');
    const legacyCatalog = catalog.map(contract => contract.id === VISUAL ? archived : contract);
    const oldPlan = async (files: string[]) => {
      const input = detectProfileInput(root, files);
      return compileMissionPlan({ schemaVersion: 2,
        ticket: { id: 'ticket', title: 'Visual review of a CLI migration', body },
        diff: { files, status: 'known' },
        stack: { status: 'known', technologies: [...new Set([...Object.values(detectStack(root)),
          ...input.projects.flatMap(project => project.technologies.map(technology => technology.id))])].sort() },
        policy: mergePolicies(await loadProjectPolicies(root, join(CORE, 'policies')), new Date().toISOString()),
        profiles: { catalog: await loadProfiles(root, join(CORE, 'profiles')), input },
        specialists: { catalog: legacyCatalog },
      });
    };
    const legacyHash = (await oldPlan([])).inputHash;
    const plan: MissionSpecialistPlan = { planHash: live.planHash,
      context: { status: 'complete', issues: [] }, specialists: [{ specialistId: VISUAL,
        contractVersion: 2, inputHash: legacyHash, state: 'applicable', stages: ['post-implementation'] },
        { specialistId: 'core:security-engineer', contractVersion: 2, inputHash: legacyHash,
          state: 'applicable', stages: ['post-implementation'] }] };
    const ticket = { path: 'ticket.md', contentHash: `sha256:${createHash('sha256').update(body).digest('hex')}` };
    await createMission(root, { missionId: ID, title: 'Isolated visual migration', mode: 'team',
      teamController: { planHash: plan.planHash, routingHash: missionControllerRoutingHash(plan, ticket, baseCommit),
        leadWriterId: 'writer:primary', runtime: 'codex', runtimeAttested: true } });
    await writeMissionControllerPlan(root, ID, plan, ticket, baseCommit);
    await writeFile(join(root, 'runtime.ts'), 'export const version = 2;\n');
    const writer = await appendMissionEvent(root, ID, { source: 'void-harness:mission.dispatch', kind: 'lead-writer.requested',
      subject: 'writer:primary', correlationId: ID, payload: { writerId: 'writer:primary', planHash: plan.planHash,
        actionKind: 'run-lead-writer', implementationRound: 1, findingIds: [] } });
    await appendMissionEvent(root, ID, { source: 'writer:primary', kind: 'lead-writer.completed', subject: 'writer:primary',
      correlationId: ID, causationId: writer.eventId, payload: { writerId: 'writer:primary', planHash: plan.planHash,
        actionKind: 'run-lead-writer', implementationRound: 1, requestEventId: writer.eventId } });
    const patch = git(['diff', '--no-ext-diff', '--no-textconv', '--binary', '--full-index',
      '--no-renames', '--relative', baseCommit, '--', '.', ':(exclude).void/machine/**']);
    const legacyPostHash = canonicalJsonHash({ routing: (await oldPlan(['runtime.ts'])).inputHash,
      subject: canonicalJsonHash({ baseCommit, diff: patch, files: ['runtime.ts'] }) });
    if (recoverAfterMigration === 'closed-before-review') {
      await recordMissionClosure(root, ID, 'controller-stop', 'void-harness:mission.dispatch');
      const closed = (await inspectMission(root, ID, { dependencies: {} })).stream.events;
      const lifecycle = projectMissionLifecycle(closed);
      if (lifecycle.status !== 'closed') throw new Error('Expected authentic stopped episode');
      const path = await eventLogPath(root, ID);
      const originalBytes = await readFile(path, 'utf8');
      const roots = resolveProjectRoots(root);
      const request = { schemaVersion: 1 as const, expectedEpisodeId: lifecycle.episodeId,
        expectedJournalHash: canonicalJsonHash(closed), migrationId: 'visual-craft-director-v2-v3',
        recovery: { closureEventId: lifecycle.closure.eventId } };
      const migrated = await migrateMissionSpecialist(roots, ID, request);
      expect(migrated.recorded).toBe(true);
      const after = (await inspectMission(root, ID, { dependencies: {} })).stream.events;
      expect(after).toHaveLength(closed.length + 1);
      expect(after.at(-1)?.kind).toBe('specialist.contract-migrated');
      expect(projectMissionLifecycle(after)).toEqual({ status: 'open', episodeId: migrated.migrationEventId });
      expect((await readFile(path, 'utf8')).startsWith(originalBytes)).toBe(true);
      expect(await migrateMissionSpecialist(roots, ID, request)).toMatchObject({ recorded: false });
      const next = await dispatchMissionSpecialists(roots, { kind: 'dispatch', missionId: ID, json: true });
      expect(next.action).toMatchObject({ kind: 'invoke-specialists', stage: 'post-implementation', reviewRound: 1 });
      expect(next.envelopes.find(envelope => envelope.specialistId === VISUAL)?.contractVersion).toBe(3);
      return;
    }
    const binding = { missionId: ID, specialistId: VISUAL, stage: 'post-implementation' as const,
      reviewRound: 1, inputHash: legacyPostHash };
    const oldEnvelope = { ...binding, schemaVersion: 1 as const, runtime: 'codex' as const,
      agentName: 'visual-craft-director', contractVersion: 2,
      contextPack: compileContextPack({ dispatch: binding, diff: 'CLI changed', touchedPaths: ['runtime.ts'],
        artifacts: [], lens: 'full', budgetTokens: 12000 }) };
    await recordSpecialistRequests(root, ID, [oldEnvelope], plan.planHash);
    await recordSpecialistLifecycle(root, ID, { status: 'started', envelope: oldEnvelope, contextId: 'context_legacy_visual' });
    await recordSpecialistLifecycle(root, ID, { status: 'completed', envelope: oldEnvelope, contextId: 'context_legacy_visual',
      completion: { schemaVersion: 1, specialistId: VISUAL, contractVersion: 2, completionId: 'legacy_visual_review',
        verdict: 'blocked', findings: [], evidenceRequests: ['Provide supported evidence of visual applicability for the current change.'], limitations: ['The v2 review cannot certify this CLI change without applicability evidence.'] } });
    const peerBinding = { ...binding, specialistId: 'core:security-engineer' as const };
    const peerEnvelope = { ...oldEnvelope, ...peerBinding, agentName: 'security-engineer',
      contextPack: compileContextPack({ dispatch: peerBinding, diff: patch, touchedPaths: ['runtime.ts'],
        artifacts: [], lens: 'full', budgetTokens: 12000 }) };
    await recordSpecialistRequests(root, ID, [peerEnvelope], plan.planHash);
    await recordSpecialistLifecycle(root, ID, { status: 'started', envelope: peerEnvelope, contextId: 'context_peer_security' });
    await recordSpecialistLifecycle(root, ID, { status: 'completed', envelope: peerEnvelope, contextId: 'context_peer_security', completion: {
      schemaVersion: 1, specialistId: 'core:security-engineer', contractVersion: 2, completionId: 'peer_security_review',
      verdict: 'pass', findings: [], evidenceRequests: [], limitations: [] } });
    const queuedBinding = { ...binding, reviewRound: 2 };
    const queuedOld = { ...oldEnvelope, ...queuedBinding,
      contextPack: compileContextPack({ dispatch: queuedBinding, diff: patch, touchedPaths: ['runtime.ts'],
        artifacts: [], lens: 'full', budgetTokens: 12000 }) };
    await recordSpecialistRequests(root, ID, [queuedOld], plan.planHash);
    const roots = resolveProjectRoots(root);
    const before = (await inspectMission(root, ID, { dependencies: {} })).stream;
    const start = before.events[0];
    const original = before.events.find(event => event.kind === 'specialist.completed');
    if (!start || !original) throw new Error('Expected canonical original review.');
    const logPath = await eventLogPath(root, ID);
    const originalBytes = await readFile(logPath, 'utf8');
    const request = { schemaVersion: 1 as const, expectedEpisodeId: start.eventId,
      expectedJournalHash: canonicalJsonHash(before.events), migrationId: 'visual-craft-director-v2-v3' };
    expect(await migrateMissionSpecialist(roots, ID, request)).toMatchObject({ recorded: true });
    expect((await readFile(logPath, 'utf8')).startsWith(originalBytes)).toBe(true);
    const migratedBytes = await readFile(logPath, 'utf8');
    await expect(recordSpecialistLifecycle(root, ID, { status: 'started', envelope: queuedOld,
      contextId: 'context_superseded_visual' })).rejects.toThrow('SPECIALIST_LIFECYCLE_INVALID');
    expect(await readFile(logPath, 'utf8')).toBe(migratedBytes);
    if (recoverAfterMigration) {
      const resolutionPath = '.void/machine/migration-resolution.md';
      const resolutionBody = 'The recorded migration requests a fresh v3 applicability review; the original obligation remains due.\n';
      await writeFile(join(root, resolutionPath), resolutionBody);
      await recordMissionClosure(root, ID, 'controller-stop');
      const closed = (await inspectMission(root, ID, { dependencies: {} })).stream.events;
      const closure = closed.at(-1);
      if (!closure) throw new Error('Expected controller closure after recorded migration.');
      const closedBytes = await readFile(logPath, 'utf8');
      const recovered = await recoverStoppedMission(roots, ID, { schemaVersion: 1,
        closureEventId: closure.eventId, expectedJournalHash: canonicalJsonHash(closed),
        disposition: { kind: 'review-blocker', completionEventIds: [original.eventId],
          resolutionArtifact: { path: resolutionPath,
            sha256: `sha256:${createHash('sha256').update(resolutionBody).digest('hex')}` } } });
      expect(recovered.recorded).toBe(true);
      expect((await readFile(logPath, 'utf8')).startsWith(closedBytes)).toBe(true);
    }
    const first = await dispatchMissionSpecialists(roots, { kind: 'dispatch', missionId: ID, json: true });
    expect(first.action).toEqual({ kind: 'invoke-specialists', specialistIds: [VISUAL], stage: 'post-implementation', reviewRound: 2 });
    expect(first.envelopes).toHaveLength(1);
    const envelope = first.envelopes[0];
    if (!envelope) throw new Error('Expected fresh native visual envelope.');
    expect(envelope.contractVersion).toBe(3);
    await recordSpecialistLifecycle(root, ID, { status: 'started', envelope, contextId: 'context_fresh_visual' });
    await recordSpecialistLifecycle(root, ID, { status: 'completed', envelope, contextId: 'context_fresh_visual', completion: {
      schemaVersion: 1, specialistId: VISUAL, contractVersion: 3, completionId: 'fresh_visual_scope_review',
      verdict: 'pass', findings: [], evidenceRequests: [], limitations: [] } });
    const reviewed = (await inspectMission(root, ID, { dependencies: {} })).stream.events;
    const obligations = reduceEvidenceObligations({ events: reviewed, expectedSource: 'runtime:codex',
      phase: 'post-implementation', evidenceContext: { dependencies: {} }, proofs: [] });
    expect(obligations.blockingObligationIds).toHaveLength(1);
    expect(reviewed.filter(event => event.kind === 'mission.closed')).toHaveLength(recoverAfterMigration ? 1 : 0);
    expect(projectMissionLifecycle(reviewed)).toMatchObject({ status: 'open' });
    // The supported recorder executes a real verifier against the actual canonical v3 result.
    const verifier = "const fs=require('node:fs');const assert=require('node:assert/strict');const rows=fs.readFileSync(process.argv[1],'utf8').trim().split('\\n').map(JSON.parse);const found=rows.find(e=>e.kind==='specialist.completed'&&e.payload.contextId==='context_fresh_visual');assert.equal(found.payload.completion.contractVersion,3);assert.equal(found.payload.completion.verdict,'pass');process.stdout.write(JSON.stringify({reviewEventId:found.eventId,contractVersion:3,verdict:'pass'}));";
    const proof = await verifyMissionCommand({ roots, missionId: ID, shell: false, echo: false,
      command: [process.execPath, '-e', verifier, logPath] });
    expect(proof.exitCode).toBe(0);
    const proofEvent = (await inspectMission(root, ID, { dependencies: {} })).stream.events
      .find(event => event.kind === 'evidence.recorded' && event.subject === proof.evidenceId);
    const obligationId = obligations.blockingObligationIds[0];
    if (!proofEvent || !obligationId) throw new Error('Expected supported evidence and original obligation.');
    const discharge = await requestSpecialistEvidence(roots, ID, { operation: 'discharge',
      completionEventId: original.eventId, contextId: 'context_visual_author_discharge', obligationIds: [obligationId] });
    const response = { requestEventId: discharge.eventId, contextId: 'context_visual_author_discharge' };
    await recordSpecialistEvidence(roots, ID, 'started', response);
    await recordSpecialistEvidence(roots, ID, 'completed', { ...response, items: [{ obligationId,
      proofEventIds: [proofEvent.eventId], reason: 'The verified canonical v3 scope assessment resolves this original applicability evidence request.' }] });
    const after = await dispatchMissionSpecialists(roots, { kind: 'dispatch', missionId: ID, json: true });
    expect(after.action.kind, JSON.stringify(after)).not.toBe('stop');
    expect(after.envelopes).toHaveLength(0);
    expect((await readFile(logPath, 'utf8')).startsWith(originalBytes)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true });
    await rm(CORE, { recursive: true });
    vi.restoreAllMocks();
  }
});
