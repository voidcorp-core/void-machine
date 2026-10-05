import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJsonHash, deriveMissionVerdict, projectMissionLifecycle,
  sealEvidence, type EvidenceDraft } from '@voidcorp/mission-engine';
import { recordMissionClosure } from '../../commands/mission.js';
import { appendMissionEvent, eventLogPath, inspectMission, recordMissionEvidence } from './store.js';
import { parseMissionRecoveryRequest, recordStoppedMissionRecovery } from './mission-recovery.js';
import { COMMAND_MISSION, COMMAND_DIFF, OTHER_DIFF, commandIncident, commandProof } from './__fixtures__/command-correction.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true }))); });
async function root() {
  const value = await mkdtemp(join(tmpdir(), 'void-command-correction-'));
  roots.push(value);
  return value;
}
async function recover(path: string, fixture: Awaited<ReturnType<typeof commandIncident>>) {
  return recordStoppedMissionRecovery(path, COMMAND_MISSION,
    parseMissionRecoveryRequest(fixture.request), fixture.observation);
}

describe('explicit correction of command invocation evidence', () => {
  it('retains observed DEV-925 failures and distinct input hashes before any disposition', async () => {
    const fixture = await commandIncident(await root(), { allCommands: true });
    expect(fixture.failed[1]?.inputHash).toBe('sha256:182943cad8fe912a2c74b788640f9ffcfba3447740942d4bfd1a630b87a9c771');
    expect(fixture.passed[1]?.inputHash).toBe('sha256:f298ce692978eae38e5283db4edd76a5943129b2a16026dd1d4607c980772dc2');
    expect(fixture.inspected.verdict).toMatchObject({ status: 'blocked', failedEvidence: 6, freshEvidence: 6 });
  });

  it('recovers the six observed command corrections once without rewriting proofs or replaying effects', async () => {
    const path = await root();
    const fixture = await commandIncident(path, { allCommands: true });
    const journal = await eventLogPath(path, COMMAND_MISSION);
    const before = await readFile(journal, 'utf8');
    const results = await Promise.all([recover(path, fixture), recover(path, fixture)]);
    expect(results.filter(result => result.recorded)).toHaveLength(1);
    expect(new Set(results.map(result => result.recoveryEventId)).size).toBe(1);
    expect(await recover(path, fixture)).toMatchObject({ recorded: false });
    expect((await readFile(journal, 'utf8')).startsWith(before)).toBe(true);
    const after = await inspectMission(path, COMMAND_MISSION, fixture.context);
    expect(after.stream.events.slice(0, -1)).toEqual(fixture.inspected.stream.events);
    expect(after.stream.events.at(-1)?.payload).toMatchObject({ nextAction: 'verification',
      consumedRounds: 0, remainingRounds: 2 });
    expect(after.verdict).toMatchObject({ status: 'verified', failedEvidence: 0, freshEvidence: 6 });
    expect(projectMissionLifecycle(after.stream.events).status).toBe('open');
  });

  it('admits an absolute executable only when the original mono-string names that exact path', async () => {
    const path = await root();
    const fixture = await commandIncident(path, { initialExecutable: '/tools/pnpm' });
    await recover(path, fixture);
    expect((await inspectMission(path, COMMAND_MISSION, fixture.context)).verdict)
      .toMatchObject({ status: 'verified', failedEvidence: 0 });
  });

  it.each([
    { initialExecutable: 'pnpm', executable: '/tools/pnpm' },
    { initialExecutable: '/trusted/pnpm', executable: '/other/pnpm' },
  ])('refuses basename-only equivalence from $initialExecutable to $executable', async options => {
    const path = await root();
    const fixture = await commandIncident(path, options);
    await expect(recover(path, fixture)).rejects.toThrow('MISSION_RECOVERY_REFUSED: invalid-command-correction');
  });

  const invalidProofs: readonly { readonly name: string; readonly failed?: Partial<EvidenceDraft>;
    readonly replacement?: Partial<EvidenceDraft> }[] = [
    { name: 'a real command failure', failed: { exitCode: 1 } },
    { name: 'a correctly formed command returning 127', failed: { command: ['pnpm', 'typecheck'],
      output: { stdout: '', stderr: 'missing subcommand', truncated: false } } },
    { name: 'an exit127 without spawn ENOENT', failed: { output: { stdout: '', stderr: 'command returned 127', truncated: false } } },
    { name: 'an unsealed command input', failed: { inputHash: OTHER_DIFF } },
    { name: 'a different command', replacement: { command: ['true'] } },
    { name: 'an ambiguous argument boundary', replacement: { command: ['pnpm', 'typecheck --help'] },
      failed: { command: ['pnpm typecheck --help'] } },
    { name: 'a failed replacement', replacement: { exitCode: 1, status: 'failed' } },
    { name: 'a different diff', replacement: { diffHash: OTHER_DIFF } },
    { name: 'a different environment', replacement: { environment: { runtime: 'node:v26.0.0', platform: 'darwin', arch: 'arm64' } } },
    { name: 'a shell invocation', replacement: { source: 'shell:explicit' } },
    { name: 'a foreign proof', replacement: { missionId: 'mis_foreign_12345678' } },
    { name: 'an untrusted producer', replacement: { producer: 'runtime:claude' } },
  ];
  it.each(invalidProofs)('refuses $name without appending a receipt', async options => {
    const path = await root();
    const fixture = await commandIncident(path, options);
    const journal = await eventLogPath(path, COMMAND_MISSION);
    const before = await readFile(journal, 'utf8');
    await expect(recover(path, fixture)).rejects.toThrow('MISSION_RECOVERY_REFUSED: invalid-command-correction');
    expect(await readFile(journal, 'utf8')).toBe(before);
  });

  it('refuses a tampered replacement without hiding its original failure', async () => {
    const path = await root();
    const fixture = await commandIncident(path, { tamperReplacement: true });
    expect(fixture.inspected.verdict).toMatchObject({ failedEvidence: 1, tamperedEvidence: 1 });
    await expect(recover(path, fixture)).rejects.toThrow('MISSION_RECOVERY_REFUSED: invalid-command-correction');
  });

  it('refuses a replacement superseded by a later failed rerun of its own input', async () => {
    const path = await root();
    const fixture = await commandIncident(path, { beforeClose: async () => {
      await recordMissionEvidence(path, commandProof(20, false, ['pnpm', 'typecheck'], {
        status: 'failed', exitCode: 1,
      }));
    } });
    await expect(recover(path, fixture)).rejects.toThrow('MISSION_RECOVERY_REFUSED: invalid-command-correction');
  });

  it('requires current proof dependencies and the independently observed resolution artifact', async () => {
    const path = await root();
    const fixture = await commandIncident(path);
    for (const observation of [
      { ...fixture.observation, evidenceDependencies: { 'git:working-tree': OTHER_DIFF } },
      { ...fixture.observation, evidenceDependencies: {} },
      { ...fixture.observation, resolutionArtifact: { ...fixture.observation.resolutionArtifact!, sha256: COMMAND_DIFF } },
    ]) {
      await expect(recover(path, { ...fixture, observation })).rejects.toThrow('MISSION_RECOVERY_REFUSED:');
    }
  });

  it.each(['abandoned', 'interrupted'] as const)('keeps the human %s decision effective', async reason => {
    const path = await root();
    const fixture = await commandIncident(path, { reason });
    await expect(recover(path, fixture)).rejects.toThrow('MISSION_RECOVERY_REFUSED: unsupported-closure');
  });

  it('keeps an unresolved external effect closed', async () => {
    const path = await root();
    const fixture = await commandIncident(path, { beforeClose: async () => {
      await appendMissionEvent(path, COMMAND_MISSION, { source: 'runtime:claude',
        kind: 'orchestration.node-started', subject: 'effect:publish', correlationId: COMMAND_MISSION, payload: {} });
    } });
    await expect(recover(path, fixture)).rejects.toThrow('MISSION_RECOVERY_REFUSED: ambiguous-effect');
  });

  it('keeps the exhausted review budget closed', async () => {
    const path = await root();
    const fixture = await commandIncident(path, { beforeClose: async () => {
      await appendMissionEvent(path, COMMAND_MISSION, { source: 'runtime:claude',
        kind: 'specialist.completed', subject: 'core:test-qa-engineer', correlationId: COMMAND_MISSION,
        payload: { stage: 'post-implementation', reviewRound: 1, inputHash: COMMAND_DIFF,
          contextId: 'context-review-1', completion: { schemaVersion: 1,
            specialistId: 'core:test-qa-engineer', contractVersion: 1, completionId: 'completion-review-1',
            verdict: 'pass', findings: [], evidenceRequests: [], limitations: [] } } });
    } });
    await expect(recover(path, { ...fixture, observation: { ...fixture.observation, maxRounds: 1 } }))
      .rejects.toThrow('MISSION_RECOVERY_REFUSED: review-budget-exhausted');
  });

  it('preserves a safety blocker after an admitted command correction', async () => {
    const path = await root();
    const fixture = await commandIncident(path, { beforeClose: async () => {
      await appendMissionEvent(path, COMMAND_MISSION, { source: 'runtime:claude',
        kind: 'finding.reported', subject: 'fnd_security_1', correlationId: COMMAND_MISSION,
        payload: { findingId: 'fnd_security_1', ruleId: 'security.secret-leak', severity: 'critical',
          title: 'Security decision remains open', blocking: true, waivable: false, evidenceIds: [] } });
    } });
    await recover(path, fixture);
    expect((await inspectMission(path, COMMAND_MISSION, fixture.context)).verdict)
      .toMatchObject({ status: 'blocked', failedEvidence: 0, openBlockers: 1 });
  });

  it('does not waive later failures, changed dependencies or a forged recovery receipt', async () => {
    const path = await root();
    const fixture = await commandIncident(path);
    await recover(path, fixture);
    const admitted = await inspectMission(path, COMMAND_MISSION, fixture.context);
    expect(deriveMissionVerdict(admitted.stream, { dependencies: { 'git:working-tree': OTHER_DIFF } }).status)
      .toBe('unverified');
    const events = admitted.stream.events.map(event => event.kind === 'mission.recovered'
      ? { ...event, source: 'runtime:claude' } : event);
    expect(deriveMissionVerdict({ ...admitted.stream, events }, fixture.context).status).not.toBe('verified');
    const { proofHash: _proofHash, ...failedDraft } = fixture.failed[0]!;
    await recordMissionEvidence(path, sealEvidence({ ...failedDraft, evidenceId: 'evd_later_failure' }));
    expect((await inspectMission(path, COMMAND_MISSION, fixture.context)).verdict)
      .toMatchObject({ status: 'blocked', failedEvidence: 1 });
  });

  it('does not resurrect older same-input failures when correcting the current failure', async () => {
    const path = await root();
    const fixture = await commandIncident(path, { beforeClose: async () => {
      await recordMissionEvidence(path, commandProof(20, true, ['pnpm typecheck']));
      await recordMissionEvidence(path, commandProof(21, false, ['pnpm', 'typecheck']));
    } });
    const events = fixture.inspected.stream.events;
    const request = { ...fixture.request, disposition: { ...fixture.request.disposition, pairs: [{
      failedEventId: events.find(event => event.subject === 'evd_command_failed_20')!.eventId,
      replacementEventId: events.find(event => event.subject === 'evd_command_passed_21')!.eventId,
    }] } };
    await recover(path, { ...fixture, request });
    const after = await inspectMission(path, COMMAND_MISSION, fixture.context);
    expect(after.stream.events.slice(0, -1)).toEqual(events);
    expect(after.verdict).toMatchObject({ status: 'verified', failedEvidence: 0 });
  });

  it('does not reopen another stopped episode without actual progress', async () => {
    const path = await root();
    const fixture = await commandIncident(path);
    await recover(path, fixture);
    await recordMissionClosure(path, COMMAND_MISSION, 'controller-stop', 'void-harness:mission.dispatch');
    const current = await inspectMission(path, COMMAND_MISSION, fixture.context);
    const request = { ...fixture.request, closureEventId: current.stream.events.at(-1)!.eventId,
      expectedJournalHash: canonicalJsonHash(current.stream.events) };
    await expect(recover(path, { ...fixture, request })).rejects.toThrow('MISSION_RECOVERY_REFUSED: no-recovery-progress');
  });
});
