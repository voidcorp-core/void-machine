import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import {
  advanceMechanicalContext,
  evaluateContextMeasurement,
  hashCheckpointObjective,
  type MechanicalContextState,
  mergeMechanicalContextBlock,
  parseCheckpoint,
  parseMechanicalContextBlock,
} from '@voidcorp/mission-engine/session';
import { normalizeToolCall } from '../enforcement/normalize.js';
import { type LifecycleExecution, record, within } from './executor-shared.js';

const CHECKPOINT = join('.void', 'machine', 'checkpoint.md');
const MAX_CHECKPOINT_BYTES = 500_000;
const LOCK_STALE_MS = 1_000;
const POST_TOOL_MEASUREMENT_COOLDOWN_MS = 5_000;
const MAX_TRANSCRIPT_BYTES = 1_048_576;
const MAX_CONFIG_BYTES = 65_536;
const EMPTY_TRANSCRIPT_HASH = `sha256:${createHash('sha256').update('').digest('hex')}`;
const MECHANICAL_BEGIN = '<!-- void-harness:context-continuity:begin -->';
const MECHANICAL_END = '<!-- void-harness:context-continuity:end -->';

export interface ContextContinuityExecution extends LifecycleExecution {
  readonly resumeContext?: string;
  readonly output?: {
    readonly hookSpecificOutput: {
      readonly hookEventName: 'UserPromptSubmit' | 'PostToolUse';
      readonly additionalContext: string;
    };
  };
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function rawCheckpoint(path: string): string | undefined {
  let descriptor: number | undefined;
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_CHECKPOINT_BYTES) return undefined;
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.size > MAX_CHECKPOINT_BYTES) return undefined;
    return readBoundedDescriptor(descriptor, MAX_CHECKPOINT_BYTES);
  } catch (error) {
    return errorCode(error) === 'ENOENT' ? '' : undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
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
    sealedWorkRevision: 0,
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

interface HeldLock {
  readonly descriptor: number;
  readonly dev: number;
  readonly ino: number;
}

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
}

function sameFile(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function unlinkOwnedPath(path: string, owner: FileIdentity): boolean {
  try {
    const current = lstatSync(path);
    if (current.isSymbolicLink() || !sameFile(current, owner)) return false;
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

function staleFile(info: { readonly mtimeMs: number; readonly ctimeMs: number }, now: number): boolean {
  return now - Math.max(info.mtimeMs, info.ctimeMs) >= LOCK_STALE_MS;
}

function openExclusive(path: string): HeldLock | undefined {
  try {
    const descriptor = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    const info = fstatSync(descriptor);
    return { descriptor, dev: info.dev, ino: info.ino };
  } catch {
    return undefined;
  }
}

function releaseLock(path: string, lock: HeldLock): void {
  try {
    closeSync(lock.descriptor);
  } finally {
    unlinkOwnedPath(path, lock);
  }
}

function acquireLock(path: string, now: number): HeldLock | undefined {
  const direct = openExclusive(path);
  if (direct !== undefined) return direct;
  let observed: ReturnType<typeof lstatSync>;
  try {
    observed = lstatSync(path);
    if (!observed.isFile() || observed.isSymbolicLink() || !staleFile(observed, now)) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const recoveryPath = `${path}.recovery`;
  try {
    const recovery = lstatSync(recoveryPath);
    if (
      !recovery.isFile()
      || recovery.isSymbolicLink()
      || !staleFile(recovery, now)
      || !unlinkOwnedPath(recoveryPath, recovery)
    ) return undefined;
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') return undefined;
  }

  try {
    linkSync(path, recoveryPath);
    const current = lstatSync(path);
    const recovery = lstatSync(recoveryPath);
    if (!sameFile(current, observed) || !sameFile(recovery, observed)) return undefined;
    if (!unlinkOwnedPath(path, observed)) return undefined;
    return openExclusive(path);
  } catch {
    return undefined;
  } finally {
    unlinkOwnedPath(recoveryPath, observed);
  }
}

function safeMachineDirectory(root: string): string | undefined {
  try {
    const canonicalRoot = realpathSync(resolve(root));
    let cursor = canonicalRoot;
    for (const segment of ['.void', 'machine']) {
      cursor = join(cursor, segment);
      try {
        const existing = lstatSync(cursor);
        if (!existing.isDirectory() || existing.isSymbolicLink()) return undefined;
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') return undefined;
        try {
          mkdirSync(cursor, { mode: 0o700 });
        } catch (mkdirError) {
          if (errorCode(mkdirError) !== 'EEXIST') return undefined;
        }
        const created = lstatSync(cursor);
        if (!created.isDirectory() || created.isSymbolicLink()) return undefined;
      }
      const canonical = realpathSync(cursor);
      if (!within(canonicalRoot, canonical) || canonical !== cursor) return undefined;
    }
    return cursor;
  } catch {
    return undefined;
  }
}

interface AnchoredMachineDirectory {
  readonly descriptor: number;
  readonly previousCwd: string;
}

function anchorMachineDirectory(root: string): AnchoredMachineDirectory | undefined {
  const directory = safeMachineDirectory(root);
  if (directory === undefined) return undefined;
  let descriptor: number | undefined;
  const previousCwd = process.cwd();
  let changedDirectory = false;
  let anchorEstablished = false;
  try {
    descriptor = openSync(
      directory,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0)
        | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor);
    if (!opened.isDirectory()) return undefined;
    process.chdir(directory);
    changedDirectory = true;
    const current = statSync('.');
    if (
      current.dev !== opened.dev
      || current.ino !== opened.ino
      || realpathSync('.') !== directory
    ) return undefined;
    anchorEstablished = true;
    return { descriptor, previousCwd };
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined && !anchorEstablished) {
      if (changedDirectory) process.chdir(previousCwd);
      closeSync(descriptor);
    }
  }
}

function releaseMachineDirectory(anchor: AnchoredMachineDirectory): void {
  try {
    process.chdir(anchor.previousCwd);
  } finally {
    closeSync(anchor.descriptor);
  }
}

function atomicCheckpointWrite(content: string, now: number): boolean {
  const temporary = `.checkpoint-${String(process.pid)}-${String(now)}.tmp`;
  let descriptor: number | undefined;
  let owned: Pick<HeldLock, 'dev' | 'ino'> | undefined;
  let renamed = false;
  try {
    descriptor = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    const opened = fstatSync(descriptor);
    owned = { dev: opened.dev, ino: opened.ino };
    const bytes = Buffer.from(content, 'utf8');
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
      if (written <= 0) return false;
      offset += written;
    }
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, 'checkpoint.md');
    renamed = true;
    return true;
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (!renamed && owned !== undefined) {
      try {
        const current = lstatSync(temporary);
        if (!current.isSymbolicLink() && current.dev === owned.dev && current.ino === owned.ino) {
          unlinkSync(temporary);
        }
      } catch {
        // Failed temporary cleanup never changes the previous checkpoint authority.
      }
    }
  }
}

interface CheckpointMutation {
  readonly execution: ContextContinuityExecution;
  readonly content?: string;
}

function mutateCheckpoint(
  root: string,
  now: number,
  decide: (raw: string) => CheckpointMutation,
): ContextContinuityExecution {
  const anchor = anchorMachineDirectory(root);
  if (anchor === undefined) {
    return { status: 'degraded', details: { reason: 'unsafe-checkpoint-path' } };
  }
  try {
    const lockPath = 'checkpoint.md.lock';
    const lock = acquireLock(lockPath, now);
    if (lock === undefined) {
      return { status: 'skipped', details: { reason: 'checkpoint-lock-or-write-failed' } };
    }
    try {
      const raw = rawCheckpoint('checkpoint.md');
      if (raw === undefined) {
        return { status: 'degraded', details: { reason: 'checkpoint-unreadable' } };
      }
      const mutation = decide(raw);
      if (mutation.content === undefined) return mutation.execution;
      if (!atomicCheckpointWrite(mutation.content, now)) {
        return { status: 'skipped', details: { reason: 'checkpoint-lock-or-write-failed' } };
      }
      return mutation.execution;
    } finally {
      releaseLock(lockPath, lock);
    }
  } finally {
    releaseMachineDirectory(anchor);
  }
}

interface TranscriptObservation {
  readonly fingerprint: string;
  readonly cursorBytes: number;
  readonly usedTokens?: number;
  readonly skippedBytes: number;
  readonly skippedLines: number;
}

function canonicalDirectory(path: string): string | undefined {
  try {
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink()) return undefined;
    const canonical = realpathSync(path);
    return canonical === resolve(path) ? canonical : undefined;
  } catch {
    return undefined;
  }
}

function encodedClaudeProject(root: string): string {
  return root.replace(/[^a-zA-Z0-9]/g, '-');
}

function transcriptRoots(
  root: string,
  runtime: 'claude' | 'codex' | 'unknown',
): readonly string[] {
  const canonicalRoot = realpathSync(resolve(root));
  const candidates = [canonicalRoot];
  if (runtime === 'claude') {
    candidates.push(
      join(homedir(), '.claude', 'projects', encodedClaudeProject(canonicalRoot)),
    );
  }
  return candidates
    .map(canonicalDirectory)
    .filter((path): path is string => path !== undefined);
}

function runtimeSessionId(input: Record<string, unknown>): string | undefined {
  const value = input['session_id'] ?? input['sessionId']
    ?? input['thread_id'] ?? input['threadId'];
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(value)
    ? value
    : undefined;
}

export function isExternalTranscriptBound(
  path: string,
  runtime: 'claude' | 'codex' | 'unknown',
  sessionId: string,
): boolean {
  return runtime === 'claude'
    && /^[A-Za-z0-9_-]{8,200}$/.test(sessionId)
    && basename(path) === `${sessionId}.jsonl`;
}

interface OpenedRegularFile {
  readonly descriptor: number;
  readonly canonicalPath: string;
  readonly size: number;
}

function openBoundedRegularFile(
  path: string,
  maxBytes: number,
  allowedRoots: readonly string[],
): OpenedRegularFile | undefined {
  let descriptor: number | undefined;
  try {
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) return undefined;
    const canonicalPath = realpathSync(path);
    if (!allowedRoots.some((root) => within(root, canonicalPath))) return undefined;
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor);
    const currentPath = realpathSync(path);
    const current = statSync(currentPath);
    if (
      !opened.isFile()
      || opened.size > maxBytes
      || currentPath !== canonicalPath
      || opened.dev !== current.dev
      || opened.ino !== current.ino
      || !allowedRoots.some((root) => within(root, currentPath))
    ) {
      closeSync(descriptor);
      return undefined;
    }
    return { descriptor, canonicalPath, size: opened.size };
  } catch {
    if (descriptor !== undefined) closeSync(descriptor);
    return undefined;
  }
}

export function readBoundedDescriptor(
  descriptor: number,
  maxBytes: number,
): string | undefined {
  const bytes = Buffer.alloc(maxBytes + 1);
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
    if (count === 0) break;
    offset += count;
  }
  return offset > maxBytes ? undefined : bytes.subarray(0, offset).toString('utf8');
}

function finiteToken(value: unknown): number | undefined {
  if (value === undefined) return 0;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

type UsageLine =
  | { readonly status: 'none' | 'invalid' }
  | { readonly status: 'usage'; readonly usedTokens: number };

function usageFromLine(line: string): UsageLine {
  try {
    const parsed = record(JSON.parse(line));
    const usage = record(record(parsed?.['message'])?.['usage']);
    if (usage === undefined) return { status: 'none' };
    const input = finiteToken(usage['input_tokens']);
    const output = finiteToken(usage['output_tokens']);
    const cacheRead = finiteToken(usage['cache_read_input_tokens']);
    const cacheCreation = finiteToken(usage['cache_creation_input_tokens']);
    return input === undefined || output === undefined
      || cacheRead === undefined || cacheCreation === undefined
      ? { status: 'invalid' }
      : { status: 'usage', usedTokens: input + output + cacheRead + cacheCreation };
  } catch {
    return { status: 'invalid' };
  }
}

function observeTranscript(
  path: string,
  state: MechanicalContextState,
  input: Record<string, unknown>,
  root: string,
  runtime: 'claude' | 'codex' | 'unknown',
): TranscriptObservation | undefined {
  if (path === '' || path.length > 4_096 || path.includes('\u0000') || !isAbsolute(path)) {
    return undefined;
  }
  let descriptor: number | undefined;
  try {
    const roots = transcriptRoots(root, runtime);
    const opened = openBoundedRegularFile(path, Number.MAX_SAFE_INTEGER, roots);
    if (opened === undefined) return undefined;
    descriptor = opened.descriptor;
    const canonicalRoot = realpathSync(resolve(root));
    if (!within(canonicalRoot, opened.canonicalPath)) {
      const sessionId = runtimeSessionId(input);
      if (
        sessionId === undefined
        || !isExternalTranscriptBound(opened.canonicalPath, runtime, sessionId)
      ) {
        return undefined;
      }
    }
    const fingerprint = `sha256:${createHash('sha256').update(opened.canonicalPath).digest('hex')}`;
    const sameTranscript = fingerprint === state.transcriptFingerprint;
    const previousCursor = sameTranscript && opened.size >= state.transcriptCursorBytes
      ? state.transcriptCursorBytes
      : 0;
    const available = Math.max(0, opened.size - previousCursor);
    if (available === 0) return undefined;
    const readStart = available > MAX_TRANSCRIPT_BYTES
      ? opened.size - MAX_TRANSCRIPT_BYTES
      : previousCursor;
    const requested = Math.min(MAX_TRANSCRIPT_BYTES, opened.size - readStart);
    const bytes = Buffer.alloc(requested);
    const bytesRead = readSync(descriptor, bytes, 0, requested, readStart);
    const bounded = bytes.subarray(0, bytesRead);
    let contentStart = 0;
    let skippedBytes = Math.max(0, readStart - previousCursor);
    if (readStart > previousCursor) {
      const firstNewline = bounded.indexOf(0x0a);
      if (firstNewline < 0) {
        return {
          fingerprint,
          cursorBytes: readStart + bytesRead,
          skippedBytes: skippedBytes + bytesRead,
          skippedLines: 1,
        };
      }
      contentStart = firstNewline + 1;
      skippedBytes += contentStart;
    }
    const lastNewline = bounded.lastIndexOf(0x0a);
    if (lastNewline < contentStart) {
      return {
        fingerprint,
        cursorBytes: previousCursor,
        skippedBytes,
        skippedLines: 0,
      };
    }
    const complete = bounded.subarray(contentStart, lastNewline).toString('utf8');
    let usedTokens: number | undefined;
    let skippedLines = 0;
    for (const line of complete.split('\n')) {
      if (line.trim() === '') continue;
      const usage = usageFromLine(line);
      if (usage.status === 'invalid') {
        skippedLines += 1;
      } else if (usage.status === 'usage') {
        usedTokens = usage.usedTokens;
      }
    }
    return {
      fingerprint,
      cursorBytes: readStart + lastNewline + 1,
      ...(usedTokens === undefined ? {} : { usedTokens }),
      skippedBytes,
      skippedLines,
    };
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

interface ThresholdConfig {
  readonly windowTokens?: number;
  readonly thresholdPercent: number;
}

function contextConfig(root: string): unknown {
  let descriptor: number | undefined;
  try {
    const canonicalRoot = realpathSync(resolve(root));
    const opened = openBoundedRegularFile(
      join(canonicalRoot, '.void', 'config.json'),
      MAX_CONFIG_BYTES,
      [canonicalRoot],
    );
    if (opened === undefined) return undefined;
    descriptor = opened.descriptor;
    const raw = readBoundedDescriptor(descriptor, MAX_CONFIG_BYTES);
    return raw === undefined ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function thresholdConfig(root: string): ThresholdConfig {
  const config = record(contextConfig(root));
  const context = record(config?.['context']);
  const window = context?.['windowTokens'];
  const threshold = context?.['checkpointThresholdPercent'];
  const windowTokens = Number.isSafeInteger(window) && Number(window) > 0
    ? Number(window)
    : undefined;
  const thresholdPercent = threshold === undefined
    ? 50
    : Number.isSafeInteger(threshold) && Number(threshold) >= 40 && Number(threshold) <= 60
      ? Number(threshold)
      : 0;
  return {
    ...(windowTokens === undefined ? {} : { windowTokens }),
    thresholdPercent,
  };
}

interface MeasurementEvolution {
  readonly state: MechanicalContextState;
  readonly emitNudge: boolean;
  readonly usagePercent?: number;
  readonly skippedBytes: number;
  readonly skippedLines: number;
}

function measureContext(
  state: MechanicalContextState,
  input: Record<string, unknown>,
  root: string,
  event: 'UserPromptSubmit' | 'PostToolUse' | 'PreCompact',
  runtime: 'claude' | 'codex' | 'unknown',
  now: number,
): MeasurementEvolution {
  if (
    event === 'PostToolUse'
    && now - state.lastMeasurementAtMs < POST_TOOL_MEASUREMENT_COOLDOWN_MS
  ) {
    return { state, emitNudge: false, skippedBytes: 0, skippedLines: 0 };
  }
  const path = input['transcript_path'];
  if (typeof path !== 'string') {
    return { state, emitNudge: false, skippedBytes: 0, skippedLines: 0 };
  }
  const observed = observeTranscript(path, state, input, root, runtime);
  if (observed === undefined) {
    return { state, emitNudge: false, skippedBytes: 0, skippedLines: 0 };
  }
  const cursorState = observed.fingerprint === state.transcriptFingerprint
    && observed.cursorBytes === state.transcriptCursorBytes
    ? state
    : {
        ...state,
        transcriptFingerprint: observed.fingerprint,
        transcriptCursorBytes: observed.cursorBytes,
      };
  if (observed.usedTokens === undefined) {
    return {
      state: cursorState,
      emitNudge: false,
      skippedBytes: observed.skippedBytes,
      skippedLines: observed.skippedLines,
    };
  }
  const config = thresholdConfig(root);
  const decision = evaluateContextMeasurement(cursorState, {
    usedTokens: observed.usedTokens,
    measuredAtMs: now,
    thresholdPercent: config.thresholdPercent,
    ...(config.windowTokens === undefined ? {} : { windowTokens: config.windowTokens }),
  });
  return {
    state: decision.state,
    emitNudge: decision.emitNudge,
    ...(decision.usagePercent === undefined ? {} : { usagePercent: decision.usagePercent }),
    skippedBytes: observed.skippedBytes,
    skippedLines: observed.skippedLines,
  };
}

function nudgeOutput(
  event: 'UserPromptSubmit' | 'PostToolUse',
  thresholdPercent: number,
): NonNullable<ContextContinuityExecution['output']> {
  return {
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext:
        `Context usage reached the configured ${String(thresholdPercent)}% checkpoint threshold. `
        + 'Invoke `void-checkpoint` before continuing a long branch of work.',
    },
  };
}

function sealPreCompact(
  input: Record<string, unknown>,
  root: string,
  runtime: 'claude' | 'codex' | 'unknown',
  now: number,
): ContextContinuityExecution {
  return mutateCheckpoint(root, now, (raw) => {
    const block = parseMechanicalContextBlock(raw);
    if (block.status === 'invalid') {
      return {
        execution: {
          status: 'degraded',
          details: { reason: 'mechanical-block-ambiguous' },
        },
      };
    }
    const current = block.status === 'valid' ? block.state : initialState(raw);
    const advanced = advanceMechanicalContext(current, {
      objectiveHash: hashCheckpointObjective(parseCheckpoint(raw).objective),
    });
    const measurement = measureContext(advanced, input, root, 'PreCompact', runtime, now);
    const sealed = advanceMechanicalContext(measurement.state, { compactionSealed: true });
    const merged = mergeMechanicalContextBlock(raw, sealed);
    if (!merged.ok) {
      return {
        execution: { status: 'degraded', details: { reason: merged.error } },
      };
    }
    return {
      content: merged.value,
      execution: {
        status: 'ok',
        details: {
          sealed: true,
          transcriptSkippedBytes: measurement.skippedBytes,
          transcriptSkippedLines: measurement.skippedLines,
        },
      },
    };
  });
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
    || candidate.includes(MECHANICAL_BEGIN)
    || candidate.includes(MECHANICAL_END)
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
  runtime: 'claude' | 'codex' | 'unknown',
  observation: Parameters<typeof advanceMechanicalContext>[1],
  input?: Record<string, unknown>,
  event?: 'UserPromptSubmit' | 'PostToolUse',
): ContextContinuityExecution {
  return mutateCheckpoint(root, now, (raw) => {
    const block = parseMechanicalContextBlock(raw);
    if (block.status === 'invalid') {
      return {
        execution: {
          status: 'degraded',
          details: { reason: 'mechanical-block-ambiguous' },
        },
      };
    }
    const current = block.status === 'valid' ? block.state : initialState(raw);
    const reconcile = observation.semanticCheckpointWritten === true;
    const advanced = advanceMechanicalContext(current, {
      ...observation,
      ...(reconcile
        ? { objectiveHash: hashCheckpointObjective(parseCheckpoint(raw).objective) }
        : {}),
      semanticCheckpointWritten: false,
    });
    const measurement = input === undefined || event === undefined
      ? { state: advanced, emitNudge: false, skippedBytes: 0, skippedLines: 0 }
      : measureContext(advanced, input, root, event, runtime, now);
    const next = reconcile
      ? advanceMechanicalContext(measurement.state, { semanticCheckpointWritten: true })
      : measurement.state;
    if (next === current && block.status === 'valid') {
      return {
        execution: { status: 'skipped', details: { reason: 'duplicate-observation' } },
      };
    }
    const merged = mergeMechanicalContextBlock(raw, next);
    if (!merged.ok) {
      return { execution: { status: 'degraded', details: { reason: merged.error } } };
    }
    return {
      content: merged.value,
      execution: {
        status: 'ok',
        details: {
          advanced: next.workRevision !== current.workRevision,
          transcriptSkippedBytes: measurement.skippedBytes,
          transcriptSkippedLines: measurement.skippedLines,
        },
        ...(measurement.emitNudge && event !== undefined
          ? { output: nudgeOutput(event, thresholdConfig(root).thresholdPercent) }
          : {}),
      },
    };
  });
}

function observePostToolUse(
  input: Record<string, unknown>,
  root: string,
  runtime: 'claude' | 'codex' | 'unknown',
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
    return evolveCheckpoint(root, now, runtime, {
      readFiles: paths.readFiles,
      modifiedFiles: paths.modifiedFiles,
      ...(checkpointWrite ? { semanticCheckpointWritten: true } : {}),
    }, checkpointWrite ? undefined : input, checkpointWrite ? undefined : 'PostToolUse');
  } catch {
    return { status: 'degraded', details: { reason: 'invalid-tool-input' } };
  }
}

export function executeContextContinuity(
  rawInput: unknown,
  root: string,
  runtime: 'claude' | 'codex' | 'unknown',
  now: number,
): ContextContinuityExecution {
  const projectRoot = resolve(root);
  const input = record(rawInput);
  if (input === undefined) {
    return { status: 'degraded', details: { reason: 'invalid-hook-input' } };
  }
  const event = input['hook_event_name'];
  if (event === 'PreCompact') return sealPreCompact(input, projectRoot, runtime, now);
  if (event === 'PostToolUse') return observePostToolUse(input, projectRoot, runtime, now);
  if (event === 'UserPromptSubmit') {
    return evolveCheckpoint(projectRoot, now, runtime, {}, input, 'UserPromptSubmit');
  }
  if (event === 'SessionStart') {
    const source = input['source'];
    if (
      source === 'startup' || source === 'resume' || source === 'clear'
      || source === 'compact' || source === 'fork'
    ) {
      return evolveCheckpoint(projectRoot, now, runtime, { resumeSource: source });
    }
  }
  return { status: 'skipped', details: { reason: 'event-not-actionable' } };
}
