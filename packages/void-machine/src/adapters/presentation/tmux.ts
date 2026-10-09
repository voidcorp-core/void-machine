// tdd-cover: e2e packages/void-machine/test/presentation-adapters-contract.test.ts
import {
  PRESENTATION_LIMITS, nextLabel, stackPlacement, surfaceCause, tmuxSocket,
} from '../../core/presentation.js';
import type { SurfacePort, SurfacePresence, SurfaceRef } from '../../runtime/presentation.js';
import { type Answer, type Deadline, type MultiplexerConfig, answerOf, deadline, runCommand } from './command.js';

/**
 * Delegated runs as tmux panes (tmux(1): split-window, select-pane -T, set-option -p, kill-pane).
 * Every call names the server socket recorded at open, and the display command is passed as argv,
 * which split-window executes directly without `sh -c` once it has two arguments or more.
 */

const PANE_ID = /^%\d{1,9}$/;
const MARKER = '@void_run';
const FIELDS = `#{pane_id}\t#{pane_title}\t#{${MARKER}}`;

interface Row { readonly id: string; readonly title: string; readonly run: string }

export function parsePaneRows(stdout: string): Row[] | undefined {
  const rows = stdout.split('\n').filter((line) => line !== '').slice(0, 1024).map((line) => {
    const [id = '', title = '', run = ''] = line.split('\t');
    return { id, title, run };
  });
  return rows.every((row) => PANE_ID.test(row.id)) ? rows : undefined;
}

export function createTmuxSurface(config: MultiplexerConfig): SurfacePort {
  const run = config.run ?? runCommand;
  const now = config.now ?? Date.now;
  const caller = config.env['TMUX_PANE'];

  async function call(socket: string, args: readonly string[], clock: Deadline): Promise<Answer> {
    const result = await run(config.executable, ['-S', socket, ...args], { env: config.env,
      timeoutMs: clock.remaining() });
    return answerOf(result, args[0] ?? 'tmux');
  }

  async function presence(ref: SurfaceRef, clock: Deadline): Promise<SurfacePresence> {
    const answer = await call(ref.scope, ['display-message', '-p', '-t', ref.id, FIELDS], clock);
    if (!answer.ok) {
      const missing = answer.cause.code === 'exit-nonzero' && /can't find pane/.test(answer.cause.detail ?? '');
      return missing ? { state: 'closed' } : { state: 'unknown', cause: answer.cause };
    }
    const [row] = parsePaneRows(answer.stdout) ?? [];
    if (row === undefined) return { state: 'unknown', cause: surfaceCause('parse-failed', 'display-message') };
    return { state: row.id === ref.id && row.title === ref.label && row.run === ref.runId ? 'open' : 'foreign' };
  }

  return {
    kind: 'tmux',
    async open(view) {
      const clock = deadline(now, PRESENTATION_LIMITS.openMs);
      const socket = tmuxSocket(config.env);
      if (socket === undefined || caller === undefined || !PANE_ID.test(caller)) {
        return { ok: false, cause: surfaceCause('unreachable', 'environment', 'TMUX or TMUX_PANE is missing') };
      }
      // One argument would go through sh -c; the argv is executed directly only from two on.
      if (view.command.length < 2 || view.command.some((argument) => argument === '')) {
        return { ok: false, cause: surfaceCause('not-representable', 'display command') };
      }
      // The caller's window: new surfaces stack beside the person who launched them.
      const listed = await call(socket, ['list-panes', '-t', caller, '-F', FIELDS], clock);
      const rows = listed.ok ? parsePaneRows(listed.stdout) : undefined;
      if (rows === undefined) {
        return { ok: false, cause: listed.ok ? surfaceCause('parse-failed', 'list-panes') : listed.cause };
      }
      const label = nextLabel(view.role, rows.map((row) => row.title));
      const ours = rows.filter((row) => row.run !== '').map((row) => row.id);
      const placement = stackPlacement(caller, ours);
      const split = await call(socket, ['split-window', '-d', placement.direction === 'right' ? '-h' : '-v',
        '-P', '-F', '#{pane_id}', '-c', view.cwd, '-t', placement.target, '--', ...view.command], clock);
      const id = split.ok ? split.stdout.trim() : '';
      if (!split.ok || !PANE_ID.test(id)) {
        return { ok: false, cause: split.ok ? surfaceCause('parse-failed', 'split-window') : split.cause };
      }
      const ref: SurfaceRef = { kind: 'tmux', scope: socket, id, label, runId: view.runId };
      for (const step of [['select-pane', '-t', id, '-T', label], ['set-option', '-p', '-t', id, MARKER, view.runId]]) {
        const answer = await call(socket, step, clock);
        if (answer.ok) continue;
        const cleanup = await call(socket, ['kill-pane', '-t', id], deadline(now, PRESENTATION_LIMITS.closeMs));
        return { ok: false, cause: answer.cause, ...(cleanup.ok ? {} : { orphan: ref }) };
      }
      return { ok: true, ref };
    },
    inspect: (ref) => presence(ref, deadline(now, PRESENTATION_LIMITS.inspectMs)),
    async close(ref) {
      if (ref.id === caller && ref.scope === tmuxSocket(config.env)) {
        return { outcome: 'skipped', cause: surfaceCause('own-pane', 'kill-pane') };
      }
      const clock = deadline(now, PRESENTATION_LIMITS.closeMs);
      const found = await presence(ref, clock);
      if (found.state === 'closed') return { outcome: 'already-absent' };
      if (found.state === 'foreign') return { outcome: 'skipped', cause: surfaceCause('identity-mismatch', 'display-message') };
      if (found.state === 'unknown') return { outcome: 'failed', cause: found.cause };
      const killed = await call(ref.scope, ['kill-pane', '-t', ref.id], clock);
      return killed.ok ? { outcome: 'closed' } : { outcome: 'failed', cause: killed.cause };
    },
  };
}
