import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { executeDelegationResult, machineRootOf } from './delegation-result.js';

const SESSION = '6d5ea8bb-764f-4463-b733-8b94509eb25e';

function repository(): { main: string; worktree: string; root: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hook-delegation-')));
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  const main = join(base, 'main');
  mkdirSync(main);
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  git(main, 'init', '-q', '-b', 'main');
  git(main, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'root');
  const worktree = join(base, 'ticket');
  git(main, 'worktree', 'add', '-q', '-b', 'ticket', worktree);
  return { main, worktree, root: join(main, '.void', 'machine') };
}

function claim(root: string, resultPath: string): void {
  mkdirSync(join(root, 'agents', 'sessions'), { recursive: true });
  writeFileSync(join(root, 'agents', 'sessions', `${SESSION}.json`), JSON.stringify({ schemaVersion: 1, resultPath }));
}

function runDirectory(root: string): string {
  const directory = join(root, 'runs', 'mis_hook-contract', 'agents', 'run_x');
  mkdirSync(directory, { recursive: true });
  return directory;
}

const stop = (cwd: string, message: unknown = 'No blocking finding.') =>
  ({ hook_event_name: 'Stop', session_id: SESSION, cwd, last_assistant_message: message });

describe('the delegation-result Stop hook', () => {
  it('resolves the machine directory of the main checkout from a worktree', () => {
    const { worktree, root } = repository();
    expect(machineRootOf(worktree)).toBe(root);
  });

  it('writes the final message where the claim of its session points', () => {
    const { worktree, root } = repository();
    const resultPath = join(runDirectory(root), 'result.json');
    claim(root, resultPath);
    expect(executeDelegationResult(stop(worktree), 1_234)).toMatchObject({ status: 'ok' });
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toEqual({ schemaVersion: 1, sessionId: SESSION,
      recordedAt: 1_234, lastAssistantMessage: 'No blocking finding.', truncated: false });
    expect(readdirSync(join(root, 'runs', 'mis_hook-contract', 'agents', 'run_x'))).toEqual(['result.json']);
  });

  it('does nothing for a session no run claims while no run waits for its binding', () => {
    const { worktree, root } = repository();
    expect(executeDelegationResult(stop(worktree), 1)).toMatchObject({ status: 'skipped' });
    expect(existsSync(root)).toBe(false);
  });

  it('parks the message of an unclaimed session while a run waits for its binding', () => {
    const { worktree, root } = repository();
    mkdirSync(join(root, 'agents', 'pending'), { recursive: true });
    writeFileSync(join(root, 'agents', 'pending', 'run_x'), '');
    expect(executeDelegationResult(stop(worktree), 7)).toMatchObject({ status: 'ok', details: { parked: true } });
    expect(JSON.parse(readFileSync(join(root, 'agents', 'parked', `${SESSION}.json`), 'utf8')))
      .toMatchObject({ recordedAt: 7, lastAssistantMessage: 'No blocking finding.' });
  });

  it('bounds the recorded message and says it was cut', () => {
    const { worktree, root } = repository();
    const resultPath = join(runDirectory(root), 'result.json');
    claim(root, resultPath);
    executeDelegationResult(stop(worktree, 'é'.repeat(200_000)), 1);
    const stored = JSON.parse(readFileSync(resultPath, 'utf8'));
    expect(stored.truncated).toBe(true);
    expect(Buffer.byteLength(stored.lastAssistantMessage, 'utf8')).toBeLessThanOrEqual(262_144);
  });

  it.each([
    ['a session id that is not a UUID', { session_id: '../../etc' }],
    ['no working directory', { cwd: 42 }],
  ])('ignores an input with %s', (_case, change) => {
    const { worktree, root } = repository();
    claim(root, join(runDirectory(root), 'result.json'));
    expect(executeDelegationResult({ ...stop(worktree), ...change }, 1)).toMatchObject({ status: 'skipped' });
    expect(existsSync(join(root, 'runs', 'mis_hook-contract', 'agents', 'run_x', 'result.json'))).toBe(false);
  });

  it.each([
    ['outside the runs directory', (root: string) => join(root, '..', 'escaped.json')],
    ['to another file name', (root: string) => join(runDirectory(root), 'run.json')],
  ])('refuses a claim that points %s', (_case, target) => {
    const { worktree, root } = repository();
    claim(root, target(root));
    expect(executeDelegationResult(stop(worktree), 1)).toMatchObject({ status: 'skipped' });
    expect(existsSync(target(root))).toBe(false);
  });

  it('refuses a run directory that is a symbolic link', () => {
    const { main, worktree, root } = repository();
    const elsewhere = join(main, 'elsewhere');
    mkdirSync(elsewhere);
    mkdirSync(join(root, 'runs', 'mis_hook-contract', 'agents'), { recursive: true });
    symlinkSync(elsewhere, join(root, 'runs', 'mis_hook-contract', 'agents', 'run_x'));
    claim(root, join(root, 'runs', 'mis_hook-contract', 'agents', 'run_x', 'result.json'));
    expect(executeDelegationResult(stop(worktree), 1)).toMatchObject({ status: 'skipped' });
    expect(readdirSync(elsewhere)).toEqual([]);
  });
});
