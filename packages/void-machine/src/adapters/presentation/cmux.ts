// tdd-cover: e2e packages/void-machine/test/presentation-adapters-contract.test.ts
import { z } from 'zod';
import {
  PRESENTATION_LIMITS, type SurfaceCause, cmuxSocket, displayLine, nextLabel, stackPlacement, surfaceCause,
} from '../../core/presentation.js';
import type { SurfacePort, SurfacePresence, SurfaceRef, SurfaceView } from '../../runtime/presentation.js';
import { type Answer, type Deadline, type MultiplexerConfig, answerOf, deadline, runCommand } from './command.js';

/**
 * Delegated runs as cmux terminal splits (cmux docs/cli-contract.md): beside the caller first,
 * then stacked below the last run shown, as the former mission presentation script did. A split
 * is recognised by diffing the workspace tree, and titled `WORK-n | <runId>`, its ownership mark.
 */

const REF = /^surface:\d{1,9}$/;
const colors = { work: '#3B82F6', review: '#06B6D4' } as const;

const surfaceSchema = z.object({ ref: z.string(), title: z.string().optional(), type: z.string().optional() });
const treeSchema = z.object({ windows: z.array(z.object({ workspaces: z.array(z.object({
  panes: z.array(z.object({ surfaces: z.array(surfaceSchema).max(256) })).max(256) })).max(256) })).max(64) });
type Surface = z.infer<typeof surfaceSchema>;

/** The surfaces of the one workspace a filtered tree must hold. Mutations answer in text; the tree never does. */
export function workspaceSurfaces(stdout: string): Surface[] | undefined {
  try {
    const tree = treeSchema.safeParse(JSON.parse(stdout));
    const spaces = tree.success ? tree.data.windows.flatMap((window) => window.workspaces) : [];
    const [only] = spaces;
    return spaces.length === 1 && only !== undefined ? only.panes.flatMap((pane) => pane.surfaces) : undefined;
  } catch {
    return undefined;
  }
}

const OWNED = /^((?:WORK|REVIEW)-\d{1,6}) \| (run_[0-9a-f-]{36})$/;
const titleOf = (ref: Pick<SurfaceRef, 'label' | 'runId'>) => `${ref.label} | ${ref.runId}`;

export function createCmuxSurface(config: MultiplexerConfig): SurfacePort {
  const run = config.run ?? runCommand;
  const now = config.now ?? Date.now;
  const workspace = config.env['CMUX_WORKSPACE_ID'];
  const caller = config.env['CMUX_SURFACE_ID'];

  async function call(socket: string, args: readonly string[], clock: Deadline): Promise<Answer> {
    const { CMUX_SOCKET: _deprecated, ...env } = config.env;
    const result = await run(config.executable, ['--json', ...args], { env: { ...env, CMUX_SOCKET_PATH: socket },
      timeoutMs: clock.remaining() });
    return answerOf(result, args[0] ?? 'cmux');
  }

  async function surfaces(socket: string, space: string, clock: Deadline)
    : Promise<{ ok: true; value: Surface[] } | { ok: false; cause: SurfaceCause }> {
    const answer = await call(socket, ['tree', '--workspace', space], clock);
    if (!answer.ok) return answer;
    const value = workspaceSurfaces(answer.stdout);
    return value === undefined ? { ok: false, cause: surfaceCause('parse-failed', 'tree') } : { ok: true, value };
  }

  async function split(view: SurfaceView, socket: string, space: string, clock: Deadline)
    : Promise<{ ok: true; ref: SurfaceRef } | { ok: false; cause: SurfaceCause }> {
    const line = displayLine(view.command);
    if (line === undefined) return { ok: false, cause: surfaceCause('not-representable', 'display command') };
    const before = await surfaces(socket, space, clock);
    if (!before.ok) return before;
    const owned = before.value.filter((surface) => OWNED.test(surface.title ?? ''));
    const label = nextLabel(view.role, owned.map((surface) => OWNED.exec(surface.title ?? '')?.[1] ?? ''));
    const placement = stackPlacement(caller ?? '', owned.map((surface) => surface.ref));
    const created = await call(socket, ['new-split', placement.direction, '--workspace', space,
      '--surface', placement.target, '--focus', 'false', '--command', line], clock);
    if (!created.ok) return created;
    const after = await surfaces(socket, space, clock);
    if (!after.ok) return after;
    const added = after.value.filter((surface) => !before.value.some((known) => known.ref === surface.ref));
    const [only] = added;
    // Anything but exactly one new terminal cannot be attributed: touch none of them.
    if (added.length !== 1 || only === undefined || !REF.test(only.ref) || (only.type ?? 'terminal') !== 'terminal') {
      return { ok: false, cause: surfaceCause('needs-reconciliation', 'tree', `${String(added.length)} new surfaces`) };
    }
    return { ok: true, ref: { kind: 'cmux', scope: socket, container: space, id: only.ref, label, runId: view.runId } };
  }

  async function presence(ref: SurfaceRef, clock: Deadline): Promise<SurfacePresence> {
    if (ref.container === undefined) return { state: 'unknown', cause: surfaceCause('record-corrupt', 'tree') };
    const listed = await surfaces(ref.scope, ref.container, clock);
    if (!listed.ok) return { state: 'unknown', cause: listed.cause };
    const surface = listed.value.find((known) => known.ref === ref.id);
    if (surface === undefined) return { state: 'closed' };
    return { state: surface.title === titleOf(ref) ? 'open' : 'foreign' };
  }

  return {
    kind: 'cmux',
    async open(view) {
      const clock = deadline(now, PRESENTATION_LIMITS.openMs);
      const socket = cmuxSocket(config.env);
      if (socket === undefined || workspace === undefined || caller === undefined) {
        return { ok: false, cause: surfaceCause('unreachable', 'environment',
          'CMUX_SOCKET_PATH, CMUX_WORKSPACE_ID or CMUX_SURFACE_ID is missing') };
      }
      const opened = await split(view, socket, workspace, clock);
      if (!opened.ok) return opened;
      const { ref } = opened;
      const renamed = await call(socket, ['rename-tab', '--workspace', workspace, '--surface', ref.id, titleOf(ref)], clock);
      if (!renamed.ok) {
        const cleanup = await call(socket, ['close-surface', '--surface', ref.id, '--workspace', workspace],
          deadline(now, PRESENTATION_LIMITS.closeMs));
        return { ok: false, cause: renamed.cause, ...(cleanup.ok ? {} : { orphan: ref }) };
      }
      // The ticket is shown in the sidebar status; losing it never loses the surface.
      await call(socket, ['set-status', `void-${ref.label}`, `${ref.label} | ${view.ticket ?? view.runId}`,
        '--workspace', workspace, '--color', colors[view.role]], clock);
      return { ok: true, ref };
    },
    inspect: (ref) => presence(ref, deadline(now, PRESENTATION_LIMITS.inspectMs)),
    async close(ref) {
      if (ref.id === caller) return { outcome: 'skipped', cause: surfaceCause('own-pane', 'close-surface') };
      const clock = deadline(now, PRESENTATION_LIMITS.closeMs);
      const found = await presence(ref, clock);
      if (found.state === 'closed') return { outcome: 'already-absent' };
      if (found.state === 'foreign') return { outcome: 'skipped', cause: surfaceCause('identity-mismatch', 'tree') };
      if (found.state === 'unknown' || ref.container === undefined) {
        return { outcome: 'failed', cause: found.state === 'unknown' ? found.cause : surfaceCause('record-corrupt') };
      }
      const closed = await call(ref.scope, ['close-surface', '--surface', ref.id, '--workspace', ref.container], clock);
      if (!closed.ok) return { outcome: 'failed', cause: closed.cause };
      await call(ref.scope, ['clear-status', `void-${ref.label}`, '--workspace', ref.container], clock);
      return { outcome: 'closed' };
    },
  };
}
