import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { RUN_ID, delegatedSession, kernelCommand, machineRootOf } from './delegation-kernel.js';
import { type Environment, type LifecycleExecution, record } from './executor-shared.js';

/**
 * PreToolUse hook on `Agent`: under a multiplexer, the coordinator's delegation becomes a supervised
 * run (`void-machine agents dispatch`) and the native call is refused with its id. Every failure lets
 * the native subagent run and says why: capture never blocks the work.
 */
type Capture = LifecycleExecution & { readonly output?: { readonly hookSpecificOutput: {
  readonly hookEventName: 'PreToolUse'; readonly permissionDecision?: 'deny';
  readonly permissionDecisionReason?: string; readonly additionalContext?: string; } } };
const DISPATCH_TIMEOUT_MS = 60_000;
const WORK_MODES = new Set(['auto', 'bypassPermissions']);
const EDITING_TOOL = /(^|[\s,])(Edit|Write|NotebookEdit|MultiEdit|\*)([\s,(]|$)/;
const skipped = (reason: string): Capture => ({ status: 'skipped', details: { reason } });
const quoted = (arg: string) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`);
const parse = (text: string) => { try { return record(JSON.parse(text)); } catch { return undefined; } };
/** The kernel detects the surface precisely; this only spares a dispatch where none can exist. */
const shown = (env: Environment) => env['HERDR_ENV'] === '1'
  || [env['TMUX'], env['CMUX_SOCKET_PATH'], env['CMUX_SOCKET']].some(Boolean);

/** Built-in types that never edit; a file-defined type is read-only when no declared tool edits. */
function readOnly(type: string, checkout: string, env: Environment): boolean {
  if (type === 'Explore' || type === 'Plan') return true;
  if (!/^[\w.-]{1,100}$/.test(type)) return false;
  for (const home of [checkout, env['HOME'] ?? homedir()]) {
    try {
      const definition = readFileSync(join(home, '.claude', 'agents', `${type}.md`), 'utf8');
      const frontmatter = /^---\n([\s\S]*?)\n---/.exec(definition)?.[1] ?? '';
      const tools = /^tools:(.*)$/m.exec(frontmatter)?.[1];
      return tools !== undefined && tools.trim() !== '' && !EDITING_TOOL.test(tools);
    } catch { /* Not defined here: look in the next directory. */ }
  }
  return false;
}

/** The ticket a Linear branch names (`user/dev-928-slug`), the one the run is shown against. */
function ticketOf(cwd: string): string | undefined {
  const branch = spawnSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', timeout: 5_000 }).stdout;
  return /(?:^|\/)([a-z][a-z0-9]{0,9}-\d{1,9})(?:-|$)/i.exec(branch?.trim() ?? '')?.[1]?.toUpperCase();
}

const passWith = (reason: string, why: string): Capture => ({ status: 'degraded', details: { reason },
  diagnostic: `delegation-capture: ${why}\n`, output: { hookSpecificOutput: { hookEventName: 'PreToolUse',
    additionalContext: `void-machine could not supervise this subagent (${why}); it runs natively, without a pane.` } } });

/** What the coordinator reads instead of a result: its run, and the commands that collect the answer. */
function refusal(command: readonly string[], runId: string, ticket: string | undefined, background: boolean): string {
  const vm = [...command.map(quoted), 'agents'].join(' ');
  return `void-machine runs this subagent as supervised run ${runId}${ticket === undefined ? '' : ` (${ticket})`}`
    + ', shown in its own pane; do not call Agent again for it. Collect its answer: run '
    + `\`${vm} wait ${runId} --timeout 540\`${background ? ' in the background (Bash run_in_background)' : ''}`
    + ` until it reports turn-ended, answer a question with \`${vm} send ${runId} --message-file <file>\`, then`
    + ` close it with \`${vm} accept ${runId}\`, which prints its final message.`;
}

export function executeDelegationCapture(input: unknown, env: Environment): Capture {
  const fields = record(input);
  const tool = record(fields?.['tool_input']);
  const [sessionId, cwd, prompt] = [fields?.['session_id'], fields?.['cwd'], tool?.['prompt']];
  const [type, model] = [tool?.['subagent_type'], tool?.['model']];
  if (fields?.['tool_name'] !== 'Agent' || typeof prompt !== 'string' || prompt === ''
    || typeof sessionId !== 'string' || typeof cwd !== 'string') return skipped('not-an-agent-call');
  if (!shown(env)) return skipped('no-surface');
  if (type === 'fork') return skipped('fork');
  const root = machineRootOf(cwd);
  if (root === undefined) return skipped('no-repository');
  if (fields['agent_id'] !== undefined || delegatedSession(root, sessionId)) return skipped('delegated-caller');
  const checkout = dirname(dirname(root));
  const command = kernelCommand(checkout, env);
  if (command === undefined) return passWith('no-cli', 'no void-machine command is installed or on PATH');
  const role = typeof type === 'string' && readOnly(type, checkout, env) ? 'review' : 'work';
  const mode = String(fields['permission_mode']);
  // A work run acts in auto mode: never grant that to a coordinator that asks before acting.
  if (role === 'work' && !WORK_MODES.has(mode)) return passWith('caller-permission', `the caller runs in ${mode} mode`);
  const ticket = ticketOf(cwd);
  const briefs = mkdtempSync(join(tmpdir(), 'agent-capture-'));
  try {
    writeFileSync(join(briefs, 'brief.md'), prompt, { mode: 0o600 });
    const run = spawnSync(command[0] ?? '', [...command.slice(1), 'agents', 'dispatch', '--role', role, '--cwd', cwd,
      '--brief-file', join(briefs, 'brief.md'), ...(typeof type === 'string' ? ['--type', type] : []),
      ...(typeof model === 'string' ? ['--model', model] : []), ...(ticket === undefined ? [] : ['--ticket', ticket])],
    { cwd, env, encoding: 'utf8', timeout: DISPATCH_TIMEOUT_MS, shell: false });
    const answer = parse(run.stdout ?? '');
    const runId = answer?.['runId'];
    if (run.status !== 0 || answer?.['ok'] !== true || typeof runId !== 'string' || !RUN_ID.test(runId)) {
      const cause = typeof answer?.['cause'] === 'string' ? answer['cause'] : `dispatch exited ${String(run.status)}`;
      return passWith('dispatch-refused', cause.slice(0, 500));
    }
    return { status: 'ok', details: { captured: true, role }, output: { hookSpecificOutput: {
      hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: refusal(command, runId, ticket, tool?.['run_in_background'] === true) } } };
  } finally {
    rmSync(briefs, { recursive: true, force: true });
  }
}
