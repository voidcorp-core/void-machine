import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { canonicalJsonHash, type MissionSpecialistPlan, type SpecialistDispatchEnvelope } from '@voidcorp/mission-engine';
import { dispatchMissionSpecialists, planMission, recordLeadWriterCompletion,
  recoverStoppedMission, recordMissionClosure } from '../../commands/mission.js';
import { wireCodexAgents } from '../codex-agents.js';
import { resolveProjectRoots } from '../project-roots.js';
import { recordSpecialistLifecycle } from './specialist-lifecycle.js';
import { createMission, inspectMission, missionControllerRoutingHash, writeMissionControllerPlan } from './store.js';

const CORE = fileURLToPath(new URL('../../../../core/', import.meta.url));
const ID = 'mis_review_recovery_cli_12345678';
const REVIEWER = 'core:independent-code-reviewer';

async function stoppedReview(bounded: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'void-review-recovery-cli-'));
  vi.stubEnv('CODEX_SESSION_ID', 'fixture-native-review-recovery');
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const commit = () => git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '--quiet', '-m', 'test: commit review subject']);
  git(['init', '--quiet']);
  await wireCodexAgents(root, CORE);
  await writeFile(join(root, '.gitignore'), '.void/\n');
  await writeFile(join(root, 'package.json'), '{"name":"review-recovery-fixture","private":true}\n');
  await writeFile(join(root, 'runtime.ts'), 'export const ready = false;\n');
  const body = '# Implement readiness\n\nMake runtime.ts report ready.\n';
  await writeFile(join(root, 'ticket.md'), body);
  git(['add', '.']);
  commit();
  const baseCommit = git(['rev-parse', 'HEAD']);
  const live = await planMission(root, 'ticket.md');
  const plan: MissionSpecialistPlan = { planHash: live.planHash, context: live.context,
    specialists: live.specialists.map(value => ({ specialistId: value.specialistId,
      contractVersion: value.contractVersion, inputHash: value.proof.inputHash,
      state: value.state, stages: value.stages })) };
  const ticket = { path: 'ticket.md', contentHash: canonicalBody(body) };
  await createMission(root, { missionId: ID, title: 'Review recovery CLI', mode: 'team',
    teamController: { planHash: plan.planHash, routingHash: missionControllerRoutingHash(plan, ticket, baseCommit),
      leadWriterId: 'writer:primary', runtime: 'codex', runtimeAttested: true,
      ...(bounded ? { reviewPolicy: 'bounded-corrections-v1' as const } : {}) } });
  await writeMissionControllerPlan(root, ID, plan, ticket, baseCommit);
  const roots = resolveProjectRoots(root);
  const dispatch = () => dispatchMissionSpecialists(roots, { kind: 'dispatch', missionId: ID, json: true });
  async function complete(envelope: SpecialistDispatchEnvelope, contextId: string) {
    await recordSpecialistLifecycle(root, ID, { status: 'started', envelope, contextId });
    await recordSpecialistLifecycle(root, ID, { status: 'completed', envelope, contextId,
      completion: { schemaVersion: 1, specialistId: envelope.specialistId,
        contractVersion: envelope.contractVersion, completionId: `completion_${contextId}`,
        verdict: 'pass', findings: [], evidenceRequests: [], limitations: [],
        ...(envelope.reviewSubject === undefined ? {} : { review: { ...envelope.reviewSubject,
          reviewerId: 'reviewer:independent', writerId: '/root/original_writer', readOnly: true,
          scope: { kind: 'general' as const }, proofIds: [], resolutions: [],
          provenance: { kind: 'native-context' as const, contextId } } }) } });
  }
  const preparation = await dispatch();
  expect(preparation.action.kind).toBe('invoke-specialists');
  for (const [index, envelope] of preparation.envelopes.entries()) await complete(envelope, `preparation_${index}`);
  expect((await dispatch()).action.kind).toBe('run-lead-writer');
  await writeFile(join(root, 'runtime.ts'), 'export const ready = true;\n');
  git(['add', 'runtime.ts']);
  commit();
  const reviewedCommit = git(['rev-parse', 'HEAD']);
  await recordLeadWriterCompletion(root, { kind: 'writer-event', missionId: ID, json: true });
  const review = await dispatch();
  expect(review.action).toMatchObject({ kind: 'invoke-specialists', stage: 'post-implementation' });
  for (const [index, envelope] of review.envelopes.entries()) await complete(envelope, `review_${index}`);
  await recordMissionClosure(root, ID, 'controller-stop', 'void-harness:mission.dispatch');
  const events = (await inspectMission(root, ID, { dependencies: {} })).stream.events;
  const original = events.find(event => event.kind === 'specialist.completed' && event.subject === REVIEWER);
  if (!original || typeof original.payload !== 'object' || original.payload === null || Array.isArray(original.payload)) {
    throw new Error('Independent CLI review required');
  }
  const completion = original.payload['completion'];
  const contextId = original.payload['contextId'];
  const path = '.void/machine/review-bindings.json';
  const artifact = JSON.stringify({ bindings: [{ completionEventId: original.eventId,
    completionHash: canonicalJsonHash(completion), review: { taskId: ID, baseCommit, reviewedCommit,
      acceptanceCriteriaHash: ticket.contentHash, reviewerId: 'reviewer:independent', writerId: 'writer:primary',
      readOnly: true, scope: { kind: 'general' }, proofIds: [], resolutions: [],
      provenance: { kind: 'native-context', contextId } } }] });
  await writeFile(join(root, path), artifact);
  const closure = events.at(-1);
  if (!closure) throw new Error('Stopped episode required');
  const request = { schemaVersion: 1 as const, closureEventId: closure.eventId,
    expectedJournalHash: canonicalJsonHash(events), disposition: { kind: 'review-provenance' as const,
      completionEventIds: [original.eventId], resolutionArtifact: { path, sha256: canonicalBody(artifact) } } };
  return { root, roots, dispatch, request, events, reviewedCommit, git };
}

function canonicalBody(body: string) {
  return `sha256:${createHash('sha256').update(body).digest('hex')}`;
}

it.each([false, true])('preserves the CLI review subject through provenance recovery (bounded: %s)', async bounded => {
  try {
    const fixture = await stoppedReview(bounded);
    const log = join(fixture.root, '.void/machine/runs', ID, 'events.jsonl');
    const before = await readFile(log, 'utf8');
    expect(await recoverStoppedMission(fixture.roots, ID, fixture.request)).toMatchObject({ recorded: true });
    expect((await readFile(log, 'utf8')).startsWith(before)).toBe(true);
    const recovered = (await inspectMission(fixture.root, ID, { dependencies: {} })).stream.events;
    expect(recovered.at(-1)?.payload).toMatchObject({ consumedRounds: 1, consumedCorrectionBatches: 0,
      preservedCompletionEventIds: expect.arrayContaining(fixture.request.disposition.completionEventIds) });
    const next = await fixture.dispatch();
    expect(next.action.kind).toBe('run-verification');
    expect(next.envelopes).toEqual([]);
    expect(fixture.git(['rev-parse', 'HEAD'])).toBe(fixture.reviewedCommit);
  } finally { vi.unstubAllEnvs(); }
});

it('refuses changed routing after provenance recovery even when the committed subject is unchanged', async () => {
  try {
    const fixture = await stoppedReview(false);
    expect(await recoverStoppedMission(fixture.roots, ID, fixture.request)).toMatchObject({ recorded: true });
    await mkdir(join(fixture.root, '.void/policies'), { recursive: true });
    await writeFile(join(fixture.root, '.void/policies/review.yaml'),
      'schemaVersion: 1\nid: project:review\nversion: 1\nlayer: project\nrules:\n'
      + '  - id: project:security\n    pass: security\n    strength: blocking\n    baseline: false\n');
    expect(fixture.git(['rev-parse', 'HEAD'])).toBe(fixture.reviewedCommit);
    const next = await fixture.dispatch();
    expect(next.action.kind).not.toBe('run-verification');
    expect(next.action.kind).not.toBe('complete');
  } finally { vi.unstubAllEnvs(); }
});
