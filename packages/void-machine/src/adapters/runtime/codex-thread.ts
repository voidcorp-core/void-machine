// tdd-cover: e2e packages/void-machine/test/codex-thread.test.ts
import { join } from 'node:path';
import { z } from 'zod';
import type { RunObservation } from '../../core/delegation.js';
import type { LaunchPlan, RuntimeResult } from '../../runtime/delegation.js';
import { versionAtLeast } from './claude-session.js';

/**
 * What a delegated Codex thread is asked and what it answers, as the app-server protocol of the
 * installed CLI shapes it (`codex app-server generate-ts`, Codex CLI 0.158.0), and how the shared
 * daemon that serves it reports itself. Pure functions: the socket lives in codex-daemon.ts.
 */

/** The daemon version whose contract was captured and replayed; older ones are refused. */
export const MIN_CODEX_VERSION = '0.158.0';
/** A final answer is kept up to this many UTF-8 bytes, like a Stop-hook result. */
export const MAX_RESULT_BYTES = 262_144;
/** The command that brings the daemon up, named in every refusal it repairs. */
export const DAEMON_START = 'codex app-server daemon start';

const SERVICE_NAME = 'void_machine';

/** The control socket of the daemon a Codex home runs: where `daemon version` reports it. */
export function controlSocketPath(env: NodeJS.ProcessEnv, home: string): string {
  return join(env['CODEX_HOME'] ?? join(home, '.codex'), 'app-server-control', 'app-server-control.sock');
}

const VERSION = z.string().regex(/^\d+\.\d+\.\d+[0-9A-Za-z.+-]{0,40}$/);
const daemonSchema = z.object({ status: z.string().regex(/^[a-z-]{1,50}$/),
  socketPath: z.string().min(1).max(4_096).regex(/^[^\p{Cc}]+$/u), cliVersion: VERSION,
  appServerVersion: VERSION.nullish() });
export type DaemonVersion = z.infer<typeof daemonSchema>;

/** The JSON `codex app-server daemon version` prints; undefined for any other output. */
export function parseDaemonVersion(stdout: string): DaemonVersion | undefined {
  try {
    const parsed = daemonSchema.safeParse(JSON.parse(stdout));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export type DaemonReadiness =
  | { readonly kind: 'ready' }
  | { readonly kind: 'start' }
  | { readonly kind: 'refused'; readonly cause: string; readonly action: string };

/**
 * Whether the daemon can serve a run: running, on the socket this adapter reaches, at a version
 * the contract was proven on, and the same version as the CLI that shows its threads.
 */
export function daemonReadiness(version: DaemonVersion, socketPath: string): DaemonReadiness {
  if (!versionAtLeast(version.cliVersion, MIN_CODEX_VERSION)) {
    return { kind: 'refused', cause: `Codex CLI ${version.cliVersion} predates the daemon contract this adapter `
      + `was proven against (${MIN_CODEX_VERSION})`, action: `update Codex CLI to ${MIN_CODEX_VERSION} or later` };
  }
  if (version.status !== 'running') return { kind: 'start' };
  if (version.socketPath !== socketPath) {
    return { kind: 'refused', cause: `the Codex daemon listens on ${version.socketPath}, not on ${socketPath}`,
      action: 'restart it from the same CODEX_HOME: codex app-server daemon restart' };
  }
  if (version.appServerVersion !== version.cliVersion) {
    return { kind: 'refused', cause: `the Codex daemon runs ${version.appServerVersion ?? 'an unknown version'} `
      + `while the codex CLI on PATH is ${version.cliVersion}`,
    action: 'align them: codex app-server daemon update, or update the codex on PATH' };
  }
  return { kind: 'ready' };
}

/** The thread's own permissions: fixed by the role, never widened by an option. */
export function threadStartParams(plan: Pick<LaunchPlan, 'cwd' | 'role' | 'model'>): Record<string, string> {
  return { cwd: plan.cwd, approvalPolicy: 'never',
    sandbox: plan.role === 'work' ? 'workspace-write' : 'read-only', serviceName: SERVICE_NAME,
    ...(plan.model === undefined ? {} : { model: plan.model }) };
}

/** Loads an unloaded thread again, with the permissions of its role: resume takes the same overrides. */
export function threadResumeParams(threadId: string, plan: Pick<LaunchPlan, 'cwd' | 'role' | 'model'>)
  : Record<string, unknown> {
  const { serviceName: _service, ...permissions } = threadStartParams(plan);
  return { threadId, excludeTurns: true, ...permissions };
}

export function turnStartParams(threadId: string, text: string,
  outputSchema: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  return { threadId, input: [{ type: 'text', text }], ...(outputSchema === undefined ? {} : { outputSchema }) };
}

/** A short handle for the kernel's binding: the random tail of the thread's UUIDv7. */
export function handleOf(threadId: string): string {
  return threadId.replaceAll('-', '').slice(-8);
}

const listSchema = z.object({ data: z.array(z.object({ id: z.string().min(1).max(100),
  name: z.string().max(1_000).nullable() })).max(1_000) });

export type NamedThread =
  | { readonly kind: 'one'; readonly threadId: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable'; readonly cause: string };

/**
 * The thread a run's name designates, from a `thread/list` searched by that name. The search is a
 * substring match, so only an exact name counts; two threads with the name are never guessed apart.
 */
export function threadNamed(result: unknown, name: string): NamedThread {
  const parsed = listSchema.safeParse(result);
  if (!parsed.success) return { kind: 'unreadable', cause: 'thread/list answered an unknown shape' };
  const matches = parsed.data.data.filter((thread) => thread.name === name);
  const [first] = matches;
  if (first === undefined) return { kind: 'none' };
  return matches.length === 1 ? { kind: 'one', threadId: first.id }
    : { kind: 'unreadable', cause: `${String(matches.length)} Codex threads carry the name ${name}` };
}

const itemSchema = z.object({ type: z.string(), text: z.string().optional(), phase: z.string().nullable().optional() });
const turnSchema = z.object({ id: z.string().min(1).max(100), items: z.array(itemSchema).max(10_000),
  status: z.enum(['completed', 'interrupted', 'failed', 'inProgress']) });
const statusSchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['notLoaded', 'idle', 'systemError']) }),
  z.object({ type: z.literal('active'), activeFlags: z.array(z.string()).max(16) }),
]);
const threadSchema = z.object({ id: z.string().min(1).max(100), name: z.string().max(1_000).nullable(),
  status: statusSchema });

export type ThreadReading = z.infer<typeof threadSchema>;
export type TurnReading = z.infer<typeof turnSchema>;

/**
 * The `result` of a `thread/read` without its turns: identity, name and runtime status. The turns
 * are read apart, the last one only, so a long run never grows the reply past the frame bound.
 */
export function readThread(result: unknown): ThreadReading | undefined {
  const parsed = z.object({ thread: threadSchema }).safeParse(result);
  return parsed.success ? parsed.data.thread : undefined;
}

/** The `result` of a `thread/turns/list` of one turn, newest first; undefined for another shape. */
export function readLastTurn(result: unknown): { readonly turn: TurnReading | undefined } | undefined {
  const parsed = z.object({ data: z.array(turnSchema).max(1) }).safeParse(result);
  return parsed.success ? { turn: parsed.data.data[0] } : undefined;
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

function finalAnswer(turn: TurnReading): string | undefined {
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
 * The run's state from its thread's last turn: every turn of a run's thread is one the kernel
 * asked for, so the last one is the current one. An approval request is surfaced to a person;
 * the kernel never answers it.
 */
export function observeThread(thread: ThreadReading, turn: TurnReading | undefined): ThreadObservation {
  if (thread.status.type === 'systemError') return { observation: { kind: 'present', state: 'failed' } };
  if (turn === undefined) {
    // Named but never given a turn: the launch did not take, and the kernel reconciles it.
    return { observation: thread.status.type === 'active' ? { kind: 'present', state: 'working', status: 'busy' }
      : { kind: 'absent' } };
  }
  const process = thread.status.type === 'active' ? 'busy' : 'idle';
  switch (turn.status) {
    case 'inProgress': {
      // Read from disk while no daemon holds it: the turn is recorded running, but nothing runs it.
      if (thread.status.type === 'notLoaded') return { observation: { kind: 'present', state: 'failed' } };
      const flags = thread.status.type === 'active' ? thread.status.activeFlags : [];
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

const CREDENTIAL = /TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIAL|API_KEY|KEY_ID|_PAT$|_AUTH$|^SSH_AUTH_SOCK$/i;
/** A URL that carries a user and a password, such as a database connection string. */
const USERINFO = /^[a-z][a-z0-9+.-]*:\/\/[^/@\s]*:[^/@\s]*@/i;
/** The credentials Codex itself signs in with. */
const CODEX_CREDENTIALS: ReadonlySet<string> = new Set(['OPENAI_API_KEY', 'CODEX_API_KEY']);

/**
 * The environment of a daemon this adapter starts: the caller's, without other tools' credentials
 * an agent could read. A daemon the person started keeps the environment they gave it.
 */
export function childEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name, value]) => value !== undefined
    && (CODEX_CREDENTIALS.has(name) || (!CREDENTIAL.test(name) && !USERINFO.test(value)))));
}

/** What the daemon says, reduced to printable text before it reaches a cause a terminal shows. */
export function printable(text: string, max: number): string {
  return text.replace(/\p{Cc}/gu, '').slice(0, max);
}
