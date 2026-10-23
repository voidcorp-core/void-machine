import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let workspace = '';
let hook = '';
let invocation = 0;
beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'read-loop-test-'));
  hook = join(workspace, 'hook.mjs');
  await build({ entryPoints: [resolve(import.meta.dirname, '../cli.ts')], bundle: true,
    platform: 'node', format: 'esm', target: 'node24', outfile: hook,
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
});
afterAll(() => rmSync(workspace, { recursive: true, force: true }));
function project(): string { return mkdtempSync(join(workspace, 'project-')); }
function call(root: string, overrides: Readonly<Record<string, unknown>> = {}, runtime = 'claude') {
  const result = spawnSync(process.execPath, [hook, 'outcome', runtime], {
    cwd: root, env: { ...process.env, VOID_PROJECT_ROOT: root, VOID_MISSION_ID: 'mis_read_loop_test_1234' }, encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 'session-one',
      tool_use_id: `call-${++invocation}`, tool_name: 'Read',
      tool_input: { file_path: '/project/example.ts', offset: 1 },
      tool_response: { type: 'text', file: { content: 'unchanged' } }, ...overrides }),
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.signal).toBeNull();
  return { output: result.stdout === '' ? undefined : JSON.parse(result.stdout), stderr: result.stderr };
}
function warm(root: string, overrides: Readonly<Record<string, unknown>> = {}) {
  for (let count = 0; count < 3; count++) expect(call(root, overrides).output).toBeUndefined();
}
const statePath = (root: string) => join(root, '.void/machine/read-loop/state.json');

describe('read-loop advisory hook', () => {
  it('wires both completion streams and Claude failure resets to the same advisory handler', () => {
    for (const [runtime, manifest] of [['claude', '.claude-plugin/plugin.json'], ['codex', 'codex/hooks.json']]) {
      const value = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../core', manifest ?? ''), 'utf8'));
      const commands = (event: string): string[] => (value.hooks[event] ?? []).flatMap(
        (entry: { hooks: { command: string }[] }) => entry.hooks.map(item => item.command));
      expect(commands('PostToolUse').filter(command => command.endsWith(`outcome ${runtime}`))).toHaveLength(1);
      expect(commands('PostToolUseFailure').filter(command => command.endsWith(`outcome ${runtime}`)))
        .toHaveLength(runtime === 'claude' ? 1 : 0);
    }
  });
  it('records one normal outcome and advice receipt per call, and failure resets without a false completion', () => {
    const root = project(); warm(root);
    expect(call(root).output).toBeDefined();
    call(root, { hook_event_name: 'PostToolUseFailure', error: 'transient', tool_response: undefined });
    const events = readFileSync(join(root, '.void/machine/runs/mis_read_loop_test_1234/events.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line));
    expect(events.filter(event => event.kind === 'runtime.tool.completed')).toHaveLength(4);
    const receipts = events.filter(event => event.kind === 'hook.completed');
    expect(receipts).toHaveLength(5);
    expect(receipts.every(event => event.subject === 'hook:outcome-meter')).toBe(true);
    expect(receipts.filter(event => event.payload.warned === true)).toHaveLength(1);
    expect(call(root).output).toBeUndefined();
  });
  it.each(['claude', 'codex'])('warns once at four equivalent successful reads without blocking %s', runtime => {
    const root = project();
    for (let count = 0; count < 3; count++) expect(call(root, {}, runtime).output).toBeUndefined();
    const warning = call(root, { tool_input: { offset: 1, file_path: '/project/example.ts' } }, runtime).output;
    expect(warning).toEqual({ hookSpecificOutput: { hookEventName: 'PostToolUse',
      additionalContext: expect.stringContaining('4 consecutive identical read results') } });
    expect(warning.decision).toBeUndefined();
    expect(warning.continue).toBeUndefined();
    expect(call(root, {}, runtime).output).toBeUndefined();
  });
  it('resets on changed output or argument, preserving array order and path spelling', () => {
    for (const changed of [
      { tool_response: { type: 'text', file: { content: 'new information' } } },
      { tool_input: { file_path: '/project/./example.ts', offset: 1 } },
      { tool_input: { paths: ['b', 'a'] } },
    ]) {
      const root = project(); warm(root);
      expect(call(root, changed).output).toBeUndefined();
      expect(call(root).output).toBeUndefined();
    }
  });
  it.each([
    { hook_event_name: 'PostToolUseFailure', error: 'transient private error', tool_response: undefined },
    { tool_response: { is_error: true, content: 'private error' } },
    { tool_response: { isError: true } },
    { tool_response: { success: false } },
    { tool_response: { error: 'private error' } },
    { tool_response: { interrupted: true } },
    { tool_response: {} }, { tool_response: undefined }, { tool_response: null },
  ])('resets incomplete or explicitly failed observations %#', failed => {
    const root = project(); warm(root);
    expect(call(root, failed).output).toBeUndefined();
    expect(call(root).output).toBeUndefined();
  });
  it('isolates sessions, runtimes and project roots; refuses missing identity', () => {
    const root = project(); warm(root);
    expect(call(root, { session_id: 'session-two' }).output).toBeUndefined();
    expect(call(root, {}, 'codex').output).toBeUndefined();
    expect(call(project()).output).toBeUndefined();
    const missing = call(root, { session_id: '' });
    expect(missing.output).toBeUndefined();
    expect(missing.stderr).toContain('READ_LOOP_UNAVAILABLE');
    expect(call(root).output).toBeDefined();
  });
  it.each(['Bash', 'exec_command', 'write_stdin', 'wait', 'TaskOutput', 'mcp__jobs__status', 'Edit'])
    ('never warns or classifies %s and resets the consecutive stream', tool_name => {
      const root = project(); warm(root);
      for (let count = 0; count < 5; count++) expect(call(root, { tool_name }).output).toBeUndefined();
      expect(call(root).output).toBeUndefined();
    });
  it('deduplicates the same tool invocation without confusing repeated calls', () => {
    const root = project();
    for (let count = 0; count < 5; count++) expect(call(root, { tool_use_id: 'same-call' }).output).toBeUndefined();
    expect(call(root).output).toBeUndefined();
    expect(call(root).output).toBeUndefined();
    expect(call(root).output).toBeDefined();
  });
  it('persists bounded digests through the CLI without raw private content', () => {
    const root = project();
    const secret = 'private-content-canary';
    call(root, { session_id: secret, tool_input: { file_path: secret }, tool_response: { content: secret } });
    expect(existsSync(statePath(root))).toBe(true);
    expect(readFileSync(statePath(root), 'utf8')).not.toContain(secret);
    expect(statSync(statePath(root)).size).toBeLessThan(32 * 1024);
  });
  it('degrades safely on corrupt, oversized, locked or symlink state without leaking content', () => {
    for (const problem of ['corrupt', 'oversized', 'locked', 'symlink']) {
      const root = project(); const directory = join(root, '.void/machine/read-loop');
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const privateText = 'private-state-canary';
      if (problem === 'locked') writeFileSync(join(directory, 'state.lock'), '');
      else if (problem === 'symlink') {
        const outside = join(workspace, `outside-${invocation}`); writeFileSync(outside, privateText);
        symlinkSync(outside, statePath(root));
      } else writeFileSync(statePath(root), problem === 'oversized' ? 'x'.repeat(32769) : privateText);
      const result = call(root);
      expect(result.output).toBeUndefined();
      expect(result.stderr).toContain('READ_LOOP_UNAVAILABLE');
      expect(result.stderr).not.toContain(privateText);
      if (problem === 'symlink') expect(readFileSync(statePath(root), 'utf8')).toBe(privateText);
    }
  });
  it('does not follow an observed-directory symlink or count oversized/deep inputs', () => {
    const root = project(); const outside = project();
    mkdirSync(join(root, '.void')); symlinkSync(outside, join(root, '.void/machine'));
    expect(call(root).stderr).toContain('READ_LOOP_UNAVAILABLE');
    expect(readdirSync(outside)).toEqual([]);
    const bounded = project(); warm(bounded);
    expect(call(bounded, { tool_response: 'x'.repeat(300_000) }).output).toBeUndefined();
    expect(call(bounded).output).toBeUndefined();
    let nested: unknown = 'leaf';
    for (let level = 0; level < 40; level++) nested = { nested };
    expect(call(bounded, { tool_response: nested }).output).toBeUndefined();
  });
});
