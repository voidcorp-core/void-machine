// tdd-cover: e2e packages/void-machine/test/presentation-adapters-contract.test.ts
import { z } from 'zod';
import {
  PRESENTATION_LIMITS, type SurfaceCause, crewFamily, displayLine, nextLabel, surfaceCause, surfaceLabelRole,
  tabPlacement, ticketToken,
} from '../../core/presentation.js';
import type { SurfacePort, SurfacePresence, SurfaceRef, SurfaceView } from '../../runtime/presentation.js';
import {
  type Answer, type Deadline, type MultiplexerConfig, answerOf, deadline, runCommand,
} from './command.js';

/**
 * Delegated runs as herdr panes (herdr 0.9, `herdr --skill`): a crew tab per role filled as a grid
 * of four, the pane labelled `WORK-n`, the run and its ticket stamped as pane metadata, and the
 * display command typed into the pane's shell. The cockpit reads the same `ticket=` token.
 */

const SOURCE = 'void-machine';
const PANE_ID = /^[A-Za-z0-9]{1,32}:p[A-Za-z0-9]{1,32}$/;
const TAB_ID = /^[A-Za-z0-9]{1,32}:t[A-Za-z0-9]{1,32}$/;
const WORKSPACE_ID = /^[A-Za-z0-9]{1,32}$/;

const tabsSchema = z.object({ result: z.object({ tabs: z.array(z.object({
  tab_id: z.string().regex(TAB_ID), label: z.string().optional() })).max(512) }) });
const paneSchema = z.object({ pane_id: z.string().regex(PANE_ID), tab_id: z.string().regex(TAB_ID).optional(),
  label: z.string().optional(), tokens: z.record(z.string(), z.string()).optional() });
const panesSchema = z.object({ result: z.object({ panes: z.array(paneSchema).max(1024) }) });
const createdTabSchema = z.object({ result: z.object({ root_pane: paneSchema }) });
const oneSchema = z.object({ result: z.object({ pane: paneSchema }) });

type Pane = z.infer<typeof paneSchema>;
type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly cause: SurfaceCause };

function parse<T>(answer: Answer, schema: z.ZodType<T>, step: string): Parsed<T> {
  if (!answer.ok) return answer;
  try {
    const parsed = schema.safeParse(JSON.parse(answer.stdout));
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, cause: surfaceCause('parse-failed', step) };
  } catch {
    return { ok: false, cause: surfaceCause('parse-failed', step) };
  }
}

interface Layout { readonly tabs: readonly { readonly tab_id: string; readonly label?: string | undefined }[];
  readonly panes: readonly Pane[] }

/** `crew · 3`, then `crew 2 · 1` for the next tab of the family: the labels the cockpit gives. */
export function familyTabLabels(family: string, layout: Layout): { tab: string; label: string }[] {
  return layout.tabs.filter((tab) => tab.label?.startsWith(family) === true).map((tab, index) => {
    const count = layout.panes.filter((pane) => pane.tab_id === tab.tab_id).length;
    return { tab: tab.tab_id, label: `${index === 0 ? family : `${family} ${String(index + 1)}`} · ${String(count)}` };
  });
}

export function createHerdrSurface(config: MultiplexerConfig): SurfacePort {
  const run = config.run ?? runCommand;
  const now = config.now ?? Date.now;
  const scope = config.env['HERDR_SOCKET_PATH'];
  const workspace = config.env['HERDR_WORKSPACE_ID'];

  async function call(socket: string, args: readonly string[], clock: Deadline): Promise<Answer> {
    const result = await run(config.executable, args, { env: { ...config.env, HERDR_SOCKET_PATH: socket },
      timeoutMs: clock.remaining() });
    return answerOf(result, args.slice(0, 2).join(' '));
  }

  async function layout(socket: string, space: string, clock: Deadline): Promise<Parsed<Layout>> {
    const tabs = parse(await call(socket, ['tab', 'list', '--workspace', space], clock), tabsSchema, 'tab list');
    if (!tabs.ok) return tabs;
    const panes = parse(await call(socket, ['pane', 'list', '--workspace', space], clock), panesSchema, 'pane list');
    if (!panes.ok) return panes;
    return { ok: true, value: { tabs: tabs.value.result.tabs, panes: panes.value.result.panes } };
  }

  /** Best effort: a stale tab label is cosmetic and never fails an open or a close. */
  async function relabel(socket: string, space: string, family: string, clock: Deadline): Promise<void> {
    const current = await layout(socket, space, clock);
    if (!current.ok) return;
    for (const { tab, label } of familyTabLabels(family, current.value)) {
      if (current.value.tabs.find((known) => known.tab_id === tab)?.label !== label) {
        await call(socket, ['tab', 'rename', tab, label], clock);
      }
    }
  }

  async function create(view: SurfaceView, socket: string, space: string, clock: Deadline)
    : Promise<Parsed<{ pane: string; label: string }>> {
    const known = await layout(socket, space, clock);
    if (!known.ok) return known;
    const family = crewFamily(view.role);
    const label = nextLabel(view.role, known.value.panes.map((pane) => pane.label ?? ''));
    const placement = tabPlacement(known.value.tabs.filter((tab) => tab.label?.startsWith(family) === true)
      .map((tab) => ({ tab: tab.tab_id,
        panes: known.value.panes.filter((pane) => pane.tab_id === tab.tab_id).map((pane) => pane.pane_id) })));
    const created = placement.kind === 'new-tab'
      ? parse(await call(socket, ['tab', 'create', '--workspace', space, '--label', family, '--cwd', view.cwd,
        '--no-focus'], clock), createdTabSchema, 'tab create')
      : parse(await call(socket, ['pane', 'split', placement.target, '--direction', placement.direction,
        '--cwd', view.cwd, '--no-focus'], clock), oneSchema, 'pane split');
    if (!created.ok) return created;
    const pane = 'root_pane' in created.value.result ? created.value.result.root_pane : created.value.result.pane;
    return { ok: true, value: { pane: pane.pane_id, label } };
  }

  async function presence(ref: SurfaceRef, clock: Deadline): Promise<SurfacePresence> {
    const answer = await call(ref.scope, ['pane', 'get', ref.id], clock);
    if (!answer.ok) {
      const missing = answer.cause.code === 'exit-nonzero' && /"pane_not_found"/.test(answer.cause.detail ?? '');
      return missing ? { state: 'closed' } : { state: 'unknown', cause: answer.cause };
    }
    const pane = parse(answer, oneSchema, 'pane get');
    if (!pane.ok) return { state: 'unknown', cause: pane.cause };
    const { label, tokens } = pane.value.result.pane;
    return { state: label === ref.label && tokens?.['run'] === ref.runId ? 'open' : 'foreign' };
  }

  return {
    kind: 'herdr',
    async open(view) {
      const clock = deadline(now, PRESENTATION_LIMITS.openMs);
      const line = displayLine(view.command);
      if (line === undefined) return { ok: false, cause: surfaceCause('not-representable', 'display command') };
      if (scope?.startsWith('/') !== true || workspace === undefined || !WORKSPACE_ID.test(workspace)) {
        return { ok: false, cause: surfaceCause('unreachable', 'environment',
          'HERDR_SOCKET_PATH or HERDR_WORKSPACE_ID is missing') };
      }
      const created = await create(view, scope, workspace, clock);
      if (!created.ok) return created;
      const ref: SurfaceRef = { kind: 'herdr', scope, container: workspace, id: created.value.pane,
        label: created.value.label, runId: view.runId };
      const ticket = view.ticket === undefined ? undefined : ticketToken(view.ticket);
      const steps: (readonly string[])[] = [
        ['pane', 'rename', ref.id, ref.label],
        ['pane', 'report-metadata', ref.id, '--source', SOURCE, '--token', `run=${view.runId}`,
          ...(ticket === undefined ? [] : ['--token', ticket])],
        ['pane', 'run', ref.id, line],
      ];
      for (const step of steps) {
        const answer = await call(scope, step, clock);
        if (answer.ok) continue;
        // The pane is ours and unfinished: close it now rather than leave an unlabelled shell.
        const cleanup = await call(scope, ['pane', 'close', ref.id], deadline(now, PRESENTATION_LIMITS.closeMs));
        return { ok: false, cause: answer.cause, ...(cleanup.ok ? {} : { orphan: ref }) };
      }
      await relabel(scope, workspace, crewFamily(view.role), clock);
      return { ok: true, ref };
    },
    inspect: (ref) => presence(ref, deadline(now, PRESENTATION_LIMITS.inspectMs)),
    async close(ref) {
      if (ref.id === config.env['HERDR_PANE_ID']) {
        return { outcome: 'skipped', cause: surfaceCause('own-pane', 'pane close') };
      }
      const clock = deadline(now, PRESENTATION_LIMITS.closeMs);
      const found = await presence(ref, clock);
      if (found.state === 'foreign') return { outcome: 'skipped', cause: surfaceCause('identity-mismatch', 'pane get') };
      if (found.state === 'unknown') return { outcome: 'failed', cause: found.cause };
      if (found.state === 'open') {
        const closed = await call(ref.scope, ['pane', 'close', ref.id], clock);
        if (!closed.ok) return { outcome: 'failed', cause: closed.cause };
      }
      // A pane a person closed left its tab count stale as well.
      const role = surfaceLabelRole(ref.label);
      if (role !== undefined && ref.container !== undefined) {
        await relabel(ref.scope, ref.container, crewFamily(role), clock);
      }
      return { outcome: found.state === 'open' ? 'closed' : 'already-absent' };
    },
  };
}
