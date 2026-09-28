import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { PRODUCT_IDENTITY } from '../identity.js';
import { delegatedSession, kernelCommand, machineRootOf } from './delegation-kernel.js';

const SESSION = '6d5ea8bb-764f-4463-b733-8b94509eb25e';
const RUN = 'run_0f1e2d3c-4b5a-4968-8776-655443322110';
const MISSION = 'mis_kernel-contract';

function scratch(): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hook-kernel-')));
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  return base;
}

function repository(): { main: string; worktree: string; root: string } {
  const base = scratch();
  const main = join(base, 'main');
  mkdirSync(main);
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  git(main, 'init', '-q', '-b', 'main');
  git(main, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'root');
  const worktree = join(base, 'ticket');
  git(main, 'worktree', 'add', '-q', '-b', 'ticket', worktree);
  return { main, worktree, root: join(main, '.void', 'machine') };
}

/** A run that waits for its binding, launched under `handle`, as `run-registry.ts` writes it. */
function waitingRun(root: string, handle: string, runId = RUN, missionId = MISSION): void {
  mkdirSync(join(root, 'agents', 'pending'), { recursive: true });
  writeFileSync(join(root, 'agents', 'pending', runId), JSON.stringify({ cwd: root, createdAt: 1 }));
  mkdirSync(join(root, 'agents', 'index'), { recursive: true });
  writeFileSync(join(root, 'agents', 'index', `${runId}.json`), JSON.stringify({ missionId }));
  const run = join(root, 'runs', missionId, 'agents', runId);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'run.json'), JSON.stringify({ binding: { handle } }));
}

function executableAt(path: string): void {
  writeFileSync(path, '#!/bin/sh\n');
  chmodSync(path, 0o755);
}

describe('machineRootOf', () => {
  it('resolves the machine directory of the main checkout from a worktree', () => {
    const { worktree, root } = repository();
    expect(machineRootOf(worktree)).toBe(root);
  });

  it('has no machine directory outside a repository', () => {
    expect(machineRootOf(scratch())).toBeUndefined();
  });
});

describe('delegatedSession', () => {
  it('recognizes a session the kernel claimed by its id', () => {
    const root = scratch();
    mkdirSync(join(root, 'agents', 'sessions'), { recursive: true });
    writeFileSync(join(root, 'agents', 'sessions', `${SESSION}.json`), '{}');
    expect(delegatedSession(root, SESSION)).toBe(true);
  });

  it('recognizes a session not yet bound by the handle a waiting run was launched under', () => {
    const root = scratch();
    waitingRun(root, SESSION.slice(0, 8));
    expect(delegatedSession(root, SESSION)).toBe(true);
  });

  it('ignores a waiting run launched under another handle', () => {
    const root = scratch();
    waitingRun(root, 'ffffffff');
    expect(delegatedSession(root, SESSION)).toBe(false);
  });

  it('never follows a pending name or a mission id outside the kernel shapes', () => {
    const root = scratch();
    waitingRun(root, SESSION.slice(0, 8), 'run_x');
    expect(delegatedSession(root, SESSION)).toBe(false);
    const other = scratch();
    waitingRun(other, SESSION.slice(0, 8), RUN, '../escape');
    expect(delegatedSession(other, SESSION)).toBe(false);
  });

  it('treats a machine directory with no agents as no delegation', () => {
    expect(delegatedSession(scratch(), SESSION)).toBe(false);
  });
});

describe('kernelCommand', () => {
  it('prefers the project\'s own void-machine', () => {
    const checkout = scratch();
    mkdirSync(join(checkout, 'node_modules', '.bin'), { recursive: true });
    const local = join(checkout, 'node_modules', '.bin', 'void-machine');
    executableAt(local);
    expect(kernelCommand(checkout, { PATH: '' })).toEqual([local]);
  });

  it('reaches the installed release through npx, pinned to its version', () => {
    const checkout = scratch();
    const npx = join(checkout, 'npx');
    executableAt(npx);
    expect(kernelCommand(checkout, { PATH: checkout, VOID_MACHINE_VERSION: '4.1.0' }))
      .toEqual([npx, '--prefer-offline', '-y', `${PRODUCT_IDENTITY.packageName}@4.1.0`]);
  });

  it('finds no command when the installed version is unknown or npx is missing', () => {
    const checkout = scratch();
    executableAt(join(checkout, 'npx'));
    expect(kernelCommand(checkout, { PATH: checkout })).toBeUndefined();
    expect(kernelCommand(scratch(), { PATH: '', VOID_MACHINE_VERSION: '4.1.0' })).toBeUndefined();
  });
});
