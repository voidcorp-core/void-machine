import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { PRODUCT_IDENTITY } from '../identity.js';
import { executeDelegationCapture } from './delegation-capture.js';

const SESSION = '6d5ea8bb-764f-4463-b733-8b94509eb25e';
const RUN = 'run_0f1e2d3c-4b5a-4968-8776-655443322110';
const HERDR = { HERDR_ENV: '1', PATH: process.env['PATH'] };

/** A main checkout, a ticket worktree, and a fake `void-machine` that records its arguments. */
function project(answer: { readonly code: number; readonly stdout: string } = {
  code: 0, stdout: JSON.stringify({ ok: true, runId: RUN, missionId: 'mis_capture-test', surface: { state: 'open' } }),
}): { main: string; worktree: string; root: string; calls: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hook-capture-')));
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  const main = join(base, 'main');
  mkdirSync(join(main, 'node_modules', '.bin'), { recursive: true });
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  git(main, 'init', '-q', '-b', 'main');
  git(main, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'root');
  const worktree = join(base, 'ticket');
  git(main, 'worktree', 'add', '-q', '-b', 'folpe/dev-928-capture-the-agent-tool', worktree);
  const calls = join(base, 'calls.jsonl');
  const cli = join(main, 'node_modules', '.bin', 'void-machine');
  writeFileSync(cli, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const brief = args[args.indexOf('--brief-file') + 1];
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, brief: fs.readFileSync(brief, 'utf8') }) + '\\n');
process.stdout.write(${JSON.stringify(answer.stdout)} + '\\n');
process.exitCode = ${String(answer.code)};
`);
  chmodSync(cli, 0o755);
  return { main, worktree, root: join(main, '.void', 'machine'), calls };
}

const agentCall = (cwd: string, toolInput: Record<string, unknown> = {}) => ({
  hook_event_name: 'PreToolUse', session_id: SESSION, cwd, tool_name: 'Agent', permission_mode: 'auto',
  tool_input: { description: 'Review the diff', subagent_type: 'general-purpose', prompt: 'Review it.',
    run_in_background: false, ...toolInput },
});

function dispatched(calls: string): { args: string[]; brief: string }[] {
  try {
    return readFileSync(calls, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

const option = (args: readonly string[], name: string) => args[args.indexOf(name) + 1];

describe('the delegation-capture PreToolUse hook', () => {
  it('lets the native subagent run when no multiplexer shows the caller', () => {
    const { worktree, calls } = project();
    const execution = executeDelegationCapture(agentCall(worktree), {});
    expect(execution).toMatchObject({ status: 'skipped', details: { reason: 'no-surface' } });
    expect(execution.output).toBeUndefined();
    expect(dispatched(calls)).toEqual([]);
  });

  it('lets a fork run natively, since it shares the caller\'s context', () => {
    const { worktree, calls } = project();
    expect(executeDelegationCapture(agentCall(worktree, { subagent_type: 'fork' }), HERDR))
      .toMatchObject({ status: 'skipped', details: { reason: 'fork' } });
    expect(dispatched(calls)).toEqual([]);
  });

  it('lets a delegated run delegate natively once the kernel claimed its session', () => {
    const { worktree, root, calls } = project();
    mkdirSync(join(root, 'agents', 'sessions'), { recursive: true });
    writeFileSync(join(root, 'agents', 'sessions', `${SESSION}.json`), JSON.stringify({ schemaVersion: 1 }));
    expect(executeDelegationCapture(agentCall(worktree), HERDR))
      .toMatchObject({ status: 'skipped', details: { reason: 'delegated-caller' } });
    expect(dispatched(calls)).toEqual([]);
  });

  it('lets a delegated run delegate natively before its session is bound, by its launch handle', () => {
    const { worktree, root, calls } = project();
    mkdirSync(join(root, 'agents', 'pending'), { recursive: true });
    writeFileSync(join(root, 'agents', 'pending', RUN), JSON.stringify({ cwd: worktree, createdAt: 1 }));
    mkdirSync(join(root, 'agents', 'index'), { recursive: true });
    writeFileSync(join(root, 'agents', 'index', `${RUN}.json`), JSON.stringify({ missionId: 'mis_capture-test' }));
    const run = join(root, 'runs', 'mis_capture-test', 'agents', RUN);
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, 'run.json'), JSON.stringify({ binding: { handle: SESSION.slice(0, 8) } }));
    expect(executeDelegationCapture(agentCall(worktree), HERDR))
      .toMatchObject({ status: 'skipped', details: { reason: 'delegated-caller' } });
    expect(dispatched(calls)).toEqual([]);
  });

  it('dispatches a supervised run and refuses the native call with its runId and the wait command', () => {
    const { worktree, calls } = project();
    const execution = executeDelegationCapture(agentCall(worktree, { model: 'sonnet' }), HERDR);
    expect(execution).toMatchObject({ status: 'ok', details: { captured: true, role: 'work' } });
    const [call] = dispatched(calls);
    expect(call?.args.slice(0, 1)).toEqual(['agents']);
    expect(call?.args[1]).toBe('dispatch');
    expect(option(call?.args ?? [], '--role')).toBe('work');
    expect(option(call?.args ?? [], '--type')).toBe('general-purpose');
    expect(option(call?.args ?? [], '--model')).toBe('sonnet');
    expect(option(call?.args ?? [], '--ticket')).toBe('DEV-928');
    expect(option(call?.args ?? [], '--cwd')).toBe(worktree);
    expect(call?.brief).toBe('Review it.');
    const output = execution.output?.hookSpecificOutput;
    expect(output).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
    expect(output?.permissionDecisionReason).toContain(RUN);
    expect(output?.permissionDecisionReason).toContain(`agents wait ${RUN}`);
    expect(output?.permissionDecisionReason).toContain(`agents accept ${RUN}`);
    expect(output?.permissionDecisionReason).toContain('with a Bash timeout of 600000 ms');
  });

  it('asks for the wait in the background when the native call was a background one', () => {
    const { worktree } = project();
    const execution = executeDelegationCapture(agentCall(worktree, { run_in_background: true }), HERDR);
    expect(execution.output?.hookSpecificOutput.permissionDecisionReason).toMatch(/in the background/);
  });

  it('dispatches a read-only agent type as a review run', () => {
    const { main, worktree, calls } = project();
    mkdirSync(join(main, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(main, '.claude', 'agents', 'doctrine-critic.md'),
      '---\nname: doctrine-critic\ntools: Read, Grep, Glob, Bash\n---\nJudge.\n');
    writeFileSync(join(main, '.claude', 'agents', 'fixer.md'), '---\nname: fixer\ntools: Read, Edit\n---\nFix.\n');
    executeDelegationCapture(agentCall(worktree, { subagent_type: 'doctrine-critic' }), HERDR);
    executeDelegationCapture(agentCall(worktree, { subagent_type: 'Explore' }), HERDR);
    executeDelegationCapture(agentCall(worktree, { subagent_type: 'fixer' }), HERDR);
    expect(dispatched(calls).map((call) => option(call.args, '--role'))).toEqual(['review', 'review', 'work']);
  });

  it('lets the native subagent run and says why when the kernel refuses the dispatch', () => {
    const { worktree } = project({ code: 1,
      stdout: JSON.stringify({ ok: false, cause: 'no agent named ghost', action: 'check --type' }) });
    const execution = executeDelegationCapture(agentCall(worktree, { subagent_type: 'ghost' }), HERDR);
    expect(execution).toMatchObject({ status: 'degraded', details: { reason: 'dispatch-refused' } });
    expect(execution.output?.hookSpecificOutput.permissionDecision).toBeUndefined();
    expect(execution.output?.hookSpecificOutput.additionalContext).toContain('no agent named ghost');
  });

  it('lets the native subagent run when no void-machine command can be found', () => {
    const { main, worktree } = project();
    rmSync(join(main, 'node_modules'), { recursive: true });
    const execution = executeDelegationCapture(agentCall(worktree), { ...HERDR, PATH: '' });
    expect(execution).toMatchObject({ status: 'degraded', details: { reason: 'no-cli' } });
    expect(execution.output?.hookSpecificOutput.permissionDecision).toBeUndefined();
  });

  it('never widens a coordinator that asks before acting into an auto-mode work run', () => {
    const { worktree, calls } = project();
    const execution = executeDelegationCapture({ ...agentCall(worktree), permission_mode: 'default' }, HERDR);
    expect(execution).toMatchObject({ status: 'degraded', details: { reason: 'caller-permission' } });
    expect(execution.output?.hookSpecificOutput.permissionDecision).toBeUndefined();
    expect(dispatched(calls)).toEqual([]);
  });

  it('reads the tools an agent declares only from its frontmatter', () => {
    const { main, worktree, calls } = project();
    mkdirSync(join(main, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(main, '.claude', 'agents', 'writer.md'), '---\nname: writer\n---\ntools: Read\n');
    executeDelegationCapture(agentCall(worktree, { subagent_type: 'writer' }), HERDR);
    expect(dispatched(calls).map((call) => option(call.args, '--role'))).toEqual(['work']);
  });

  it('lets a native subagent of the caller delegate natively', () => {
    const { worktree, calls } = project();
    expect(executeDelegationCapture({ ...agentCall(worktree), agent_id: 'a1b2' }, HERDR))
      .toMatchObject({ status: 'skipped', details: { reason: 'delegated-caller' } });
    expect(dispatched(calls)).toEqual([]);
  });

  it('reaches the installed release through npx when the project has no void-machine of its own', () => {
    const { main, worktree, calls } = project();
    const bin = join(main, '..', 'bin');
    mkdirSync(bin);
    // The fake npx drops its own options and the package spec, and hands the rest to the recorded CLI.
    writeFileSync(join(bin, 'npx'), `#!/bin/sh\nshift 3\nexec ${join(main, 'node_modules', '.bin', 'void-machine')}.moved "$@"\n`);
    chmodSync(join(bin, 'npx'), 0o755);
    const cli = join(main, 'node_modules', '.bin', 'void-machine');
    writeFileSync(`${cli}.moved`, readFileSync(cli));
    chmodSync(`${cli}.moved`, 0o755);
    rmSync(cli);
    const execution = executeDelegationCapture(agentCall(worktree),
      { ...HERDR, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, VOID_MACHINE_VERSION: '4.1.0' });
    expect(execution).toMatchObject({ status: 'ok' });
    expect(dispatched(calls)).toHaveLength(1);
    expect(execution.output?.hookSpecificOutput.permissionDecisionReason).toContain(`--prefer-offline -y ${PRODUCT_IDENTITY.packageName}@4.1.0 agents wait`);
  });

  it('ignores anything that is not an Agent call with a prompt', () => {
    const { worktree } = project();
    expect(executeDelegationCapture({ ...agentCall(worktree), tool_name: 'Bash' }, HERDR))
      .toMatchObject({ status: 'skipped', details: { reason: 'not-an-agent-call' } });
    expect(executeDelegationCapture(agentCall(worktree, { prompt: 42 }), HERDR))
      .toMatchObject({ status: 'skipped', details: { reason: 'not-an-agent-call' } });
  });
});
