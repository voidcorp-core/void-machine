import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as z from 'zod/mini';
import { parseHookPayload } from '../enforcement/runner.js';
import type { AgentRuntime } from '../runtime-input.js';
import { type Environment, type LifecycleExecution, record } from './executor-shared.js';

export type SessionRun = (command: string, args: readonly string[], options: {
  readonly env: Environment; readonly shell: false; readonly timeout: number;
  readonly maxBuffer: number; readonly killSignal: 'SIGKILL'; readonly input?: Uint8Array;
}) => Buffer;
type Execution = LifecycleExecution & { readonly output?: Buffer };
const runCommand: SessionRun = (command, args, options) => {
  const result = spawnSync(command, args, options);
  if (result.error !== undefined || result.status !== 0) throw Error('process-failed');
  return result.stdout;
};
const discoverySchema = z.object({ result: z.object({ process_info: z.object({
  pane_id: z.string(), foreground_processes: z.array(z.object({
    pid: z.number().check(z.int(), z.minimum(2)),
  })).check(z.minLength(1), z.maxLength(256)),
}) }) });

function refused(reason: string): Execution {
  return { status: 'degraded', details: { reason }, diagnostic: `herdr-session: ${reason}\n` };
}

function foreground(output: Buffer, pane: string): readonly number[] | undefined {
  try {
    const value: unknown = JSON.parse(output.toString('utf8'));
    if (record(value)?.['error'] !== undefined) return undefined;
    const result = discoverySchema.safeParse(value);
    if (!result.success || result.data.result.process_info.pane_id !== pane) return undefined;
    return result.data.result.process_info.foreground_processes.map(item => item.pid);
  } catch { return undefined; }
}

function proveOwnership(
  pids: readonly number[], call: (command: string, args: readonly string[]) => Buffer,
): string | undefined {
  let pid = process.pid;
  const visited = new Set<number>();
  for (let depth = 0; depth < 64; depth++) {
    if (visited.has(pid)) return 'parent-cycle';
    visited.add(pid);
    if (pids.includes(pid)) return undefined;
    const parent = call('ps', ['-o', 'ppid=', '-p', String(pid)]).toString('utf8').trim();
    if (!/^[0-9]+$/.test(parent) || !Number.isSafeInteger(Number(parent))) return 'invalid-parent';
    pid = Number(parent);
    if (pid <= 1) return 'ownership-unproven';
  }
  return 'parent-depth-exceeded';
}

function nativeHook(env: Environment): string | undefined {
  const path = join(env['CODEX_HOME'] || join(env['HOME'] || homedir(), '.codex'),
    'herdr-agent-state.sh');
  try { return statSync(path).isFile() ? path : undefined; } catch { return undefined; }
}

/** Global session relay: no project discovery, journal or session-state publication here. */
export function executeHerdrSession(
  input: Uint8Array, env: Environment, runtime: AgentRuntime,
  run: SessionRun = runCommand, clock: () => number = () => performance.now(),
): Execution {
  if (runtime !== 'codex' || env['HERDR_ENV'] !== '1') {
    return { status: 'skipped', details: { reason: 'outside-codex-herdr' } };
  }
  try {
    if (record(parseHookPayload(input))?.['hook_event_name'] !== 'SessionStart') {
      return { status: 'skipped', details: { reason: 'event-not-actionable' } };
    }
  } catch { return refused('invalid-input'); }
  const pane = env['HERDR_PANE_ID'];
  if (pane === undefined || pane.length === 0 || pane.length > 160
    || [...pane].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    || !env['HERDR_SOCKET_PATH']) return refused('missing-herdr-context');
  const hook = nativeHook(env);
  if (hook === undefined) return refused('native-hook-unavailable');
  const deadline = clock() + 2000;
  let reason = 'discovery-failed';
  const call = (command: string, args: readonly string[]) => {
    const timeout = Math.floor(deadline - clock());
    if (timeout <= 0) { reason = 'discovery-deadline'; throw Error(reason); }
    return run(command, args, { env, shell: false, timeout, maxBuffer: 262144, killSignal: 'SIGKILL' });
  };
  try {
    const pids = foreground(call('herdr', ['pane', 'process-info', '--pane', pane]), pane);
    if (pids === undefined) return refused('invalid-discovery');
    reason = 'parent-lookup-failed';
    const denied = proveOwnership(pids, call);
    if (denied !== undefined) return refused(denied);
  } catch { return refused(reason); }
  try {
    const output = run('sh', [hook, 'session'], {
      env, shell: false, timeout: 1000, maxBuffer: 262144, killSignal: 'SIGKILL', input,
    });
    return { status: 'ok', details: { relayed: true }, output };
  } catch { return refused('native-relay-failed'); }
}
