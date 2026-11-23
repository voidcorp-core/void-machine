// tdd-cover: e2e packages/cli/src/lib/runs/specialist-contract-migration-append.test.ts

import { createHash } from 'node:crypto';
import { writeSequencedEventOnce } from '@voidcorp/hook-runner';
import type { SpecialistContractMigrationDeclaration, SpecialistContractMigrationRequest } from '@voidcorp/mission-engine';
import { canonicalJson, canonicalJsonHash, parseEventLine, planSpecialistContractMigration } from '@voidcorp/mission-engine';
import type { Runtime } from '../runtime.js';
import { readBoundedProjectFile } from '../safe-read.js';
import { compileClaudeSpecialist } from '../specialists/compile-claude.js';
import { compileCodexSpecialist } from '../specialists/compile-codex.js';
import { loadSpecialists, parseSpecialistYaml } from '../specialists/load.js';
import { inspectMission, loadMissionControllerPlan } from './store.js';

const MIGRATION = 'visual-craft-director-v2-v3';
const ARCHIVE = 'contract-history/visual-craft-director/v2.yaml';
// The v2-to-v3 edge remains bound to released bytes after newer contracts ship.
const TARGET = 'contract-history/visual-craft-director/v3.yaml';
function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => key in value);
}
function hash(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}
function invalid(detail: string): never {
  throw new Error(`SPECIALIST_CONTRACT_MIGRATION_INVALID: ${detail}`);
}
function digest(body: string): string {
  return `sha256:${createHash('sha256').update(body).digest('hex')}`;
}
async function bounded(root: string, path: string, maxBytes: number): Promise<string> {
  return (await readBoundedProjectFile({ root, inputPath: path, maxBytes,
    pathEscapeMessage: 'SPECIALIST_CONTRACT_MIGRATION_INVALID: asset escapes its authority',
    invalidMessage: 'SPECIALIST_CONTRACT_MIGRATION_INVALID: bounded regular asset required' })).body;
}
export function parseSpecialistContractMigrationRequest(value: unknown): SpecialistContractMigrationRequest {
  if (!object(value) || !exact(value, ['schemaVersion', 'expectedJournalHash', 'expectedEpisodeId', 'migrationId',
    ...(value['recovery'] === undefined ? [] : ['recovery'])])
    || value['schemaVersion'] !== 1 || !hash(value['expectedJournalHash'])
    || typeof value['expectedEpisodeId'] !== 'string'
    || !/^evt_[A-Za-z0-9_-]{8,100}$/.test(value['expectedEpisodeId'])
    || value['migrationId'] !== MIGRATION) invalid('provide the exact bounded migration request without overrides');
  const recovery = value['recovery'];
  if (recovery !== undefined && (!object(recovery) || !exact(recovery, ['closureEventId'])
    || typeof recovery['closureEventId'] !== 'string'
    || !/^evt_[A-Za-z0-9_-]{8,100}$/.test(recovery['closureEventId']))) {
    invalid('recovery must identify the exact stopped closure without overrides');
  }
  return { schemaVersion: 1, expectedJournalHash: value['expectedJournalHash'],
    expectedEpisodeId: value['expectedEpisodeId'], migrationId: value['migrationId'],
    ...(object(recovery) && typeof recovery['closureEventId'] === 'string'
      ? { recovery: { closureEventId: recovery['closureEventId'] } } : {}) };
}
export async function observeSpecialistMigrationAssets(
  coreRoot: string, installRoot: string, runtime: Runtime,
): Promise<{ readonly declaration: SpecialistContractMigrationDeclaration;
  readonly observedFromContractSha256: string; readonly observedToContractSha256: string;
  readonly nativeAgentSha256: string; readonly nativeContractVersion: number }> {
  const raw: unknown = JSON.parse(await bounded(coreRoot, 'specialists/migrations.json', 16 * 1024));
  if (!object(raw) || !exact(raw, ['schemaVersion', 'migrations']) || raw['schemaVersion'] !== 1
    || !Array.isArray(raw['migrations']) || raw['migrations'].length !== 1) invalid('unsupported migration catalog');
  const item: unknown = raw['migrations'][0];
  if (!object(item) || !exact(item, ['id', 'specialistId', 'fromVersion', 'toVersion',
    'fromContractSha256', 'toContractSha256', 'fromContractPath', 'policy'])
    || item['id'] !== MIGRATION || item['specialistId'] !== 'core:visual-craft-director'
    || item['fromVersion'] !== 2 || item['toVersion'] !== 3
    || item['fromContractPath'] !== ARCHIVE || item['policy'] !== 'fresh-review-required'
    || !hash(item['fromContractSha256']) || !hash(item['toContractSha256'])) invalid('unsupported declared migration edge');
  const declaration: SpecialistContractMigrationDeclaration = { id: item['id'], specialistId: item['specialistId'],
    fromVersion: item['fromVersion'], toVersion: item['toVersion'], fromContractPath: item['fromContractPath'],
    fromContractSha256: item['fromContractSha256'], toContractSha256: item['toContractSha256'], policy: item['policy'] };
  const [from, to] = await Promise.all([bounded(coreRoot, ARCHIVE, 64 * 1024), bounded(coreRoot, TARGET, 64 * 1024)]);
  const observedFromContractSha256 = digest(from);
  const observedToContractSha256 = digest(to);
  if (observedFromContractSha256 !== declaration.fromContractSha256
    || observedToContractSha256 !== declaration.toContractSha256) invalid('declared contract bytes do not match');
  const oldContract = parseSpecialistYaml(from, ARCHIVE);
  const target = parseSpecialistYaml(to, TARGET);
  if (oldContract.id !== declaration.specialistId || oldContract.version !== declaration.fromVersion
    || target.id !== declaration.specialistId || target.version !== declaration.toVersion) invalid('declared contract identity does not match');
  const compiled = runtime === 'codex' ? compileCodexSpecialist(target) : compileClaudeSpecialist(target);
  const native = await bounded(installRoot, compiled.relativePath, 128 * 1024);
  if (native !== compiled.content) throw new Error('SPECIALIST_CONTRACT_MIGRATION_NATIVE: installed specialist must expose the exact target contract');
  return { declaration, observedFromContractSha256, observedToContractSha256,
    nativeAgentSha256: digest(native), nativeContractVersion: target.version };
}

export async function recordSpecialistContractMigration(
  root: string, missionId: string, request: SpecialistContractMigrationRequest,
  observation: import('@voidcorp/mission-engine').SpecialistContractMigrationObservation,
): Promise<{ readonly recorded: boolean; readonly migrationEventId: string }> {
  const [inspected, stored] = await Promise.all([
    inspectMission(root, missionId, { dependencies: {} }), loadMissionControllerPlan(root, missionId),
  ]);
  if (canonicalJsonHash(stored.plan) !== canonicalJsonHash(observation.plan)) {
    invalid('migration observation does not match the immutable controller plan');
  }
  const decision = planSpecialistContractMigration({ stream: inspected.stream, request, observation });
  if (decision.kind === 'refused') {
    const code = decision.code === 'stale-migration'
      && canonicalJsonHash(inspected.stream.events) !== request.expectedJournalHash ? 'stale-journal' : decision.code;
    throw new Error(`SPECIALIST_CONTRACT_MIGRATION_REFUSED: ${code}: ${decision.reasons.join('; ')}`);
  }
  if (decision.kind === 'already-migrated') {
    return { recorded: false, migrationEventId: decision.migrationEventId };
  }
  const eventId = `evt_${createHash('sha256').update(canonicalJson({ missionId,
    episodeId: decision.receipt.episodeId, requestHash: decision.receipt.requestHash })).digest('hex')}`;
  const parsed = parseEventLine(canonicalJson({ schemaVersion: 1, seq: inspected.stream.lastSeq + 1,
    eventId, missionId, ts: new Date().toISOString(), source: 'void-harness:mission.migrate-specialist',
    kind: 'specialist.contract-migrated', subject: decision.receipt.specialistId,
    correlationId: missionId, payload: decision.receipt }));
  if (!parsed.ok) invalid(parsed.issue.message);
  const result = await writeSequencedEventOnce({ root, missionId, eventId,
    draft: { source: parsed.value.source, kind: parsed.value.kind, subject: parsed.value.subject,
      correlationId: missionId, payload: parsed.value.payload },
    validate: events => {
      if (canonicalJsonHash(events) !== request.expectedJournalHash) {
        throw new Error('SPECIALIST_CONTRACT_MIGRATION_REFUSED: stale-journal: observe the current journal again');
      }
    },
  });
  return { recorded: result.appended, migrationEventId: result.event.eventId };
}

/** Recompute unchanged peers against the declared original catalog, never stored input hashes. */
export async function loadSpecialistMigrationComparisonCatalog(
  coreRoot: string, declaration: SpecialistContractMigrationDeclaration,
  plan: import('@voidcorp/mission-engine').MissionSpecialistPlan,
) {
  if (declaration.id !== MIGRATION || declaration.fromContractPath !== ARCHIVE) invalid('unsupported comparison catalog');
  const body = await bounded(coreRoot, ARCHIVE, 64 * 1024);
  if (digest(body) !== declaration.fromContractSha256) invalid('comparison archive hash does not match');
  const previous = parseSpecialistYaml(body, ARCHIVE);
  const catalog = (await loadSpecialists(coreRoot)).map(contract =>
    contract.id === declaration.specialistId ? previous : contract);
  if (plan.specialists.some(specialist => catalog.find(contract => contract.id === specialist.specialistId)?.version
    !== specialist.contractVersion)) invalid('comparison catalog does not match the frozen contracts');
  return catalog;
}
