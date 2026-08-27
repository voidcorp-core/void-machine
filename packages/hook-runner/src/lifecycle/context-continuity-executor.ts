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
import { dirname, join } from 'node:path';
import {
  hashCheckpointObjective,
  mergeMechanicalContextBlock,
  parseCheckpoint,
  parseMechanicalContextBlock,
  type MechanicalContextState,
} from '@voidcorp/mission-engine/session';
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
  const merged = mergeMechanicalContextBlock(
    raw,
    block.status === 'valid' ? block.state : initialState(raw),
  );
  if (!merged.ok) {
    return { status: 'degraded', details: { reason: merged.error } };
  }
  if (!atomicCheckpointWrite(path, merged.value, now)) {
    return { status: 'skipped', details: { reason: 'checkpoint-lock-or-write-failed' } };
  }
  return { status: 'ok', details: { sealed: true } };
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
  return { status: 'skipped', details: { reason: 'event-not-actionable' } };
}
