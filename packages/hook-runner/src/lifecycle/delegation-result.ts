import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { type LifecycleExecution, record, within } from './executor-shared.js';

/**
 * Stop hook of a delegated run: records the session's final message where the Void Machine
 * kernel claimed it (`<machine>/agents/sessions/<session_id>.json` names the result path), or
 * parks it while a run still waits for its binding. It decides nothing, never writes stdout,
 * and ignores every session no run claims.
 */

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_MESSAGE_BYTES = 262_144;
const MAX_CLAIM_BYTES = 4_096;

const skipped = (reason: string): LifecycleExecution => ({ status: 'skipped', details: { reason } });

/** `<main checkout>/.void/machine`, the kernel's rule: the parent of the common `.git`. */
export function machineRootOf(cwd: string): string | undefined {
  const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd, shell: false, encoding: 'utf8', timeout: 5_000 });
  const common = result.status === 0 ? result.stdout.replace(/\r?\n$/, '') : '';
  return common !== '' && basename(common) === '.git' ? join(dirname(common), '.void', 'machine') : undefined;
}

function plainDirectory(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}

/** The claimed result path, only when it is a `result.json` inside a real run directory. */
function claimedPath(root: string, sessionId: string): string | undefined {
  try {
    const claim = record(JSON.parse(readFileSync(join(root, 'agents', 'sessions', `${sessionId}.json`), 'utf8')));
    const path = claim?.['resultPath'];
    if (claim?.['schemaVersion'] !== 1 || typeof path !== 'string' || !isAbsolute(path)) return undefined;
    if (path.length > MAX_CLAIM_BYTES || basename(path) !== 'result.json') return undefined;
    const runs = join(root, 'runs');
    if (!within(runs, path) || !plainDirectory(dirname(path))) return undefined;
    return within(realpathSync(runs), realpathSync(dirname(path))) ? path : undefined;
  } catch {
    return undefined;
  }
}

function waitingRuns(root: string): boolean {
  try {
    return readdirSync(join(root, 'agents', 'pending')).some((name) => !name.startsWith('.'));
  } catch {
    return false;
  }
}

function boundedMessage(message: string): { readonly text: string; readonly truncated: boolean } {
  const bytes = Buffer.from(message, 'utf8');
  if (bytes.byteLength <= MAX_MESSAGE_BYTES) return { text: message, truncated: false };
  // A cut inside a character decodes to U+FFFD; drop that tail rather than store it.
  return { text: bytes.subarray(0, MAX_MESSAGE_BYTES).toString('utf8').replace(/�+$/, ''), truncated: true };
}

export function executeDelegationResult(input: unknown, now: number): LifecycleExecution {
  const fields = record(input);
  const sessionId = fields?.['session_id'];
  const cwd = fields?.['cwd'];
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId) || typeof cwd !== 'string') {
    return skipped('not-a-session');
  }
  const root = machineRootOf(cwd);
  if (root === undefined) return skipped('no-repository');
  let target = claimedPath(root, sessionId);
  const parked = target === undefined;
  if (target === undefined) {
    if (!waitingRuns(root)) return skipped('not-delegated');
    target = join(root, 'agents', 'parked', `${sessionId}.json`);
  }
  const message = fields?.['last_assistant_message'];
  const { text, truncated } = boundedMessage(typeof message === 'string' ? message : '');
  try {
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const temporary = join(dirname(target), `.tmp-${randomUUID()}`);
    writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, sessionId, recordedAt: now,
      lastAssistantMessage: text, truncated }), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, target);
  } catch {
    return { status: 'degraded', details: { reason: 'result-not-written' } };
  }
  return { status: 'ok', details: { recorded: true, parked, truncated } };
}
