import { loadSpecialistMigrationComparisonCatalog, observeSpecialistMigrationAssets, parseSpecialistContractMigrationRequest, recordSpecialistContractMigration } from '../lib/runs/specialist-contract-migration.js';
import { parseSpecialistEvidenceRequest, parseSpecialistEvidenceResponse, requestSpecialistEvidence, recordSpecialistEvidence } from '../lib/runs/specialist-evidence.js';
import { parseMissionRecoveryRequest, recordStoppedMissionRecovery } from '../lib/runs/mission-recovery.js';
import { observedMissionLifecycle, requireOpenMission } from '../lib/runs/mission-lifecycle.js';
import { execFile as nodeExecFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  canonicalJsonHash,
  validatedSpecialistContractMigrations,
  createSpecialistDispatch,
  planLensExecution,
  type LensPlan,
  type OrchestrationCapability,
  compileMissionPlan,
  classifyRisk,
  mergePolicies,
  orchestrateMissionTeam,
  selectMissionMode,
  type MissionTeamAction,
  type MissionPlan,
  type MissionSpecialistPlan,
  type CanonicalEvent,
  type SpecialistRuntimeCapability,
  type SpecialistDispatchEnvelope,
  type SpecialistDispatchRuntime,
  type MissionVerdictStatus,
  type RecoveryDecision,
  citedPaths,
  type ContextArtifact,
  type ContextPackInput,
  type SpecialistInvocationStage,
  type MissionRecoveryRequest,
  type MissionRecoveryObservation,
} from '@voidcorp/mission-engine';
import { writeSequencedEventOnce } from '@voidcorp/hook-runner';
import { findCoreSource } from '../lib/paths.js';
import { type ProjectRoots, resolveProjectRoots } from '../lib/project-roots.js';
import { observeOrchestrationCapability } from '../lib/orchestration-capability.js';
import { specialistCapabilityFor } from '../lib/runtime-adapters.js';
import { loadProjectPolicies } from '../lib/policy-loader.js';
import { loadProfiles } from '../lib/profile-loader.js';
import { readBoundedProjectFile } from '../lib/safe-read.js';
import { loadSpecialists } from '../lib/specialists/load.js';
import { archiveMission, pruneMissions } from '../lib/runs/archive.js';
import { inspectCurrentMission } from '../lib/runs/inspect-current.js';
import { collectKnownSecrets, redactText } from '../lib/runs/redact.js';
import {
  createMission,
  inspectMission,
  loadMissionControllerPlan,
  missionControllerRoutingHash,
  resumeMission,
  writeMissionControllerPlan,
  type MissionMode,
  type MissionControllerTicketBinding,
} from '../lib/runs/store.js';
import { verifyMissionCommand } from '../lib/runs/verify.js';
import {
  parseSpecialistLifecycleInput,
  recordSpecialistLifecycle,
  recordSpecialistRequests,
  type SpecialistLifecycleStatus,
} from '../lib/runs/specialist-lifecycle.js';
import { detectProfileInput, detectStack } from '../lib/stack.js';

const MISSION_ID = /^mis_[A-Za-z0-9_-]{8,100}$/;
const execFile = promisify(nodeExecFile);
const MAX_TICKET_BYTES = 100_000;

export interface CoordinatorRuntimeIdentity {
  readonly runtime: SpecialistDispatchRuntime;
  readonly attested: boolean;
}

/** Runtime markers are injected by the native shell. Codex markers take
 * precedence so a Codex coordinator cannot gain Claude capability by also
 * supplying CLAUDECODE. An unknown shell stays on the degraded Codex path. */
export function coordinatorRuntimeIdentity(
  environment: Readonly<Record<string, string | undefined>>,
): CoordinatorRuntimeIdentity {
  const codex = [
    environment.CODEX_SESSION_ID,
    environment.CODEX_THREAD_ID,
    environment.CODEX_CI,
  ].some((value) => typeof value === 'string' && value.length > 0);
  if (codex) return Object.freeze({ runtime: 'codex', attested: true });
  if (environment.CLAUDECODE === '1') {
    return Object.freeze({ runtime: 'claude', attested: true });
  }
  return Object.freeze({ runtime: 'codex', attested: false });
}

export function constrainCapabilityByAttestation(
  identity: CoordinatorRuntimeIdentity,
  capability: SpecialistRuntimeCapability,
): SpecialistRuntimeCapability {
  if (identity.attested) return capability;
  return Object.freeze({
    status: capability.status === 'unavailable' ? 'unavailable' : 'degraded',
    limitations: Object.freeze([
      'coordinator runtime identity is not attested by a native session marker',
      ...capability.limitations,
    ]),
  });
}

interface InvalidArgs {
  readonly kind: 'invalid';
  readonly code: 'MISSION_USAGE';
  readonly problem: string;
  readonly fix: string;
}

export type MissionArgs =
  | { readonly kind: 'evidence-request'; readonly missionId: string; readonly inputPath: string; readonly json: boolean }
  | { readonly kind: 'evidence-event'; readonly missionId: string; readonly inputPath: string;
      readonly status: 'started' | 'completed'; readonly json: boolean }
  | { readonly kind: 'migrate-specialist'; readonly missionId: string; readonly inputPath: string; readonly json: boolean }
  | {
      readonly kind: 'recover';
      readonly missionId: string;
      readonly inputPath: string;
      readonly json: boolean;
    }
  | {
      readonly kind: 'plan';
      readonly ticketPath: string;
      readonly json: boolean;
    }
  | {
      readonly kind: 'dispatch';
      readonly missionId: string;
      readonly json: boolean;
    }
  | {
      readonly kind: 'specialist-event';
      readonly missionId: string;
      readonly status: SpecialistLifecycleStatus;
      readonly inputPath: string;
      readonly json: boolean;
    }
  | {
      readonly kind: 'start';
      readonly title: string;
      readonly mode: MissionMode;
      readonly ticketPath?: string;
      readonly json: boolean;
    }
  | {
      readonly kind: 'writer-event';
      readonly missionId: string;
      readonly json: boolean;
    }
  | {
      readonly kind: 'close';
      readonly missionId: string;
      readonly reason: 'interrupted' | 'abandoned';
      readonly json: boolean;
    }
  | {
      readonly kind: 'verify';
      readonly missionId: string;
      readonly shell: boolean;
      readonly command: readonly string[];
      readonly json: boolean;
    }
  | {
      readonly kind: 'inspect';
      readonly missionId: string;
      readonly json: boolean;
    }
  | {
      readonly kind: 'resume';
      readonly missionId: string;
      readonly json: boolean;
    }
  | {
      readonly kind: 'archive';
      readonly missionId: string;
      readonly json: boolean;
    }
  | {
      readonly kind: 'prune';
      readonly olderThanDays: number;
      readonly apply: boolean;
      readonly json: boolean;
    }
  | { readonly kind: 'help' }
  | InvalidArgs;

function invalid(problem: string, fix: string): InvalidArgs {
  return { kind: 'invalid', code: 'MISSION_USAGE', problem, fix };
}

function valueAfter(
  args: readonly string[],
  option: string,
): string | undefined {
  const index = args.indexOf(option);
  return index === -1 ? undefined : args[index + 1];
}

function validateOptions(
  args: readonly string[],
  valueOptions: readonly string[],
  booleanOptions: readonly string[],
): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? '';
    if (valueOptions.includes(token)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        return `missing value for ${token}`;
      }
      index += 1;
      continue;
    }
    if (booleanOptions.includes(token)) continue;
    return `unknown option '${token}'`;
  }
  return undefined;
}

function missionIdFrom(options: readonly string[]): string | InvalidArgs {
  const missionId = valueAfter(options, '--id');
  if (missionId === undefined) {
    return invalid('missing required option --id', 'pass --id mis_<opaque-id>');
  }
  if (!MISSION_ID.test(missionId)) {
    return invalid('invalid mission ID', 'pass the ID returned by mission start');
  }
  return missionId;
}

export function parseMissionArgs(args: readonly string[]): MissionArgs {
  const [subcommand] = args;
  const divider = args.indexOf('--');
  const options = args.slice(1, divider === -1 ? undefined : divider);
  if (
    subcommand === undefined
    || subcommand === 'help'
    || subcommand === '--help'
    || options.includes('--help')
  ) {
    return { kind: 'help' };
  }
  const command = divider === -1 ? [] : args.slice(divider + 1);
  if (subcommand === 'evidence-request' || subcommand === 'evidence-event') {
    if (divider !== -1) return invalid('evidence commands do not accept a command', 'remove --');
    const names = options.filter(value => value.startsWith('--'));
    if (new Set(names).size !== names.length) return invalid('duplicate evidence option', 'provide each option once');
    const error = validateOptions(options,
      subcommand === 'evidence-event' ? ['--id', '--input', '--status'] : ['--id', '--input'], ['--json']);
    if (error !== undefined) return invalid(error, 'void-harness mission --help');
    const missionId = missionIdFrom(options);
    if (typeof missionId !== 'string') return missionId;
    const inputPath = valueAfter(options, '--input');
    if (inputPath === undefined) return invalid('missing required option --input', 'pass --input <json-file>');
    const base = { missionId, inputPath, json: options.includes('--json') };
    if (subcommand === 'evidence-request') return { ...base, kind: 'evidence-request' };
    const status = valueAfter(options, '--status');
    if (status !== 'started' && status !== 'completed') return invalid('invalid evidence status', 'pass started|completed');
    return { ...base, kind: 'evidence-event', status };
  }
  if (subcommand === 'recover' || subcommand === 'migrate-specialist') {
    if (divider !== -1) return invalid('recover does not accept a command', 'remove --');
    const tokens = options.filter(value => value.startsWith('--'));
    if (new Set(tokens).size !== tokens.length) {
      return invalid('duplicate recovery option', 'provide each recovery option once');
    }
    const error = validateOptions(options, ['--id', '--input'], ['--json']);
    if (error !== undefined) return invalid(error, 'void-harness mission recover --help');
    const missionId = missionIdFrom(options);
    if (typeof missionId !== 'string') return missionId;
    const inputPath = valueAfter(options, '--input');
    if (inputPath === undefined) return invalid('missing required option --input', 'pass --input <json-file>');
    return subcommand === 'recover'
      ? { kind: 'recover', missionId, inputPath, json: options.includes('--json') }
      : { kind: 'migrate-specialist', missionId, inputPath, json: options.includes('--json') };
  }
  if (subcommand === 'start') {
    if (divider !== -1) {
      return invalid('start does not accept a command', 'remove the -- separator');
    }
    const optionError = validateOptions(
      options,
      ['--title', '--mode', '--ticket'],
      ['--json'],
    );
    if (optionError !== undefined) {
      return invalid(optionError, 'void-harness mission start --help');
    }
    const title = valueAfter(options, '--title')?.trim();
    if (
      title === undefined
      || title === ''
      || title.length > 200
      || [...title].some((character) => {
        const point = character.codePointAt(0) ?? 0;
        return point < 0x20 || point === 0x7f;
      })
    ) {
      return invalid(
        'title must contain 1 to 200 characters',
        'pass --title <title>',
      );
    }
    const mode = valueAfter(options, '--mode') ?? 'team';
    if (mode !== 'fast' && mode !== 'team' && mode !== 'fortress') {
      return invalid(
        `invalid mode '${mode}'`,
        'use --mode fast|team|fortress',
      );
    }
    const ticketPath = valueAfter(options, '--ticket');
    if (ticketPath !== undefined && mode === 'fast') {
      return invalid(
        'controller-owned specialist missions cannot use fast mode',
        'use --mode team or --mode fortress',
      );
    }
    if (ticketPath === undefined) {
      return {
        kind: 'start',
        title,
        mode,
        json: options.includes('--json'),
      };
    }
    return {
      kind: 'start',
      title,
      mode,
      ticketPath,
      json: options.includes('--json'),
    };
  }
  if (subcommand === 'plan') {
    if (divider !== -1) {
      return invalid('plan does not accept a command', 'remove the -- separator');
    }
    const optionError = validateOptions(options, ['--ticket'], ['--json']);
    if (optionError !== undefined) {
      return invalid(optionError, 'void-harness mission plan --help');
    }
    const ticketPath = valueAfter(options, '--ticket');
    if (ticketPath === undefined) {
      return invalid(
        'missing required option --ticket',
        'pass --ticket <markdown-file>',
      );
    }
    return { kind: 'plan', ticketPath, json: options.includes('--json') };
  }
  if (subcommand === 'dispatch') {
    if (divider !== -1) {
      return invalid('dispatch does not accept a command', 'remove the -- separator');
    }
    const optionError = validateOptions(
      options,
      ['--id'],
      ['--json'],
    );
    if (optionError !== undefined) {
      return invalid(optionError, 'void-harness mission dispatch --help');
    }
    const missionId = missionIdFrom(options);
    if (typeof missionId !== 'string') return missionId;
    return {
      kind: 'dispatch',
      missionId,
      json: options.includes('--json'),
    };
  }
  if (subcommand === 'writer-event') {
    if (divider !== -1) {
      return invalid('writer-event does not accept a command', 'remove the -- separator');
    }
    const optionError = validateOptions(
      options,
      ['--id'],
      ['--json'],
    );
    if (optionError !== undefined) {
      return invalid(optionError, 'void-harness mission writer-event --help');
    }
    const missionId = missionIdFrom(options);
    if (typeof missionId !== 'string') return missionId;
    return {
      kind: 'writer-event',
      missionId,
      json: options.includes('--json'),
    };
  }
  if (subcommand === 'close') {
    if (divider !== -1) {
      return invalid('close does not accept a command', 'remove the -- separator');
    }
    const optionError = validateOptions(options, ['--id', '--reason'], ['--json']);
    if (optionError !== undefined) {
      return invalid(optionError, 'void-harness mission close --help');
    }
    const missionId = missionIdFrom(options);
    if (typeof missionId !== 'string') return missionId;
    const reason = valueAfter(options, '--reason');
    if (reason !== 'interrupted' && reason !== 'abandoned') {
      return invalid(
        'close reason must be interrupted or abandoned',
        'pass --reason interrupted|abandoned',
      );
    }
    return {
      kind: 'close',
      missionId,
      reason,
      json: options.includes('--json'),
    };
  }
  if (subcommand === 'specialist-event') {
    if (divider !== -1) {
      return invalid('specialist-event does not accept a command', 'remove the -- separator');
    }
    const optionError = validateOptions(
      options,
      ['--id', '--status', '--input'],
      ['--json'],
    );
    if (optionError !== undefined) {
      return invalid(optionError, 'void-harness mission specialist-event --help');
    }
    const missionId = missionIdFrom(options);
    if (typeof missionId !== 'string') return missionId;
    const status = valueAfter(options, '--status');
    if (status !== 'started' && status !== 'completed' && status !== 'failed') {
      return invalid(
        'status must be started, completed, or failed',
        'pass --status started|completed|failed',
      );
    }
    const inputPath = valueAfter(options, '--input');
    if (inputPath === undefined) {
      return invalid('missing required option --input', 'pass --input <json-file>');
    }
    return {
      kind: 'specialist-event',
      missionId,
      status,
      inputPath,
      json: options.includes('--json'),
    };
  }
  if (subcommand === 'verify') {
    const optionError = validateOptions(
      options,
      ['--id'],
      ['--shell', '--json'],
    );
    if (optionError !== undefined) {
      return invalid(optionError, 'void-harness mission verify --help');
    }
    const missionId = missionIdFrom(options);
    if (typeof missionId !== 'string') return missionId;
    if (divider === -1 || command.length === 0) {
      return invalid(
        'verify requires a command after --',
        'void-harness mission verify --id <id> -- <command...>',
      );
    }
    const shell = options.includes('--shell');
    if (shell && command.length !== 1) {
      return invalid(
        '--shell requires exactly one explicit command string',
        "pass --shell -- 'command && next-command'",
      );
    }
    return {
      kind: 'verify',
      missionId,
      shell,
      command,
      json: options.includes('--json'),
    };
  }
  if (subcommand === 'inspect' || subcommand === 'archive' || subcommand === 'resume') {
    if (divider !== -1) {
      return invalid(
        `${subcommand} does not accept a command`,
        `void-harness mission ${subcommand} --id <id>`,
      );
    }
    const optionError = validateOptions(options, ['--id'], ['--json']);
    if (optionError !== undefined) {
      return invalid(optionError, `void-harness mission ${subcommand} --help`);
    }
    const missionId = missionIdFrom(options);
    if (typeof missionId !== 'string') return missionId;
    return {
      kind: subcommand,
      missionId,
      json: options.includes('--json'),
    };
  }
  if (subcommand === 'prune') {
    if (divider !== -1) {
      return invalid('prune does not accept a command', 'remove the -- separator');
    }
    const optionError = validateOptions(
      options,
      ['--older-than'],
      ['--apply', '--json'],
    );
    if (optionError !== undefined) {
      return invalid(optionError, 'void-harness mission prune --help');
    }
    const rawDays = valueAfter(options, '--older-than');
    const olderThanDays = rawDays === undefined ? Number.NaN : Number(rawDays);
    if (!Number.isInteger(olderThanDays) || olderThanDays < 1) {
      return invalid(
        '--older-than must be a positive integer',
        'pass --older-than <days>',
      );
    }
    return {
      kind: 'prune',
      olderThanDays,
      apply: options.includes('--apply'),
      json: options.includes('--json'),
    };
  }
  return invalid(
    `unknown mission subcommand '${subcommand}'`,
    'use plan, start, dispatch, specialist-event, writer-event, close, resume, verify, inspect, archive, or prune',
  );
}

async function readTicket(root: string, ticketPath: string): Promise<{
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly path: string;
}> {
  const canonicalRoot = await realpath(resolve(root));
  const loaded = await readBoundedProjectFile({
    root: canonicalRoot,
    inputPath: ticketPath,
    maxBytes: MAX_TICKET_BYTES,
    pathEscapeMessage: 'MISSION_TICKET_PATH_ESCAPE: ticket resolves outside project root',
    invalidMessage: `MISSION_TICKET_INVALID: ticket must be a stable file under ${MAX_TICKET_BYTES} bytes`,
  });
  const canonicalTicket = loaded.resolvedPath;
  const body = loaded.body;
  if (body.trim() === '') throw new Error('MISSION_TICKET_INVALID: ticket is empty');
  const heading = body.split('\n').find((line) => /^#\s+\S/.test(line));
  const fallback = basename(canonicalTicket, extname(canonicalTicket));
  return Object.freeze({
    id: fallback.slice(0, 128),
    title: (heading?.replace(/^#\s+/, '').trim() ?? fallback).slice(0, 200),
    body,
    path: normalizeControllerTicketPath(relative(canonicalRoot, canonicalTicket)),
  });
}

export function normalizeControllerTicketPath(path: string): string {
  return path.replaceAll('\\', '/');
}

async function readLifecycleJson(root: string, inputPath: string): Promise<unknown> {
  const loaded = await readBoundedProjectFile({
    root,
    inputPath,
    maxBytes: MAX_TICKET_BYTES,
    pathEscapeMessage: 'SPECIALIST_LIFECYCLE_PATH_ESCAPE: input resolves outside project root',
    invalidMessage: `SPECIALIST_LIFECYCLE_INPUT_INVALID: input must be a stable file under ${MAX_TICKET_BYTES} bytes`,
  });
  try {
    return JSON.parse(loaded.body);
  } catch {
    throw new Error('SPECIALIST_LIFECYCLE_INPUT_INVALID: input must contain valid JSON');
  }
}

interface DetectedFiles {
  readonly files: readonly string[];
  readonly status: 'known' | 'unknown';
}

async function gitFiles(root: string): Promise<DetectedFiles> {
  try {
    const options = { cwd: root, encoding: 'utf8' as const, maxBuffer: 1_000_000, timeout: 5_000 };
    const [changed, untracked] = await Promise.all([
      execFile('git', ['diff', '--name-only', '--relative', 'HEAD'], options),
      execFile('git', ['ls-files', '--others', '--exclude-standard'], options),
    ]);
    return Object.freeze({
      files: Object.freeze(
        [...new Set(`${changed.stdout}\n${untracked.stdout}`
          .split('\n')
          .filter((file) => file !== '' && !file.startsWith('.void/')))].sort(),
      ),
      status: 'known',
    });
  } catch {
    return Object.freeze({ files: Object.freeze([]), status: 'unknown' });
  }
}

interface MissionReviewSubject {
  readonly diff: string;
  readonly files: DetectedFiles;
  readonly hash: string;
}

async function missionReviewBase(root: string): Promise<string> {
  try {
    const result = await execFile('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
      cwd: root, encoding: 'utf8', timeout: 5_000, maxBuffer: 1_000,
    });
    return result.stdout.trim();
  } catch {
    throw new Error('MISSION_REVIEW_BASE_INVALID: a committed Git baseline is required');
  }
}

/** Git 2.50: diff <commit> compares the complete worktree with a fixed commit.
 * https://git-scm.com/docs/git-diff/2.50.0 */
async function captureMissionReviewSubject(
  root: string,
  baseCommit: string | undefined,
): Promise<MissionReviewSubject> {
  if (baseCommit === undefined) {
    throw new Error(
      'MISSION_REVIEW_BASE_MISSING: legacy mission has no review baseline; preserve its history and start a new mission',
    );
  }
  const options = { cwd: root, encoding: 'utf8' as const, timeout: 10_000, maxBuffer: 4_000_000 };
  try {
    await execFile('git', ['merge-base', '--is-ancestor', baseCommit, 'HEAD'], options);
  } catch {
    throw new Error('MISSION_REVIEW_BASE_INVALID: baseline is missing or is not an ancestor of HEAD');
  }
  try {
    const paths = ['--', '.', ':(exclude).void/machine/**'];
    const [patch, names, untracked] = await Promise.all([
      execFile('git', ['diff', '--no-ext-diff', '--no-textconv', '--binary', '--full-index',
        '--no-renames', '--relative', baseCommit, ...paths], options),
      execFile('git', ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z',
        '--no-renames', '--relative', baseCommit, ...paths], options),
      execFile('git', ['ls-files', '--others', '--exclude-standard', '-z', ...paths], options),
    ]);
    if (untracked.stdout !== '') {
      throw new Error('MISSION_REVIEW_UNTRACKED: stage new files before requesting implementation review');
    }
    if (/^GIT binary patch$/m.test(patch.stdout)) {
      throw new Error('MISSION_REVIEW_BINARY_UNSUPPORTED: encoded binary content cannot be safely reviewed');
    }
    const files = Object.freeze({
      files: Object.freeze(names.stdout.split('\0').filter(Boolean).sort()),
      status: 'known' as const,
    });
    return Object.freeze({
      diff: patch.stdout,
      files,
      hash: canonicalJsonHash({ baseCommit, diff: patch.stdout, files: files.files }),
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('MISSION_REVIEW_')) throw error;
    throw new Error('MISSION_REVIEW_CONTENT_UNAVAILABLE: bounded Git review capture failed');
  }
}

/** Token budget one specialist may spend reading, per the expert-team spec. */
const CONTEXT_PACK_BUDGET_TOKENS = 12_000;

/**
 * Compile what every convened specialist reads instead of exploring.
 *
 * Measured on 2026-08-30: `Grep` and `Glob` spawn a `rg` binary that is absent
 * wherever `rg` is only a shell function, so five specialists convened on a real
 * diff read nothing and answered anyway. Handing them the diff removes the
 * dependency rather than repairing it, and a diff git could not produce is named
 * in the pack rather than rendered as an empty one.
 */
const ANCHOR_MAX_BYTES = 200_000;

/** Read one repository file for the pack, or return nothing rather than fail the
 * dispatch: a missing anchor is named in the pack, never a reason to convene
 * nobody. */
async function packArtifact(
  root: string,
  path: string,
): Promise<ContextArtifact | undefined> {
  try {
    const loaded = await readBoundedProjectFile({
      root,
      inputPath: path,
      maxBytes: ANCHOR_MAX_BYTES,
      pathEscapeMessage: 'MISSION_PACK_PATH_ESCAPE: anchor resolves outside project root',
      invalidMessage: 'MISSION_PACK_INVALID: anchor must be a stable bounded file',
    });
    return { path, text: loaded.body };
  } catch {
    return undefined;
  }
}

/**
 * Compile what every convened specialist reads instead of exploring, for the
 * stage it is convened at.
 *
 * The two stages ask different questions and need different evidence. At
 * `post-implementation` the subject is the diff. At `pre-implementation` there
 * IS no diff -- nothing has been written, which is the entire point of briefing
 * first -- so the subject is the ticket and the code it names. The first version
 * of this shipped the diff at both stages, and the panel convened on eleven
 * tokens of empty fence while `omitted` claimed nothing had been left out. That
 * is the silent cap this module exists to refuse, in the stage that matters most.
 *
 * Measured on 2026-08-30 by running the cycle: six specialists convened at
 * `pre-implementation` with an empty pack. Unit tests, typecheck and eighteen
 * gates were all green on it.
 */
async function compileDispatchContent(
  root: string,
  files: DetectedFiles,
  stage: SpecialistInvocationStage,
  ticketPath: string,
  reviewSubject: MissionReviewSubject | undefined,
  profiles: MissionPlan['profiles'],
): Promise<Omit<ContextPackInput, 'dispatch'>> {
  const unavailable = profiles.filter((profile) => profile.sourceReviewRequired)
    .map((profile) => `guidance ${profile.profileId} requires source review: ${profile.reasons.join(', ')}`);
  const secrets = collectKnownSecrets();

  let diff = '';
  if (stage === 'post-implementation') {
    if (reviewSubject === undefined) {
      throw new Error('MISSION_REVIEW_CONTENT_UNAVAILABLE: review subject is missing');
    }
    diff = reviewSubject.diff;
  } else {
    unavailable.push('diff (pre-implementation: nothing is written yet)');
  }

  // The completion path already refuses secret-bearing events. The pack reaches
  // a model runtime and whatever it persists, which is the wider blast radius of
  // the two, so an in-flight credential is masked here rather than forwarded.
  const redactedDiff = redactText(diff, secrets);
  if (redactedDiff !== diff) unavailable.push('diff (secrets redacted)');

  // Ticket first: it is the brief at both stages, and the compiler spends the
  // budget in the order artifacts arrive.
  const ticket = await packArtifact(root, ticketPath);
  if (ticket === undefined) unavailable.push(`${ticketPath} (unreadable)`);
  const anchors = ticket === undefined
    ? []
    : (await Promise.all(citedPaths(ticket.text).map((path) => packArtifact(root, path))));
  const artifacts = [ticket, ...anchors]
    .filter((item): item is ContextArtifact => item !== undefined)
    .map((item) => ({ path: item.path, text: redactText(item.text, secrets) }));

  return {
    diff: redactedDiff,
    touchedPaths: stage === 'post-implementation' ? files.files : [],
    artifacts,
    lens: 'full',
    budgetTokens: CONTEXT_PACK_BUDGET_TOKENS,
    unavailable,
  };
}

function detectedStack(root: string, profileInput: ReturnType<typeof detectProfileInput>): {
  readonly technologies: readonly string[];
  readonly status: 'known' | 'unknown';
} {
  const markers = [
    'package.json',
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
  ];
  if (!markers.some((marker) => existsSync(join(root, marker)))) {
    return Object.freeze({ technologies: Object.freeze([]), status: 'unknown' });
  }
  const stack = detectStack(root);
  return Object.freeze({
    technologies: Object.freeze([...new Set([
      ...Object.values(stack),
      ...profileInput.projects.flatMap((project) =>
        project.technologies.map((technology) => technology.id)),
    ])].sort()),
    status: 'known',
  });
}

export async function planMission(
  root: string,
  ticketPath: string,
  generatedAt = new Date().toISOString(),
): Promise<MissionPlan> {
  return (await planBoundMission(root, ticketPath, generatedAt)).plan;
}

async function compileMission(
  root: string,
  ticket: Awaited<ReturnType<typeof readTicket>>,
  generatedAt: string,
  detectedFiles?: DetectedFiles,
  specialistCatalog?: Awaited<ReturnType<typeof loadSpecialists>>,
): Promise<MissionPlan> {
  const [coreRoot, diff] = await Promise.all([
    findCoreSource(),
    detectedFiles ?? gitFiles(root),
  ]);
  const [policies, profiles, specialists] = await Promise.all([
    loadProjectPolicies(root, join(coreRoot, 'policies')),
    loadProfiles(root, join(coreRoot, 'profiles')),
    specialistCatalog ?? loadSpecialists(coreRoot),
  ]);
  const profileInput = detectProfileInput(root, diff.files);
  const stack = detectedStack(root, profileInput);
  return compileMissionPlan({
    schemaVersion: 2,
    ticket: { id: ticket.id, title: ticket.title, body: ticket.body },
    diff,
    stack,
    policy: mergePolicies(policies, generatedAt),
    profiles: {
      catalog: profiles,
      input: profileInput,
    },
    specialists: { catalog: specialists },
  }, { generatedAt });
}

function controllerTicketBinding(
  ticket: Awaited<ReturnType<typeof readTicket>>,
): MissionControllerTicketBinding {
  return Object.freeze({
    path: ticket.path,
    contentHash: `sha256:${createHash('sha256').update(ticket.body).digest('hex')}`,
  });
}

async function planBoundMission(
  root: string,
  ticketPath: string,
  generatedAt = new Date().toISOString(),
  detectedFiles?: DetectedFiles,
  specialistCatalog?: Awaited<ReturnType<typeof loadSpecialists>>,
): Promise<{
  readonly plan: MissionPlan;
  readonly ticket: MissionControllerTicketBinding;
}> {
  const ticket = await readTicket(root, ticketPath);
  const plan = await compileMission(root, ticket, generatedAt, detectedFiles, specialistCatalog);
  return Object.freeze({
    plan,
    ticket: controllerTicketBinding(ticket),
  });
}

export async function migrateMissionSpecialist(
  roots: ProjectRoots, missionId: string,
  request: import('@voidcorp/mission-engine').SpecialistContractMigrationRequest,
) {
  const { workRoot, installRoot } = roots;
  const [stored, current, coreRoot] = await Promise.all([
    loadMissionControllerPlan(installRoot, missionId),
    inspectCurrentMission(roots, missionId, collectKnownSecrets()), findCoreSource(),
  ]);
  if (request.recovery === undefined) requireOpenMission(current.inspected.stream.events);
  if (missionRoutingHash(current.inspected.stream.events) !== stored.routingHash) {
    throw new Error('MISSION_CONTROLLER_PLAN_INVALID: migration requires the immutable bound plan');
  }
  const identity = missionRuntimeIdentity(current.inspected.stream.events);
  const coordinator = coordinatorRuntimeIdentity(process.env);
  if (!identity?.attested || !coordinator.attested || coordinator.runtime !== identity.runtime) {
    throw new Error('SPECIALIST_CONTRACT_MIGRATION_RUNTIME: observe the original native runtime');
  }
  const capability = await specialistCapabilityFor(installRoot, identity.runtime);
  if (capability.status === 'unavailable') {
    throw new Error(`SPECIALIST_CONTRACT_MIGRATION_NATIVE: ${capability.limitations.join('; ')}`);
  }
  const assets = await observeSpecialistMigrationAssets(coreRoot, installRoot, identity.runtime);
  const subject = await captureMissionReviewSubject(workRoot, stored.baseCommit);
  const live = await planBoundMission(workRoot, stored.ticket.path, new Date().toISOString(), subject.files);
  if (live.ticket.path !== stored.ticket.path || live.ticket.contentHash !== stored.ticket.contentHash) {
    throw new Error('MISSION_TICKET_CHANGED: migration cannot replace the bound ticket');
  }
  const hashes = Object.fromEntries(live.plan.specialists.map(specialist => [specialist.specialistId,
    canonicalJsonHash({ routing: specialist.proof.inputHash, subject: subject.hash })]));
  const comparisonCatalog = await loadSpecialistMigrationComparisonCatalog(coreRoot, assets.declaration, stored.plan);
  const comparison = await planBoundMission(workRoot, stored.ticket.path, new Date().toISOString(), subject.files, comparisonCatalog);
  const originalHashes = Object.fromEntries(comparison.plan.specialists.map(specialist => [specialist.specialistId,
    canonicalJsonHash({ routing: specialist.proof.inputHash, subject: subject.hash })]));
  const targetInputHash = hashes[assets.declaration.specialistId];
  if (targetInputHash === undefined) throw new Error('SPECIALIST_CONTRACT_MIGRATION_INVALID: missing target review input');
  const result = await recordSpecialistContractMigration(installRoot, missionId, request, {
    ...assets, reviewSubjectHash: subject.hash, targetInputHash, plan: stored.plan,
    currentInputHashes: originalHashes, maxRounds: 2,
    expectedSource: identity.runtime === 'codex' ? 'runtime:codex' : 'runtime:claude',
    evidenceDependencies: { 'git:working-tree': current.project.diffHash },
  });
  return { ...result, provenance: { coreRoot, runtime: identity.runtime, capability,
    declarationHash: canonicalJsonHash(assets.declaration), nativeAgentSha256: assets.nativeAgentSha256 } };
}

/** Observe recovery inputs from the bound project and this candidate's actual assets. */
export async function recoverStoppedMission(
  roots: ProjectRoots, missionId: string, request: MissionRecoveryRequest,
) {
  const { workRoot, installRoot } = roots;
  const [stored, current, coreRoot] = await Promise.all([
    loadMissionControllerPlan(installRoot, missionId),
    inspectCurrentMission(roots, missionId, collectKnownSecrets()), findCoreSource(),
  ]);
  const inspected = current.inspected;
  if (missionRoutingHash(inspected.stream.events) !== stored.routingHash) {
    throw new Error('MISSION_CONTROLLER_PLAN_INVALID: recovery requires the original bound plan');
  }
  const identity = missionRuntimeIdentity(inspected.stream.events);
  const coordinator = coordinatorRuntimeIdentity(process.env);
  if (!identity?.attested || !coordinator.attested || coordinator.runtime !== identity.runtime) {
    throw new Error('MISSION_RECOVERY_RUNTIME: observe the original native runtime before recovery');
  }
  const capability = await specialistCapabilityFor(installRoot, identity.runtime);
  if (capability.status === 'unavailable') {
    throw new Error(`MISSION_RECOVERY_CAPABILITY: ${capability.limitations.join('; ')}`);
  }
  const migration = validatedSpecialistContractMigrations(inspected.stream.events, stored.plan);
  if (!migration.ok) throw new Error(`SPECIALIST_CONTRACT_MIGRATION_INVALID: ${migration.reasons.join('; ')}`);
  const catalog = await loadSpecialists(coreRoot);
  for (const specialist of migration.plan.specialists) {
    const current = catalog.find(value => value.id === specialist.specialistId);
    if (!current || current.version !== specialist.contractVersion) {
      throw new Error(`MISSION_RECOVERY_CONTRACT: ${specialist.specialistId} needs matching candidate assets`);
    }
  }
  const implemented = inspected.stream.events.some(event => event.kind === 'lead-writer.completed'
    && objectField(event.payload, 'actionKind') !== 'run-preparation-correction');
  const subject = implemented ? await captureMissionReviewSubject(workRoot, stored.baseCommit) : undefined;
  const live = await planBoundMission(workRoot, stored.ticket.path, new Date().toISOString(), subject?.files);
  if (live.ticket.path !== stored.ticket.path || live.ticket.contentHash !== stored.ticket.contentHash) {
    throw new Error('MISSION_TICKET_CHANGED: recovery cannot replace the original ticket');
  }
  const currentInputHashes = Object.fromEntries(live.plan.specialists.map(specialist => [
    specialist.specialistId, subject === undefined ? specialist.proof.inputHash
      : canonicalJsonHash({ routing: specialist.proof.inputHash, subject: subject.hash }),
  ]));
  if (migration.migration !== undefined) {
    if (subject === undefined) {
      throw new Error('SPECIALIST_CONTRACT_MIGRATION_INVALID: migration requires its post-implementation subject');
    }
    const assets = await observeSpecialistMigrationAssets(coreRoot, installRoot, identity.runtime);
    if (canonicalJsonHash(assets.declaration) !== migration.migration.receipt.declarationHash
      || assets.nativeAgentSha256 !== migration.migration.receipt.nativeAgentSha256) {
      throw new Error('SPECIALIST_CONTRACT_MIGRATION_INVALID: declared or installed contract changed');
    }
    const comparisonCatalog = await loadSpecialistMigrationComparisonCatalog(coreRoot, assets.declaration, stored.plan);
    const comparison = await planBoundMission(workRoot, stored.ticket.path, new Date().toISOString(), subject.files, comparisonCatalog);
    for (const specialist of comparison.plan.specialists) {
      if (specialist.specialistId !== assets.declaration.specialistId) {
        currentInputHashes[specialist.specialistId] = canonicalJsonHash({
          routing: specialist.proof.inputHash, subject: subject.hash,
        });
      }
    }
  }
  const resolutionArtifact = request.disposition.kind === 'review-blocker'
    ? await recoveryResolutionArtifact(workRoot, request.disposition.resolutionArtifact.path) : undefined;
  const observation: MissionRecoveryObservation = {
    stage: implemented ? 'post-implementation' : 'pre-implementation', maxRounds: 2,
    evidenceDependencies: { 'git:working-tree': current.project.diffHash },
    expectedSource: identity.runtime === 'codex' ? 'runtime:codex' : 'runtime:claude',
    currentInputHashes,
    contractVersions: Object.fromEntries(migration.plan.specialists.map(value => [value.specialistId, value.contractVersion])),
    ...(resolutionArtifact === undefined ? {} : { resolutionArtifact }),
  };
  const result = await recordStoppedMissionRecovery(installRoot, missionId, request, observation);
  return { ...result, provenance: { coreRoot, catalogHash: canonicalJsonHash(catalog),
    routingHash: stored.routingHash, runtime: identity.runtime, capability } };
}

async function evidenceRuntime(roots: ProjectRoots, missionId: string) {
  const inspected = await inspectMission(roots.installRoot, missionId, { dependencies: {} });
  const identity = missionRuntimeIdentity(inspected.stream.events);
  const coordinator = coordinatorRuntimeIdentity(process.env);
  if (!identity?.attested || !coordinator.attested || coordinator.runtime !== identity.runtime) {
    throw new Error('SPECIALIST_EVIDENCE_INVALID: observe the original native runtime before author clarification');
  }
  const capability = await specialistCapabilityFor(roots.installRoot, identity.runtime);
  if (capability.status === 'unavailable') {
    throw new Error(`SPECIALIST_EVIDENCE_INVALID: ${capability.limitations.join('; ')}`);
  }
  return capability;
}

async function recoveryResolutionArtifact(root: string, path: string) {
  const loaded = await readBoundedProjectFile({ root, inputPath: path, maxBytes: 100_000,
    pathEscapeMessage: 'MISSION_RECOVERY_INVALID: resolution artifact escaped the project',
    invalidMessage: 'MISSION_RECOVERY_INVALID: unsafe or oversized resolution artifact' });
  return { path, sha256: `sha256:${createHash('sha256').update(loaded.body).digest('hex')}` };
}

/**
 * Two roots, on purpose. The ticket, the diff and the context pack are read
 * from the tree the command runs in; the mission journal, the controller plan
 * and the installed specialists belong to the repository and are read from
 * the installation root. In the main checkout the two are one directory; from
 * a linked worktree the panel would otherwise be looked for where `git
 * worktree add` never put it (DEV-732).
 */
export async function dispatchMissionSpecialists(
  roots: ProjectRoots,
  input: Extract<MissionArgs, { readonly kind: 'dispatch' }>,
  generatedAt = new Date().toISOString(),
  capabilityOverride?: SpecialistRuntimeCapability,
  orchestrationOverride?: OrchestrationCapability,
): Promise<{
  readonly planHash: string;
  readonly phase: string;
  readonly action: MissionTeamAction;
  readonly nextWriterRound?: number;
  readonly envelopes: readonly SpecialistDispatchEnvelope[];
  /**
   * How wide to run the envelopes, and what the runtime could actually carry.
   *
   * A ceiling, never a truncation: every envelope is still returned, because the
   * controller returns `verified` only once every applicable completion is in.
   */
  readonly lensPlan?: LensPlan;
}> {
  const { workRoot, installRoot } = roots;
  const [stored, initialInspection] = await Promise.all([
    loadMissionControllerPlan(installRoot, input.missionId),
    inspectMission(installRoot, input.missionId, { dependencies: {} }),
  ]);
  const current = initialInspection.stream.events.some(event => event.kind === 'evidence.recorded')
    ? await inspectCurrentMission(roots, input.missionId, collectKnownSecrets()) : undefined;
  const inspected = current?.inspected ?? initialInspection;
  requireOpenMission(inspected.stream.events);
  const implemented = inspected.stream.events.some((event) =>
    event.kind === 'lead-writer.completed'
    && isUnknownRecord(event.payload)
    && event.payload.actionKind !== 'run-preparation-correction');
  const reviewSubject = implemented
    ? await captureMissionReviewSubject(workRoot, stored.baseCommit)
    : undefined;
  const live = await planBoundMission(
    workRoot, stored.ticket.path, generatedAt, reviewSubject?.files,
  );
  const livePlan = live.plan;
  if (
    live.ticket.path !== stored.ticket.path
    || live.ticket.contentHash !== stored.ticket.contentHash
  ) {
    throw new Error(
      'MISSION_TICKET_CHANGED: the controller-bound ticket path or content changed; start a new mission',
    );
  }
  if (missionRoutingHash(inspected.stream.events) !== stored.routingHash) {
    throw new Error('MISSION_CONTROLLER_PLAN_INVALID: stored routing does not match mission start');
  }
  const currentInputHashes = Object.fromEntries(livePlan.specialists.map((specialist) => [
    specialist.specialistId,
    reviewSubject === undefined ? specialist.proof.inputHash : canonicalJsonHash({
      routing: specialist.proof.inputHash, subject: reviewSubject.hash,
    }),
  ]));
  const migration = validatedSpecialistContractMigrations(inspected.stream.events, stored.plan);
  if (!migration.ok) throw new Error(`SPECIALIST_CONTRACT_MIGRATION_INVALID: ${migration.reasons.join('; ')}`);
  if (migration.migration !== undefined) {
    const identity = missionRuntimeIdentity(inspected.stream.events);
    if (identity === undefined || reviewSubject === undefined) {
      throw new Error('SPECIALIST_CONTRACT_MIGRATION_INVALID: migration requires its native post-implementation subject');
    }
    const coreRoot = await findCoreSource();
    const assets = await observeSpecialistMigrationAssets(coreRoot, installRoot, identity.runtime);
    if (canonicalJsonHash(assets.declaration) !== migration.migration.receipt.declarationHash
      || assets.nativeAgentSha256 !== migration.migration.receipt.nativeAgentSha256) {
      throw new Error('SPECIALIST_CONTRACT_MIGRATION_INVALID: declared or installed contract changed');
    }
    const catalog = await loadSpecialistMigrationComparisonCatalog(coreRoot, assets.declaration, stored.plan);
    const comparison = await planBoundMission(workRoot, stored.ticket.path, generatedAt, reviewSubject.files, catalog);
    for (const specialist of comparison.plan.specialists) {
      if (specialist.specialistId !== assets.declaration.specialistId) {
        currentInputHashes[specialist.specialistId] = canonicalJsonHash({
          routing: specialist.proof.inputHash, subject: reviewSubject.hash,
        });
      }
    }
  }
  const firstImplementation = inspected.stream.events.find(event => event.kind === 'lead-writer.completed'
    && objectField(event.payload, 'actionKind') !== 'run-preparation-correction');
  const implementationRequest = firstImplementation === undefined ? undefined
    : inspected.stream.events.find(event => event.kind === 'lead-writer.requested'
      && event.eventId === objectField(firstImplementation.payload, 'requestEventId'));
  const preparationBoundary = implementationRequest?.seq ?? firstImplementation?.seq;
  const preImplementationInputHashes: Record<string, string> = {};
  for (const specialist of stored.plan.specialists) {
    const admittedPreparation = preparationBoundary === undefined ? undefined
      : inspected.stream.events.filter(event => event.kind === 'specialist.completed'
        && event.seq < preparationBoundary && event.subject === specialist.specialistId
        && objectField(event.payload, 'stage') === 'pre-implementation').at(-1);
    const admittedHash = admittedPreparation === undefined ? undefined
      : objectField(admittedPreparation.payload, 'inputHash');
    const inputHash = implemented
      ? (typeof admittedHash === 'string' ? admittedHash : specialist.inputHash)
      : currentInputHashes[specialist.specialistId];
    if (inputHash === undefined) {
      throw new Error(
        `MISSION_CONTROLLER_PLAN_INVALID: pre-implementation hash missing for ${specialist.specialistId}`,
      );
    }
    preImplementationInputHashes[specialist.specialistId] = inputHash;
  }
  const runtimeIdentity = missionRuntimeIdentity(inspected.stream.events);
  const runtime = runtimeIdentity?.runtime;
  const rawCapability = capabilityOverride ?? (runtime === undefined
    ? { status: 'unavailable' as const, limitations: ['mission runtime identity is missing'] }
    : await specialistCapabilityFor(installRoot, runtime));
  const specialistRuntime = runtimeIdentity === undefined
    ? rawCapability
    : constrainCapabilityByAttestation(runtimeIdentity, rawCapability);
  const decision = orchestrateMissionTeam({
    plan: stored.plan,
    stream: inspected.stream,
    evidenceContext: { dependencies: current === undefined ? {}
      : { 'git:working-tree': current.project.diffHash } },
    currentInputHashesByStage: {
      'pre-implementation': preImplementationInputHashes,
      'post-implementation': currentInputHashes,
    },
    maxReviewRounds: 2,
    specialistRuntime,
  });
  const envelopes = decision.action.kind === 'invoke-specialists' && runtime !== undefined
    ? createSpecialistDispatch({
        missionId: input.missionId,
        runtime,
        plan: migration.plan,
        action: decision.action,
        currentInputHashes: decision.action.stage === 'pre-implementation'
          ? preImplementationInputHashes
          : currentInputHashes,
        contextContent: await compileDispatchContent(
          workRoot,
          reviewSubject?.files ?? await gitFiles(workRoot),
          decision.action.stage,
          stored.ticket.path,
          reviewSubject,
          livePlan.profiles,
        ),
      })
    : Object.freeze([]);
  // Independent lenses, which is what the canonical plan declares them to be:
  // fresh context, assigned lens only, no write access. A debate is a different
  // demand and belongs to the pass that makes it, not to this one.
  const lensPlan = envelopes.length > 0 && runtime !== undefined
    ? planLensExecution(
        { declaredLenses: envelopes.length, wants: 'independent' },
        orchestrationOverride ?? observeOrchestrationCapability(runtime, process.env),
      )
    : undefined;
  if (envelopes.length > 0) {
    await recordSpecialistRequests(installRoot, input.missionId, envelopes, stored.plan.planHash);
  }
  const writerEvents = inspected.stream.events.filter((event) =>
    event.kind === 'lead-writer.completed').length;
  const writerAction = isLeadWriterAction(decision.action)
    ? decision.action
    : undefined;
  const nextWriterRound = writerAction === undefined ? undefined : writerEvents + 1;
  if (nextWriterRound !== undefined && writerAction !== undefined) {
    await recordLeadWriterRequest(
      installRoot,
      input.missionId,
      stored.plan.planHash,
      writerAction,
      nextWriterRound,
    );
  }
  if (decision.action.kind === 'complete' || decision.action.kind === 'stop') {
    await recordMissionClosure(
      installRoot,
      input.missionId,
      decision.action.kind === 'complete' ? 'completed' : 'controller-stop',
      'void-harness:mission.dispatch',
    );
  }
  return Object.freeze({
    planHash: stored.plan.planHash,
    phase: decision.phase,
    action: decision.action,
    ...(
      nextWriterRound === undefined ? {} : { nextWriterRound }
    ),
    envelopes,
    ...(lensPlan === undefined ? {} : { lensPlan }),
  });
}

function missionSpecialistPlan(plan: MissionPlan): MissionSpecialistPlan {
  return Object.freeze({
    planHash: plan.planHash,
    context: Object.freeze({
      status: plan.context.status,
      issues: Object.freeze([...plan.context.issues]),
    }),
    specialists: Object.freeze(plan.specialists.map((specialist) => Object.freeze({
      specialistId: specialist.specialistId,
      contractVersion: specialist.contractVersion,
      inputHash: specialist.proof.inputHash,
      state: specialist.state,
      stages: Object.freeze([...specialist.stages]),
    }))),
  });
}

function missionRuntimeIdentity(
  events: readonly { readonly kind: string; readonly payload: unknown }[],
): CoordinatorRuntimeIdentity | undefined {
  const started = events.find((event) => event.kind === 'mission.started');
  const runtime = objectField(started?.payload, 'runtime');
  if (runtime !== 'claude' && runtime !== 'codex') return undefined;
  return Object.freeze({
    runtime,
    attested: objectField(started?.payload, 'runtimeAttested') === true,
  });
}

function missionRoutingHash(
  events: readonly { readonly kind: string; readonly payload: unknown }[],
): string | undefined {
  const started = events.find((event) => event.kind === 'mission.started');
  const routingHash = objectField(started?.payload, 'routingHash');
  return typeof routingHash === 'string' ? routingHash : undefined;
}

function objectField(value: unknown, key: string): unknown {
  return isUnknownRecord(value) ? value[key] : undefined;
}

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && Boolean(value) && !Array.isArray(value);
}

function rejectClosedMission(events: readonly CanonicalEvent[]): void {
  requireOpenMission(events);
}

export async function recordLeadWriterCompletion(
  root: string,
  input: Extract<MissionArgs, { readonly kind: 'writer-event' }>,
): Promise<void> {
  const inspected = await inspectMission(root, input.missionId, { dependencies: {} });
  requireOpenMission(inspected.stream.events);
  const requests = inspected.stream.events.filter((event) =>
    event.kind === 'lead-writer.requested'
    && event.source === 'void-harness:mission.dispatch')
    .sort((left, right) => right.seq - left.seq);
  const request = requests[0];
  if (request === undefined || !isUnknownRecord(request.payload)) {
    throw new Error('MISSION_WRITER_EVENT_INVALID: no controller writer request is pending');
  }
  const writerId = request.payload.writerId;
  const planHash = request.payload.planHash;
  const implementationRound = request.payload.implementationRound;
  const actionKind = request.payload.actionKind;
  if (
    typeof writerId !== 'string'
    || request.subject !== writerId
    || typeof planHash !== 'string'
    || !Number.isSafeInteger(implementationRound)
    || (actionKind !== 'run-lead-writer'
      && actionKind !== 'run-correction'
      && actionKind !== 'run-preparation-correction')
  ) {
    throw new Error('MISSION_WRITER_EVENT_INVALID: writer request is malformed');
  }
  const existing = inspected.stream.events.find((event) =>
    event.kind === 'lead-writer.completed'
    && objectField(event.payload, 'requestEventId') === request.eventId);
  if (existing !== undefined) return;
  const eventId = `evt_${createHash('sha256')
    .update([
      input.missionId,
      'lead-writer.completed',
      request.eventId,
    ].join('|'))
    .digest('hex')}`;
  const result = await writeSequencedEventOnce({
    root,
    missionId: input.missionId,
    eventId,
    draft: {
      source: writerId,
      kind: 'lead-writer.completed',
      subject: writerId,
      causationId: request.eventId,
      correlationId: input.missionId,
      payload: {
        writerId,
        planHash,
        actionKind,
        implementationRound: Number(implementationRound),
        requestEventId: request.eventId,
      },
    },
    validate: rejectClosedMission,
  });
  if (
    result.event.kind !== 'lead-writer.completed'
    || result.event.subject !== writerId
    || result.event.causationId !== request.eventId
    || objectField(result.event.payload, 'implementationRound') !== implementationRound
  ) {
    throw new Error('MISSION_WRITER_EVENT_CONFLICT: implementation round already has another owner');
  }
}

type LeadWriterAction = Extract<MissionTeamAction, {
  readonly kind: 'run-lead-writer' | 'run-correction' | 'run-preparation-correction';
}>;

function isLeadWriterAction(action: MissionTeamAction): action is LeadWriterAction {
  return action.kind === 'run-lead-writer'
    || action.kind === 'run-correction'
    || action.kind === 'run-preparation-correction';
}

async function recordLeadWriterRequest(
  root: string,
  missionId: string,
  planHash: string,
  action: LeadWriterAction,
  implementationRound: number,
): Promise<void> {
  const findingIds = action.kind === 'run-lead-writer' ? [] : [...action.findingIds];
  const eventId = `evt_${createHash('sha256')
    .update([
      missionId,
      'lead-writer.requested',
      planHash,
      action.kind,
      action.writerId,
      String(implementationRound),
      ...findingIds,
    ].join('|'))
    .digest('hex')}`;
  const result = await writeSequencedEventOnce({
    root,
    missionId,
    eventId,
    draft: {
      source: 'void-harness:mission.dispatch',
      kind: 'lead-writer.requested',
      subject: action.writerId,
      correlationId: missionId,
      payload: {
        planHash,
        actionKind: action.kind,
        writerId: action.writerId,
        implementationRound,
        findingIds,
      },
    },
    validate: rejectClosedMission,
  });
  if (
    result.event.kind !== 'lead-writer.requested'
    || result.event.source !== 'void-harness:mission.dispatch'
    || result.event.subject !== action.writerId
    || objectField(result.event.payload, 'implementationRound') !== implementationRound
  ) {
    throw new Error('MISSION_WRITER_REQUEST_CONFLICT: controller action receipt conflicts');
  }
}

type MissionClosureReason =
  | 'completed'
  | 'controller-stop'
  | 'interrupted'
  | 'abandoned';

export async function recordMissionClosure(
  root: string,
  missionId: string,
  reason: MissionClosureReason,
  source = 'void-harness:mission.close',
): Promise<void> {
  const inspected = await inspectMission(root, missionId, { dependencies: {} });
  const lifecycle = observedMissionLifecycle(inspected.stream.events);
  if (lifecycle.status === 'closed') {
    if (objectField(lifecycle.closure.payload, 'reason') === reason) return;
    throw new Error('MISSION_CLOSURE_CONFLICT: mission already closed for another reason');
  }
  const eventId = `evt_${createHash('sha256')
    .update([missionId, 'mission.closed', lifecycle.episodeId].join('|'))
    .digest('hex')}`;
  let result: Awaited<ReturnType<typeof writeSequencedEventOnce>>;
  try {
    result = await writeSequencedEventOnce({
      root,
      missionId,
      eventId,
      draft: {
        source,
        kind: 'mission.closed',
        subject: 'mission',
        correlationId: missionId,
        payload: { reason, episodeId: lifecycle.episodeId },
      },
      validate: events => {
        const current = observedMissionLifecycle(events);
        if (current.status !== 'open' || current.episodeId !== lifecycle.episodeId) {
          throw new Error('MISSION_CLOSURE_CONFLICT: active episode changed');
        }
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('HOOK_EVENT_ID_CONFLICT:')) {
      throw new Error('MISSION_CLOSURE_CONFLICT: mission already closed for another reason');
    }
    throw error;
  }
  if (
    result.event.kind !== 'mission.closed'
    || result.event.subject !== 'mission'
    || objectField(result.event.payload, 'reason') !== reason
  ) {
    throw new Error('MISSION_CLOSURE_CONFLICT: mission already closed for another reason');
  }
}

function renderPlan(plan: MissionPlan): string {
  const applicable = plan.applicability.filter((item) => item.state === 'pending').length;
  const specialists = plan.specialists.filter((item) => item.state === 'applicable').length;
  return [
    `${plan.ticketId} risk=${plan.risk.level} mode=${plan.risk.requiredMode}`,
    `passes applicable=${applicable} total=${plan.applicability.length}`,
    `specialists applicable=${specialists} total=${plan.specialists.length}`,
    `plan ${plan.planHash}`,
  ].join('\n');
}

function renderInspection(
  inspected: Awaited<ReturnType<typeof inspectCurrentMission>>['inspected'],
): string {
  const verdict = inspected.verdict;
  return [
    `${verdict.missionId} ${verdict.status}`,
    `${verdict.title} (${verdict.mode})`,
    `evidence fresh=${verdict.freshEvidence} stale=${verdict.staleEvidence} tampered=${verdict.tamperedEvidence}`,
    `blockers=${verdict.openBlockers} exceptions=${verdict.acceptedExceptions}`,
    ...verdict.reasons.map((reason) => `- ${reason}`),
  ].join('\n');
}

export function missionVerdictExitCode(
  status: MissionVerdictStatus,
): 0 | 1 {
  return status === 'verified' || status === 'shipped-with-exception' ? 0 : 1;
}

export function missionRecoveryExitCode(
  status: RecoveryDecision['status'],
): 0 | 1 {
  return status === 'active' || status === 'complete' ? 0 : 1;
}

function usage(): string {
  return `void-harness mission

  mission start --title <title> [--ticket <markdown-file>] [--mode fast|team|fortress] [--json]
  mission plan --ticket <markdown-file> [--json]
  mission dispatch --id <id> [--json]
  mission evidence-request --id <id> --input <json-file> [--json]
  mission evidence-event --id <id> --status started|completed --input <json-file> [--json]
  mission recover --id <id> --input <json-file> [--json]
  mission specialist-event --id <id> --status started|completed|failed --input <json-file> [--json]
  mission writer-event --id <id> [--json]
  mission close --id <id> --reason interrupted|abandoned [--json]
  mission verify --id <id> [--shell] [--json] -- <command...>
  mission resume --id <id> [--json]
  mission inspect --id <id> [--json]
  mission archive --id <id> [--json]
  mission prune --older-than <days> [--apply] [--json]

Commands use shell:false. --shell is explicit and accepts one command string.
Prune is a dry-run unless --apply is present.
`;
}

interface MissionFailure {
  readonly code: string;
  readonly problem: string;
  readonly cause: string;
  readonly fix: string;
}

function missionFailure(error: unknown): MissionFailure {
  const message = error instanceof Error ? error.message : String(error);
  const match = /^([A-Z][A-Z0-9_]+):\s*(.*)$/s.exec(message);
  return Object.freeze({
    code: match?.[1] ?? 'MISSION_FAILED',
    problem: 'mission command could not complete',
    cause: match?.[2] ?? message,
    fix: 'correct the reported input or policy and retry',
  });
}

export function renderMissionFailure(error: unknown, json: boolean): string {
  const failure = missionFailure(error);
  if (json) return `${JSON.stringify({ error: failure })}\n`;
  return `${failure.code}: ${failure.problem}\n`
    + `Cause: ${failure.cause}\n`
    + `Fix: ${failure.fix}.\n`;
}

export async function mission(args: readonly string[]): Promise<void> {
  const parsed = parseMissionArgs(args);
  if (parsed.kind === 'help') {
    process.stdout.write(usage());
    return;
  }
  if (parsed.kind === 'invalid') {
    if (args.includes('--json')) {
      process.stderr.write(`${JSON.stringify({
        error: {
          code: parsed.code,
          problem: parsed.problem,
          cause: 'arguments did not satisfy the mission command contract',
          fix: parsed.fix,
        },
      })}\n`);
    } else {
      process.stderr.write(
        `${parsed.code}: ${parsed.problem}\nFix: ${parsed.fix}\n`,
      );
    }
    process.exitCode = 2;
    return;
  }
  // Resolved once. Everything read from the tree takes `workRoot`; the journal,
  // the controller plan and the installed panel take `installRoot`.
  const roots = resolveProjectRoots();
  const root = roots.workRoot;
  const journal = roots.installRoot;
  try {
    if (parsed.kind === 'plan') {
      const plan = await planMission(root, parsed.ticketPath);
      process.stdout.write(parsed.json ? `${JSON.stringify(plan)}\n` : `${renderPlan(plan)}\n`);
      return;
    }
    if (parsed.kind === 'evidence-request' || parsed.kind === 'evidence-event') {
      const capability = await evidenceRuntime(roots, parsed.missionId);
      const value = await readLifecycleJson(root, parsed.inputPath);
      if (parsed.kind === 'evidence-request') {
        const request = await requestSpecialistEvidence(roots, parsed.missionId, parseSpecialistEvidenceRequest(value));
        process.stdout.write(parsed.json ? `${JSON.stringify({ request, capability })}\n` : `${request.eventId}\n`);
      } else {
        await recordSpecialistEvidence(roots, parsed.missionId, parsed.status,
          parseSpecialistEvidenceResponse(parsed.status, value));
        process.stdout.write(parsed.json ? `${JSON.stringify({ recorded: true, status: parsed.status, capability })}\n`
          : `recorded evidence ${parsed.status}\n`);
      }
      return;
    }
    if (parsed.kind === 'migrate-specialist') {
      const request = parseSpecialistContractMigrationRequest(await readLifecycleJson(root, parsed.inputPath));
      const result = await migrateMissionSpecialist(roots, parsed.missionId, request);
      process.stdout.write(parsed.json ? `${JSON.stringify(result)}\n`
        : `specialist migration ${result.recorded ? 'recorded' : 'already recorded'}: ${result.migrationEventId}\n`);
      return;
    }
    if (parsed.kind === 'recover') {
      const request = parseMissionRecoveryRequest(await readLifecycleJson(root, parsed.inputPath));
      const result = await recoverStoppedMission(roots, parsed.missionId, request);
      process.stdout.write(parsed.json ? `${JSON.stringify(result)}\n`
        : `recovery ${result.recorded ? 'recorded' : 'already recorded'}: ${result.recoveryEventId}\n`);
      return;
    }
    if (parsed.kind === 'dispatch') {
      const dispatched = await dispatchMissionSpecialists(roots, parsed);
      process.stdout.write(
        parsed.json
          ? `${JSON.stringify(dispatched)}\n`
          : `${dispatched.planHash}\n${dispatched.phase}: ${dispatched.action.kind}\n${dispatched.envelopes
            .map((envelope) => `${envelope.agentName} ${envelope.stage} round=${envelope.reviewRound}`)
            .join('\n')}${dispatched.envelopes.length === 0 ? '' : '\n'}`,
      );
      return;
    }
    if (parsed.kind === 'specialist-event') {
      const lifecycle = parseSpecialistLifecycleInput(
        parsed.status,
        await readLifecycleJson(root, parsed.inputPath),
      );
      await recordSpecialistLifecycle(journal, parsed.missionId, lifecycle);
      process.stdout.write(
        parsed.json
          ? `${JSON.stringify({ recorded: true, status: parsed.status })}\n`
          : `recorded specialist.${parsed.status}\n`,
      );
      return;
    }
    if (parsed.kind === 'writer-event') {
      await recordLeadWriterCompletion(journal, parsed);
      process.stdout.write(
        parsed.json
          ? `${JSON.stringify({ recorded: true, status: 'completed' })}\n`
          : 'recorded lead-writer.completed\n',
      );
      return;
    }
    if (parsed.kind === 'close') {
      await recordMissionClosure(journal, parsed.missionId, parsed.reason);
      process.stdout.write(
        parsed.json
          ? `${JSON.stringify({ closed: true, reason: parsed.reason })}\n`
          : `closed mission: ${parsed.reason}\n`,
      );
      return;
    }
    if (parsed.kind === 'start') {
      const baseCommit = parsed.ticketPath === undefined ? undefined : await missionReviewBase(root);
      const bound = parsed.ticketPath === undefined
        ? undefined
        : await planBoundMission(root, parsed.ticketPath);
      const plan = bound?.plan;
      const diff = plan === undefined ? await gitFiles(root) : undefined;
      const stack = diff === undefined
        ? undefined
        : detectedStack(root, detectProfileInput(root, diff.files));
      const selection = plan === undefined && diff !== undefined && stack !== undefined
        ? selectMissionMode(classifyRisk({
            ticket: parsed.title,
            files: diff.files,
            stack: stack.technologies,
            complete: diff.status === 'known' && stack.status === 'known',
          }), parsed.mode)
        : selectMissionMode(plan?.risk ?? classifyRisk({
            ticket: parsed.title,
            files: [],
            stack: [],
            complete: false,
          }), parsed.mode);
      const missionId = `mis_${randomUUID()}`;
      const controllerPlan = plan === undefined ? undefined : missionSpecialistPlan(plan);
      const ticketBinding = bound?.ticket;
      const runtimeIdentity = bound === undefined
        ? undefined
        : coordinatorRuntimeIdentity(process.env);
      const routingHash = controllerPlan === undefined
        ? undefined
        : ticketBinding === undefined
          ? undefined
          : missionControllerRoutingHash(controllerPlan, ticketBinding, baseCommit);
      await createMission(journal, {
        missionId,
        title: parsed.title,
        mode: selection.effectiveMode,
        requestedMode: selection.requestedMode,
        ...(selection.promotion === undefined
          ? {}
          : { promotionReason: selection.promotion.reason }),
        ...(plan === undefined || runtimeIdentity === undefined || routingHash === undefined
          ? {}
          : {
              teamController: {
                planHash: plan.planHash,
                routingHash,
                leadWriterId: 'writer:primary',
                runtime: runtimeIdentity.runtime,
                runtimeAttested: runtimeIdentity.attested,
              },
          }),
      });
      if (controllerPlan !== undefined) {
        if (ticketBinding === undefined) {
          throw new Error('MISSION_CONTROLLER_PLAN_INVALID: ticket binding is missing');
        }
        const storedHash = await writeMissionControllerPlan(
          journal,
          missionId,
          controllerPlan,
          ticketBinding,
          baseCommit,
        );
        if (storedHash !== routingHash) {
          throw new Error('MISSION_CONTROLLER_PLAN_INVALID: routing hash changed while storing');
        }
      }
      process.stdout.write(
        parsed.json
          ? `${JSON.stringify({
              missionId,
              ...selection,
              ...(plan === undefined ? {} : { planHash: plan.planHash }),
            })}\n`
          : `${missionId}\n${selection.promotion === undefined
            ? ''
            : `mode ${selection.requestedMode} -> ${selection.effectiveMode}\n`}`,
      );
      return;
    }
    if (parsed.kind === 'resume') {
      const resumed = await resumeMission(journal, parsed.missionId);
      process.stdout.write(
        parsed.json
          ? `${JSON.stringify(resumed)}\n`
          : `${resumed.decision.status}: ${resumed.decision.action.kind}\n`,
      );
      process.exitCode = missionRecoveryExitCode(resumed.decision.status);
      return;
    }
    if (parsed.kind === 'prune') {
      const candidates = await pruneMissions(
        journal,
        parsed.olderThanDays,
        parsed.apply,
      );
      process.stdout.write(
        parsed.json
          ? `${JSON.stringify({ apply: parsed.apply, candidates })}\n`
          : `${parsed.apply ? 'deleted' : 'dry-run'}: ${candidates.length} run(s)\n`
            + candidates.map((item) => `${item.missionId} ${item.path}`).join('\n')
            + (candidates.length === 0 ? '' : '\n'),
      );
      return;
    }
    if (parsed.kind === 'inspect') {
      const { inspected } = await inspectCurrentMission(
        roots,
        parsed.missionId,
        collectKnownSecrets(),
      );
      process.stdout.write(
        parsed.json
          ? `${JSON.stringify(inspected.verdict)}\n`
          : `${renderInspection(inspected)}\n`,
      );
      process.exitCode = missionVerdictExitCode(inspected.verdict.status);
      return;
    }
    if (parsed.kind === 'archive') {
      const { project } = await inspectCurrentMission(
        roots,
        parsed.missionId,
        collectKnownSecrets(),
      );
      const archived = await archiveMission(journal, parsed.missionId, {
        dependencies: { 'git:working-tree': project.diffHash },
      });
      process.stdout.write(
        parsed.json
          ? `${JSON.stringify(archived)}\n`
          : `${archived.path}\n`,
      );
      return;
    }
    const result = await verifyMissionCommand({
      roots,
      missionId: parsed.missionId,
      command: parsed.command,
      shell: parsed.shell,
      echo: !parsed.json,
    });
    process.stdout.write(
      parsed.json
        ? `${JSON.stringify({
            evidenceId: result.evidenceId,
            exitCode: result.exitCode,
            verdict: result.verdict,
          })}\n`
        : `evidence ${result.evidenceId}: ${result.verdict}\n`,
    );
    process.exitCode = result.exitCode !== 0
      ? result.exitCode
      : missionVerdictExitCode(result.verdict);
  } catch (error) {
    process.stderr.write(renderMissionFailure(error, parsed.json));
    process.exitCode = 1;
  }
}
