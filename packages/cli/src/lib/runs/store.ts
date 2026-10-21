import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  stat,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { 
  MAX_EVENT_LOG_BYTES,voidReadPath, 
  writeSequencedEvent,
  writeSequencedEventOnce,} from '@voidcorp/hook-runner';
import {
  type CanonicalEvent,
  canonicalJsonHash,
  deriveMissionVerdict,
  type EventDraft,
  type EventStreamState,
  type Evidence,
  type EvidenceContext,
  type JsonValue,
  type MissionSpecialistPlan,
  type MissionVerdict,
  parseEventLine,
  planMissionRecovery,
  type RecoveryDecision,
  recoveryCheckpoint,
  replayEventLog,
} from '@voidcorp/mission-engine';
import { readBoundedProjectFile } from '../safe-read.js';
import { requireOpenMission } from './mission-lifecycle.js';
import { collectKnownSecrets, redactText } from './redact.js';

const MISSION_ID = /^mis_[A-Za-z0-9_-]{8,100}$/;

export type MissionMode = 'fast' | 'team' | 'fortress';

export interface CreateMissionInput {
  readonly missionId: string;
  readonly title: string;
  readonly mode: MissionMode;
  readonly requestedMode?: MissionMode;
  readonly promotionReason?: 'high-risk-predicate' | 'risk-not-explicitly-low';
  readonly teamController?: {
    readonly planHash: string;
    readonly routingHash: string;
    readonly leadWriterId: string;
    readonly runtime: 'claude' | 'codex';
    readonly runtimeAttested?: boolean;
    readonly reviewPolicy?: 'bounded-corrections-v1';
  };
  readonly now?: Date;
}

export interface MissionInspection {
  readonly stream: EventStreamState;
  readonly verdict: MissionVerdict;
  readonly quarantineFiles: readonly string[];
}

export interface MissionResumeResult {
  readonly decision: RecoveryDecision;
  readonly recorded: boolean;
}

export interface MissionControllerTicketBinding {
  readonly path: string;
  readonly contentHash: string;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function within(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function validMissionId(missionId: string): void {
  if (!MISSION_ID.test(missionId)) {
    throw new Error('MISSION_INVALID_ID: expected mis_<opaque-id>');
  }
}

function rejectClosedMission(events: readonly CanonicalEvent[]): void {
  requireOpenMission(events);
}

async function existingRunDirectory(
  root: string,
  missionId: string,
): Promise<string> {
  validMissionId(missionId);
  const canonicalRoot = await realpath(resolve(root));
  const run = voidReadPath(resolve(root), 'runs', missionId);
  const info = await lstat(run);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('MISSION_UNSAFE_RUN: run path must be a directory');
  }
  const canonicalRun = await realpath(run);
  if (!within(canonicalRoot, canonicalRun)) {
    throw new Error('MISSION_PATH_ESCAPE: run resolves outside project');
  }
  return run;
}

async function writeMissionMetadata(
  run: string,
  input: CreateMissionInput,
  createdAt: string,
): Promise<void> {
  const path = join(run, 'mission.json');
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(
      `${JSON.stringify({
        schemaVersion: 1,
        missionId: input.missionId,
        title: input.title,
        mode: input.mode,
        requestedMode: input.requestedMode ?? input.mode,
        ...(input.promotionReason === undefined
          ? {}
          : { promotionReason: input.promotionReason }),
        ...(input.teamController === undefined
          ? {}
          : { teamController: input.teamController }),
        createdAt,
      })}\n`,
      'utf8',
    );
  } finally {
    await handle.close();
  }
}

export async function appendMissionEvent(
  root: string,
  missionId: string,
  draft: EventDraft,
  now?: Date,
): ReturnType<typeof writeSequencedEvent> {
  const canFollowClosure = draft.kind === 'mission.closed'
    || draft.kind === 'mission.archived';
  return writeSequencedEvent({
    root,
    missionId,
    draft,
    ...(canFollowClosure ? {} : { validate: (events: readonly CanonicalEvent[]) => {
      if (events.length === 0 && draft.kind === 'mission.started'
        && draft.source === 'void-harness:mission' && draft.subject === 'mission'
        && draft.correlationId === missionId) return;
      rejectClosedMission(events);
    } }),
    ...(now === undefined ? {} : { now }),
  });
}

export async function createMission(
  root: string,
  input: CreateMissionInput,
): Promise<void> {
  validMissionId(input.missionId);
  if (
    input.title.length < 1
    || input.title.length > 200
    || [...input.title].some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point < 0x20 || point === 0x7f;
    })
  ) {
    throw new Error('MISSION_INVALID_TITLE: expected 1 to 200 printable characters');
  }
  if (
    input.mode !== 'fast'
    && input.mode !== 'team'
    && input.mode !== 'fortress'
  ) {
    throw new Error('MISSION_INVALID_MODE: expected fast, team, or fortress');
  }
  if (
    input.requestedMode !== undefined
    && input.requestedMode !== 'fast'
    && input.requestedMode !== 'team'
    && input.requestedMode !== 'fortress'
  ) {
    throw new Error('MISSION_INVALID_MODE: requested mode is invalid');
  }
  if (
    input.teamController !== undefined
    && (
      (input.mode !== 'team' && input.mode !== 'fortress')
      || !/^sha256:[a-f0-9]{64}$/.test(input.teamController.planHash)
      || !/^sha256:[a-f0-9]{64}$/.test(input.teamController.routingHash)
      || !/^[A-Za-z0-9][A-Za-z0-9:._-]{3,127}$/.test(input.teamController.leadWriterId)
      || (input.teamController.runtime !== 'claude'
        && input.teamController.runtime !== 'codex')
      || (input.teamController.reviewPolicy !== undefined
        && input.teamController.reviewPolicy !== 'bounded-corrections-v1')
      || (input.teamController.runtimeAttested !== undefined
        && typeof input.teamController.runtimeAttested !== 'boolean')
    )
  ) {
    throw new Error('MISSION_INVALID_TEAM_CONTROLLER: controller metadata is invalid');
  }
  const safeInput = {
    ...input,
    title: redactText(input.title, collectKnownSecrets()),
  };
  const run = voidReadPath(resolve(root), 'runs', input.missionId);
  try {
    await lstat(run);
    throw new Error(`MISSION_EXISTS: ${input.missionId}`);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  const createdAt = (input.now ?? new Date()).toISOString();
  await appendMissionEvent(
    root,
    input.missionId,
    {
      source: 'void-harness:mission',
      kind: 'mission.started',
      subject: 'mission',
      correlationId: input.missionId,
      payload: {
        title: safeInput.title,
        mode: safeInput.mode,
        requestedMode: safeInput.requestedMode ?? safeInput.mode,
        ...(safeInput.promotionReason === undefined
          ? {}
          : { promotionReason: safeInput.promotionReason }),
        ...(safeInput.teamController === undefined
          ? {}
          : {
              planHash: safeInput.teamController.planHash,
              routingHash: safeInput.teamController.routingHash,
              leadWriterId: safeInput.teamController.leadWriterId,
              runtime: safeInput.teamController.runtime,
              runtimeAttested: safeInput.teamController.runtimeAttested === true,
              ...(safeInput.teamController.reviewPolicy === undefined ? {}
                : { reviewPolicy: safeInput.teamController.reviewPolicy }),
            }),
      },
    },
    input.now,
  );
  await writeMissionMetadata(run, safeInput, createdAt);
}

export async function writeMissionControllerPlan(
  root: string,
  missionId: string,
  plan: MissionSpecialistPlan,
  ticket: MissionControllerTicketBinding,
  baseCommit?: string,
  inputRecipe?: 'project-v1',
): Promise<string> {
  const run = await existingRunDirectory(root, missionId);
  const routingHash = missionControllerRoutingHash(plan, ticket, baseCommit, inputRecipe);
  const handle = await open(join(run, 'controller-plan.json'), 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify({
      schemaVersion: inputRecipe === undefined ? (baseCommit === undefined ? 1 : 2) : 3,
      routingHash,
      plan,
      ticket,
      ...(baseCommit === undefined ? {} : { baseCommit }),
      ...(inputRecipe === undefined ? {} : { inputRecipe }),
    })}\n`, 'utf8');
  } finally {
    await handle.close();
  }
  return routingHash;
}

export async function loadMissionControllerPlan(
  root: string,
  missionId: string,
): Promise<{
  readonly plan: MissionSpecialistPlan;
  readonly ticket: MissionControllerTicketBinding;
  readonly routingHash: string;
  readonly baseCommit?: string;
  readonly inputRecipe?: 'project-v1';
}> {
  const run = await existingRunDirectory(root, missionId);
  const path = join(run, 'controller-plan.json');
  const loaded = await readBoundedProjectFile({
    root,
    inputPath: path,
    maxBytes: 256_000,
    pathEscapeMessage: 'MISSION_CONTROLLER_PLAN_INVALID: plan path escaped the project',
    invalidMessage: 'MISSION_CONTROLLER_PLAN_INVALID: plan file is unsafe or oversized',
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(loaded.body);
  } catch {
    throw new Error('MISSION_CONTROLLER_PLAN_INVALID: plan file is not valid JSON');
  }
  if (!unknownRecord(parsed) || !exactObjectKeys(parsed, [
    'schemaVersion',
    'routingHash',
    'plan',
    'ticket',
    ...(parsed.schemaVersion === 2 || parsed.schemaVersion === 3 ? ['baseCommit'] : []),
    ...(parsed.schemaVersion === 3 ? ['inputRecipe'] : []),
  ])) {
    throw new Error('MISSION_CONTROLLER_PLAN_INVALID: plan envelope is malformed');
  }
  const plan = parseMissionSpecialistPlan(parsed.plan);
  const ticket = parseMissionControllerTicket(parsed.ticket);
  const routingHash = typeof parsed.routingHash === 'string' ? parsed.routingHash : '';
  const baseCommit = parsed.schemaVersion === 2 || parsed.schemaVersion === 3 ? parsed.baseCommit : undefined;
  const inputRecipe = parsed.schemaVersion === 3 && parsed.inputRecipe === 'project-v1' ? 'project-v1' : undefined;
  if (
    (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2 && parsed.schemaVersion !== 3)
    || (parsed.schemaVersion === 3 && inputRecipe === undefined)
    || ((parsed.schemaVersion === 2 || parsed.schemaVersion === 3) && (
      typeof baseCommit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baseCommit)
    ))
    || !/^sha256:[a-f0-9]{64}$/.test(routingHash)
  ) {
    throw new Error('MISSION_CONTROLLER_PLAN_INVALID: plan integrity check failed');
  }
  const base = typeof baseCommit === 'string' ? { baseCommit } : {};
  if (missionControllerRoutingHash(plan, ticket, base.baseCommit, inputRecipe) !== routingHash) {
    throw new Error('MISSION_CONTROLLER_PLAN_INVALID: plan integrity check failed');
  }
  return Object.freeze({ plan, ticket, routingHash, ...base, ...(inputRecipe === undefined ? {} : { inputRecipe }) });
}

export function missionControllerRoutingHash(
  plan: MissionSpecialistPlan,
  ticket: MissionControllerTicketBinding,
  baseCommit?: string,
  inputRecipe?: 'project-v1',
): string {
  if (inputRecipe !== undefined && (inputRecipe !== 'project-v1' || baseCommit === undefined)) {
    throw new Error('MISSION_CONTROLLER_PLAN_INVALID: project input recipe requires a committed baseline');
  }
  if (baseCommit !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baseCommit)) {
    throw new Error('MISSION_REVIEW_BASE_INVALID: expected a full commit object ID');
  }
  return canonicalJsonHash({ plan, ticket, ...(baseCommit === undefined ? {} : { baseCommit }),
    ...(inputRecipe === undefined ? {} : { inputRecipe }) });
}

function unknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && Boolean(value) && !Array.isArray(value);
}

function exactObjectKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  return actual.length === canonical.length
    && actual.every((key, index) => key === canonical[index]);
}

function parseMissionSpecialistPlan(value: unknown): MissionSpecialistPlan {
  if (!unknownRecord(value) || !exactObjectKeys(value, ['planHash', 'context', 'specialists'])) {
    throw new Error('MISSION_CONTROLLER_PLAN_INVALID: routing plan is malformed');
  }
  if (
    typeof value.planHash !== 'string'
    || !/^sha256:[a-f0-9]{64}$/.test(value.planHash)
    || !unknownRecord(value.context)
    || !exactObjectKeys(value.context, ['status', 'issues'])
    || (value.context.status !== 'complete' && value.context.status !== 'degraded')
    || !Array.isArray(value.context.issues)
    || value.context.issues.some((issue) => typeof issue !== 'string' || issue.length > 256)
    || !Array.isArray(value.specialists)
    || value.specialists.length < 1
    || value.specialists.length > 64
  ) {
    throw new Error('MISSION_CONTROLLER_PLAN_INVALID: routing fields are malformed');
  }
  const specialists = value.specialists.map((candidate) => {
    if (!unknownRecord(candidate) || !exactObjectKeys(candidate, [
      'specialistId',
      'contractVersion',
      'inputHash',
      'state',
      'stages',
    ])) {
      throw new Error('MISSION_CONTROLLER_PLAN_INVALID: specialist entry is malformed');
    }
    const specialistId = parseStoredSpecialistId(candidate.specialistId);
    if (
      specialistId === undefined
      || !Number.isSafeInteger(candidate.contractVersion)
      || Number(candidate.contractVersion) < 1
      || Number(candidate.contractVersion) > 10_000
      || typeof candidate.inputHash !== 'string'
      || !/^sha256:[a-f0-9]{64}$/.test(candidate.inputHash)
      || (candidate.state !== 'applicable'
        && candidate.state !== 'not-applicable'
        && candidate.state !== 'degraded')
      || !Array.isArray(candidate.stages)
      || candidate.stages.length < 1
      || candidate.stages.length > 2
      || candidate.stages.some((stage) =>
        stage !== 'pre-implementation' && stage !== 'post-implementation')
    ) {
      throw new Error('MISSION_CONTROLLER_PLAN_INVALID: specialist fields are malformed');
    }
    const stages = candidate.stages.flatMap((stage) =>
      stage === 'pre-implementation' || stage === 'post-implementation' ? [stage] : []);
    return Object.freeze({
      specialistId,
      contractVersion: Number(candidate.contractVersion),
      inputHash: candidate.inputHash,
      state: candidate.state,
      stages: Object.freeze(stages),
    });
  });
  if (new Set(specialists.map((specialist) => specialist.specialistId)).size !== specialists.length) {
    throw new Error('MISSION_CONTROLLER_PLAN_INVALID: specialist IDs are duplicated');
  }
  return Object.freeze({
    planHash: value.planHash,
    context: Object.freeze({
      status: value.context.status,
      issues: Object.freeze(value.context.issues.flatMap((issue) =>
        typeof issue === 'string' ? [issue] : [])),
    }),
    specialists: Object.freeze(specialists),
  });
}

function parseMissionControllerTicket(value: unknown): MissionControllerTicketBinding {
  if (
    !unknownRecord(value)
    || !exactObjectKeys(value, ['path', 'contentHash'])
    || typeof value.path !== 'string'
    || value.path.length < 1
    || value.path.length > 512
    || isAbsolute(value.path)
    || value.path.includes('\\')
    || value.path.split('/').includes('..')
    || typeof value.contentHash !== 'string'
    || !/^sha256:[a-f0-9]{64}$/.test(value.contentHash)
  ) {
    throw new Error('MISSION_CONTROLLER_PLAN_INVALID: ticket binding is malformed');
  }
  return Object.freeze({ path: value.path, contentHash: value.contentHash });
}

function parseStoredSpecialistId(value: unknown): `core:${string}` | undefined {
  return typeof value === 'string' && /^core:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    ? `core:${value.slice('core:'.length)}`
    : undefined;
}

export async function recordMissionEvidence(
  root: string,
  evidence: Evidence,
): Promise<void> {
  await existingRunDirectory(root, evidence.missionId);
  const serialized = JSON.stringify(evidence);
  if (
    redactText(serialized, collectKnownSecrets()) !== serialized
  ) {
    throw new Error(
      'MISSION_EVIDENCE_CONTAINS_SECRET: redact before sealing the proof',
    );
  }
  await appendMissionEvent(root, evidence.missionId, {
    source: evidence.producer,
    kind: 'evidence.recorded',
    subject: evidence.evidenceId,
    correlationId: evidence.missionId,
    payload: { evidence } as unknown as JsonValue,
  });
}

async function quarantineInvalidLines(
  run: string,
  text: string,
  secrets: readonly string[],
): Promise<readonly string[]> {
  const invalid = text
    .split('\n')
    .map((line, index) => ({ line, index: index + 1, parsed: parseEventLine(line) }))
    .filter((entry) => entry.line.trim() !== '' && !entry.parsed.ok);
  if (invalid.length === 0) return [];
  const directory = join(run, 'quarantine');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(directory);
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
    throw new Error('MISSION_UNSAFE_QUARANTINE: expected a directory');
  }
  const paths: string[] = [];
  for (const entry of invalid) {
    const digest = createHash('sha256').update(entry.line).digest('hex');
    const path = join(directory, `${digest}.json`);
    const parsed = entry.parsed;
    const content = JSON.stringify({
      line: entry.index,
      issue: parsed.ok ? 'unknown' : parsed.issue.code,
      content: redactText(entry.line.slice(0, 4_096), secrets),
    });
    try {
      const handle = await open(path, 'wx', 0o600);
      try {
        await handle.writeFile(`${content}\n`, 'utf8');
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
    paths.push(path);
  }
  return paths;
}

export async function inspectMission(
  root: string,
  missionId: string,
  context: EvidenceContext,
  options: { readonly secrets?: readonly string[] } = {},
): Promise<MissionInspection> {
  const run = await existingRunDirectory(root, missionId);
  const log = join(run, 'events.jsonl');
  const info = await lstat(log);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error('MISSION_UNSAFE_LOG: events.jsonl must be a regular file');
  }
  if (info.size > MAX_EVENT_LOG_BYTES) {
    throw new Error(`MISSION_LOG_TOO_LARGE: ${info.size} bytes`);
  }
  const text = await readFile(log, 'utf8');
  const stream = replayEventLog(text);
  const quarantineFiles = await quarantineInvalidLines(
    run,
    text,
    options.secrets ?? collectKnownSecrets(),
  );
  return {
    stream,
    verdict: deriveMissionVerdict(stream, { ...context, missionId }),
    quarantineFiles,
  };
}

function resumedCheckpoint(event: EventStreamState['events'][number]): string | undefined {
  if (event.kind !== 'mission.resumed') return undefined;
  if (typeof event.payload !== 'object' || event.payload === null || Array.isArray(event.payload)) {
    return undefined;
  }
  const payload = event.payload as Readonly<Record<string, JsonValue>> & {
    readonly checkpointEventId?: JsonValue;
  };
  const checkpoint = payload.checkpointEventId;
  return typeof checkpoint === 'string' ? checkpoint : undefined;
}

export async function resumeMission(
  root: string,
  missionId: string,
): Promise<MissionResumeResult> {
  const inspected = await inspectMission(root, missionId, { dependencies: {} });
  const decision = planMissionRecovery(inspected.stream);
  const checkpointEventId = recoveryCheckpoint(inspected.stream);
  const alreadyRecorded = inspected.stream.events.some((event) =>
    resumedCheckpoint(event) === checkpointEventId
  );
  if (alreadyRecorded) {
    return Object.freeze({ decision, recorded: false });
  }
  const eventId = `evt_${createHash('sha256')
    .update(`${missionId}\0resume\0${checkpointEventId}`)
    .digest('hex')}`;
  const written = await writeSequencedEventOnce({
    root,
    missionId,
    eventId,
    draft: {
      source: 'void-harness:mission.resume',
      kind: 'mission.resumed',
      subject: decision.action.kind === 'run-node'
        || decision.action.kind === 'finalize-node'
        ? decision.action.nodeId
        : 'mission',
      correlationId: missionId,
      payload: {
        checkpointEventId,
        status: decision.status,
        action: decision.action,
      } as unknown as JsonValue,
    },
    validate: rejectClosedMission,
  });
  return Object.freeze({ decision, recorded: written.appended });
}

export async function eventLogPath(
  root: string,
  missionId: string,
): Promise<string> {
  return join(await existingRunDirectory(root, missionId), 'events.jsonl');
}

export async function missionCreatedAt(
  root: string,
  missionId: string,
): Promise<number> {
  const run = await existingRunDirectory(root, missionId);
  const metadata = join(run, 'mission.json');
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(metadata);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
    return (await stat(run)).birthtimeMs;
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error('MISSION_UNSAFE_METADATA: mission.json must be a regular file');
  }
  try {
    const value = JSON.parse(await readFile(metadata, 'utf8')) as {
      createdAt?: unknown;
    };
    const created = typeof value.createdAt === 'string'
      ? Date.parse(value.createdAt)
      : Number.NaN;
    if (Number.isFinite(created)) return created;
  } catch {
    // Legacy/hook-created missions do not necessarily have mission.json.
  }
  return (await stat(run)).birthtimeMs;
}
