import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'outcome-meter.sh');
const BASH = process.env.SHELL?.includes('bash') ? process.env.SHELL : '/opt/homebrew/bin/bash';

function runHook(
  payload: Record<string, unknown>,
  env: Record<string, string> = {},
): { dir: string; events: Record<string, unknown>[] } {
  const dir = mkdtempSync(join(tmpdir(), 'out-meter-'));
  execFileSync(BASH, [script], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env },
  });
  const runs = join(dir, '.void', 'machine', 'runs');
  const mission = existsSync(runs)
    ? readdirSync(runs)[0]
    : undefined;
  const path = mission === undefined
    ? ''
    : join(runs, mission, 'events.jsonl');
  const raw = path !== '' && existsSync(path)
    ? readFileSync(path, 'utf8').trim()
    : '';
  const events = raw === ''
    ? []
    : raw.split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
  return { dir, events };
}

const post = (
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResponse?: unknown,
): Record<string, unknown> => ({
  hook_event_name: 'PostToolUse',
  session_id: 'sess-1',
  tool_name: toolName,
  tool_input: toolInput,
  ...(toolResponse !== undefined ? { tool_response: toolResponse } : {}),
});

// The compatibility wrapper has no runtime identity in these fixtures. Its new
// advice receipt must therefore report degraded, while preserving the real tool outcome.
function completion(events: Record<string, unknown>[]): Record<string, unknown> | undefined {
  expect(events).toHaveLength(2);
  const receipts = events.filter(event => event.kind === 'hook.completed');
  const outcomes = events.filter(event => event.kind === 'runtime.tool.completed');
  expect(receipts).toHaveLength(1);
  expect(outcomes).toHaveLength(1);
  expect(receipts[0]).toMatchObject({
    schemaVersion: 1, seq: 1, source: 'runtime:unknown', subject: 'hook:outcome-meter',
    payload: { status: 'degraded', reason: 'read-loop-unavailable' },
  });
  expect(outcomes[0]).toMatchObject({ schemaVersion: 1, seq: 2, source: 'runtime:unknown' });
  return outcomes[0];
}

describe('outcome-meter', () => {
  it('records a successful Skill completion as status=ok', () => {
    const { events } = runHook(post('Skill', { skill: 'harness:tdd' }, { success: true }));
    expect(completion(events)).toMatchObject({
      subject: 'skill:harness:tdd',
      payload: { status: 'ok' },
    });
  });

  it('derives status=error from an is_error tool_response', () => {
    const { events } = runHook(post('Bash', { command: 'x' }, { is_error: true }));
    expect(completion(events)).toMatchObject({
      subject: 'tool:Bash',
      payload: { status: 'error' },
    });
  });

  it('derives status=error from a non-null error field', () => {
    const { events } = runHook(post('Bash', { command: 'x' }, { error: 'boom' }));
    expect(completion(events)).toMatchObject({ payload: { status: 'error' } });
  });

  it('records status=unknown when there is no tool_response to judge', () => {
    const { events } = runHook(post('Read', { file_path: 'a.ts' }));
    expect(completion(events)).toMatchObject({
      subject: 'tool:Read',
      payload: { status: 'unknown' },
    });
  });

  it('classifies an Agent spawn as kind=agent using subagent_type', () => {
    const { events } = runHook(post('Agent', { subagent_type: 'Explore' }, {}));
    expect(completion(events)).toMatchObject({
      subject: 'agent:Explore',
      payload: { status: 'ok' },
    });
  });

  it('writes a Stop marker carrying the session id', () => {
    const { events } = runHook({ hook_event_name: 'Stop', session_id: 'sess-1' });
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'runtime.session.stopped',
        subject: 'runtime:unknown',
        payload: {},
      }),
    ]);
  });

  it('never writes tool content or command text (privacy)', () => {
    const { dir, events } = runHook(post('Bash', { command: 'echo SECRET_TOKEN' }, { stdout: 'SECRET_TOKEN' }));
    expect(JSON.stringify(events)).not.toContain('SECRET_TOKEN');
    expect(existsSync(join(dir, '.void', 'outcomes.jsonl'))).toBe(false);
  });
});
