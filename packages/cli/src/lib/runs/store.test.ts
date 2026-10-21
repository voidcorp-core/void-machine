import { recordStoppedMissionRecovery } from './mission-recovery.js';
import { execFileSync } from 'node:child_process';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  sealEvidence,
  canonicalJsonHash,
  type MissionSpecialistPlan,
} from '@voidcorp/mission-engine';
import { archiveMission } from './archive.js';
import { computeProjectState } from './project-state.js';
import {
  appendMissionEvent,
  createMission,
  inspectMission,
  loadMissionControllerPlan,
  missionControllerRoutingHash,
  recordMissionEvidence,
  resumeMission,
  writeMissionControllerPlan,
} from './store.js';

const roots: string[] = [];
const ID = 'mis_0123456789abcdef0123456789abcdef';
const DIFF = `sha256:${'a'.repeat(64)}`;
const INPUT = `sha256:${'b'.repeat(64)}`;
const CONTROLLER_PLAN: MissionSpecialistPlan = {
  planHash: `sha256:${'c'.repeat(64)}`,
  context: { status: 'complete', issues: [] },
  specialists: [{
    specialistId: 'core:security-engineer',
    contractVersion: 2,
    inputHash: INPUT,
    state: 'applicable',
    stages: ['pre-implementation', 'post-implementation'],
  }],
};
const CONTROLLER_TICKET = {
  path: 'tickets/DEV-500.md',
  contentHash: `sha256:${'d'.repeat(64)}`,
};

afterEach(async () => {
  delete process.env.MISSION_TEST_TOKEN;
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'void-mission-store-'));
  roots.push(root);
  return root;
}

function proof(stdout = 'ok') {
  return sealEvidence({
    schemaVersion: 1,
    evidenceId: 'evd_00000000-0000-4000-8000-000000000001',
    missionId: ID,
    type: 'command',
    producer: 'void-harness:mission.verify',
    source: 'command:pnpm',
    environment: {
      runtime: 'node:v24.0.0',
      platform: 'darwin',
      arch: 'arm64',
    },
    confidence: 'high',
    inputHash: INPUT,
    diffHash: DIFF,
    startedAt: '2026-07-24T12:00:00.000Z',
    finishedAt: '2026-07-24T12:00:01.000Z',
    durationMs: 1_000,
    status: 'passed',
    exitCode: 0,
    command: ['pnpm', 'test'],
    affectedNodes: [],
    output: { stdout, stderr: '', truncated: false },
    dependencies: [
      { kind: 'diff', key: 'git:working-tree', hash: DIFF },
    ],
  });
}

describe('mission run store', () => {
  it('rejects ordinary transitions after closure while allowing archival metadata', async () => {
    const root = await fixture();
    await createMission(root, { missionId: ID, title: 'Terminal journal', mode: 'team' });
    await appendMissionEvent(root, ID, {
      source: 'void-harness:mission.close',
      kind: 'mission.closed',
      subject: 'mission',
      correlationId: ID,
      payload: { reason: 'interrupted' },
    });

    await expect(appendMissionEvent(root, ID, {
      source: 'runtime:codex',
      kind: 'evidence.recorded',
      subject: 'late-proof',
      correlationId: ID,
      payload: {},
    })).rejects.toThrow('MISSION_CLOSED');
    await expect(appendMissionEvent(root, ID, {
      source: 'void-harness:mission.archive',
      kind: 'mission.archived',
      subject: 'mission',
      correlationId: ID,
      payload: { archive: 'receipt' },
    })).resolves.toMatchObject({ kind: 'mission.archived' });
  });

  it.each([undefined, 'a'.repeat(40)])(
    'round-trips an integrity-bound controller plan and rejects tampering (base=%s)',
    async (baseCommit) => {
    const root = await fixture();
    const routingHash = missionControllerRoutingHash(
      CONTROLLER_PLAN,
      CONTROLLER_TICKET,
      baseCommit,
    );
    await createMission(root, {
      missionId: ID,
      title: 'Persist specialist routing',
      mode: 'team',
      teamController: {
        planHash: CONTROLLER_PLAN.planHash,
        routingHash,
        leadWriterId: 'writer:primary',
        runtime: 'codex',
      },
    });
    await writeMissionControllerPlan(root, ID, CONTROLLER_PLAN, CONTROLLER_TICKET, baseCommit);

    await expect(loadMissionControllerPlan(root, ID)).resolves.toEqual({
      plan: CONTROLLER_PLAN,
      ticket: CONTROLLER_TICKET,
      routingHash,
      ...(baseCommit === undefined ? {} : { baseCommit }),
    });

    await writeFile(
      join(root, '.void', 'machine', 'runs', ID, 'controller-plan.json'),
      `${JSON.stringify({
        schemaVersion: baseCommit === undefined ? 1 : 2,
        routingHash,
        plan: baseCommit === undefined ? { ...CONTROLLER_PLAN, specialists: [] } : CONTROLLER_PLAN,
        ticket: CONTROLLER_TICKET,
        ...(baseCommit === undefined ? {} : { baseCommit: 'b'.repeat(40) }),
      })}\n`,
    );
    await expect(loadMissionControllerPlan(root, ID)).rejects.toThrow(
      'MISSION_CONTROLLER_PLAN_INVALID',
    );
  });

  it('binds the project input recipe to a versioned controller plan and rejects recipe tampering', async () => {
    const root = await fixture();
    await createMission(root, { missionId: ID, title: 'Recipe-bound mission', mode: 'team' });
    const baseCommit = 'a'.repeat(40);
    const routingHash = await writeMissionControllerPlan(root, ID, CONTROLLER_PLAN, CONTROLLER_TICKET,
      baseCommit, 'project-v1');
    expect(routingHash).not.toBe(missionControllerRoutingHash(CONTROLLER_PLAN, CONTROLLER_TICKET, baseCommit));
    expect(await loadMissionControllerPlan(root, ID)).toMatchObject({ inputRecipe: 'project-v1', baseCommit, routingHash });
    const path = join(root, '.void/machine/runs', ID, 'controller-plan.json');
    const stored = JSON.parse(await readFile(path, 'utf8'));
    expect(stored.schemaVersion).toBe(3);
    await writeFile(path, JSON.stringify({ ...stored, inputRecipe: 'runtime-v1' }));
    await expect(loadMissionControllerPlan(root, ID)).rejects.toThrow('MISSION_CONTROLLER_PLAN_INVALID');
  });

  it('refuses to create an evidence-only run for an unknown mission', async () => {
    const root = await fixture();

    await expect(recordMissionEvidence(root, proof())).rejects.toThrow();
  });

  it('creates, verifies and inspects one deterministic run', async () => {
    const root = await fixture();
    await createMission(root, {
      missionId: ID,
      title: 'Evidence ledger',
      mode: 'team',
      now: new Date('2026-07-24T12:00:00.000Z'),
    });
    await recordMissionEvidence(root, proof());

    const inspected = await inspectMission(root, ID, {
      dependencies: { 'git:working-tree': DIFF },
    });

    expect(inspected.verdict).toMatchObject({
      missionId: ID,
      title: 'Evidence ledger',
      status: 'verified',
    });
    expect(inspected.stream.events).toHaveLength(2);
  });

  it('redacts a known secret from mission metadata and events', async () => {
    const root = await fixture();
    process.env.MISSION_TEST_TOKEN = 'top-secret-title-value';
    await createMission(root, {
      missionId: ID,
      title: 'Release top-secret-title-value',
      mode: 'team',
    });
    const run = join(root, '.void', 'machine', 'runs', ID);
    const persisted = [
      await readFile(join(run, 'events.jsonl'), 'utf8'),
      await readFile(join(run, 'mission.json'), 'utf8'),
    ].join('\n');

    expect(persisted).not.toContain('top-secret-title-value');
    expect(persisted).toContain('[REDACTED]');
  });

  it('rejects sealed evidence that still contains a known secret', async () => {
    const root = await fixture();
    await createMission(root, {
      missionId: ID,
      title: 'Reject unsafe proof',
      mode: 'team',
    });
    process.env.MISSION_TEST_TOKEN = 'top-secret-proof-value';

    await expect(
      recordMissionEvidence(root, proof('top-secret-proof-value')),
    ).rejects.toThrow('MISSION_EVIDENCE_CONTAINS_SECRET');
    const log = await readFile(
      join(root, '.void', 'machine', 'runs', ID, 'events.jsonl'),
      'utf8',
    );
    expect(log).not.toContain('top-secret-proof-value');
  });

  it('quarantines invalid JSONL and degrades the verdict', async () => {
    const root = await fixture();
    await createMission(root, {
      missionId: ID,
      title: 'Corrupt run',
      mode: 'team',
    });
    const log = join(root, '.void', 'machine', 'runs', ID, 'events.jsonl');
    await appendFile(log, '{"secret":"super-secret-token"\n', 'utf8');

    const inspected = await inspectMission(
      root,
      ID,
      { dependencies: { 'git:working-tree': DIFF } },
      { secrets: ['super-secret-token'] },
    );
    const quarantine = await readFile(inspected.quarantineFiles[0] ?? '', 'utf8');

    expect(inspected.verdict.status).toBe('degraded');
    expect(inspected.quarantineFiles).toHaveLength(1);
    expect(quarantine).not.toContain('super-secret-token');
  });

  it('archives only a completed green-or-excepted run as jsonl.gz', async () => {
    const root = await fixture();
    await createMission(root, {
      missionId: ID,
      title: 'Archive run',
      mode: 'team',
    });
    await recordMissionEvidence(root, proof());

    const archived = await archiveMission(root, ID, {
      dependencies: { 'git:working-tree': DIFF },
    });

    expect(archived.path).toMatch(/\.jsonl\.gz$/);
    expect(archived.verdict).toBe('verified');
  });

  it('hashes project changes but excludes its own .void evidence', async () => {
    const root = await fixture();
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    await writeFile(join(root, 'tracked.ts'), 'export const value = 1;\n');
    execFileSync('git', ['add', 'tracked.ts'], { cwd: root });
    const initial = await computeProjectState(root);
    await mkdir(join(root, '.void'), { recursive: true });
    await writeFile(join(root, '.void', 'runtime-noise'), 'ignored\n');
    const withEvidence = await computeProjectState(root);
    await writeFile(join(root, 'tracked.ts'), 'export const value = 2;\n');
    const changed = await computeProjectState(root);

    expect(withEvidence.diffHash).toBe(initial.diffHash);
    expect(changed.diffHash).not.toBe(initial.diffHash);
    expect(changed.affectedNodes).toContain('file:tracked.ts');
  });

  it('records one resume checkpoint and never replays a proven side effect', async () => {
    const root = await fixture();
    await createMission(root, {
      missionId: ID,
      title: 'Resume safely',
      mode: 'team',
      now: new Date('2026-07-24T12:00:00.000Z'),
    });
    await appendMissionEvent(root, ID, {
      source: 'runtime:codex',
      kind: 'orchestration.node-defined',
      subject: 'security-review',
      correlationId: ID,
      payload: {
        tier: 'critical',
        inputHash: INPUT,
        independenceEssential: true,
        sideEffectKey: 'effect:security-review',
      },
    });
    await appendMissionEvent(root, ID, {
      source: 'runtime:codex',
      kind: 'orchestration.node-started',
      subject: 'security-review',
      correlationId: ID,
      payload: { attempt: 'initial' },
    });
    await appendMissionEvent(root, ID, {
      source: 'runtime:codex',
      kind: 'side-effect.completed',
      subject: 'effect:security-review',
      correlationId: ID,
      payload: {
        nodeId: 'security-review',
        receiptId: 'rcp_security_001',
        inputHash: INPUT,
      },
    });

    const first = await resumeMission(root, ID);
    const second = await resumeMission(root, ID);
    const inspected = await inspectMission(root, ID, { dependencies: {} });

    expect(first).toMatchObject({
      recorded: true,
      decision: { action: { kind: 'finalize-node' } },
    });
    expect(second).toMatchObject({
      recorded: false,
      decision: { action: { kind: 'finalize-node' } },
    });
    expect(inspected.stream.events.filter((item) =>
      item.kind === 'mission.resumed'
    )).toHaveLength(1);
  });
});


describe('recovered mission transition projection', () => {
  it('admits ordinary transitions after recovery while preserving the historical closure', async () => {
    const root = await fixture();
    await createMission(root, { missionId: ID, title: 'Recovered transition', mode: 'team' });
    const completed = await appendMissionEvent(root, ID, { source: 'runtime:codex',
      kind: 'specialist.completed', subject: 'core:test-qa-engineer', correlationId: ID, payload: {
        stage: 'pre-implementation', reviewRound: 1, inputHash: `sha256:${'a'.repeat(64)}`,
        contextId: 'context_recovery_fixture', completion: { schemaVersion: 1,
          specialistId: 'core:test-qa-engineer', contractVersion: 2, completionId: 'completion_fixture',
          verdict: 'degraded', findings: [], evidenceRequests: ['Clarify proof timing.'],
          limitations: ['Proof timing unresolved.'] },
      } });
    await appendMissionEvent(root, ID, { source: 'void-harness:mission.close',
      kind: 'mission.closed', subject: 'mission', correlationId: ID, payload: { reason: 'controller-stop' } });
    const prior = (await inspectMission(root, ID, { dependencies: {} })).stream.events;
    const closure = prior.at(-1);
    if (!closure) throw new Error('Expected original closure.');
    const artifact = { path: 'docs/clarification.md', sha256: `sha256:${'a'.repeat(64)}` };
    await recordStoppedMissionRecovery(root, ID, { schemaVersion: 1,
      closureEventId: closure.eventId, expectedJournalHash: canonicalJsonHash(prior),
      disposition: { kind: 'review-blocker', completionEventIds: [completed.eventId], resolutionArtifact: artifact },
    }, { stage: 'pre-implementation', expectedSource: 'runtime:codex', maxRounds: 2,
      currentInputHashes: { 'core:test-qa-engineer': artifact.sha256 },
      contractVersions: { 'core:test-qa-engineer': 2 }, resolutionArtifact: artifact });
    await expect(appendMissionEvent(root, ID, { source: 'runtime:codex',
      kind: 'agent.observed', subject: 'agent', correlationId: ID, payload: {} })).resolves.toBeDefined();
    const events = (await inspectMission(root, ID, { dependencies: {} })).stream.events;
    expect(events.filter(value => value.kind === 'mission.closed')).toHaveLength(1);
    expect(events.at(-1)?.kind).toBe('agent.observed');
  });
});
