import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as z from 'zod/mini';
import { measureHerdrContext } from './context-continuity-executor.js';
import { type Environment, type LifecycleExecution, record } from './executor-shared.js';
import { metadataCommands, metadataSequence } from './herdr-metadata.js';
import { foreground, proveOwnership } from './herdr-ownership.js';
import { readOrchestra } from './orchestra-reader.js';

export type MetadataRun = (command: string, args: readonly string[], options: {
  readonly cwd: string; readonly env: Environment; readonly shell: false;
  readonly timeout: number; readonly maxBuffer: number;
}) => string;
const runCommand: MetadataRun = (command, args, options) => {
  const result = spawnSync(command, args, { ...options, encoding: 'utf8' });
  if (result.error !== undefined || result.status !== 0) {
    throw Error(`${command}: ${result.error?.message ?? result.stderr?.slice(0, 300) ?? 'transport refused'}`);
  }
  return result.stdout;
};
const paneList = z.object({ result: z.object({ panes: z.array(z.object({
  pane_id: z.string(), workspace_id: z.string(), cwd: z.nullish(z.string()), label: z.nullish(z.string()),
  tokens: z.optional(z.record(z.string(), z.string())),
})).check(z.maxLength(256)) }) });
type Execution = LifecycleExecution & { readonly output?: {
  readonly hookSpecificOutput: { readonly hookEventName: 'SessionStart'; readonly additionalContext: string };
} };

/** All subprocesses share one short deadline; the hook has no durable home writes. */
export function executeHerdrMetadata(
  raw: unknown, root: string, env: Environment, runtime: 'claude' | 'codex' | 'unknown',
  run: MetadataRun = runCommand,
): Execution {
  if (env['HERDR_ENV'] !== '1') return { status: 'skipped', details: { reason: 'outside-herdr' } };
  const now = Date.now();
  const seq = metadataSequence(performance.timeOrigin, performance.now());
  const deadline = performance.now() + 2000;
  const input = record(raw);
  const event = input?.['hook_event_name'];
  if (input === undefined || !['SessionStart', 'Stop', 'SessionEnd'].includes(String(event))) {
    return { status: 'skipped', details: { reason: 'event-not-actionable' } };
  }
  const call = (command: string, args: readonly string[]) => {
    const timeout = Math.floor(deadline - performance.now());
    if (timeout <= 0) throw Error('Herdr projection deadline exceeded');
    return run(command, args, { cwd: root, env, shell: false, timeout, maxBuffer: 262_144 });
  };
  try {
    const common = call('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
    const inventory = () => paneList.parse(JSON.parse(call('herdr', ['pane', 'list']))).result.panes;
    const snapshot = readOrchestra(join(env['HOME'] ?? homedir(), '.local/state/orchestra'), common, root, () => {
      return inventory().flatMap(pane => typeof pane.label === 'string' && typeof pane.cwd === 'string'
        ? [{ pane_id: pane.pane_id, workspace_id: pane.workspace_id, label: pane.label, cwd: pane.cwd,
          ...(pane.tokens === undefined ? {} : { tokens: pane.tokens }) }] : []);
    });
    if (snapshot === undefined) {
      if (event !== 'SessionStart') return { status: 'skipped', details: { reason: 'no-orchestra-mission' } };
      const paneId = env['HERDR_PANE_ID'];
      if (!paneId || !env['HERDR_SOCKET_PATH']) throw Error('missing-herdr-context');
      const panes = inventory();
      const matches = panes.filter(pane => pane.pane_id === paneId);
      const pane = matches[0];
      if (matches.length !== 1 || !pane || !pane.cwd || realpathSync(pane.cwd) !== realpathSync(root)) {
        throw Error('Herdr caller pane missing or foreign worktree');
      }
      if (pane.label && panes.filter(other => other.label === pane.label && typeof other.cwd === 'string'
        && realpathSync(other.cwd) === realpathSync(root)).length !== 1) {
        throw Error('ambiguous Herdr coordinator identity');
      }
      const pids = foreground(Buffer.from(call('herdr', ['pane', 'process-info', '--pane', paneId])), paneId);
      if (pids === undefined) throw Error('invalid Herdr process discovery');
      const denied = proveOwnership(pids, (command, args) => Buffer.from(call(command, args)));
      if (denied !== undefined) throw Error(denied);
      return { status: 'ok', details: { host: 'herdr', mission: 'absent' }, output: { hookSpecificOutput: {
        hookEventName: 'SessionStart', additionalContext: `Validated Herdr caller: ${paneId}. No Orchestra mission selected.\n`
          + 'Use void-orchestrate before delegating a ticket: register the mission, create or reuse its worker tab, '
          + 'and launch the worker once. Revalidate live identity before acting; this hook never launches workers.',
      } } };
    }
    const workspace = snapshot.coordinator
      ? record(record(JSON.parse(call('herdr', ['workspace', 'get', snapshot.pane.workspace_id])))?.['result'])
      : undefined;
    const workspaceMission = record(record(workspace?.['workspace'])?.['tokens'])?.['mission'];
    const percent = measureHerdrContext(input, root, runtime, now);
    const commands = metadataCommands(snapshot, { hook_event_name: String(event),
      ...(typeof input['source'] === 'string' ? { source: input['source'] } : {}) }, seq, percent,
    typeof workspaceMission === 'string' ? workspaceMission : undefined);
    for (const args of commands) {
      const output = call('herdr', args).trim();
      // The CLI acknowledges successful metadata writes with exit 0 and no stdout.
      if (output === '') continue;
      const response = record(JSON.parse(output));
      if (record(response?.['result']) === undefined || response?.['error'] !== undefined) {
        throw Error('Herdr metadata publication refused');
      }
    }
    return { status: 'ok', details: { mission: snapshot.mission.mission, published: commands.length,
      context: percent === undefined ? 'unmeasurable' : 'measured' },
      ...(event === 'SessionStart' ? { output: { hookSpecificOutput: {
        hookEventName: 'SessionStart', additionalContext: `Orchestra mission: ${snapshot.directory}\n`
          + 'Read mission.md and the current brief/report before resuming; Herdr IDs are hints.',
      } } } : {}) };
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    return { status: 'degraded', details: { reason }, diagnostic: `herdr-metadata: ${reason}\n`,
      ...(event === 'SessionStart' ? { output: { hookSpecificOutput: {
        hookEventName: 'SessionStart', additionalContext: `Herdr discovery refused: ${reason}.\n`
          + 'Do not act on this host until resolved. Native delegation independent of that action may continue.',
      } } } : {}) };
  }
}
