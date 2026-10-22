import { recordStoppedMissionRecovery } from '../lib/runs/mission-recovery.js';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJsonHash, createSpecialistDispatch } from '@voidcorp/mission-engine';
import type { MissionSpecialistPlan } from '@voidcorp/mission-engine';
import { describe, expect, it } from 'vitest';
import { writeExcludeBlock } from '../lib/git-exclude.js';
import { resolveProjectRoots } from '../lib/project-roots.js';
import { recordSpecialistLifecycle, recordSpecialistRequests } from '../lib/runs/specialist-lifecycle.js';
import {
  appendMissionEvent,
  createMission,
  inspectMission,
  missionControllerRoutingHash,
  writeMissionControllerPlan,
} from '../lib/runs/store.js';
import { adapterFor } from '../lib/runtime-adapters.js';
import {
  constrainCapabilityByAttestation,
  coordinatorRuntimeIdentity,
  dispatchMissionSpecialists,
  missionRecoveryExitCode,
  missionVerdictExitCode,
  normalizeControllerTicketPath,
  parseMissionArgs,
  planMission,
  recordLeadWriterCompletion,
  recordMissionClosure,
  renderMissionFailure,
} from './mission.js';

const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'core');

// Each helper runs inside its test's timed body, through real Git, planning and
// journal transitions. None injects a successful controller state.
async function dispatchFixture(implementationPath = 'runtime.ts', boundedReview = false) {
  const root = await mkdtemp(join(tmpdir(), 'void-mission-dispatch-'));
  const missionId = 'mis_0123456789abcdef0123456789abcdef';
  await writeFile(join(root, 'package.json'), JSON.stringify({
    packageManager: 'pnpm@10.34.5',
    devDependencies: { typescript: '7.0.2', next: '99.0.0' },
  }));
  const ticketBody = '# Runtime API review\n\nVerify the tested API runtime and observability change.\nPreparation: `docs/preparation.md`.\n';
  await writeFile(join(root, 'DEV-500.md'), ticketBody);
  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'docs/preparation.md'), 'Initial preparation: review freshness needs explanation.\n');
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', 'package.json', 'DEV-500.md', 'docs/preparation.md'], { cwd: root });
  execFileSync('git', [
    '-c', 'user.name=Void Test',
    '-c', 'user.email=void@example.test',
    'commit', '--quiet', '-m', 'test: seed mission fixture',
  ], { cwd: root });
  if (implementationPath !== '') {
    await writeFile(join(root, implementationPath), implementationPath === 'runtime.ts'
      ? 'export const ready = true;\n' : 'Ready.\n');
    execFileSync('git', ['add', implementationPath], { cwd: root });
  }
  const plan = await planMission(root, 'DEV-500.md', '2026-08-21T12:00:00.000Z');
  const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root, encoding: 'utf8',
  }).trim();
  const controllerPlan: MissionSpecialistPlan = {
    planHash: plan.planHash,
    context: plan.context,
    specialists: plan.specialists.map((specialist) => ({
      specialistId: specialist.specialistId,
      contractVersion: specialist.contractVersion,
      inputHash: specialist.proof.inputHash,
      state: specialist.state,
      stages: specialist.stages,
    })),
  };
  const ticketBinding = {
    path: 'DEV-500.md',
    contentHash: `sha256:${createHash('sha256').update(ticketBody).digest('hex')}`,
  };
  await createMission(root, {
    missionId,
    title: 'Runtime API review',
    mode: 'team',
    teamController: {
      planHash: plan.planHash,
      routingHash: missionControllerRoutingHash(controllerPlan, ticketBinding, baseCommit),
      leadWriterId: 'writer:primary',
      runtime: 'codex',
      ...(boundedReview ? { reviewPolicy: 'bounded-corrections-v1' as const } : {}),
    },
  });
  await writeMissionControllerPlan(root, missionId, controllerPlan, ticketBinding, baseCommit);
  await writeFile(join(root, 'package.json'), JSON.stringify({
    packageManager: 'pnpm@10.34.5',
    devDependencies: { typescript: '7.0.2', next: '99.0.0' },
    scripts: { lint: 'tsc --noEmit' },
  }));
  const input = {
    kind: 'dispatch' as const,
    missionId,
    json: true,
  };

  const capability = {
    status: 'degraded' as const,
    limitations: ['fixture cannot enforce native isolation'],
  };
  return { root, missionId, ticketBody, plan, input, capability };
}

type DispatchFixture = Awaited<ReturnType<typeof dispatchFixture>>;
type SpecialistDispatch = Awaited<ReturnType<typeof dispatchMissionSpecialists>>;

async function completeDispatchedSpecialists(
  fixture: DispatchFixture,
  dispatch: SpecialistDispatch,
  evidenceRequest = '',
) {
  for (const [index, envelope] of dispatch.envelopes.entries()) {
    const contextId = `ctx_dispatch_${envelope.stage}_${index}_${envelope.agentName}`;
    await recordSpecialistLifecycle(fixture.root, fixture.missionId, {
      status: 'started', envelope, contextId,
    });
    await recordSpecialistLifecycle(fixture.root, fixture.missionId, {
      status: 'completed', envelope, contextId,
      completion: {
        schemaVersion: 1, specialistId: envelope.specialistId,
        contractVersion: envelope.contractVersion,
        completionId: `cmp_dispatch_${envelope.stage}_${index}_${envelope.agentName}`,
        verdict: 'pass', findings: [],
        evidenceRequests: index === 0 && evidenceRequest !== '' ? [evidenceRequest] : [],
        limitations: [],
      },
    });
  }
}

// Reconstruct a historical dispatch through the existing transport. The new
// controller must read these real lifecycle events without issuing another panel.
async function legacyPreparation(fixture: DispatchFixture, reviewRound = 1) {
  const { root, missionId, plan } = fixture;
  const live = await planMission(root, 'DEV-500.md', '2026-08-21T12:00:00.000Z');
  const action = { kind: 'invoke-specialists' as const, stage: 'pre-implementation' as const,
    reviewRound, specialistIds: plan.specialists.filter(item => item.state === 'applicable'
      && item.stages.includes('pre-implementation')).map(item => item.specialistId) };
  const envelopes = createSpecialistDispatch({ missionId, runtime: 'codex', plan, action,
    currentInputHashes: Object.fromEntries(live.specialists.map(item =>
      [item.specialistId, item.proof.inputHash])),
    contextContent: { diff: '', touchedPaths: [], lens: 'full', budgetTokens: 6000,
      artifacts: [{ path: 'DEV-500.md', text: fixture.ticketBody }] },
  });
  await recordSpecialistRequests(root, missionId, envelopes, plan.planHash);
  return { planHash: plan.planHash, phase: 'preparation', action, envelopes };
}

async function admittedWriterFixture() {
  const fixture = await dispatchFixture();
  const { root, input, capability } = fixture;
  const preparation = await dispatchMissionSpecialists(
    resolveProjectRoots(root), input, '2026-08-21T12:00:00.000Z', capability,
  );
  await completeDispatchedSpecialists(fixture, preparation);
  const admission = await dispatchMissionSpecialists(
    resolveProjectRoots(root), input, '2026-08-21T12:00:00.000Z', capability,
  );
  return { ...fixture, admission };
}

async function postImplementationFixture() {
  const fixture = await admittedWriterFixture();
  const { root, missionId, input, capability } = fixture;
  await recordLeadWriterCompletion(root, { kind: 'writer-event', missionId, json: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({
    packageManager: 'pnpm@10.34.5',
    devDependencies: { typescript: '7.0.2', next: '99.0.0' },
    scripts: { test: 'vitest run' },
  }));
  execFileSync('git', ['add', 'package.json'], { cwd: root });
  execFileSync('git', [
    '-c', 'user.name=Void Test',
    '-c', 'user.email=void@example.test',
    'commit', '--quiet', '-m', 'test: commit implementation fixture',
  ], { cwd: root });
  await writeFile(join(root, 'docs/preparation.md'),
    'Preparation: review identity follows bytes across staging and commits.\n');
  const post = await dispatchMissionSpecialists(
    resolveProjectRoots(root),
    input,
    '2026-08-21T12:01:00.000Z',
    capability,
  );
  return { ...fixture, post };
}

async function committedReviewFixture() {
  const fixture = await postImplementationFixture();
  const { root, input, capability, post } = fixture;
  execFileSync('git', ['add', 'package.json', 'docs/preparation.md'], { cwd: root });
  await completeDispatchedSpecialists(fixture, post);
  execFileSync('git', [
    '-c', 'user.name=Void Test', '-c', 'user.email=void@example.test',
    'commit', '--quiet', '-m', 'test: commit reviewed content',
  ], { cwd: root });
  const committed = await dispatchMissionSpecialists(
    resolveProjectRoots(root), input, '2026-08-21T12:01:30.000Z', capability,
  );
  return { ...fixture, committed };
}

describe('parseMissionArgs', () => {
  it('persists controller ticket paths with portable separators', () => {
    expect(normalizeControllerTicketPath('tickets\\DEV-500.md')).toBe('tickets/DEV-500.md');
    expect(normalizeControllerTicketPath('tickets/DEV-500.md')).toBe('tickets/DEV-500.md');
  });

  it('defaults mission start to team mode', () => {
    expect(
      parseMissionArgs(['start', '--title', 'Ship evidence']),
    ).toEqual({
      kind: 'start',
      title: 'Ship evidence',
      mode: 'team',
      json: false,
    });
  });

  it('derives controller runtime identity instead of accepting a caller choice', () => {
    expect(parseMissionArgs([
      'start',
      '--title',
      'Review API',
      '--ticket',
      'DEV-500.md',
    ])).toEqual({
      kind: 'start',
      title: 'Review API',
      mode: 'team',
      ticketPath: 'DEV-500.md',
      json: false,
    });
    expect(coordinatorRuntimeIdentity({
      CLAUDECODE: '1',
      CODEX_SESSION_ID: 'codex-session',
    })).toEqual({ runtime: 'codex', attested: true });
    expect(coordinatorRuntimeIdentity({ CLAUDECODE: '1' })).toEqual({
      runtime: 'claude',
      attested: true,
    });
    const unknown = coordinatorRuntimeIdentity({});
    expect(unknown).toEqual({ runtime: 'codex', attested: false });
    expect(constrainCapabilityByAttestation(unknown, {
      status: 'available',
      limitations: [],
    })).toMatchObject({ status: 'degraded' });
  });

  it('keeps command argv separate from mission options', () => {
    expect(
      parseMissionArgs([
        'verify',
        '--id',
        'mis_0123456789abcdef0123456789abcdef',
        '--json',
        '--',
        'pnpm',
        'test',
      ]),
    ).toEqual({
      kind: 'verify',
      missionId: 'mis_0123456789abcdef0123456789abcdef',
      shell: false,
      command: ['pnpm', 'test'],
      json: true,
    });
  });

  it('passes --help through to the verified command', () => {
    expect(
      parseMissionArgs([
        'verify',
        '--id',
        'mis_0123456789abcdef0123456789abcdef',
        '--',
        'node',
        '--help',
      ]),
    ).toMatchObject({
      kind: 'verify',
      command: ['node', '--help'],
    });
  });

  it('requires one explicit command string for shell mode', () => {
    expect(
      parseMissionArgs([
        'verify',
        '--id',
        'mis_0123456789abcdef0123456789abcdef',
        '--shell',
        '--',
        'pnpm test',
        '&& echo unsafe',
      ]),
    ).toMatchObject({
      kind: 'invalid',
      code: 'MISSION_USAGE',
    });
  });

  it('keeps prune dry-run unless apply is explicit', () => {
    expect(
      parseMissionArgs(['prune', '--older-than', '30']),
    ).toEqual({
      kind: 'prune',
      olderThanDays: 30,
      apply: false,
      json: false,
    });
  });

  it('parses an idempotent mission resume request', () => {
    expect(parseMissionArgs([
      'resume',
      '--id',
      'mis_0123456789abcdef0123456789abcdef',
      '--json',
    ])).toEqual({
      kind: 'resume',
      missionId: 'mis_0123456789abcdef0123456789abcdef',
      json: true,
    });
  });

  it('parses deterministic mission planning', () => {
    expect(parseMissionArgs([
      'plan',
      '--ticket',
      'tickets/DEV-435.md',
      '--json',
    ])).toEqual({
      kind: 'plan',
      ticketPath: 'tickets/DEV-435.md',
      json: true,
    });
  });

  it('parses a runtime-neutral specialist dispatch request', () => {
    expect(parseMissionArgs([
      'dispatch',
      '--id',
      'mis_0123456789abcdef0123456789abcdef',
      '--json',
    ])).toEqual({
      kind: 'dispatch',
      missionId: 'mis_0123456789abcdef0123456789abcdef',
      json: true,
    });
  });

  it('parses a bounded specialist lifecycle event file', () => {
    expect(parseMissionArgs([
      'specialist-event',
      '--id',
      'mis_0123456789abcdef0123456789abcdef',
      '--status',
      'completed',
      '--input',
      '.void/machine/specialist-completion.json',
      '--json',
    ])).toEqual({
      kind: 'specialist-event',
      missionId: 'mis_0123456789abcdef0123456789abcdef',
      status: 'completed',
      inputPath: '.void/machine/specialist-completion.json',
      json: true,
    });
  });

  it('parses an attributed lead-writer completion', () => {
    expect(parseMissionArgs([
      'writer-event',
      '--id',
      'mis_0123456789abcdef0123456789abcdef',
      '--json',
    ])).toEqual({
      kind: 'writer-event',
      missionId: 'mis_0123456789abcdef0123456789abcdef',
      json: true,
    });
  });

  it('parses an explicit mission closure used by lifecycle learning', () => {
    expect(parseMissionArgs([
      'close',
      '--id',
      'mis_0123456789abcdef0123456789abcdef',
      '--reason',
      'interrupted',
      '--json',
    ])).toEqual({
      kind: 'close',
      missionId: 'mis_0123456789abcdef0123456789abcdef',
      reason: 'interrupted',
      json: true,
    });
  });

  it.each([
    ['manual stage bypass', ['dispatch', '--id', 'mis_0123456789abcdef0123456789abcdef', '--stage', 'post-implementation']],
    ['caller-selected runtime', ['start', '--title', 'x', '--ticket', 'ticket.md', '--runtime', 'claude']],
    ['fast controller start', ['start', '--title', 'x', '--ticket', 'ticket.md', '--mode', 'fast']],
    ['invalid lifecycle status', ['specialist-event', '--id', 'mis_0123456789abcdef0123456789abcdef', '--status', 'requested', '--input', 'event.json']],
    ['invalid closure reason', ['close', '--id', 'mis_0123456789abcdef0123456789abcdef', '--reason', 'complete']],
  ])('rejects unsafe specialist input: %s', (_name, args) => {
    expect(parseMissionArgs(args)).toMatchObject({ kind: 'invalid' });
  });

  it.each([
    [['plan'], 'missing required option --ticket'],
    [['plan', '--ticket'], 'missing value for --ticket'],
    [['plan', '--ticket', 'ticket.md', '--unknown'], "unknown option '--unknown'"],
  ] as const)('rejects invalid plan arguments', (args, problem) => {
    expect(parseMissionArgs(args)).toMatchObject({
      kind: 'invalid',
      code: 'MISSION_USAGE',
      problem,
    });
  });

  it('fails the process for stale, blocked, or degraded verdicts', () => {
    expect(missionVerdictExitCode('verified')).toBe(0);
    expect(missionVerdictExitCode('shipped-with-exception')).toBe(0);
    expect(missionVerdictExitCode('unverified')).toBe(1);
    expect(missionVerdictExitCode('blocked')).toBe(1);
    expect(missionVerdictExitCode('degraded')).toBe(1);
  });

  it('fails resume when no safe recovery decision is actionable', () => {
    expect(missionRecoveryExitCode('active')).toBe(0);
    expect(missionRecoveryExitCode('complete')).toBe(0);
    expect(missionRecoveryExitCode('waiting')).toBe(1);
    expect(missionRecoveryExitCode('blocked')).toBe(1);
    expect(missionRecoveryExitCode('degraded')).toBe(1);
  });

  it('plans a real ticket deterministically and degrades outside git', async () => {
    const root = await mkdtemp(join(tmpdir(), 'void-mission-plan-'));
    await writeFile(join(root, 'package.json'), JSON.stringify({
      packageManager: 'pnpm@10.34.5',
      devDependencies: { vitest: '^4.1.9' },
    }));
    await writeFile(
      join(root, 'DEV-435.md'),
      '# Compile policies\n\nAdd a tested API module with observability.\n',
    );
    const first = await planMission(
      root,
      'DEV-435.md',
      '2026-07-26T00:00:00Z',
    );
    const second = await planMission(
      root,
      'DEV-435.md',
      '2026-07-26T00:01:00Z',
    );
    expect(first.planHash).toBe(second.planHash);
    expect(first.context).toMatchObject({ status: 'degraded' });
    expect(first.applicability).toHaveLength(13);
    expect(first.specialists).toHaveLength(16);
    expect(first.specialists.map((item) => item.specialistId)).toEqual(expect.arrayContaining([
      'core:data-migration-engineer',
      'core:api-integration-engineer',
      'core:observability-sre-engineer',
      'core:accessibility-specialist',
      'core:devex-docs-engineer',
      'core:independent-code-reviewer',
      'core:pdf-specialist',
    ]));
    expect(first.specialists.every((item) => item.proof.inputHash === first.inputHash)).toBe(true);
  });

  it.each(['proof-1.txt', 'docs/guide.md', 'settings.yaml', ''])(
    'requires independent review for a bounded implementation planned with "%s"', async path => {
      const fixture = await dispatchFixture(path, true);
      const { root, missionId, plan, input, capability } = fixture;
      const reviewer = plan.specialists.find(item => item.specialistId === 'core:independent-code-reviewer');
      expect(reviewer).toMatchObject({ state: 'applicable', stages: ['post-implementation'] });
      expect(reviewer?.proof.inputs).toContain('profile-base');
      expect(reviewer?.proof.inputs).not.toContain('code-change');
      const preparation = await dispatchMissionSpecialists(
        resolveProjectRoots(root), input, '2026-08-21T12:00:00.000Z', capability,
      );
      await completeDispatchedSpecialists(fixture, preparation);
      const admission = await dispatchMissionSpecialists(
        resolveProjectRoots(root), input, '2026-08-21T12:00:01.000Z', capability,
      );
      expect(admission.action.kind).toBe('run-lead-writer');
      if (path === '') await writeFile(join(root, 'proof-1.txt'), 'Ready.\n');
      execFileSync('git', ['add', 'package.json', path || 'proof-1.txt'], { cwd: root });
      execFileSync('git', ['-c', 'user.name=Void Test', '-c', 'user.email=void@example.test',
        'commit', '--quiet', '-m', 'test: commit text implementation'], { cwd: root });
      await recordLeadWriterCompletion(root, { kind: 'writer-event', missionId, json: true });
      const post = await dispatchMissionSpecialists(
        resolveProjectRoots(root), input, '2026-08-21T12:00:02.000Z', capability,
      );
      expect(post.action).toMatchObject({ kind: 'invoke-specialists',
        specialistIds: ['core:independent-code-reviewer'], stage: 'post-implementation',
        reviewScope: { kind: 'general' } });
      expect(post.envelopes).toHaveLength(1);
      expect(post.envelopes[0]?.reviewSubject?.reviewedCommit).toBe(
        execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      );
      const inspected = await inspectMission(root, missionId, { dependencies: {} });
      expect(inspected.stream.events.some(item => item.kind === 'mission.closed')).toBe(false);
    },
  );

  it('dispatches the writer directly without requesting preparation specialists', async () => {
    const { root, missionId, input, capability } = await dispatchFixture();
    const dispatch = await dispatchMissionSpecialists(resolveProjectRoots(root), input,
      '2026-08-21T12:00:00.000Z', capability);
    expect(dispatch.action).toEqual({ kind: 'run-lead-writer', writerId: 'writer:primary' });
    expect(dispatch.envelopes).toEqual([]);
    const events = (await inspectMission(root, missionId, { dependencies: {} })).stream.events;
    expect(events.filter(event => event.kind === 'specialist.requested')).toEqual([]);
  });

  it('continues historical passes and an empty correction after unrelated tests without replay', async () => {
    const fixture = await dispatchFixture();
    const { root, missionId, input, capability, plan } = fixture;
    const original = await legacyPreparation(fixture);
    await writeFile(join(root, 'runtime.test.ts'), 'export const regression = true;\n');
    await completeDispatchedSpecialists(fixture, original);
    await appendMissionEvent(root, missionId, { kind: 'lead-writer.requested', correlationId: missionId,
      source: 'void-harness:mission.dispatch', subject: 'writer:primary',
      payload: { writerId: 'writer:primary', planHash: plan.planHash,
        actionKind: 'run-preparation-correction', implementationRound: 1 } });
    await recordLeadWriterCompletion(root, { kind: 'writer-event', missionId, json: true });
    await legacyPreparation(fixture, 2);
    const before = (await inspectMission(root, missionId, { dependencies: {} })).stream.events;
    const dispatch = await dispatchMissionSpecialists(resolveProjectRoots(root), input,
      '2026-08-21T12:00:01.000Z', capability);
    expect(dispatch.action).toEqual({ kind: 'run-lead-writer', writerId: 'writer:primary' });
    expect(dispatch.nextWriterRound).toBe(2);
    expect(dispatch.envelopes).toEqual([]);
    const after = (await inspectMission(root, missionId, { dependencies: {} })).stream.events;
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length).map(event => event.kind)).toEqual(['lead-writer.requested']);
    expect(after.filter(event => event.kind === 'specialist.started')).toHaveLength(original.envelopes.length);
  });

  it('dispatches every post-implementation lens idempotently within the runtime width', async () => {
    const { root, missionId, plan, input, capability, post: first } = await postImplementationFixture();
    expect(plan.profiles).toContainEqual(expect.objectContaining({
      profileId: 'core:typescript', state: 'applicable', sourceReviewRequired: false,
    }));
    expect(plan.context).toEqual({ status: 'complete', issues: [] });
    const second = await dispatchMissionSpecialists(resolveProjectRoots(root), input, '2026-08-21T12:00:00.000Z', capability);
    const inspected = await inspectMission(root, missionId, { dependencies: {} });
    const requested = inspected.stream.events.filter((event) =>
      event.kind === 'specialist.requested');

    expect(first.envelopes.length).toBeGreaterThan(0);
    for (const envelope of first.envelopes) {
      expect(envelope.contextPack.omitted.join(' ')).toContain('core:nextjs-config');
      expect(envelope.contextPack.omitted.join(' ')).toContain('version-uncovered:nextjs@99.0.0');
      expect(envelope.contextPack.artifacts).toContainEqual({
        path: 'docs/preparation.md',
        text: expect.stringContaining('Preparation: review identity follows bytes across staging and commits.'),
      });
    }
    // The lens width is a concurrency ceiling, never a truncation. The controller
    // requires every applicable completion before it will return `verified`, so
    // dropping an envelope to fit a narrow runtime would not run a smaller pass —
    // it would stall the mission on a completion nobody was asked for.
    const narrow = await dispatchMissionSpecialists(
      resolveProjectRoots(root),
      input,
      '2026-08-21T12:00:00.000Z',
      capability,
      { runtime: 'claude', maxConcurrentAgents: 1, agentToAgent: false },
    );
    expect(narrow.envelopes.map((envelope) => envelope.specialistId))
      .toEqual(first.envelopes.map((envelope) => envelope.specialistId));
    expect(narrow.lensPlan?.lenses).toBe(1);
    expect(narrow.lensPlan?.declaredLenses).toBe(first.envelopes.length);
    expect(narrow.lensPlan?.mode).toBe('serial');
    // Says which runtime it planned for, so a result can never imply a wider pass.
    expect(narrow.lensPlan?.reason).toContain('claude');
    expect(first.lensPlan?.mode).toBe('fan-out');
    expect(first.action).toMatchObject({
      kind: 'invoke-specialists',
      stage: 'post-implementation',
    });
    expect(second.envelopes).toEqual(first.envelopes);
    expect(requested).toHaveLength(first.envelopes.length);
    expect(requested.map((event) => event.subject)).toEqual(
      first.envelopes.map((envelope) => envelope.specialistId),
    );
  });

  it('blocks writer and closure on current evidence requests without journal mutation', async () => {
    const fixture = await dispatchFixture();
    const { root, missionId, input, capability } = fixture;
    const first = await legacyPreparation(fixture);
    await completeDispatchedSpecialists(fixture, first,
      'Explain how corrected preparation invalidates old reviews.');
    const correction = await dispatchMissionSpecialists(
      resolveProjectRoots(root), input, '2026-08-21T12:00:00.000Z', capability,
    );
    expect(correction.action).toMatchObject({ kind: 'await-evidence' });
    expect(correction.action.kind === 'await-evidence' ? correction.action.reasons.length : 0)
      .toBeGreaterThan(0);
    const waiting = (await inspectMission(root, missionId, { dependencies: {} })).stream.events;
    expect(waiting.some(event => event.kind === 'mission.closed')).toBe(false);
    expect(waiting.some(event => event.kind === 'lead-writer.requested')).toBe(false);
    await expect(recordLeadWriterCompletion(root, { kind: 'writer-event', missionId, json: true }))
      .rejects.toThrow('MISSION_WRITER_EVENT_INVALID: no controller writer request is pending');
    expect((await inspectMission(root, missionId, { dependencies: {} })).stream.events)
      .toEqual(waiting);
  });

  it('admits the ordinary writer and records its completion once', async () => {
    const { root, missionId, ticketBody, plan, admission: correction } = await admittedWriterFixture();
    expect(correction).toMatchObject({ planHash: plan.planHash,
      action: { kind: 'run-lead-writer', writerId: 'writer:primary' }, nextWriterRound: 1 });
    expect(await readFile(join(root, 'DEV-500.md'), 'utf8')).toBe(ticketBody);
    await recordLeadWriterCompletion(root, {
      kind: 'writer-event',
      missionId,
      json: true,
    });
    await recordLeadWriterCompletion(root, { kind: 'writer-event', missionId, json: true });
    const writerCompletions = (await inspectMission(root, missionId, {
      dependencies: {},
    })).stream.events.filter((event) => event.kind === 'lead-writer.completed');
    expect(writerCompletions).toHaveLength(1);
  });

  it('binds post-implementation review to changed bytes while preserving staging identity', async () => {
    const { root, plan, input, capability, post } = await postImplementationFixture();
    expect(post.planHash).toBe(plan.planHash);
    expect(post.action).toMatchObject({
      kind: 'invoke-specialists',
      stage: 'post-implementation',
    });
    expect(post.envelopes.length).toBeGreaterThan(0);
    expect(post.envelopes[0]?.contextPack.touchedPaths).toContain('package.json');
    expect(post.envelopes[0]?.contextPack.diff).toContain('vitest run');

    const subject = (dispatch: typeof post) => dispatch.envelopes.map((envelope) => ({
      specialistId: envelope.specialistId,
      inputHash: envelope.inputHash,
      diff: envelope.contextPack.diff,
      touchedPaths: envelope.contextPack.touchedPaths,
    }));
    expect(post.envelopes[0]?.contextPack.diff).toContain('vitest run');
    // A real content edit on the same path must invalidate the review.
    await writeFile(join(root, 'package.json'), JSON.stringify({
      packageManager: 'pnpm@10.34.5',
      devDependencies: { typescript: '7.0.2', next: '99.0.0' },
      scripts: { test: 'vitest run --changed' },
    }));
    const edited = await dispatchMissionSpecialists(
      resolveProjectRoots(root), input, '2026-08-21T12:01:10.000Z', capability,
    );
    expect.soft(edited.envelopes.map((envelope) => envelope.inputHash))
      .not.toEqual(post.envelopes.map((envelope) => envelope.inputHash));
    await writeFile(join(root, 'package.json'), JSON.stringify({
      packageManager: 'pnpm@10.34.5',
      devDependencies: { typescript: '7.0.2', next: '99.0.0' },
      scripts: { test: 'vitest run' },
    }));
    execFileSync('git', ['add', 'package.json', 'docs/preparation.md'], { cwd: root });
    const staged = await dispatchMissionSpecialists(
      resolveProjectRoots(root), input, '2026-08-21T12:01:20.000Z', capability,
    );
    expect.soft(subject(staged)).toEqual(subject(post));
  });

  it('reuses committed review and requests correction after a later content change', async () => {
    const { root, input, capability, committed } = await committedReviewFixture();
    expect(committed.action.kind).toBe('run-verification');
    expect(committed.envelopes).toEqual([]);
    await writeFile(join(root, 'package.json'), JSON.stringify({
      packageManager: 'pnpm@10.34.5',
      devDependencies: { typescript: '7.0.2', next: '99.0.0' }, scripts: { test: 'vitest run --changed' },
    }));
    const stale = await dispatchMissionSpecialists(
      resolveProjectRoots(root), input, '2026-08-21T12:01:35.000Z', capability,
    );
    expect(stale.action).toMatchObject({ kind: 'run-correction' });
    expect(stale.envelopes).toEqual([]);
  });

  it('refuses untracked, binary and changed-ticket review inputs without new requests', async () => {
    const { root, missionId, input, capability } = await postImplementationFixture();
    // A file absent from Git's diff cannot silently receive a review proof.
    await writeFile(join(root, 'new-module.ts'), 'export const answer = 42;\n');
    const requestsBeforeUntracked = (await inspectMission(root, missionId, {
      dependencies: {},
    })).stream.events.filter((event) => event.kind === 'specialist.requested').length;
    await expect(dispatchMissionSpecialists(
      resolveProjectRoots(root), input, '2026-08-21T12:01:40.000Z', capability,
    )).rejects.toThrow('MISSION_REVIEW_UNTRACKED');
    expect((await inspectMission(root, missionId, { dependencies: {} })).stream.events
      .filter((event) => event.kind === 'specialist.requested')).toHaveLength(requestsBeforeUntracked);
    execFileSync('git', ['add', 'new-module.ts'], { cwd: root });

    await writeFile(join(root, 'new-module.ts'), Buffer.from([0, 1, 2, 3]));
    execFileSync('git', ['add', 'new-module.ts'], { cwd: root });
    await expect(dispatchMissionSpecialists(
      resolveProjectRoots(root), input, '2026-08-21T12:01:50.000Z', capability,
    )).rejects.toThrow('MISSION_REVIEW_BINARY_UNSUPPORTED');
    await writeFile(join(root, 'new-module.ts'), 'export const answer = 42;\n');
    execFileSync('git', ['add', 'new-module.ts'], { cwd: root });

    const requestsBeforeTicketChange = (await inspectMission(root, missionId, {
      dependencies: {},
    })).stream.events.filter((event) => event.kind === 'specialist.requested').length;
    await writeFile(
      join(root, 'DEV-500.md'),
      '# Different ticket\n\nChange authentication scope.\n',
    );
    await expect(dispatchMissionSpecialists(
      resolveProjectRoots(root),
      input,
      '2026-08-21T12:02:00.000Z',
      capability,
    )).rejects.toThrow('MISSION_TICKET_CHANGED');
    const requestsAfterTicketChange = (await inspectMission(root, missionId, {
      dependencies: {},
    })).stream.events.filter((event) => event.kind === 'specialist.requested').length;
    expect(requestsAfterTicketChange).toBe(requestsBeforeTicketChange);  });

  it('includes programme bytes in the second-round review subject', async () => {
    const { root, missionId, input, capability, post } = await committedReviewFixture();
    await writeFile(join(root, 'package.json'), JSON.stringify({
      packageManager: 'pnpm@10.34.5',
      devDependencies: { typescript: '7.0.2', next: '99.0.0' }, scripts: { test: 'vitest run --changed' },
    }));
    const stale = await dispatchMissionSpecialists(
      resolveProjectRoots(root), input, '2026-08-21T12:01:35.000Z', capability,
    );
    expect(stale.action).toMatchObject({ kind: 'run-correction' });
    expect(stale.envelopes).toEqual([]);

    await writeFile(join(root, 'new-module.ts'), 'export const answer = 42;\n');
    execFileSync('git', ['add', 'new-module.ts'], { cwd: root });
    await writeFile(join(root, '.void', 'program.md'), 'authorized base: develop\n');
    execFileSync('git', ['add', '.void/program.md'], { cwd: root });
    await recordLeadWriterCompletion(root, { kind: 'writer-event', missionId, json: true });
    const policy = await dispatchMissionSpecialists(
      resolveProjectRoots(root), input, '2026-08-21T12:01:45.000Z', capability,
    );
    expect(policy.action).toMatchObject({ kind: 'invoke-specialists', stage: 'post-implementation', reviewRound: 2 });
    expect(policy.envelopes[0]?.inputHash).not.toBe(post.envelopes[0]?.inputHash);
    expect.soft(policy.envelopes[0]?.contextPack.touchedPaths).toContain('.void/program.md');
    expect.soft(policy.envelopes[0]?.contextPack.diff).toContain('authorized base: develop');

  });

  // Measured on 2026-09-02, run-2026-09-02-chain-b: the DEV-704 worker ran
  // `mission dispatch` in its worktree and got `blocked / stop`, "no native
  // specialists are installed in this worktree". They were installed in the
  // main checkout, hidden from git by design, so `worktree add` carried none.
  it('dispatches from a linked worktree with the panel and journal of the main checkout', async () => {
    const main = await mkdtemp(join(tmpdir(), 'void-mission-worktree-'));
    const missionId = 'mis_0123456789abcdef0123456789abcdef';
    const ticketBody = '# Root resolution\n\nRead the panel from the installation root.\n';
    await writeFile(join(main, 'package.json'), JSON.stringify({
      packageManager: 'pnpm@10.34.5',
    }));
    await writeFile(join(main, 'DEV-732.md'), ticketBody);
    execFileSync('git', ['init', '--quiet'], { cwd: main });
    await adapterFor('claude').wire({
      stageRoot: main,
      installRoot: main,
      sourceRoot: CORE_ROOT,
      enabledPlugins: ['harness'],
      enabledPacks: [],
      source: 'local',
      marketplaceRepo: 'acme/void-harness-fork',
      pinVersion: '0.17.0',
    });
    writeExcludeBlock(main);
    execFileSync('git', ['add', 'package.json', 'DEV-732.md'], { cwd: main });
    execFileSync('git', [
      '-c', 'user.name=Void Test',
      '-c', 'user.email=void@example.test',
      'commit', '--quiet', '-m', 'test: seed mission fixture',
    ], { cwd: main });
    const linked = join(await mkdtemp(join(tmpdir(), 'void-mission-linked-')), 'DEV-732');
    execFileSync('git', ['worktree', 'add', '--quiet', linked, '-b', 'worker/DEV-732'], { cwd: main });
    expect(existsSync(join(linked, '.claude', 'agents'))).toBe(false);

    const plan = await planMission(main, 'DEV-732.md', '2026-09-02T12:00:00.000Z');
    const controllerPlan: MissionSpecialistPlan = {
      planHash: plan.planHash,
      context: plan.context,
      specialists: plan.specialists.map((specialist) => ({
        specialistId: specialist.specialistId,
        contractVersion: specialist.contractVersion,
        inputHash: specialist.proof.inputHash,
        state: specialist.state,
        stages: specialist.stages,
      })),
    };
    const ticketBinding = {
      path: 'DEV-732.md',
      contentHash: `sha256:${createHash('sha256').update(ticketBody).digest('hex')}`,
    };
    await createMission(main, {
      missionId,
      title: 'Root resolution',
      mode: 'team',
      teamController: {
        planHash: plan.planHash,
        routingHash: missionControllerRoutingHash(controllerPlan, ticketBinding),
        leadWriterId: 'writer:primary',
        runtime: 'claude',
      },
    });
    await writeMissionControllerPlan(main, missionId, controllerPlan, ticketBinding);

    const roots = resolveProjectRoots(linked);
    const dispatched = await dispatchMissionSpecialists(
      roots,
      { kind: 'dispatch', missionId, json: true },
      '2026-09-02T12:01:00.000Z',
    );

    expect(dispatched.phase).not.toBe('blocked');
    expect(dispatched.action).toMatchObject({ kind: 'run-lead-writer' });
    expect(dispatched.envelopes).toEqual([]);
    // The run belongs to the repository, not to the tree: its journal grows in
    // the main checkout, and the worktree gets no `.void/machine` of its own.
    const requested = (await inspectMission(main, missionId, { dependencies: {} }))
      .stream.events.filter((event) => event.kind === 'lead-writer.requested');
    expect(requested).toHaveLength(1);
    expect(existsSync(join(linked, '.void', 'machine'))).toBe(false);
  });

  it('closes a mission once and rejects a conflicting closure reason', async () => {
    const root = await mkdtemp(join(tmpdir(), 'void-mission-close-'));
    const missionId = 'mis_0123456789abcdef0123456789abcdef';
    await createMission(root, { missionId, title: 'Close lifecycle', mode: 'team' });

    await recordMissionClosure(root, missionId, 'interrupted');
    await recordMissionClosure(root, missionId, 'interrupted');
    await expect(recordMissionClosure(root, missionId, 'abandoned')).rejects.toThrow(
      'MISSION_CLOSURE_CONFLICT',
    );

    const inspected = await inspectMission(root, missionId, { dependencies: {} });
    expect(inspected.stream.events.filter((event) => event.kind === 'mission.closed')).toHaveLength(1);
  });

  it('closes the mission automatically when the controller stops', async () => {
    const root = await mkdtemp(join(tmpdir(), 'void-mission-stop-'));
    const missionId = 'mis_0123456789abcdef0123456789abcdef';
    const ticketBody = '# Stop unavailable runtime\n\nReview an API boundary.\n';
    await writeFile(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.34.5' }));
    await writeFile(join(root, 'DEV-STOP.md'), ticketBody);
    const plan = await planMission(root, 'DEV-STOP.md', '2026-08-21T12:00:00.000Z');
    const controllerPlan: MissionSpecialistPlan = {
      planHash: plan.planHash,
      context: plan.context,
      specialists: plan.specialists.map((specialist) => ({
        specialistId: specialist.specialistId,
        contractVersion: specialist.contractVersion,
        inputHash: specialist.proof.inputHash,
        state: specialist.state,
        stages: specialist.stages,
      })),
    };
    const ticketBinding = {
      path: 'DEV-STOP.md',
      contentHash: `sha256:${createHash('sha256').update(ticketBody).digest('hex')}`,
    };
    await createMission(root, {
      missionId,
      title: 'Stop unavailable runtime',
      mode: 'team',
      teamController: {
        planHash: plan.planHash,
        routingHash: missionControllerRoutingHash(controllerPlan, ticketBinding),
        leadWriterId: 'writer:primary',
        runtime: 'codex',
      },
    });
    await writeMissionControllerPlan(root, missionId, controllerPlan, ticketBinding);

    const decision = await dispatchMissionSpecialists(resolveProjectRoots(root), {
      kind: 'dispatch',
      missionId,
      json: true,
    }, '2026-08-21T12:00:00.000Z', {
      status: 'unavailable',
      limitations: ['no isolated runtime'],
    });

    expect(decision.action.kind).toBe('stop');
    const inspected = await inspectMission(root, missionId, { dependencies: {} });
    expect(inspected.stream.events).toContainEqual(expect.objectContaining({
      kind: 'mission.closed',
      payload: { reason: 'controller-stop', episodeId: inspected.stream.events[0]?.eventId },
    }));
    await expect(dispatchMissionSpecialists(resolveProjectRoots(root), {
      kind: 'dispatch',
      missionId,
      json: true,
    }, '2026-08-21T12:00:00.000Z', {
      status: 'unavailable',
      limitations: ['no isolated runtime'],
    })).rejects.toThrow('MISSION_CLOSED');
  });

  it('applies fortress policy overlays to high-risk planning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'void-mission-fortress-'));
    await writeFile(join(root, 'package.json'), JSON.stringify({
      packageManager: 'pnpm@10.34.5',
    }));
    await writeFile(
      join(root, 'DEV-442.md'),
      '# Authentication permissions\n\nHarden auth permissions.\n',
    );

    const plan = await planMission(
      root,
      'DEV-442.md',
      '2026-07-27T00:00:00Z',
    );
    const decisions = Object.fromEntries(
      plan.applicability.map((item) => [item.pass, item]),
    );

    expect(plan.risk.requiredMode).toBe('fortress');
    expect(decisions.architecture).toMatchObject({
      state: 'pending',
      depth: 'deep',
    });
    expect(decisions.security).toMatchObject({
      state: 'pending',
      depth: 'deep',
    });
    expect(decisions.qa).toMatchObject({
      state: 'pending',
      depth: 'deep',
    });
  });

  it('loads the UI core policy and makes frontend TDD, craft, and accessibility deep passes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'void-mission-ui-'));
    await writeFile(join(root, 'package.json'), JSON.stringify({
      packageManager: 'pnpm@10.34.5',
    }));
    await writeFile(
      join(root, 'DEV-444.md'),
      '# Accessible action menu UI\n\nAdd a keyboard-accessible React component and error state.\n',
    );

    const plan = await planMission(root, 'DEV-444.md', '2026-07-27T00:00:00Z');
    const decisions = Object.fromEntries(
      plan.applicability.map((item) => [item.pass, item]),
    );

    expect(plan.policySources).toContain('core:ui-quality');
    expect(decisions.tdd).toMatchObject({ state: 'pending', depth: 'deep' });
    expect(decisions['ux-ui']).toMatchObject({ state: 'pending', depth: 'deep' });
    expect(decisions.accessibility).toMatchObject({ state: 'pending', depth: 'deep' });
  });

  it('renders structured JSON failures without hiding the root cause', () => {
    expect(JSON.parse(renderMissionFailure(
      new Error('POLICY_PATH_ESCAPE: policy resolves outside root'),
      true,
    ))).toEqual({
      error: {
        code: 'POLICY_PATH_ESCAPE',
        problem: 'mission command could not complete',
        cause: 'policy resolves outside root',
        fix: 'correct the reported input or policy and retry',
      },
    });
  });
});


describe('explicit mission recovery CLI boundary', () => {
  it('parses an explicit recovery request without runtime or budget overrides', () => {
    expect(parseMissionArgs(['recover', '--id', 'mis_0123456789abcdef0123456789abcdef',
      '--input', 'recovery-request.json', '--json'])).toEqual({ kind: 'recover',
      missionId: 'mis_0123456789abcdef0123456789abcdef',
      inputPath: 'recovery-request.json', json: true });
  });
  it('rejects duplicate recovery request options explicitly', () => {
    expect(parseMissionArgs(['recover', '--id', 'mis_0123456789abcdef0123456789abcdef',
      '--input', 'one.json', '--input', 'other.json'])).toMatchObject({
      kind: 'invalid', problem: expect.stringContaining('duplicate'),
    });
  });
  it('closes the recovered episode without confusing its historical closure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'void-mission-recovered-close-'));
    const missionId = 'mis_0123456789abcdef0123456789abcdef';
    await createMission(root, { missionId, title: 'Recovered episode closure', mode: 'team' });
    const completed = await appendMissionEvent(root, missionId, { source: 'runtime:codex',
      kind: 'specialist.completed', subject: 'core:test-qa-engineer', correlationId: missionId, payload: {
        stage: 'pre-implementation', reviewRound: 1, inputHash: `sha256:${'a'.repeat(64)}`,
        contextId: 'context_recovery_fixture', completion: { schemaVersion: 1,
          specialistId: 'core:test-qa-engineer', contractVersion: 2, completionId: 'completion_fixture',
          verdict: 'degraded', findings: [], evidenceRequests: ['Clarify proof timing.'],
          limitations: ['Proof timing unresolved.'] },
      } });
    await appendMissionEvent(root, missionId, { source: 'void-harness:mission.close',
      kind: 'mission.closed', subject: 'mission', correlationId: missionId, payload: { reason: 'controller-stop' } });
    const prior = (await inspectMission(root, missionId, { dependencies: {} })).stream.events;
    const closure = prior.at(-1);
    if (!closure) throw new Error('Expected original closure.');
    const artifact = { path: 'docs/clarification.md', sha256: `sha256:${'a'.repeat(64)}` };
    const recovered = await recordStoppedMissionRecovery(root, missionId, { schemaVersion: 1,
      closureEventId: closure.eventId, expectedJournalHash: canonicalJsonHash(prior),
      disposition: { kind: 'review-blocker', completionEventIds: [completed.eventId], resolutionArtifact: artifact },
    }, { stage: 'pre-implementation', expectedSource: 'runtime:codex', maxRounds: 2,
      currentInputHashes: { 'core:test-qa-engineer': artifact.sha256 },
      contractVersions: { 'core:test-qa-engineer': 2 }, resolutionArtifact: artifact });
    await recordMissionClosure(root, missionId, 'completed');
    await recordMissionClosure(root, missionId, 'completed');
    const current = (await inspectMission(root, missionId, { dependencies: {} })).stream.events;
    const closures = current.filter(value => value.kind === 'mission.closed');
    expect(closures).toHaveLength(2);
    expect(closures[1]?.payload).toMatchObject({ reason: 'completed', episodeId: recovered.recoveryEventId });
  });
});
