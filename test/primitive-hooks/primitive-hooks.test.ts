/**
 * Tests for the lifecycle-event hooks added beyond PreToolUse:
 *   - auto-format.sh        (PostToolUse, non-blocking, fail-open)
 *   - activation-meter.sh   (universal PreToolUse adapter; canonical run events)
 *   - sessionstart-context.sh (SessionStart, injects additionalContext; also
 *                              covers post-compaction via source=compact)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const H = (n: string) => resolve(process.cwd(), `packages/core/hooks/${n}`);

function run(hook: string, json: string, env?: Record<string, string>) {
  const proc = spawnSync('bash', [H(hook)], {
    input: json,
    encoding: 'utf8',
    env: { ...process.env, ...(env ?? {}) },
  });
  return { code: proc.status ?? 1, stdout: proc.stdout ?? '' };
}

function runEvents(root: string): Record<string, unknown>[] {
  const runs = join(root, '.void', 'machine', 'runs');
  const mission = readdirSync(runs)[0];
  if (mission === undefined) return [];
  const raw = readFileSync(join(runs, mission, 'events.jsonl'), 'utf8').trim();
  return raw === ''
    ? []
    : raw.split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('auto-format.sh', () => {
  it('exits 0 and skips a non-code file', () => {
    expect(run('auto-format.sh', '{"tool_name":"Edit","tool_input":{"file_path":"README.md"}}').code).toBe(0);
  });
  it('exits 0 on a non-edit tool', () => {
    expect(run('auto-format.sh', '{"tool_name":"Read","tool_input":{"file_path":"a.ts"}}').code).toBe(0);
  });
});

describe('activation-meter.sh', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'void-meter-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('records a Skill invocation in the canonical run and never recreates legacy logs', () => {
    const r = run('activation-meter.sh', '{"tool_name":"Skill","tool_input":{"skill":"tdd"}}', {
      CLAUDE_PROJECT_DIR: dir,
      VOID_GLOBAL_DIR: join(dir, "_global"),
    });
    expect(r.code).toBe(0);
    expect(runEvents(dir)[0]).toMatchObject({
      schemaVersion: 1,
      seq: 1,
      kind: 'runtime.tool.started',
      subject: 'skill:tdd',
    });
    expect(existsSync(join(dir, '.void', 'machine', 'activations.jsonl'))).toBe(false);
    expect(existsSync(join(dir, '.void', 'machine', 'usage.log'))).toBe(false);
  });

  it('records a non-Skill tool without persisting its command', () => {
    run('activation-meter.sh', '{"tool_name":"Bash","tool_input":{"command":"ls"}}', {
      CLAUDE_PROJECT_DIR: dir,
      VOID_GLOBAL_DIR: join(dir, "_global"),
    });
    const events = runEvents(dir);
    expect(events[0]).toMatchObject({
      kind: 'runtime.tool.started',
      subject: 'tool:Bash',
      payload: { category: 'tool', tool: 'Bash' },
    });
    expect(JSON.stringify(events)).not.toContain('"command"');
  });

  it('appends one valid sequenced canonical event', () => {
    const payload = JSON.stringify({
      tool_name: 'Skill',
      tool_input: { skill: 'harness:tdd' },
      hook_event_name: 'PreToolUse',
      session_id: 'test-session-1',
    });
    const r = run('activation-meter.sh', payload, { CLAUDE_PROJECT_DIR: dir, VOID_GLOBAL_DIR: join(dir, "_global") });
    expect(r.code).toBe(0);
    const events = runEvents(dir);
    expect(events).toHaveLength(1);
    const ev = events[0] ?? {};
    expect(ev).toMatchObject({
      schemaVersion: 1,
      seq: 1,
      kind: 'runtime.tool.started',
      subject: 'skill:harness:tdd',
    });
    expect(typeof ev.ts).toBe('string');
  });

  it('exits 0 even when .void dir is unwritable (best-effort)', () => {
    const r = run(
      'activation-meter.sh',
      '{"tool_name":"Skill","tool_input":{"skill":"harness:tdd"}}',
      { CLAUDE_PROJECT_DIR: '/dev/null/nonexistent' },
    );
    expect(r.code).toBe(0);
  });
});

describe('context-injecting hooks', () => {
  it('sessionstart emits SessionStart additionalContext JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-sessionstart-'));
    try {
      const r = run(
        'sessionstart-context.sh',
        '{"hook_event_name":"SessionStart","source":"startup"}',
        { CLAUDE_PROJECT_DIR: root, VOID_GLOBAL_DIR: join(root, '.void', 'global') },
      );
      expect(r.code).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.hookSpecificOutput.hookEventName).toBe('SessionStart');
      expect(out.hookSpecificOutput.additionalContext).toContain('floor');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

});
