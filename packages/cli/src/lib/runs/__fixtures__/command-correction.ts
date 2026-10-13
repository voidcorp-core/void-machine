// tdd-cover: e2e packages/cli/src/lib/runs/mission-command-correction.test.ts
import { canonicalJsonHash, sealEvidence, type EvidenceDraft,
  type MissionRecoveryObservation } from '@voidcorp/mission-engine';
import { recordMissionClosure } from '../../../commands/mission.js';
import { appendMissionEvent, createMission, inspectMission, recordMissionEvidence } from '../store.js';

export const COMMAND_MISSION = 'mis_0123456789abcdef0123456789abcdef';
export const COMMAND_DIFF = 'sha256:6160d2729fcbcd70693c225d47bc2e80a6d2e47a596700bbf7624f00aedfb359';
export const OTHER_DIFF = `sha256:${'b'.repeat(64)}`;
export const COMMAND_ARTIFACT = { path: '.void/machine/command-resolution.md', sha256: OTHER_DIFF };
const observedEnvironment = { runtime: 'node:v24.15.0', platform: 'darwin', arch: 'arm64' };

// DEV-925 seq18-29: exact argv, environment and diff; IDs, output and times normalized.
// DEV-927 additionally resolves pnpm to an absolute executable path; its journal is open.
export const OBSERVED_COMMANDS = [
  ['pnpm', '--filter', '@voidcorp/void-machine', 'test'], ['pnpm', 'typecheck'],
  ['pnpm', 'lint'], ['pnpm', 'skills:check-references'], ['pnpm', 'sync:docs'],
  ['pnpm', 'derive:check'],
] as const;
export function commandProof(index: number, failed: boolean, command: readonly string[],
  overrides: Partial<EvidenceDraft> = {}) {
  const actualCommand = overrides.command ?? command;
  const environment = overrides.environment ?? observedEnvironment;
  const draft: EvidenceDraft = {
    schemaVersion: 1, missionId: COMMAND_MISSION,
    evidenceId: `evd_command_${failed ? 'failed' : 'passed'}_${index}`,
    type: 'command', producer: 'void-harness@4.0.0:mission.verify',
    source: `command:${actualCommand[0]?.split('/').at(-1)}`, environment,
    confidence: 'high', inputHash: canonicalJsonHash({ command: actualCommand, shell: false, environment }),
    diffHash: COMMAND_DIFF, startedAt: '2026-09-30T12:00:00.000Z',
    finishedAt: '2026-09-30T12:00:01.000Z', durationMs: 1000,
    status: failed ? 'failed' : 'passed', exitCode: failed ? 127 : 0, command: actualCommand,
    affectedNodes: [], output: { stdout: failed ? '' : 'passed',
      stderr: failed ? `spawn ${actualCommand[0]} ENOENT` : '', truncated: false },
    dependencies: [{ kind: 'diff', key: 'git:working-tree', hash: COMMAND_DIFF }],
    ...overrides,
  };
  return sealEvidence(draft);
}
export async function commandIncident(root: string, options: {
  readonly allCommands?: boolean;
  readonly executable?: string;
  readonly initialExecutable?: string;
  readonly failed?: Partial<EvidenceDraft>;
  readonly replacement?: Partial<EvidenceDraft>;
  readonly tamperReplacement?: boolean;
  readonly beforeClose?: () => Promise<void>;
  readonly reason?: 'controller-stop' | 'abandoned' | 'interrupted';
} = {}) {
  await createMission(root, { missionId: COMMAND_MISSION, title: 'Correct command argv', mode: 'team' });
  const writer = await appendMissionEvent(root, COMMAND_MISSION, {
    source: 'void-harness:mission.dispatch', kind: 'lead-writer.requested',
    subject: 'writer:primary', correlationId: COMMAND_MISSION, payload: { actionKind: 'run-lead-writer' },
  });
  await appendMissionEvent(root, COMMAND_MISSION, { source: 'runtime:claude',
    kind: 'lead-writer.completed', subject: 'writer:primary', correlationId: COMMAND_MISSION,
    payload: { requestEventId: writer.eventId, actionKind: 'run-lead-writer' },
  });
  const commands = options.allCommands ? OBSERVED_COMMANDS : [OBSERVED_COMMANDS[1]];
  const failed = commands.map((command, index) => commandProof(index, true,
    [[options.initialExecutable ?? command[0], ...command.slice(1)].join(' ')], options.failed));
  const passed = commands.map((command, index) => commandProof(index, false,
    [options.executable ?? options.initialExecutable ?? command[0], ...command.slice(1)], options.replacement));
  const replacements = options.tamperReplacement
    ? passed.map(proof => ({ ...proof, output: { ...proof.output, stdout: 'forged result' } })) : passed;
  for (const proof of [...failed, ...replacements]) {
    if (proof.missionId === COMMAND_MISSION) await recordMissionEvidence(root, proof);
    else await appendMissionEvent(root, COMMAND_MISSION, {
      source: proof.producer, kind: 'evidence.recorded', subject: proof.evidenceId,
      correlationId: COMMAND_MISSION, payload: { evidence: { ...proof,
        environment: { ...proof.environment }, output: { ...proof.output },
        dependencies: proof.dependencies.map(dependency => ({ ...dependency })) } },
    });
  }
  await options.beforeClose?.();
  await recordMissionClosure(root, COMMAND_MISSION, options.reason ?? 'controller-stop',
    'void-harness:mission.dispatch');
  const context = { dependencies: { 'git:working-tree': COMMAND_DIFF } };
  const inspected = await inspectMission(root, COMMAND_MISSION, context);
  const events = inspected.stream.events;
  const pairs = failed.map((proof, index) => ({
    failedEventId: events.find(event => event.subject === proof.evidenceId)!.eventId,
    replacementEventId: events.find(event => event.subject === passed[index]!.evidenceId)!.eventId,
  }));
  const request = { schemaVersion: 1, closureEventId: events.at(-1)!.eventId,
    expectedJournalHash: canonicalJsonHash(events), disposition: {
      kind: 'command-correction', pairs, resolutionArtifact: COMMAND_ARTIFACT,
    } };
  const observation: MissionRecoveryObservation = { stage: 'post-implementation',
    expectedSource: 'runtime:claude', contractVersions: { 'core:test-qa-engineer': 1 },
    currentInputHashes: { 'core:test-qa-engineer': COMMAND_DIFF }, maxRounds: 2,
    resolutionArtifact: COMMAND_ARTIFACT, evidenceDependencies: context.dependencies };
  return { request, observation, context, inspected, failed, passed };
}
