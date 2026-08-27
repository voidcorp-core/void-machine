import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  advanceMechanicalContext,
  hashCheckpointObjective,
  type MechanicalContextState,
  mergeMechanicalContextBlock,
  parseCheckpoint,
  parseMechanicalContextBlock,
} from '@voidcorp/mission-engine/session';
import { normalizeToolCall } from '../enforcement/normalize.js';
import { type LifecycleExecution, record } from './executor-shared.js';

const CHECKPOINT = join('.void', 'machine', 'checkpoint.md');
const MAX_CHECKPOINT_BYTES = 500_000;
const LOCK_STALE_MS = 1_000;
const EMPTY_TRANSCRIPT_HASH = `sha256:${createHash('sha256').update('').digest('hex')}`;

export interface ContextContinuityExecution extends LifecycleExecution {
  readonly resumeContext?: string;
}

function rawCheckpoint(path: string): string | undefined {
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_CHECKPOINT_BYTES) return undefined;
    return readFileSync(path, 'utf8');
  } catch {
    return existsSync(path) ? undefined : '';
  }
}

function initialState(raw: string): MechanicalContextState {
  const parsed = parseCheckpoint(raw);
  const hasSemantic = parsed.objective !== undefined || parsed.nextAction !== undefined;
  return {
    schemaVersion: 1,
    objectiveHash: hashCheckpointObjective(parsed.objective),
    workRevision: 1,
    semanticRevision: hasSemantic ? 1 : 0,
    nudgeEmitted: false,
    transcriptFingerprint: EMPTY_TRANSCRIPT_HASH,
    transcriptCursorBytes: 0,
    lastMeasurementAtMs: 0,
    lastUsedTokens: 0,
    readFiles: [],
    modifiedFiles: [],
    readFilesOverflow: 0,
    modifiedFilesOverflow: 0,
    clearPending: false,
    lastResumeSource: 'none',
  };
}

function acquireLock(path: string, now: number): number | undefined {
  try {
    return openSync(path, 'wx');
  } catch {
    try {
      if (now - statSync(path).mtimeMs < LOCK_STALE_MS) return undefined;
      unlinkSync(path);
      return openSync(path, 'wx');
    } catch {
      return undefined;
    }
  }
}

function releaseLock(path: string, descriptor: number): void {
  try {
    closeSync(descriptor);
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // A missing stale lock is harmless after the checkpoint decision finished.
    }
  }
}

function atomicCheckpointWrite(path: string, content: string, now: number): boolean {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const lock = `${path}.lock`;
  const descriptor = acquireLock(lock, now);
  if (descriptor === undefined) return false;
  const temporary = join(directory, `.checkpoint-${String(process.pid)}-${String(now)}.tmp`);
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, path);
    return true;
  } catch {
    try {
      unlinkSync(temporary);
    } catch {
      // Failed temporary cleanup never changes the previous checkpoint authority.
    }
    return false;
  } finally {
    releaseLock(lock, descriptor);
  }
}

function sealPreCompact(root: string, now: number): ContextContinuityExecution {
  const path = join(root, CHECKPOINT);
  const raw = rawCheckpoint(path);
  if (raw === undefined) {
    return { status: 'degraded', details: { reason: 'checkpoint-unreadable' } };
  }
  const block = parseMechanicalContextBlock(raw);
  if (block.status === 'invalid') {
    return { status: 'degraded', details: { reason: 'mechanical-block-ambiguous' } };
  }
  const current = block.status === 'valid' ? block.state : initialState(raw);
  const state = advanceMechanicalContext(current, {
    objectiveHash: hashCheckpointObjective(parseCheckpoint(raw).objective),
  });
  const merged = mergeMechanicalContextBlock(raw, state);
  if (!merged.ok) {
    return { status: 'degraded', details: { reason: merged.error } };
  }
  if (!atomicCheckpointWrite(path, merged.value, now)) {
    return { status: 'skipped', details: { reason: 'checkpoint-lock-or-write-failed' } };
  }
  return { status: 'ok', details: { sealed: true } };
}

function successfulToolUse(input: Record<string, unknown>): boolean {
  const response = record(input['tool_response']) ?? record(input['tool_result']);
  if (response?.['is_error'] === true || response?.['success'] === false) return false;
  return input['error'] === undefined && input['tool_error'] === undefined;
}

function boundedProjectPath(root: string, candidate: string): string | undefined {
  if (
    candidate === ''
    || candidate.length > 500
    || [...candidate].some((character) => character.charCodeAt(0) < 0x20)
  ) return undefined;
  const target = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate);
  const local = relative(resolve(root), target);
  if (local === '' || local.startsWith('..') || isAbsolute(local)) return undefined;
  return local.split('\\').join('/');
}

function toolPaths(
  call: ReturnType<typeof normalizeToolCall>,
  root: string,
): { readonly readFiles: readonly string[]; readonly modifiedFiles: readonly string[] } {
  const isModification = call.tool === 'Edit' || call.tool === 'Write' || call.tool === 'apply_patch';
  const isRead = call.tool === 'Read' || call.tool === 'read_file' || call.tool === 'view_image';
  if (!isModification && !isRead) return { readFiles: [], modifiedFiles: [] };
  const paths = call.edits
    .map((edit) => boundedProjectPath(root, edit.path))
    .filter((path): path is string => path !== undefined && path !== CHECKPOINT);
  return isRead
    ? { readFiles: paths, modifiedFiles: [] }
    : { readFiles: [], modifiedFiles: paths };
}

function evolveCheckpoint(
  root: string,
  now: number,
  observation: Parameters<typeof advanceMechanicalContext>[1],
): ContextContinuityExecution {
  const path = join(root, CHECKPOINT);
  const raw = rawCheckpoint(path);
  if (raw === undefined) {
    return { status: 'degraded', details: { reason: 'checkpoint-unreadable' } };
  }
  const block = parseMechanicalContextBlock(raw);
  if (block.status === 'invalid') {
    return { status: 'degraded', details: { reason: 'mechanical-block-ambiguous' } };
  }
  const current = block.status === 'valid' ? block.state : initialState(raw);
  const next = advanceMechanicalContext(current, observation);
  if (next === current && block.status === 'valid') {
    return { status: 'skipped', details: { reason: 'duplicate-observation' } };
  }
  const merged = mergeMechanicalContextBlock(raw, next);
  if (!merged.ok) return { status: 'degraded', details: { reason: merged.error } };
  if (!atomicCheckpointWrite(path, merged.value, now)) {
    return { status: 'skipped', details: { reason: 'checkpoint-lock-or-write-failed' } };
  }
  return { status: 'ok', details: { advanced: next.workRevision !== current.workRevision } };
}

function observePostToolUse(
  input: Record<string, unknown>,
  root: string,
  now: number,
): ContextContinuityExecution {
  if (!successfulToolUse(input)) {
    return { status: 'skipped', details: { reason: 'tool-use-failed' } };
  }
  try {
    const call = normalizeToolCall(input);
    const paths = toolPaths(call, root);
    const checkpointWrite = (call.tool === 'Edit' || call.tool === 'Write' || call.tool === 'apply_patch')
      && call.edits.some(
        (edit) => boundedProjectPath(root, edit.path) === CHECKPOINT,
      );
    const raw = checkpointWrite ? rawCheckpoint(join(root, CHECKPOINT)) : undefined;
    const objectiveHash = raw === undefined
      ? undefined
      : hashCheckpointObjective(parseCheckpoint(raw).objective);
    return evolveCheckpoint(root, now, {
      readFiles: paths.readFiles,
      modifiedFiles: paths.modifiedFiles,
      ...(objectiveHash === undefined ? {} : { objectiveHash }),
      ...(checkpointWrite ? { semanticCheckpointWritten: true } : {}),
    });
  } catch {
    return { status: 'degraded', details: { reason: 'invalid-tool-input' } };
  }
}

export function executeContextContinuity(
  rawInput: unknown,
  root: string,
  _runtime: 'claude' | 'codex' | 'unknown',
  now: number,
): ContextContinuityExecution {
  const input = record(rawInput);
  if (input === undefined) {
    return { status: 'degraded', details: { reason: 'invalid-hook-input' } };
  }
  const event = input['hook_event_name'];
  if (event === 'PreCompact') return sealPreCompact(root, now);
  if (event === 'PostToolUse') return observePostToolUse(input, root, now);
  if (event === 'SessionStart') {
    const source = input['source'];
    if (
      source === 'startup' || source === 'resume' || source === 'clear'
      || source === 'compact' || source === 'fork'
    ) {
      return evolveCheckpoint(root, now, { resumeSource: source });
    }
  }
  return { status: 'skipped', details: { reason: 'event-not-actionable' } };
}
