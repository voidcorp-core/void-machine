// tdd-cover: e2e packages/void-machine/test/claude-session-contract.test.ts
import { spawn as nodeSpawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { RunObservation } from '../../core/delegation.js';
import type {
  AgentRuntimePort, LaunchOutcome, LaunchPlan, NativeRunRef, Preflight, RuntimeReading, SessionReading,
  SessionState,
} from '../../runtime/delegation.js';

/**
 * Delegated runs as Claude Code background sessions (code.claude.com/docs/en/agent-view).
 * Contract replayed from Claude Code 2.1.283 in test/fixtures/claude-session/.
 */

/** `claude --resume <id> --bg` continues a session in place from this version on. */
export const MIN_CLAUDE_VERSION = '2.1.257';
const PROBE_TIMEOUT_MS = 10_000;
const LAUNCH_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1_048_576;
const MAX_SETTINGS_BYTES = 1_048_576;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ClaudeChild {
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'error' | 'close', listener: (...args: unknown[]) => void): unknown;
}
export type ClaudeSpawn = (executable: string, args: readonly string[], options: {
  readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly shell: false;
  readonly stdio: ['ignore', 'pipe', 'pipe'];
}) => ClaudeChild;

export interface ClaudeSessionConfig {
  readonly executable: string;
  readonly env: NodeJS.ProcessEnv;
  /** Home of the person running the kernel, for user-level Claude settings. */
  readonly home: string;
  readonly spawn?: ClaudeSpawn;
  readonly launchTimeoutMs?: number;
}

// Argv -------------------------------------------------------------------------------------

/** The only prompt a delegated session receives: caller text travels in a file, never argv. */
function instructionPrompt(path: string): string {
  return `Read ${path} completely before anything else and do what it asks. `
    + 'End your turn with your final answer.';
}

function permissionArgs(plan: LaunchPlan): string[] {
  const agent = plan.agentType === undefined ? [] : ['--agent', plan.agentType];
  return [...agent, '--permission-mode', plan.role === 'work' ? 'auto' : 'dontAsk'];
}

export function launchArgs(plan: LaunchPlan): string[] {
  return ['--bg', '--name', plan.name, ...permissionArgs(plan),
    ...(plan.model === undefined ? [] : ['--model', plan.model]),
    '--add-dir', plan.instructionDirectory, instructionPrompt(plan.instructionPath)];
}

export function resumeArgs(sessionId: string, plan: LaunchPlan): string[] {
  return ['--resume', sessionId, '--bg', '--add-dir', plan.instructionDirectory,
    instructionPrompt(plan.instructionPath)];
}

// Parsing ----------------------------------------------------------------------------------

const ACK = /^backgrounded · ([0-9a-f]{8}) · (\S+)\s*$/m;

export function parseAcknowledgement(stdout: string): { handle: string; name: string } | undefined {
  const match = ACK.exec(stdout);
  return match?.[1] === undefined || match[2] === undefined ? undefined
    : { handle: match[1], name: match[2] };
}

export function parseClaudeVersion(stdout: string): string | undefined {
  return /^(\d+\.\d+\.\d+)\b/.exec(stdout.trim())?.[1];
}

export function versionAtLeast(version: string, minimum: string): boolean {
  const parts = (text: string) => text.split('.').map(Number);
  const [have, need] = [parts(version), parts(minimum)];
  for (let index = 0; index < 3; index += 1) {
    const delta = (have[index] ?? 0) - (need[index] ?? 0);
    if (delta !== 0) return delta > 0;
  }
  return true;
}

const rowSchema = z.object({
  id: z.string().optional(),
  kind: z.string(),
  name: z.string().optional(),
  sessionId: z.string().optional(),
  startedAt: z.number(),
  state: z.string().optional(),
  waitingFor: z.string().optional(),
});
export type SessionRow = z.infer<typeof rowSchema>;

export function parseSessionRows(stdout: string): SessionRow[] | undefined {
  try {
    const parsed = z.array(rowSchema).max(4096).safeParse(JSON.parse(stdout));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

const NATIVE_STATES = ['working', 'blocked', 'done', 'failed', 'stopped'] as const;

function observationOf(row: SessionRow): RunObservation {
  const state = NATIVE_STATES.find((known) => known === row.state);
  if (state === undefined) {
    return { kind: 'unreadable', cause: `claude reported an unknown session state: ${String(row.state)}` };
  }
  return state === 'blocked' && row.waitingFor !== undefined
    ? { kind: 'present', state, waitingFor: row.waitingFor } : { kind: 'present', state };
}

/** The row of each run: its bound handle first, else the newest background row with its name. */
export function readSessions(rows: readonly SessionRow[], refs: readonly NativeRunRef[]): SessionReading {
  const background = rows.filter((row) => row.kind === 'background' && row.id !== undefined);
  const sessions = new Map<string, SessionState>();
  for (const ref of refs) {
    const named = background.filter((row) => row.name === ref.name)
      .sort((left, right) => right.startedAt - left.startedAt);
    const row = (ref.handle === undefined ? undefined
      : background.find((candidate) => candidate.id === ref.handle)) ?? named[0];
    if (row === undefined) continue;
    const bound = row.id !== undefined && row.sessionId !== undefined && UUID.test(row.sessionId);
    sessions.set(ref.name, { observation: observationOf(row),
      ...(bound && row.id !== undefined && row.sessionId !== undefined
        ? { binding: { handle: row.id, sessionId: row.sessionId } } : {}) });
  }
  return sessions;
}

export type HookWiring = 'local-bundle' | 'wired' | 'missing';

/** Whether a settings document runs the delegation-result lifecycle on Stop. */
export function resultHookWiring(settings: string): HookWiring {
  const commandSchema = z.object({ hooks: z.object({ Stop: z.array(z.object({
    hooks: z.array(z.object({ command: z.string().optional() })).optional() })) }) });
  let parsed: unknown;
  try { parsed = JSON.parse(settings); } catch { return 'missing'; }
  const document = commandSchema.safeParse(parsed);
  if (!document.success) return 'missing';
  const commands = document.data.hooks.Stop.flatMap((entry) => entry.hooks ?? [])
    .map((hook) => hook.command ?? '').filter((command) => command.includes('lifecycle delegation-result'));
  if (commands.length === 0) return 'missing';
  return commands.some((command) => command.includes('.void/hooks/_void-hook.mjs')) ? 'local-bundle' : 'wired';
}

// Processes --------------------------------------------------------------------------------

type Run =
  | { readonly kind: 'exited'; readonly code: number | undefined; readonly stdout: string; readonly stderr: string }
  | { readonly kind: 'not-started'; readonly cause: string }
  | { readonly kind: 'timed-out' };

function collect(stream: NodeJS.ReadableStream | null, onLimit: () => void): Promise<string> {
  return new Promise((resolve) => {
    if (stream === null) { resolve(''); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on('data', (chunk: unknown) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += bytes.byteLength;
      if (size > MAX_OUTPUT_BYTES) onLimit();
      else chunks.push(bytes);
    });
    stream.once('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.once('error', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function runBounded(config: ClaudeSessionConfig, args: readonly string[], cwd: string,
  timeoutMs: number): Promise<Run> {
  const spawn: ClaudeSpawn = config.spawn ?? ((executable, argv, options) => nodeSpawn(executable, argv, options));
  return new Promise((resolve) => {
    let child: ClaudeChild;
    try {
      child = spawn(config.executable, args, { cwd, env: config.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ kind: 'not-started', cause: error instanceof Error ? error.message : String(error) });
      return;
    }
    let timedOut = false;
    const terminate = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1_000).unref();
    };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    const output = Promise.all([collect(child.stdout, terminate), collect(child.stderr, terminate)]);
    child.once('error', (error: unknown) => {
      clearTimeout(timer);
      resolve({ kind: 'not-started', cause: error instanceof Error ? error.message : String(error) });
    });
    child.once('close', (code: unknown) => {
      clearTimeout(timer);
      void output.then(([stdout, stderr]) => resolve(timedOut ? { kind: 'timed-out' }
        : { kind: 'exited', code: typeof code === 'number' ? code : undefined, stdout, stderr }));
    });
  });
}

function launchOutcome(run: Run, plan: LaunchPlan): LaunchOutcome {
  if (run.kind === 'timed-out') return { kind: 'lost', cause: 'claude did not acknowledge the launch in time' };
  if (run.kind === 'not-started') {
    return { kind: 'refused', cause: `claude could not start: ${run.cause}`,
      action: 'install Claude Code or put claude on PATH' };
  }
  const untrusted = /^Workspace not trusted\.?\s*(.*)$/m.exec(run.stderr);
  if (untrusted !== null) {
    return { kind: 'refused', cause: 'Workspace not trusted',
      action: (untrusted[1] ?? '').slice(0, 400) || `run claude once in ${plan.cwd} and accept the trust prompt` };
  }
  if (run.code !== 0) {
    return { kind: 'refused', cause: `claude --bg exited with code ${String(run.code)}`,
      action: `run claude once by hand in ${plan.cwd} to see why the launch fails` };
  }
  const ack = parseAcknowledgement(run.stdout);
  if (ack === undefined) return { kind: 'lost', cause: 'claude printed no launch acknowledgement' };
  if (/^warning: no agent named /m.test(run.stderr)) {
    return { kind: 'refused', handle: ack.handle, cause: `no agent named ${String(plan.agentType)}`,
      action: 'use an agent type defined for this project or the user' };
  }
  return { kind: 'acknowledged', handle: ack.handle };
}

// Preflight ---------------------------------------------------------------------------------

function readBounded(path: string): string | undefined {
  try {
    const text = readFileSync(path, 'utf8');
    return text.length > MAX_SETTINGS_BYTES ? undefined : text;
  } catch {
    return undefined;
  }
}

function projectRoot(cwd: string): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, shell: false,
    encoding: 'utf8', timeout: 5_000 });
  const top = result.status === 0 ? result.stdout.replace(/\r?\n$/, '') : '';
  return top === '' ? cwd : top;
}

function resultHookPreflight(cwd: string, home: string): Preflight {
  const root = projectRoot(cwd);
  const wirings = [join(root, '.claude', 'settings.json'), join(root, '.claude', 'settings.local.json'),
    join(home, '.claude', 'settings.json')].map((path) => resultHookWiring(readBounded(path) ?? ''));
  const update = `run npx voidmachine update in ${root}, commit the refreshed hooks, then dispatch again`;
  if (wirings.every((wiring) => wiring === 'missing')) {
    return { ok: false, action: update,
      cause: 'the delegation-result Stop hook is not installed, so no result would ever be collected' };
  }
  const bundle = readBounded(join(root, '.void', 'hooks', '_void-hook.mjs')) ?? '';
  if (wirings.includes('local-bundle') && !wirings.includes('wired') && !bundle.includes('delegation-result')) {
    return { ok: false, action: update,
      cause: 'the installed hook bundle predates the delegation-result Stop hook' };
  }
  return { ok: true };
}

export function createClaudeSessionRuntime(config: ClaudeSessionConfig): AgentRuntimePort {
  const launchTimeout = config.launchTimeoutMs ?? LAUNCH_TIMEOUT_MS;
  return {
    async preflight(cwd) {
      const run = await runBounded(config, ['--version'], cwd, PROBE_TIMEOUT_MS);
      const version = run.kind === 'exited' && run.code === 0 ? parseClaudeVersion(run.stdout) : undefined;
      if (version === undefined) {
        return { ok: false, cause: 'claude is not installed, not on PATH, or did not report its version',
          action: `install Claude Code ${MIN_CLAUDE_VERSION} or later` };
      }
      if (!versionAtLeast(version, MIN_CLAUDE_VERSION)) {
        return { ok: false, cause: `Claude Code ${version} cannot resume background sessions in place`,
          action: `update Claude Code to ${MIN_CLAUDE_VERSION} or later` };
      }
      return resultHookPreflight(cwd, config.home);
    },
    async dispatch(plan) {
      return launchOutcome(await runBounded(config, launchArgs(plan), plan.cwd, launchTimeout), plan);
    },
    async observe(refs): Promise<RuntimeReading> {
      const run = await runBounded(config, ['agents', '--json', '--all'], tmpdir(), PROBE_TIMEOUT_MS);
      if (run.kind !== 'exited' || run.code !== 0) {
        return { kind: 'unreadable', cause: run.kind === 'exited'
          ? `claude agents exited with code ${String(run.code)}` : 'claude agents did not answer in time' };
      }
      const rows = parseSessionRows(run.stdout);
      if (rows === undefined) return { kind: 'unreadable', cause: 'claude agents printed an unreadable listing' };
      return { kind: 'read', sessions: readSessions(rows, refs) };
    },
    async send(ref, plan) {
      if (ref.sessionId === undefined) {
        return { kind: 'refused', cause: 'the native session is not bound yet',
          action: 'wait until the run is listed: void-machine agents wait <runId>' };
      }
      return launchOutcome(await runBounded(config, resumeArgs(ref.sessionId, plan), plan.cwd, launchTimeout), plan);
    },
    async stop(ref) {
      if (ref.handle === undefined) return { ok: false, cause: 'no native session is bound', action: 'none' };
      const run = await runBounded(config, ['stop', ref.handle], tmpdir(), PROBE_TIMEOUT_MS);
      return run.kind === 'exited' && run.code === 0 && run.stdout.startsWith('stopped') ? { ok: true }
        : { ok: false, cause: `claude stop ${ref.handle} did not confirm`, action: `run claude stop ${ref.handle}` };
    },
    attachCommand(ref) {
      return ref.handle === undefined ? undefined : [config.executable, 'attach', ref.handle];
    },
  };
}
