import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
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
import { type LifecycleExecution, readJson, record } from './executor-shared.js';

const CHECKPOINT = join('.void', 'machine', 'checkpoint.md');
const MAX_CHECKPOINT_BYTES = 500_000;
const LOCK_STALE_MS = 1_000;
const POST_TOOL_MEASUREMENT_COOLDOWN_MS = 5_000;
const MAX_TRANSCRIPT_BYTES = 1_048_576;
const EMPTY_TRANSCRIPT_HASH = `sha256:${createHash('sha256').update('').digest('hex')}`;

export interface ContextContinuityExecution extends LifecycleExecution {
  readonly resumeContext?: string;
  readonly output?: {
    readonly hookSpecificOutput: {
      readonly hookEventName: 'UserPromptSubmit' | 'PostToolUse';
      readonly additionalContext: string;
    };
  };
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

interface TranscriptObservation {
  readonly fingerprint: string;
  readonly cursorBytes: number;
  readonly usedTokens?: number;
  readonly skippedBytes: number;
  readonly skippedLines: number;
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
): TranscriptObservation | undefined {
  if (path === '' || path.length > 4_096 || path.includes('\u0000') || !isAbsolute(path)) {
    return undefined;
  }
  let descriptor: number | undefined;
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink()) return undefined;
    const fingerprint = `sha256:${createHash('sha256').update(path).digest('hex')}`;
    const sameTranscript = fingerprint === state.transcriptFingerprint;
    const previousCursor = sameTranscript && info.size >= state.transcriptCursorBytes
      ? state.transcriptCursorBytes
      : 0;
    const available = Math.max(0, info.size - previousCursor);
    if (available === 0) return undefined;
    const readStart = available > MAX_TRANSCRIPT_BYTES
      ? info.size - MAX_TRANSCRIPT_BYTES
      : previousCursor;
    const requested = Math.min(MAX_TRANSCRIPT_BYTES, info.size - readStart);
    const bytes = Buffer.alloc(requested);
    descriptor = openSync(path, 'r');
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

function thresholdConfig(root: string): ThresholdConfig {
  const config = record(readJson(join(root, '.void', 'config.json')));
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
  const observed = observeTranscript(path, state);
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
  now: number,
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
  const advanced = advanceMechanicalContext(current, {
    objectiveHash: hashCheckpointObjective(parseCheckpoint(raw).objective),
  });
  const measurement = measureContext(advanced, input, root, 'PreCompact', now);
  const state = measurement.state;
  const merged = mergeMechanicalContextBlock(raw, state);
  if (!merged.ok) {
    return { status: 'degraded', details: { reason: merged.error } };
  }
  if (!atomicCheckpointWrite(path, merged.value, now)) {
    return { status: 'skipped', details: { reason: 'checkpoint-lock-or-write-failed' } };
  }
  return {
    status: 'ok',
    details: {
      sealed: true,
      transcriptSkippedBytes: measurement.skippedBytes,
      transcriptSkippedLines: measurement.skippedLines,
    },
  };
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
  input?: Record<string, unknown>,
  event?: 'UserPromptSubmit' | 'PostToolUse',
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
  const reconcile = observation.semanticCheckpointWritten === true;
  const advanced = advanceMechanicalContext(current, {
    ...observation,
    semanticCheckpointWritten: false,
  });
  const measurement = input === undefined || event === undefined
    ? { state: advanced, emitNudge: false, skippedBytes: 0, skippedLines: 0 }
    : measureContext(advanced, input, root, event, now);
  const next = reconcile
    ? advanceMechanicalContext(measurement.state, { semanticCheckpointWritten: true })
    : measurement.state;
  if (next === current && block.status === 'valid') {
    return { status: 'skipped', details: { reason: 'duplicate-observation' } };
  }
  const merged = mergeMechanicalContextBlock(raw, next);
  if (!merged.ok) return { status: 'degraded', details: { reason: merged.error } };
  if (!atomicCheckpointWrite(path, merged.value, now)) {
    return { status: 'skipped', details: { reason: 'checkpoint-lock-or-write-failed' } };
  }
  return {
    status: 'ok',
    details: {
      advanced: next.workRevision !== current.workRevision,
      transcriptSkippedBytes: measurement.skippedBytes,
      transcriptSkippedLines: measurement.skippedLines,
    },
    ...(measurement.emitNudge && event !== undefined
      ? { output: nudgeOutput(event, thresholdConfig(root).thresholdPercent) }
      : {}),
  };
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
    }, checkpointWrite ? undefined : input, checkpointWrite ? undefined : 'PostToolUse');
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
  if (event === 'PreCompact') return sealPreCompact(input, root, now);
  if (event === 'PostToolUse') return observePostToolUse(input, root, now);
  if (event === 'UserPromptSubmit') {
    return evolveCheckpoint(root, now, {}, input, 'UserPromptSubmit');
  }
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
