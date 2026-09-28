import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MAX_RESULT_BYTES, SOCKET_PATH_MAX_BYTES, childEnvironment, handleOf, observeThread, parseCodexVersion, readThread,
  socketPathFor, threadStartParams, turnStartParams,
} from '../src/adapters/runtime/codex-thread.js';
import type { LaunchPlan } from '../src/runtime/delegation.js';

/** Frames captured from Codex CLI 0.155.1 on 2026-09-28; paths replaced by /work, shapes verbatim. */
const captured = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/codex-app-server/${name}`, import.meta.url)), 'utf8'));
const dispatch = captured('dispatch.frames.json') as { requests: Array<{ method: string; params: unknown }> };
const THREAD = '01a0e9f7-5d5e-7c92-b856-0c2782407fda';
const TURN = '01a0e9f7-5e20-7812-b9d7-920fabee855c';
const INTERRUPTED_TURN = '01a0ea07-75d5-75b1-a49b-be6ab0097121';
const SECOND_TURN = '01a0ea07-9537-71e3-b352-fb4a81be9c1b';

function thread(name: string) {
  const response = captured(name) as { result: unknown };
  const parsed = readThread(response.result);
  if (parsed === undefined) throw new Error(`${name} does not parse`);
  return parsed;
}

const review: LaunchPlan = {
  name: 'vm-run_1', role: 'review', agentType: 'independent-code-reviewer', model: undefined, cwd: '/work/review',
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
      const params = JSON.stringify(threadStartParams({ ...review, role }));
      expect(params).not.toMatch(/danger-full-access|on-request|untrusted|granular/);
    }
  });

  it('starts a turn with the brief and the output schema, as the captured request did', () => {
    const request = dispatch.requests.find((frame) => frame.method === 'turn/start') as
      { params: { input: Array<{ text: string }> } };
    const text = request.params.input[0]?.text ?? '';
    expect(turnStartParams(THREAD, text, verdict)).toEqual(request.params);
    expect(turnStartParams(THREAD, 'next', undefined)).toEqual({ threadId: THREAD,
      input: [{ type: 'text', text: 'next' }] });
  });
});

describe('reading a thread', () => {
  it('sees a turn still running as working and busy', () => {
    expect(observeThread(thread('read-in-progress.json'), TURN)).toEqual({
      observation: { kind: 'present', state: 'working', status: 'busy' } });
  });

  it('ends a completed turn with its final answer', () => {
    expect(observeThread(thread('read-completed.json'), TURN)).toEqual({
      observation: { kind: 'present', state: 'done', status: 'idle' },
      result: { turnId: TURN, text: '{"verdict":"pass","summary":"Hello."}', truncated: false } });
  });

  it('reads an interrupted turn as stopped', () => {
    expect(observeThread(thread('read-interrupted.json'), INTERRUPTED_TURN)).toEqual({
      observation: { kind: 'present', state: 'stopped', status: 'idle' } });
  });

  it('follows the turn its adapter started, never an earlier one of the same thread', () => {
    const both = thread('read-second-turn-completed.json');
    expect(observeThread(both, SECOND_TURN)).toMatchObject({ observation: { state: 'done' },
      result: { turnId: SECOND_TURN } });
    expect(observeThread(both, INTERRUPTED_TURN)).toEqual({
      observation: { kind: 'present', state: 'stopped', status: 'idle' } });
  });

  it('follows the last turn while the one it started is not recorded yet', () => {
    expect(observeThread(thread('read-in-progress.json'), undefined)).toEqual({
      observation: { kind: 'present', state: 'working', status: 'busy' } });
  });

  it('refuses a thread/read answer that does not have the protocol shape', () => {
    expect(readThread({ thread: { id: THREAD } })).toBeUndefined();
    expect(readThread('garbage')).toBeUndefined();
  });

  // Synthetic states: never captured, built on the 0.155.1 protocol types (ThreadStatus, TurnStatus).
  const synthetic = (status: unknown, turnStatus: string, items: unknown[] = []) => {
    const base = captured('read-in-progress.json') as { result: { thread: Record<string, unknown> } };
    const turns = [{ id: TURN, items, itemsView: 'full', status: turnStatus, error: null, startedAt: 1,
      completedAt: null, durationMs: null }];
    const parsed = readThread({ thread: { ...base.result.thread, status, turns } });
    if (parsed === undefined) throw new Error('synthetic thread does not parse');
    return parsed;
  };

  it('surfaces an approval asked despite the never policy as a person to wait for, never answered', () => {
    expect(observeThread(synthetic({ type: 'active', activeFlags: ['waitingOnApproval'] }, 'inProgress'), TURN))
      .toEqual({ observation: { kind: 'present', state: 'blocked', status: 'waiting',
        waitingFor: 'an approval, although the run was started with approvalPolicy never' } });
    expect(observeThread(synthetic({ type: 'active', activeFlags: ['waitingOnUserInput'] }, 'inProgress'), TURN))
      .toMatchObject({ observation: { state: 'blocked', waitingFor: 'user input' } });
  });

  it('reads a failed turn or a thread in system error as failed', () => {
    expect(observeThread(synthetic({ type: 'idle' }, 'failed'), TURN).observation)
      .toEqual({ kind: 'present', state: 'failed', status: 'idle' });
    expect(observeThread(synthetic({ type: 'systemError' }, 'inProgress'), TURN).observation)
      .toEqual({ kind: 'present', state: 'failed' });
  });

  it('takes the last final answer, or the last message when none is marked final', () => {
    const message = (text: string, phase: string | null) => ({ type: 'agentMessage', id: text, text, phase,
      memoryCitation: null, delivery: null, questions: null });
    const done = synthetic({ type: 'idle' }, 'completed', [message('plan', 'commentary'), message('answer', 'final_answer'),
      message('after', 'commentary')]);
    expect(observeThread(done, TURN).result?.text).toBe('answer');
    expect(observeThread(synthetic({ type: 'idle' }, 'completed', [message('only', null)]), TURN).result?.text)
      .toBe('only');
    expect(observeThread(synthetic({ type: 'idle' }, 'completed', []), TURN).result).toBeUndefined();
  });

  it('bounds the final answer in bytes and cuts it on a character boundary', () => {
    const long = `${'a'.repeat(MAX_RESULT_BYTES - 1)}é and more`;
    const message = { type: 'agentMessage', id: 'm', text: long, phase: 'final_answer', memoryCitation: null,
      delivery: null, questions: null };
    const result = observeThread(synthetic({ type: 'idle' }, 'completed', [message]), TURN).result;
    expect(result?.truncated).toBe(true);
    expect(result?.text).toBe('a'.repeat(MAX_RESULT_BYTES - 1));
  });
});

describe('the socket and the environment of an app-server', () => {
  it('names the socket from the run, short enough for every Unix socket address', () => {
    const path = socketPathFor('/Users/someone/.void-machine/s', 'vm-run_0f0e0d0c-0b0a-4908-8706-050403020100');
    expect(path).toMatch(/^\/Users\/someone\/\.void-machine\/s\/[0-9a-f]{16}\.sock$/);
    expect(socketPathFor('/Users/someone/.void-machine/s', 'vm-run_0f0e0d0c-0b0a-4908-8706-050403020100')).toBe(path);
    expect(Buffer.byteLength(path ?? '', 'utf8')).toBeLessThanOrEqual(SOCKET_PATH_MAX_BYTES);
  });

  it('refuses a directory too deep for a socket address, or one the WebSocket address cannot carry', () => {
    expect(socketPathFor(`/${'d'.repeat(90)}`, 'vm-run_1')).toBeUndefined();
    expect(socketPathFor('/Users/a:b/.void-machine/s', 'vm-run_1')).toBeUndefined();
  });

  it('keeps what Codex needs from the environment and drops the credentials of other tools', () => {
    const env = childEnvironment({ PATH: '/bin', HOME: '/home/user', CODEX_HOME: '/home/user/.codex',
      OPENAI_API_KEY: 'sk-kept', GH_TOKEN: 'gho-dropped', GITHUB_TOKEN: 'dropped', NPM_TOKEN: 'dropped',
      AWS_SECRET_ACCESS_KEY: 'dropped', DB_PASSWORD: 'dropped', VOID_MISSION_ID: 'mis_x' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/user', CODEX_HOME: '/home/user/.codex',
      OPENAI_API_KEY: 'sk-kept', VOID_MISSION_ID: 'mis_x' });
  });

  it('parses the Codex version and derives a handle from the thread id', () => {
    expect(parseCodexVersion('codex-cli 0.155.1\n')).toBe('0.155.1');
    expect(parseCodexVersion('garbage')).toBeUndefined();
    expect(handleOf(THREAD)).toBe('82407fda');
  });
});
