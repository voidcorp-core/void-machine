import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, onTestFinished } from 'vitest';
import { delegatedSession } from '../../packages/hook-runner/src/lifecycle/delegation-kernel.js';
import { executeDelegationResult } from '../../packages/hook-runner/src/lifecycle/delegation-result.js';
import { createRunRegistry, resolveMachineRoot } from '../../packages/void-machine/src/adapters/store/run-registry.js';

// The kernel writes the claim and the hook, shipped in a separately built bundle, follows it.
// This pins that one contract from both sides, from a worktree placed outside the checkout.

const SESSION = '6d5ea8bb-764f-4463-b733-8b94509eb25e';
const RUN = 'run_0f0e0d0c-0b0a-4908-8706-050403020100';

function checkoutWithWorktree(): { main: string; worktree: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'delegation-claim-')));
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  const main = join(base, 'main');
  mkdirSync(main);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: main, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'root');
  const worktree = join(base, 'review');
  git('worktree', 'add', '-q', '--detach', worktree);
  return { main, worktree };
}

async function dispatchedRun(worktree: string) {
  const root = resolveMachineRoot(worktree);
  if (!root.ok) throw new Error(root.cause);
  const registry = createRunRegistry({ machineRoot: root.root });
  await registry.create({ runId: RUN, missionId: 'mis_claim-contract', name: `vm-${RUN}`, role: 'review',
    runtime: 'claude', cwd: worktree, agentType: 'independent-code-reviewer', ticket: undefined,
    model: undefined }, { seq: 1, at: 1, to: 'admitted', event: 'admitted', cause: 'c', action: 'a' }, 'brief');
  return registry;
}

const stop = (cwd: string, text: string) =>
  ({ hook_event_name: 'Stop', session_id: SESSION, cwd, last_assistant_message: text });

it('delivers the final message of a bound session to the run that claimed it', async () => {
  const { worktree } = checkoutWithWorktree();
  const registry = await dispatchedRun(worktree);
  await registry.bind(RUN, { handle: '6d5ea8bb', sessionId: SESSION });
  expect(executeDelegationResult(stop(worktree, 'Verdict: pass.'), 50)).toMatchObject({ status: 'ok' });
  expect(await registry.result(RUN)).toEqual({ sessionId: SESSION, recordedAt: 50, pendingWork: 0,
    text: 'Verdict: pass.', truncated: false });
});

it('delivers a message recorded before the bind once the session is bound', async () => {
  const { worktree } = checkoutWithWorktree();
  const registry = await dispatchedRun(worktree);
  expect(executeDelegationResult(stop(worktree, 'Early verdict.'), Date.now()))
    .toMatchObject({ status: 'ok', details: { parked: true } });
  await registry.bind(RUN, { handle: '6d5ea8bb', sessionId: SESSION });
  expect(await registry.result(RUN)).toMatchObject({ text: 'Early verdict.' });
});

it('recognizes a session the kernel launched, before and after its binding, as a delegated caller', async () => {
  const { main, worktree } = checkoutWithWorktree();
  const root = join(main, '.void', 'machine');
  const registry = await dispatchedRun(worktree);
  expect(delegatedSession(root, SESSION)).toBe(false);
  await registry.bind(RUN, { handle: '6d5ea8bb' });
  expect(delegatedSession(root, SESSION)).toBe(true);
  expect(delegatedSession(root, '0d5ea8bb-764f-4463-b733-8b94509eb25e')).toBe(false);
  await registry.bind(RUN, { handle: '6d5ea8bb', sessionId: SESSION });
  expect(delegatedSession(root, SESSION)).toBe(true);
});
