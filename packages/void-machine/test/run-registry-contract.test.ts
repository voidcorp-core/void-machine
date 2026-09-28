import { execFileSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { createRunRegistry, resolveMachineRoot } from '../src/adapters/store/run-registry.js';
import type { RunTransition } from '../src/core/delegation.js';

const MISSION = 'mis_registry-contract';
const RUN = 'run_0f0e0d0c-0b0a-4908-8706-050403020100';
const SESSION = '6d5ea8bb-764f-4463-b733-8b94509eb25e';
const admitted: RunTransition = { seq: 1, at: 100, to: 'admitted', event: 'admitted', cause: 'c', action: 'a' };
const dispatched: RunTransition = { seq: 2, at: 101, from: 'admitted', to: 'dispatched',
  event: 'dispatched', cause: 'c', action: 'a' };

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

/** A main checkout and one linked worktree placed outside it, like a ticket worktree. */
function repository(): { main: string; worktree: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'vm-registry-')));
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  const main = join(base, 'main');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  git(main, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'root');
  const worktree = join(base, 'worktrees', 'ticket');
  git(main, 'worktree', 'add', '-q', '-b', 'ticket', worktree);
  return { main, worktree };
}

function registryIn(cwd: string, options: { now?: () => number; isAlive?: (pid: number) => boolean } = {}) {
  const root = resolveMachineRoot(cwd);
  if (!root.ok) throw new Error(root.cause);
  return { root: root.root, registry: createRunRegistry({ machineRoot: root.root, ...options }) };
}

const run = (cwd: string) => ({ runId: RUN, missionId: MISSION, name: `vm-${RUN}`, role: 'review' as const,
  runtime: 'claude' as const, cwd, agentType: 'independent-code-reviewer', ticket: 'DEV-923', model: undefined });

describe('where runs are recorded', () => {
  it('records a run launched from a worktree under the main checkout, via the common Git directory', async () => {
    const { main, worktree } = repository();
    const { root, registry } = registryIn(worktree);
    expect(root).toBe(join(main, '.void', 'machine'));
    const brief = await registry.create(run(worktree), admitted, 'Review the diff.');
    expect(brief.path.startsWith(join(main, '.void', 'machine', 'runs', MISSION, 'agents', RUN))).toBe(true);
    expect(readFileSync(brief.path, 'utf8')).toBe('Review the diff.');
    expect(statSync(brief.path).mode & 0o777).toBe(0o600);
    expect(existsSync(join(worktree, '.void'))).toBe(false);
    expect(await registry.read(RUN)).toMatchObject({ runId: RUN, missionId: MISSION, transitions: [admitted] });
  });

  it('refuses a directory outside any Git repository', () => {
    const outside = mkdtempSync(join(tmpdir(), 'vm-outside-'));
    onTestFinished(() => rmSync(outside, { recursive: true, force: true }));
    expect(resolveMachineRoot(outside)).toMatchObject({ ok: false, action: expect.stringContaining('git') });
  });
});

describe('transitions', () => {
  it('lets exactly one writer record each sequence number', async () => {
    const { main } = repository();
    const { registry } = registryIn(main);
    await registry.create(run(main), admitted, 'brief');
    const outcomes = await Promise.all([registry.append(RUN, dispatched),
      registry.append(RUN, { ...dispatched, to: 'failed' })]);
    expect(outcomes.filter((outcome) => outcome === 'appended')).toHaveLength(1);
    expect((await registry.read(RUN))?.transitions).toHaveLength(2);
    expect(await registry.append(RUN, { ...dispatched, seq: 4 })).toBe('conflict');
  });

  it('lists the runs of a mission and every run recorded', async () => {
    const { main } = repository();
    const { registry } = registryIn(main);
    await registry.create(run(main), admitted, 'brief');
    expect((await registry.list(MISSION)).map((record) => record.runId)).toEqual([RUN]);
    expect(await registry.list('mis_other-mission')).toEqual([]);
    expect(await registry.runIds()).toEqual([RUN]);
  });
});

describe('binding and results', () => {
  function result(recordedAt: number, text = 'LGTM') {
    return JSON.stringify({ schemaVersion: 1, sessionId: SESSION, recordedAt, lastAssistantMessage: text,
      truncated: false });
  }

  it('claims the session with the result path the hook must write, and reads that result back', async () => {
    const { main } = repository();
    const { root, registry } = registryIn(main);
    await registry.create(run(main), admitted, 'brief');
    expect(existsSync(join(root, 'agents', 'pending', RUN))).toBe(true);
    await registry.bind(RUN, { handle: '6d5ea8bb', sessionId: SESSION });
    const claim = JSON.parse(readFileSync(join(root, 'agents', 'sessions', `${SESSION}.json`), 'utf8'));
    expect(claim).toEqual({ schemaVersion: 1,
      resultPath: join(root, 'runs', MISSION, 'agents', RUN, 'result.json') });
    expect(existsSync(join(root, 'agents', 'pending', RUN))).toBe(false);
    writeFileSync(claim.resultPath, result(500));
    expect(await registry.result(RUN)).toEqual({ sessionId: SESSION, recordedAt: 500, text: 'LGTM', truncated: false });
    expect((await registry.read(RUN))?.binding).toEqual({ handle: '6d5ea8bb', sessionId: SESSION });
  });

  it('adopts a result the hook parked before the session was bound', async () => {
    const { main } = repository();
    const { root, registry } = registryIn(main);
    await registry.create(run(main), admitted, 'brief');
    mkdirSync(join(root, 'agents', 'parked'), { recursive: true });
    writeFileSync(join(root, 'agents', 'parked', `${SESSION}.json`), result(400, 'early'));
    await registry.bind(RUN, { handle: '6d5ea8bb', sessionId: SESSION });
    expect(await registry.result(RUN)).toMatchObject({ text: 'early', recordedAt: 400 });
  });

  it('reads no result from a symbolic link, an oversized file or a malformed document', async () => {
    const { main } = repository();
    const { root, registry } = registryIn(main);
    await registry.create(run(main), admitted, 'brief');
    const path = join(root, 'runs', MISSION, 'agents', RUN, 'result.json');
    const elsewhere = join(main, 'elsewhere.json');
    writeFileSync(elsewhere, result(1));
    symlinkSync(elsewhere, path);
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(await registry.result(RUN)).toBeUndefined();
    rmSync(path);
    writeFileSync(path, result(1, 'x'.repeat(2_200_000)));
    expect(await registry.result(RUN)).toBeUndefined();
    writeFileSync(path, '{"schemaVersion": 1}');
    expect(await registry.result(RUN)).toBeUndefined();
  });

  it('writes each next message as its own private instruction file', async () => {
    const { main } = repository();
    const { registry } = registryIn(main);
    const brief = await registry.create(run(main), admitted, 'brief');
    const first = await registry.writeMessage(RUN, 'Give the final verdict.');
    const second = await registry.writeMessage(RUN, 'Again.');
    expect(first.directory).toBe(brief.directory);
    expect(first.path).not.toBe(second.path);
    expect(readFileSync(second.path, 'utf8')).toBe('Again.');
  });
});

describe('the mission lock', () => {
  it('admits one holder, and a second only after release', async () => {
    const { main } = repository();
    const { registry } = registryIn(main);
    const first = await registry.lock(MISSION, 'w1');
    expect(first).toBeDefined();
    expect(await registry.lock(MISSION, 'w2')).toBeUndefined();
    await first?.release();
    expect(await registry.lock(MISSION, 'w2')).toBeDefined();
  });

  it('takes over a lock whose holder is dead or whose lease has expired', async () => {
    const { main } = repository();
    let now = 1_000;
    const dead = registryIn(main, { isAlive: () => false, now: () => now });
    expect(await dead.registry.lock(MISSION, 'w1')).toBeDefined();
    expect(await dead.registry.lock(MISSION, 'w2')).toBeDefined();
    const alive = registryIn(main, { isAlive: () => true, now: () => now });
    expect(await alive.registry.lock(MISSION, 'w3')).toBeUndefined();
    now += 60_001;
    expect(await alive.registry.lock(MISSION, 'w3')).toBeDefined();
  });
});
