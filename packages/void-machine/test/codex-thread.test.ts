import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MAX_RESULT_BYTES, childEnvironment, controlSocketPath, daemonReadiness, handleOf, observeThread,
  parseDaemonVersion, printable, readLastTurn, readThread, threadNamed, threadResumeParams, threadStartParams,
  turnStartParams,
} from '../src/adapters/runtime/codex-thread.js';
import type { LaunchPlan } from '../src/runtime/delegation.js';

/** Frames captured from the Codex app-server daemon 0.158.0 on 2026-09-29; paths replaced, shapes verbatim. */
const captured = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/codex-daemon/${name}`, import.meta.url)), 'utf8'));
const dispatch = captured('dispatch.frames.json') as { requests: Array<{ method: string; params: unknown }> };
const THREAD = '01a0ea7c-0a16-7d92-a048-70f5effc1707';
const FIRST_TURN = '01a0ea7c-0dca-7c00-9c0b-b879856bbeec';
const THIRD_TURN = '01a0ea7c-4eb1-7500-a405-8311c50b7ff7';
const RUN = 'vm-run_00000000-0000-4000-8000-000000000001';
const SOCKET = '/home/user/.codex/app-server-control/app-server-control.sock';

const resultOf = (name: string) => (captured(name) as { result: unknown }).result;

/** A snapshot the adapter takes: the thread without its turns, then its last turn only. */
function observed(snapshot: string) {
  const thread = readThread(resultOf(`${snapshot}.read.json`));
  const last = readLastTurn(resultOf(`${snapshot}.turns.json`));
  if (thread === undefined || last === undefined) throw new Error(`${snapshot} does not parse`);
  return observeThread(thread, last.turn);
}

const review: LaunchPlan = {
  name: RUN, role: 'review', agentType: 'independent-code-reviewer', model: undefined, cwd: '/work/review',
  instructionPath: '/work/.void/machine/runs/m/agents/run_1/brief/brief.md',
  instructionDirectory: '/work/.void/machine/runs/m/agents/run_1/brief',
};
const verdict = { type: 'object', properties: { verdict: { type: 'string', enum: ['pass', 'fail'] },
  summary: { type: 'string' } }, required: ['verdict', 'summary'], additionalProperties: false };

describe('the parameters of a delegated thread', () => {
  it('starts a review read-only and never asks for an approval, as the captured request did', () => {
    const request = dispatch.requests.find((frame) => frame.method === 'thread/start');
    expect(threadStartParams(review)).toEqual(request?.params);
  });

  it('lets a worker write in its worktree only, with the model only when one is asked for', () => {
    expect(threadStartParams({ ...review, role: 'work', model: 'gpt-5.6-sol' })).toEqual({ cwd: '/work/review',
      approvalPolicy: 'never', sandbox: 'workspace-write', serviceName: 'void_machine', model: 'gpt-5.6-sol' });
  });

  it('never widens the sandbox or the approval policy, whatever the role', () => {
    for (const role of ['work', 'review'] as const) {
      const params = JSON.stringify([threadStartParams({ ...review, role }), threadResumeParams(THREAD, { ...review, role })]);
      expect(params).not.toMatch(/danger-full-access|on-request|untrusted|granular/);
    }
  });

  it('resumes an unloaded thread with the permissions of its role, which the daemon confirmed on resume', () => {
    // Captured: the resumed thread answered approvalPolicy never and a readOnly sandbox.
    const resumed = resultOf('resume.json') as { approvalPolicy: string; sandbox: { type: string } };
    expect([resumed.approvalPolicy, resumed.sandbox.type]).toEqual(['never', 'readOnly']);
    expect(threadResumeParams(THREAD, review)).toEqual({ threadId: THREAD, excludeTurns: true, cwd: '/work/review',
      approvalPolicy: 'never', sandbox: 'read-only' });
    expect(threadResumeParams(THREAD, { ...review, role: 'work', model: 'gpt-5.6-sol' })).toMatchObject({
      sandbox: 'workspace-write', model: 'gpt-5.6-sol' });
  });

  it('starts a turn with the brief and the output schema, as the captured request did', () => {
    const request = dispatch.requests.find((frame) => frame.method === 'turn/start') as
      { params: { threadId: string; input: Array<{ text: string }> } };
    const text = request.params.input[0]?.text ?? '';
    expect(turnStartParams(THREAD, text, verdict)).toEqual(request.params);
    expect(turnStartParams(THREAD, 'next', undefined)).toEqual({ threadId: THREAD,
      input: [{ type: 'text', text: 'next' }] });
  });
});

describe('finding a run thread by its name', () => {
  const list = resultOf('list-by-name.json') as { data: Array<{ id: string; name: string }> };

  it('takes the one thread carrying the exact name, as the captured search found it', () => {
    expect(threadNamed(list, RUN)).toEqual({ kind: 'one', threadId: THREAD });
  });

  it('never guesses between threads carrying the same name', () => {
    // Seen during the captures of 2026-09-29, before the earlier threads were archived.
    const twice = { data: [...list.data, { ...list.data[0], id: '01a0ea61-1fc9-7fd3-aeeb-fb6a514c7a0e' }] };
    expect(threadNamed(twice, RUN)).toEqual({ kind: 'unreadable', cause: `2 Codex threads carry the name ${RUN}` });
  });

  it('counts a substring match as no thread, and an unknown answer as unreadable', () => {
    expect(threadNamed(list, 'vm-run_00000000')).toEqual({ kind: 'none' });
    expect(threadNamed({ data: [] }, RUN)).toEqual({ kind: 'none' });
    expect(threadNamed('garbage', RUN)).toMatchObject({ kind: 'unreadable' });
  });
});

describe('reading a thread', () => {
  it('sees a turn still running as working and busy', () => {
    expect(observed('in-progress')).toEqual({ observation: { kind: 'present', state: 'working', status: 'busy' } });
  });

  it('ends a completed turn with its final answer, not the commentary written in the same shape', () => {
    expect(observed('completed')).toEqual({ observation: { kind: 'present', state: 'done', status: 'idle' },
      result: { turnId: FIRST_TURN, text: '{"verdict":"pass","summary":"Hello, the command completed successfully."}',
        truncated: false } });
  });

  it('reads an interrupted turn as stopped', () => {
    expect(observed('interrupted')).toEqual({ observation: { kind: 'present', state: 'stopped', status: 'idle' } });
  });

  it('follows the last turn, the one the kernel asked for last', () => {
    expect(observed('third-turn-completed')).toEqual({ observation: { kind: 'present', state: 'done', status: 'idle' },
      result: { turnId: THIRD_TURN, text: '{"verdict":"pass","summary":"Bye."}', truncated: false } });
  });

  it('reads a thread the daemon unloaded from its last turn, as recorded', () => {
    const thread = readThread(resultOf('not-loaded.read.json'));
    expect(thread?.status).toEqual({ type: 'notLoaded' });
  });

  it('refuses an answer that does not have the protocol shape', () => {
    expect(readThread({ thread: { id: THREAD } })).toBeUndefined();
    expect(readThread('garbage')).toBeUndefined();
    expect(readThread((captured('read-unknown.json') as { result?: unknown }).result)).toBeUndefined();
    expect(readLastTurn({ data: [{ id: 'x' }] })).toBeUndefined();
    expect(readLastTurn({ data: [] })).toEqual({ turn: undefined });
  });

  // Synthetic states: never captured, built on the 0.158.0 protocol types (ThreadStatus, TurnStatus).
  const synthetic = (status: unknown, turnStatus: string | undefined, items: unknown[] = []) => {
    const thread = readThread({ thread: { ...(resultOf('in-progress.read.json') as { thread: object }).thread,
      status } });
    const last = readLastTurn({ data: turnStatus === undefined ? [] : [{ id: FIRST_TURN, items, itemsView: 'full',
      status: turnStatus, error: null, startedAt: 1, completedAt: null, durationMs: null }] });
    if (thread === undefined || last === undefined) throw new Error('synthetic thread does not parse');
    return observeThread(thread, last.turn);
  };

  it('surfaces an approval asked despite the never policy as a person to wait for, never answered', () => {
    expect(synthetic({ type: 'active', activeFlags: ['waitingOnApproval'] }, 'inProgress'))
      .toEqual({ observation: { kind: 'present', state: 'blocked', status: 'waiting',
        waitingFor: 'an approval, although the run was started with approvalPolicy never' } });
    expect(synthetic({ type: 'active', activeFlags: ['waitingOnUserInput'] }, 'inProgress'))
      .toMatchObject({ observation: { state: 'blocked', waitingFor: 'user input' } });
  });

  it('reads a failed turn, a thread in system error, or a running turn no daemon holds as failed', () => {
    expect(synthetic({ type: 'idle' }, 'failed').observation).toEqual({ kind: 'present', state: 'failed', status: 'idle' });
    expect(synthetic({ type: 'systemError' }, 'inProgress').observation).toEqual({ kind: 'present', state: 'failed' });
    expect(synthetic({ type: 'notLoaded' }, 'inProgress').observation).toEqual({ kind: 'present', state: 'failed' });
  });

  it('reads a named thread that never got its turn as absent, so the kernel reconciles it', () => {
    expect(synthetic({ type: 'idle' }, undefined).observation).toEqual({ kind: 'absent' });
    expect(synthetic({ type: 'active', activeFlags: [] }, undefined).observation)
      .toEqual({ kind: 'present', state: 'working', status: 'busy' });
  });

  it('takes the last final answer, or the last message when none is marked final', () => {
    const message = (text: string, phase: string | null) => ({ type: 'agentMessage', id: text, text, phase,
      memoryCitation: null, delivery: null, questions: null });
    const done = synthetic({ type: 'idle' }, 'completed', [message('plan', 'commentary'),
      message('answer', 'final_answer'), message('after', 'commentary')]);
    expect(done.result?.text).toBe('answer');
    expect(synthetic({ type: 'idle' }, 'completed', [message('only', null)]).result?.text).toBe('only');
    expect(synthetic({ type: 'idle' }, 'completed', []).result).toBeUndefined();
  });

  it('bounds the final answer in bytes and cuts it on a character boundary', () => {
    const long = `${'a'.repeat(MAX_RESULT_BYTES - 1)}é and more`;
    const message = { type: 'agentMessage', id: 'm', text: long, phase: 'final_answer', memoryCitation: null,
      delivery: null, questions: null };
    const result = synthetic({ type: 'idle' }, 'completed', [message]).result;
    expect(result?.truncated).toBe(true);
    expect(result?.text).toBe('a'.repeat(MAX_RESULT_BYTES - 1));
  });
});

describe('the daemon a run is served by', () => {
  // Printed by `codex app-server daemon version` on 2026-09-29, home replaced.
  const running = { status: 'running', backend: 'pid',
    managedCodexPath: '/home/user/.codex/packages/standalone/current/bin/codex', managedCodexVersion: '0.158.0',
    socketPath: SOCKET, cliVersion: '0.158.0', appServerVersion: '0.158.0' };
  const version = (fields: Record<string, unknown> = {}) => {
    const parsed = parseDaemonVersion(JSON.stringify({ ...running, ...fields }));
    if (parsed === undefined) throw new Error('the version does not parse');
    return parsed;
  };

  it('finds the control socket in the Codex home, CODEX_HOME first', () => {
    expect(controlSocketPath({}, '/home/user')).toBe(SOCKET);
    expect(controlSocketPath({ CODEX_HOME: '/srv/codex' }, '/home/user'))
      .toBe('/srv/codex/app-server-control/app-server-control.sock');
  });

  it('serves a run from a running daemon on that socket, at the version of the CLI', () => {
    expect(daemonReadiness(version(), SOCKET)).toEqual({ kind: 'ready' });
  });

  it('starts a daemon that is not running', () => {
    expect(daemonReadiness(version({ status: 'stopped', appServerVersion: null }), SOCKET)).toEqual({ kind: 'start' });
  });

  it('refuses a daemon of another version than the CLI, naming the repair', () => {
    expect(daemonReadiness(version({ cliVersion: '0.158.1' }), SOCKET)).toEqual({ kind: 'refused',
      cause: 'the Codex daemon runs 0.158.0 while the codex CLI on PATH is 0.158.1',
      action: 'align them: codex app-server daemon update, or update the codex on PATH' });
    // Seen on 2026-09-29: the Homebrew codex at 0.155.1 beside a 0.158.0 daemon.
    expect(daemonReadiness(version({ cliVersion: '0.155.1' }), SOCKET)).toMatchObject({ kind: 'refused',
      action: 'update Codex CLI to 0.158.0 or later' });
  });

  it('refuses a daemon on another socket than the one this adapter reaches', () => {
    expect(daemonReadiness(version({ socketPath: '/elsewhere.sock' }), SOCKET)).toMatchObject({ kind: 'refused',
      action: 'restart it from the same CODEX_HOME: codex app-server daemon restart' });
  });

  it('reads nothing from an output that is not the version JSON, nor a version that is not one', () => {
    expect(parseDaemonVersion('error: unrecognized subcommand')).toBeUndefined();
    expect(parseDaemonVersion('{"status":"running"}')).toBeUndefined();
    expect(parseDaemonVersion(JSON.stringify({ ...running, cliVersion: '0.158.0\u001b[2J' }))).toBeUndefined();
  });

  it('keeps what Codex needs from the environment and drops the credentials of other tools', () => {
    const env = childEnvironment({ PATH: '/bin', HOME: '/home/user', CODEX_HOME: '/home/user/.codex',
      OPENAI_API_KEY: 'sk-kept', CODEX_API_KEY: 'kept', GH_TOKEN: 'gho-dropped', GITHUB_TOKEN: 'dropped',
      NPM_TOKEN: 'dropped', AWS_SECRET_ACCESS_KEY: 'dropped', AWS_ACCESS_KEY_ID: 'dropped', DB_PASSWORD: 'dropped',
      ANTHROPIC_API_KEY: 'dropped', STRIPE_API_KEY: 'dropped', VOID_MISSION_ID: 'mis_x',
      SSH_AUTH_SOCK: '/tmp/agent.sock', GITLAB_PAT: 'dropped', HF_AUTH: 'dropped',
      DATABASE_URL: 'postgres://user:pw@db/app', REDIS_URL: 'redis://cache:6379', GIT_AUTHOR_NAME: 'Kept' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/user', CODEX_HOME: '/home/user/.codex',
      OPENAI_API_KEY: 'sk-kept', CODEX_API_KEY: 'kept', VOID_MISSION_ID: 'mis_x', REDIS_URL: 'redis://cache:6379',
      GIT_AUTHOR_NAME: 'Kept' });
  });

  it('keeps only printable text of what the daemon says, bounded', () => {
    expect(printable('thread not found\u001b[2J\u0007: x\u009b', 300)).toBe('thread not found[2J: x');
    expect(printable('a'.repeat(500), 300)).toHaveLength(300);
  });

  it('derives a handle from the thread id', () => {
    expect(handleOf(THREAD)).toBe('effc1707');
  });
});
