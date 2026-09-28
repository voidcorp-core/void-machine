import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { resolveInstall } from './context-executor.js';
import { type Environment, findExecutable, record } from './executor-shared.js';

/**
 * How the delegation hooks reach the Void Machine kernel: the read side of the file contract it keeps
 * under `<machine>/agents` (written by `run-registry.ts`), and the command that runs it.
 */
export const RUN_ID = /^run_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MISSION_ID = /^mis_[A-Za-z0-9_-]{8,100}$/;
const MAX_PENDING = 64;

/** `<main checkout>/.void/machine`, the kernel's rule: the parent of the common `.git`. */
export function machineRootOf(cwd: string): string | undefined {
  const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd, shell: false, encoding: 'utf8', timeout: 5_000 });
  const common = result.status === 0 ? result.stdout.replace(/\r?\n$/, '') : '';
  return common !== '' && basename(common) === '.git' ? join(dirname(common), '.void', 'machine') : undefined;
}

const json = (path: string) => {
  try { return record(JSON.parse(readFileSync(path, 'utf8'))); } catch { return undefined; }
};

/**
 * Whether the kernel launched this session: claimed by its id once bound, or, before that, launched
 * under a handle that is the first block of its id, the form Claude gives a background session.
 */
export function delegatedSession(root: string, sessionId: string): boolean {
  if (existsSync(join(root, 'agents', 'sessions', `${sessionId}.json`))) return true;
  let pending: string[] = [];
  try {
    pending = readdirSync(join(root, 'agents', 'pending')).filter((name) => RUN_ID.test(name));
  } catch { /* No run waits for its binding. */ }
  return pending.slice(0, MAX_PENDING).some((runId) => {
    const missionId = json(join(root, 'agents', 'index', `${runId}.json`))?.['missionId'];
    const run = typeof missionId === 'string' && MISSION_ID.test(missionId)
      ? json(join(root, 'runs', missionId, 'agents', runId, 'run.json')) : undefined;
    return record(run?.['binding'])?.['handle'] === sessionId.slice(0, 8);
  });
}

/** The project's own void-machine, else the installed release through npx. */
export function kernelCommand(checkout: string, env: Environment): string[] | undefined {
  const local = findExecutable('void-machine', checkout, env);
  if (local !== undefined) return [local];
  const [version, npx] = [resolveInstall(checkout, env).version, findExecutable('npx', checkout, env)];
  return npx === undefined || version === 'unknown' ? undefined : [npx, '--prefer-offline', '-y', `voidmachine@${version}`];
}
