// tdd-cover: e2e packages/hook-runner/src/lifecycle/read-loop.test.ts
import { randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync,
  realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRuntime } from '../runtime-input.js';
import type { LifecycleExecution } from './executor-shared.js';
import { advanceReadLoop, observeRead, type ReadLoopState, readLoopState } from './read-loop.js';

interface ReadLoopExecution extends LifecycleExecution {
  readonly output?: { readonly hookSpecificOutput: {
    readonly hookEventName: 'PostToolUse'; readonly additionalContext: string;
  } };
}
const MAX_STATE_BYTES = 32 * 1024;
const unavailable = (): ReadLoopExecution => ({ status: 'degraded',
  details: { reason: 'read-loop-unavailable' },
  diagnostic: 'READ_LOOP_UNAVAILABLE: repetition advice unavailable; check session payload and local cache access. Tools remain allowed.\n' });

function missing(error: unknown): boolean {
  return recordCode(error) === 'ENOENT';
}
function recordCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}
function directory(root: string): string {
  let path = realpathSync(root);
  for (const segment of ['.void', 'machine', 'read-loop']) {
    path = join(path, segment);
    try { mkdirSync(path, { mode: 0o700 }); }
    catch (error) { if (recordCode(error) !== 'EEXIST') throw error; }
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(path) !== path) throw new Error('unsafe-directory');
    if (segment === 'read-loop' && process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw new Error('public-cache');
  }
  return path;
}
function readState(): ReadLoopState {
  let fd: number | undefined;
  try {
    const info = lstatSync('state.json');
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_STATE_BYTES) throw new Error('unsafe-state');
    fd = openSync('state.json', constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.size > MAX_STATE_BYTES || opened.nlink !== 1) throw new Error('unsafe-state');
    const buffer = Buffer.alloc(MAX_STATE_BYTES + 1);
    const bytes = readSync(fd, buffer, 0, buffer.length, 0);
    if (bytes > MAX_STATE_BYTES) throw new Error('oversized-state');
    return readLoopState.parse(JSON.parse(buffer.subarray(0, bytes).toString('utf8')));
  } catch (error) {
    if (missing(error)) return { schemaVersion: 1, sessions: [] };
    throw error;
  } finally { if (fd !== undefined) closeSync(fd); }
}

/** Advisory cache only. Contention skips immediately; no retry or stale-lock takeover. */
export function executeReadLoop(raw: unknown, root: string, runtime: AgentRuntime): ReadLoopExecution {
  const observation = observeRead(raw, runtime);
  if (observation === undefined) return unavailable();
  const previousCwd = process.cwd();
  let anchor: number | undefined;
  let lock: number | undefined;
  let temporary: string | undefined;
  try {
    const path = directory(root);
    anchor = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
    const expected = fstatSync(anchor);
    process.chdir(path);
    const actual = statSync('.');
    if (!expected.isDirectory() || actual.dev !== expected.dev || actual.ino !== expected.ino
      || realpathSync('.') !== path) throw new Error('directory-changed');
    lock = openSync('state.lock', constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    const next = advanceReadLoop(readState(), observation, Date.now());
    const serialized = JSON.stringify(next.state);
    if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) throw new Error('oversized-state');
    temporary = `.state-${randomUUID()}.tmp`;
    writeFileSync(temporary, serialized, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, 'state.json');
    temporary = undefined;
    return { status: observation.kind === 'read' ? 'ok' : 'skipped',
      details: { warned: next.warn, reason: observation.kind === 'read' ? 'read-observed' : 'stream-reset' },
      ...(next.warn ? { output: { hookSpecificOutput: { hookEventName: 'PostToolUse' as const,
        additionalContext: 'READ_LOOP_WARNING: 4 consecutive identical read results. Reuse the existing result or change the question; repeat only when new information is expected. This is advice, not a tool block.' } } } : {}) };
  } catch { return unavailable(); }
  finally {
    // Only remove the lock inode this invocation owns; never take over someone else's lock.
    try {
      if (temporary !== undefined) unlinkSync(temporary);
      if (lock !== undefined) {
        const owner = fstatSync(lock);
        const current = lstatSync('state.lock');
        if (owner.dev === current.dev && owner.ino === current.ino) unlinkSync('state.lock');
      }
    } catch { process.stderr.write('READ_LOOP_UNAVAILABLE: local cache cleanup incomplete; tools remain allowed.\n'); }
    if (lock !== undefined) closeSync(lock);
    process.chdir(previousCwd);
    if (anchor !== undefined) closeSync(anchor);
  }
}
