// tdd-cover: e2e packages/void-machine/test/presentation-adapters-contract.test.ts
import { execFile } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { type SurfaceCause, surfaceCause } from '../../core/presentation.js';

/**
 * How a presentation adapter talks to its multiplexer: one CLI call at a time, argv only (never a
 * shell), bounded in output, and bounded in time by what remains of the operation's deadline.
 */

const MAX_OUTPUT_BYTES = 1_048_576;

export type CommandResult =
  | { readonly kind: 'exited'; readonly code: number; readonly stdout: string; readonly stderr: string }
  | { readonly kind: 'failed'; readonly cause: SurfaceCause };

export type CommandRunner = (executable: string, args: readonly string[], options: {
  readonly env: NodeJS.ProcessEnv; readonly timeoutMs: number; readonly cwd?: string;
}) => Promise<CommandResult>;

function errorCode(error: unknown): string | number | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' || typeof error.code === 'number' ? error.code : undefined;
}

export const runCommand: CommandRunner = (executable, args, options) => new Promise((resolve) => {
  const step = args.filter((arg) => !arg.startsWith('-')).slice(0, 2).join(' ');
  if (options.timeoutMs <= 0) {
    resolve({ kind: 'failed', cause: surfaceCause('deadline', step) });
    return;
  }
  execFile(executable, args, { env: options.env, timeout: options.timeoutMs, maxBuffer: MAX_OUTPUT_BYTES,
    killSignal: 'SIGKILL', shell: false, windowsHide: true, encoding: 'utf8',
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }) }, (error, stdout, stderr) => {
    if (error === null) { resolve({ kind: 'exited', code: 0, stdout, stderr }); return; }
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'EACCES') {
      resolve({ kind: 'failed', cause: surfaceCause('unreachable', step, `${executable}: ${String(code)}`) });
    } else if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      resolve({ kind: 'failed', cause: surfaceCause('output-overflow', step) });
    } else if (error.killed || error.signal !== null) {
      resolve({ kind: 'failed', cause: surfaceCause('timeout', step) });
    } else if (typeof code === 'number') {
      resolve({ kind: 'exited', code, stdout, stderr });
    } else {
      resolve({ kind: 'failed', cause: surfaceCause('unreachable', step, error.message) });
    }
  });
});

export interface MultiplexerConfig {
  readonly executable: string;
  readonly env: NodeJS.ProcessEnv;
  readonly run?: CommandRunner;
  readonly now?: () => number;
}

export interface Deadline {
  remaining(): number;
}

export function deadline(now: () => number, budgetMs: number): Deadline {
  const end = now() + budgetMs;
  return { remaining: () => Math.max(0, end - now()) };
}

/** Whether a path is a Unix socket owned by the current user, symlinks refused. */
export function socketReady(path: string): boolean {
  try {
    const info = lstatSync(path);
    return info.isSocket() && (process.getuid === undefined || info.uid === process.getuid());
  } catch {
    return false;
  }
}

/** The outcome of a call that must succeed: its stdout, or the cause of its failure. */
export type Answer = { readonly ok: true; readonly stdout: string } | { readonly ok: false; readonly cause: SurfaceCause };

export function answerOf(result: CommandResult, step: string): Answer {
  if (result.kind === 'failed') return { ok: false, cause: { ...result.cause, step } };
  if (result.code !== 0) {
    return { ok: false, cause: surfaceCause('exit-nonzero', step, `exit ${String(result.code)}: ${result.stderr}`) };
  }
  return { ok: true, stdout: result.stdout };
}
