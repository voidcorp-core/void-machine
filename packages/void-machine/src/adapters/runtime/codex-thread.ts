// tdd-cover: e2e packages/void-machine/test/codex-thread.test.ts
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { RunObservation } from '../../core/delegation.js';
import type { LaunchPlan, RuntimeResult } from '../../runtime/delegation.js';

/**
 * What a delegated Codex thread is asked and what it answers, as the app-server protocol of the
 * installed CLI shapes it (`codex app-server generate-ts`, Codex CLI 0.155.1). Pure functions:
 * the process and the socket live in codex-app-server.ts.
 */

/** The version whose app-server contract was captured and replayed; older ones are refused. */
export const MIN_CODEX_VERSION = '0.155.1';
/** A final answer is kept up to this many UTF-8 bytes, like a Stop-hook result. */
export const MAX_RESULT_BYTES = 262_144;
/** macOS holds a Unix socket address in 104 bytes, the terminating NUL included. */
export const SOCKET_PATH_MAX_BYTES = 103;

const SERVICE_NAME = 'void_machine';

export function parseCodexVersion(stdout: string): string | undefined {
  return /^codex-cli (\d+\.\d+\.\d+)\b/m.exec(stdout)?.[1];
}

/** The thread's own permissions: fixed by the role, never widened by an option. */
export function threadStartParams(plan: Pick<LaunchPlan, 'cwd' | 'role' | 'model'>): Record<string, string> {
  return { cwd: plan.cwd, approvalPolicy: 'never',
    sandbox: plan.role === 'work' ? 'workspace-write' : 'read-only', serviceName: SERVICE_NAME,
    ...(plan.model === undefined ? {} : { model: plan.model }) };
}

export function turnStartParams(threadId: string, text: string,
  outputSchema: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  return { threadId, input: [{ type: 'text', text }], ...(outputSchema === undefined ? {} : { outputSchema }) };
}

/** A short handle for the kernel's binding: the random tail of the thread's UUIDv7. */
export function handleOf(threadId: string): string {
  return threadId.replaceAll('-', '').slice(-8);
}

const itemSchema = z.object({ type: z.string(), text: z.string().optional(), phase: z.string().nullable().optional() });
const turnSchema = z.object({ id: z.string().min(1).max(100), items: z.array(itemSchema).max(10_000),
  status: z.enum(['completed', 'interrupted', 'failed', 'inProgress']) });
const statusSchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['notLoaded', 'idle', 'systemError']) }),
  z.object({ type: z.literal('active'), activeFlags: z.array(z.string()).max(16) }),
]);
const threadSchema = z.object({ id: z.string().min(1).max(100), sessionId: z.string().min(1).max(100),
  status: statusSchema, turns: z.array(turnSchema).max(10_000) });

export type ThreadReading = z.infer<typeof threadSchema>;

/** The `result` of a `thread/read` with its turns; undefined when it does not have the protocol shape. */
export function readThread(result: unknown): ThreadReading | undefined {
  const parsed = z.object({ thread: threadSchema }).safeParse(result);
  return parsed.success ? parsed.data.thread : undefined;
}

/** Cuts a text to a byte bound without splitting a character. */
function bounded(text: string): { readonly text: string; readonly truncated: boolean } {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.byteLength <= MAX_RESULT_BYTES) return { text, truncated: false };
  let end = MAX_RESULT_BYTES;
  // A continuation byte at the cut belongs to a character that would be split: cut before it.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return { text: bytes.subarray(0, end).toString('utf8'), truncated: true };
}

function finalAnswer(turn: z.infer<typeof turnSchema>): string | undefined {
  const messages = turn.items.filter((item) => item.type === 'agentMessage' && item.text !== undefined);
  const final = messages.filter((item) => item.phase === 'final_answer').at(-1) ?? messages.at(-1);
  return final?.text;
}

const WAITING: Readonly<Record<string, string>> = {
  waitingOnApproval: 'an approval, although the run was started with approvalPolicy never',
  waitingOnUserInput: 'user input',
};

export interface ThreadObservation {
  readonly observation: RunObservation;
  readonly result?: RuntimeResult;
}

/**
 * The run's state from its thread: the turn its adapter started (the last one while that turn
 * is not recorded yet). An approval request is surfaced to a person; the kernel never answers it.
 */
export function observeThread(thread: ThreadReading, turnId: string | undefined): ThreadObservation {
  if (thread.status.type === 'systemError') return { observation: { kind: 'present', state: 'failed' } };
  const flags = thread.status.type === 'active' ? thread.status.activeFlags : [];
  const turn = turnId === undefined ? thread.turns.at(-1) : thread.turns.find((candidate) => candidate.id === turnId);
  if (turn === undefined) {
    return { observation: thread.status.type === 'active' ? { kind: 'present', state: 'working', status: 'busy' }
      : { kind: 'unreadable', cause: 'the thread does not hold the turn its run started' } };
  }
  const process = thread.status.type === 'active' ? 'busy' : 'idle';
  switch (turn.status) {
    case 'inProgress': {
      const waiting = flags.map((flag) => WAITING[flag]).find((cause) => cause !== undefined);
      return { observation: waiting === undefined ? { kind: 'present', state: 'working', status: 'busy' }
        : { kind: 'present', state: 'blocked', status: 'waiting', waitingFor: waiting } };
    }
    case 'completed': {
      const answer = finalAnswer(turn);
      return { observation: { kind: 'present', state: 'done', status: process },
        ...(answer === undefined ? {} : { result: { turnId: turn.id, ...bounded(answer) } }) };
    }
    case 'interrupted':
      return { observation: { kind: 'present', state: 'stopped', status: process } };
    case 'failed':
      return { observation: { kind: 'present', state: 'failed', status: process } };
    default: {
      const unknown: never = turn.status;
      return unknown;
    }
  }
}

/** The socket of a run, derived from its name: never read back from a file an agent could edit. */
export function socketPathFor(directory: string, runName: string): string | undefined {
  // The WebSocket IPC address separates the socket path from the URL path with `:`.
  if (directory.includes(':') || directory.includes('?')) return undefined;
  const path = join(directory, `${createHash('sha256').update(runName).digest('hex').slice(0, 16)}.sock`);
  return Buffer.byteLength(path, 'utf8') <= SOCKET_PATH_MAX_BYTES ? path : undefined;
}

const CREDENTIAL = /TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIAL/i;

/** The app-server's environment: the caller's, without other tools' credentials an agent could read. */
export function childEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name, value]) => value !== undefined && !CREDENTIAL.test(name)));
}
