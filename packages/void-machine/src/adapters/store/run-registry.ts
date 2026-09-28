// tdd-cover: e2e packages/void-machine/test/run-registry-contract.test.ts
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import { RUN_STATES, type RunTransition } from '../../core/delegation.js';
import type {
  DelegationStore, InstructionFile, MissionLock, RunRecord, RunResult, SessionBinding,
} from '../../runtime/delegation.js';

/**
 * Delegated runs on disk, under `<main checkout>/.void/machine`, found from any worktree through
 * the common Git directory:
 *
 *   runs/<missionId>/agents/<runId>/{run.json, transitions/NNNNNN.json, brief/, result.json}
 *   agents/index/<runId>.json      the mission of each run
 *   agents/pending/<runId>          a run whose native session is not bound yet
 *   agents/sessions/<sessionId>.json  the claim the Stop hook follows: { resultPath }
 *   agents/parked/<sessionId>.json  a result the hook recorded before its session was bound
 *
 * Each transition is linked under its sequence number, so one writer wins each number even if
 * two processes believe they hold the mission lock. Nothing here protects against a delegated
 * agent that edits these files: results are untrusted data, never authorization.
 */

export const MISSION_ID = /^mis_[A-Za-z0-9_-]{8,100}$/;
export const RUN_ID = /^run_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_TRANSITIONS = 512;
const MAX_RECORD_BYTES = 65_536;
/** The hook stores at most 256 KiB of message; JSON escaping can multiply it by six. */
const MAX_RESULT_BYTES = 2_097_152;
const MAX_INDEX = 1_024;
const LOCK_LEASE_MS = 60_000;

export type MachineRoot = { readonly ok: true; readonly root: string }
  | { readonly ok: false; readonly cause: string; readonly action: string };

/** `<main checkout>/.void/machine`, the same from the main checkout and from every worktree. */
export function resolveMachineRoot(cwd: string): MachineRoot {
  const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd, shell: false, encoding: 'utf8', timeout: 5_000 });
  const common = result.status === 0 ? result.stdout.replace(/\r?\n$/, '') : '';
  if (common === '') {
    return { ok: false, cause: `${cwd} is not inside a Git repository`,
      action: 'dispatch from a git checkout or worktree, or pass --cwd <worktree>' };
  }
  if (basename(common) !== '.git') {
    return { ok: false, cause: 'the repository has no main working tree (bare or separate Git directory)',
      action: 'dispatch from a repository whose Git directory is <checkout>/.git' };
  }
  return { ok: true, root: join(dirname(common), '.void', 'machine') };
}

const bindingSchema = z.strictObject({ handle: z.string().regex(/^[0-9a-f]{8}$/),
  sessionId: z.string().regex(SESSION_ID).optional() });
const runSchema = z.strictObject({
  schemaVersion: z.literal(1), runId: z.string().regex(RUN_ID), missionId: z.string().regex(MISSION_ID),
  name: z.string().min(1).max(200), role: z.enum(['work', 'review']), runtime: z.literal('claude'),
  cwd: z.string().min(1), agentType: z.string().optional(), ticket: z.string().optional(),
  model: z.string().optional(), binding: bindingSchema.optional(),
});
const transitionSchema = z.strictObject({
  seq: z.number().int().min(1), at: z.number(), from: z.enum(RUN_STATES).optional(), to: z.enum(RUN_STATES),
  event: z.enum(['admitted', 'dispatched', 'lost', 'refused', 'observed', 'turn-ended', 'result-missing',
    'sent', 'accepted', 'retired', 'stopped']),
  cause: z.string().max(2_000), action: z.string().max(2_000), waitingFor: z.string().max(200).optional(),
});
const resultSchema = z.strictObject({ schemaVersion: z.literal(1), sessionId: z.string().regex(SESSION_ID),
  recordedAt: z.number(), lastAssistantMessage: z.string(), truncated: z.boolean() });
const indexSchema = z.strictObject({ missionId: z.string().regex(MISSION_ID) });
const lockSchema = z.strictObject({ owner: z.string(), pid: z.number().int(), token: z.string(),
  acquiredAt: z.number() });

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code : undefined;
}

async function readSmall(path: string, limit: number): Promise<string | undefined> {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > limit) return undefined;
      return await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

async function readJson<T>(path: string, schema: z.ZodType<T>, limit = MAX_RECORD_BYTES): Promise<T | undefined> {
  const text = await readSmall(path, limit);
  if (text === undefined) return undefined;
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Writes beside the target and renames over it: readers see the old or the new file, never half. */
async function replaceFile(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.tmp-${randomUUID()}`);
  await writeFile(temporary, text, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

async function linkFile(path: string, text: string): Promise<'appended' | 'conflict'> {
  const temporary = join(dirname(path), `.tmp-${randomUUID()}`);
  await writeFile(temporary, text, { mode: 0o600, flag: 'wx' });
  try {
    await link(temporary, path);
    return 'appended';
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return 'conflict';
    throw error;
  } finally {
    await unlink(temporary).catch(() => { /* An orphan temporary is ignored by readers. */ });
  }
}

/** Zod reads an optional key as `T | undefined`; the kernel types omit an absent key instead. */
function transitionOf(stored: z.infer<typeof transitionSchema>): RunTransition {
  const { from, waitingFor, ...rest } = stored;
  return { ...rest, ...(from === undefined ? {} : { from }), ...(waitingFor === undefined ? {} : { waitingFor }) };
}

function bindingOf(stored: z.infer<typeof bindingSchema> | undefined): { binding?: SessionBinding } {
  if (stored === undefined) return {};
  return { binding: { handle: stored.handle,
    ...(stored.sessionId === undefined ? {} : { sessionId: stored.sessionId }) } };
}

const recordName = (seq: number) => `${String(seq).padStart(6, '0')}.json`;

export interface RunRegistryOptions {
  readonly machineRoot: string;
  readonly now?: () => number;
  /** Whether a lock holder's process is still alive; the lease covers a reused pid. */
  readonly isAlive?: (pid: number) => boolean;
  readonly pid?: number;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === 'EPERM';
  }
}

export function createRunRegistry(options: RunRegistryOptions): DelegationStore {
  const root = options.machineRoot;
  const now = options.now ?? Date.now;
  const isAlive = options.isAlive ?? processAlive;
  const pid = options.pid ?? process.pid;
  const agents = (...parts: string[]) => join(root, 'agents', ...parts);
  const runDirectory = (missionId: string, runId: string) => join(root, 'runs', missionId, 'agents', runId);

  async function missionOf(runId: string): Promise<string | undefined> {
    if (!RUN_ID.test(runId)) return undefined;
    return (await readJson(agents('index', `${runId}.json`), indexSchema))?.missionId;
  }

  async function transitionsOf(directory: string): Promise<RunTransition[] | undefined> {
    const names = (await readdir(join(directory, 'transitions')).catch(() => []))
      .filter((name) => !name.startsWith('.')).sort();
    if (names.length === 0 || names.length > MAX_TRANSITIONS) return undefined;
    const log: RunTransition[] = [];
    for (const [index, name] of names.entries()) {
      if (name !== recordName(index + 1)) return undefined;
      const transition = await readJson(join(directory, 'transitions', name), transitionSchema);
      if (transition === undefined || transition.seq !== index + 1) return undefined;
      log.push(transitionOf(transition));
    }
    return log;
  }

  async function read(runId: string): Promise<RunRecord | undefined> {
    const missionId = await missionOf(runId);
    if (missionId === undefined) return undefined;
    const directory = runDirectory(missionId, runId);
    const stored = await readJson(join(directory, 'run.json'), runSchema);
    const transitions = await transitionsOf(directory);
    if (stored === undefined || transitions === undefined || stored.runId !== runId) return undefined;
    return { runId: stored.runId, missionId: stored.missionId, name: stored.name, role: stored.role,
      runtime: stored.runtime, cwd: stored.cwd, agentType: stored.agentType, ticket: stored.ticket,
      model: stored.model, ...bindingOf(stored.binding), transitions };
  }

  async function nextInstruction(directory: string, name: string, text: string): Promise<InstructionFile> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, name);
    await writeFile(path, text, { mode: 0o600, flag: 'wx' });
    return { path, directory };
  }

  async function takeLock(path: string, owner: string): Promise<MissionLock | undefined> {
    const token = randomUUID();
    const body = JSON.stringify({ owner, pid, token, acquiredAt: now() });
    try {
      await writeFile(path, body, { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
      return undefined;
    }
    return {
      async release() {
        const held = await readJson(path, lockSchema);
        if (held?.token === token) await unlink(path).catch(() => { /* Already released. */ });
      },
    };
  }

  return {
    read,
    async list(missionId) {
      if (!MISSION_ID.test(missionId)) return [];
      const names = await readdir(join(root, 'runs', missionId, 'agents')).catch(() => []);
      const runs: RunRecord[] = [];
      for (const name of names.filter((value) => RUN_ID.test(value)).sort().slice(0, MAX_INDEX)) {
        const run = await read(name);
        if (run !== undefined && run.missionId === missionId) runs.push(run);
      }
      return runs;
    },
    async runIds() {
      const names = await readdir(agents('index')).catch(() => []);
      return names.map((name) => name.replace(/\.json$/, '')).filter((name) => RUN_ID.test(name))
        .sort().slice(0, MAX_INDEX);
    },
    async create(run, first, brief) {
      const directory = runDirectory(run.missionId, run.runId);
      await mkdir(join(directory, 'transitions'), { recursive: true, mode: 0o700 });
      await writeFile(join(directory, 'run.json'), JSON.stringify({ schemaVersion: 1, ...run }),
        { mode: 0o600, flag: 'wx' });
      await replaceFile(agents('index', `${run.runId}.json`), JSON.stringify({ missionId: run.missionId }));
      await replaceFile(agents('pending', run.runId), '');
      if (await linkFile(join(directory, 'transitions', recordName(1)), JSON.stringify(first)) !== 'appended') {
        throw new Error('run history already exists');
      }
      return nextInstruction(join(directory, 'brief'), 'brief.md', brief);
    },
    async writeMessage(runId, text) {
      const missionId = await missionOf(runId);
      if (missionId === undefined) throw new Error('unknown run');
      const directory = join(runDirectory(missionId, runId), 'brief');
      const count = (await readdir(directory).catch(() => [])).filter((name) => name.startsWith('message-')).length;
      return nextInstruction(directory, `message-${String(count + 1).padStart(3, '0')}.md`, text);
    },
    async append(runId, transition) {
      const missionId = await missionOf(runId);
      if (missionId === undefined || transition.seq > MAX_TRANSITIONS) return 'conflict';
      const directory = join(runDirectory(missionId, runId), 'transitions');
      const previous = transition.seq - 1;
      if (previous < 1 || await readSmall(join(directory, recordName(previous)), MAX_RECORD_BYTES) === undefined) {
        return 'conflict';
      }
      return linkFile(join(directory, recordName(transition.seq)), JSON.stringify(transition));
    },
    async bind(runId, binding: SessionBinding) {
      const missionId = await missionOf(runId);
      const directory = missionId === undefined ? undefined : runDirectory(missionId, runId);
      const stored = directory === undefined ? undefined : await readJson(join(directory, 'run.json'), runSchema);
      if (directory === undefined || stored === undefined) throw new Error('unknown run');
      await replaceFile(join(directory, 'run.json'), JSON.stringify({ ...stored, binding }));
      if (binding.sessionId === undefined) return;
      const resultPath = join(directory, 'result.json');
      await replaceFile(agents('sessions', `${binding.sessionId}.json`),
        JSON.stringify({ schemaVersion: 1, resultPath }));
      await unlink(agents('pending', runId)).catch(() => { /* Bound before, or never pending. */ });
      const parked = agents('parked', `${binding.sessionId}.json`);
      if ((await lstat(resultPath).catch(() => undefined)) === undefined) {
        await rename(parked, resultPath).catch(() => { /* Nothing was parked for this session. */ });
      }
    },
    async result(runId): Promise<RunResult | undefined> {
      const missionId = await missionOf(runId);
      if (missionId === undefined) return undefined;
      const stored = await readJson(join(runDirectory(missionId, runId), 'result.json'), resultSchema,
        MAX_RESULT_BYTES);
      return stored === undefined ? undefined : { sessionId: stored.sessionId, recordedAt: stored.recordedAt,
        text: stored.lastAssistantMessage, truncated: stored.truncated };
    },
    async lock(missionId, owner) {
      if (!MISSION_ID.test(missionId)) return undefined;
      const directory = join(root, 'runs', missionId, 'agents');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, '.lock');
      const taken = await takeLock(path, owner);
      if (taken !== undefined) return taken;
      const held = await readJson(path, lockSchema);
      const stale = held === undefined || !isAlive(held.pid) || now() - held.acquiredAt > LOCK_LEASE_MS;
      if (!stale) return undefined;
      // Remove only the lock that was judged stale; a lock replaced meanwhile stays.
      const again = await readJson(path, lockSchema);
      if (again?.token === held?.token) await unlink(path).catch(() => { /* Taken over meanwhile. */ });
      return takeLock(path, owner);
    },
  };
}
