import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from 'vitest';
import { type CommandRunner, runCommand } from '../src/adapters/presentation/command.js';
import { createCmuxSurface } from '../src/adapters/presentation/cmux.js';
import { createHerdrSurface } from '../src/adapters/presentation/herdr.js';
import { createNoSurface } from '../src/adapters/presentation/none.js';
import { createTmuxSurface } from '../src/adapters/presentation/tmux.js';
import type { SurfaceRef, SurfaceView } from '../src/runtime/presentation.js';

const fixture = fileURLToPath(new URL('./fixtures/multiplexer-process.mjs', import.meta.url));
const RUN = 'run_00000000-0000-4000-8000-000000000001';
const OTHER = 'run_00000000-0000-4000-8000-000000000002';
const view: SurfaceView = { runId: RUN, role: 'work', ticket: 'DEV-925', cwd: '/work/tree',
  command: ['claude', 'attach', '6d5ea8bb'] };

type Kind = 'herdr' | 'tmux' | 'cmux';
interface Fake { readonly run: CommandRunner; state(): Record<string, unknown> & { log: { step: string; socket: string | null }[] };
  write(change: (state: Record<string, unknown>) => void): void; readonly env: Record<string, string> }

/** One fake multiplexer per test, its state in a file of its own: no test sees another's panes. */
function fake(kind: Kind, initial: Record<string, unknown>, env: Record<string, string> = {}): Fake {
  const directory = mkdtempSync(join(tmpdir(), 'vm-mux-'));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json');
  writeFileSync(file, JSON.stringify({ next: 10, ...initial }));
  const run: CommandRunner = (_executable, args, options) =>
    runCommand(execPath, [fixture, kind, ...args], { ...options, env: { ...options.env, FAKE_MUX_STATE: file } });
  return { run, env, state: () => JSON.parse(readFileSync(file, 'utf8')),
    write: (change) => { const state = JSON.parse(readFileSync(file, 'utf8')); change(state); writeFileSync(file, JSON.stringify(state)); } };
}

const herdrEnv = { HERDR_ENV: '1', HERDR_SOCKET_PATH: '/tmp/herdr.sock', HERDR_WORKSPACE_ID: 'w1', HERDR_PANE_ID: 'w1:p1' };
const herdrLayout = () => ({ tabs: [{ tab_id: 'w1:t1', label: 'pilot' }],
  panes: [{ pane_id: 'w1:p1', tab_id: 'w1:t1', label: 'ORCH', tokens: {}, typed: [] }] });
const tmuxEnv = { TMUX: '/tmp/tmux-501/default,42,0', TMUX_PANE: '%1' };
const cmuxEnv = { CMUX_SOCKET_PATH: '/tmp/cmux.sock', CMUX_WORKSPACE_ID: 'W-UUID', CMUX_SURFACE_ID: 'surface:1' };

function adapter(kind: Kind, mux: Fake, extra: Record<string, string> = {}) {
  const config = { executable: kind, env: { ...mux.env, ...extra }, run: mux.run };
  return kind === 'herdr' ? createHerdrSurface(config) : kind === 'tmux' ? createTmuxSurface(config) : createCmuxSurface(config);
}

function setup(kind: Kind, extra: Record<string, string> = {}) {
  if (kind === 'herdr') return fake(kind, herdrLayout(), { ...herdrEnv, ...extra });
  if (kind === 'tmux') return fake(kind, { panes: [{ id: '%1', title: 'coordinator' }] }, { ...tmuxEnv, ...extra });
  return fake(kind, { workspace: 'W-UUID', surfaces: [{ ref: 'surface:1', title: 'coordinator', type: 'terminal' }] },
    { ...cmuxEnv, ...extra });
}

describe.each(['herdr', 'tmux', 'cmux'] as const)('%s surface', (kind) => {
  it('opens a labelled surface that shows the run, on the recorded server', async () => {
    const mux = setup(kind);
    const opened = await adapter(kind, mux).open(view);
    expect(opened).toMatchObject({ ok: true, ref: { kind, label: 'WORK-1', runId: RUN } });
    if (!opened.ok) return;
    expect(await adapter(kind, mux).inspect(opened.ref)).toEqual({ state: 'open' });
  });

  it('closes only its own surface, and counts an absent one as already closed', async () => {
    const mux = setup(kind);
    const surface = adapter(kind, mux);
    const opened = await surface.open(view);
    if (!opened.ok) throw new Error('open failed');
    expect(await surface.close(opened.ref)).toEqual({ outcome: 'closed' });
    expect(await surface.inspect(opened.ref)).toEqual({ state: 'closed' });
    expect(await surface.close(opened.ref)).toEqual({ outcome: 'already-absent' });
  });

  it('never closes a surface that no longer carries the run it was opened for', async () => {
    const mux = setup(kind);
    const surface = adapter(kind, mux);
    const opened = await surface.open(view);
    if (!opened.ok) throw new Error('open failed');
    const forged: SurfaceRef = { ...opened.ref, runId: OTHER };
    expect(await surface.inspect(forged)).toEqual({ state: 'foreign' });
    expect(await surface.close(forged)).toMatchObject({ outcome: 'skipped', cause: { code: 'identity-mismatch' } });
    expect(await surface.inspect(opened.ref)).toEqual({ state: 'open' });
  });

  it('refuses to close the caller surface, whatever the record says', async () => {
    const mux = setup(kind);
    const own = { herdr: 'w1:p1', tmux: '%1', cmux: 'surface:1' }[kind];
    const ref: SurfaceRef = { kind, scope: { herdr: '/tmp/herdr.sock', tmux: '/tmp/tmux-501/default', cmux: '/tmp/cmux.sock' }[kind],
      ...(kind === 'tmux' ? {} : { container: kind === 'herdr' ? 'w1' : 'W-UUID' }), id: own, label: 'WORK-1', runId: RUN };
    expect(await adapter(kind, mux).close(ref)).toMatchObject({ outcome: 'skipped', cause: { code: 'own-pane' } });
  });

  it('reports an unreachable multiplexer as unknown, never as closed', async () => {
    const mux = setup(kind);
    const opened = await adapter(kind, mux).open(view);
    if (!opened.ok) throw new Error('open failed');
    const gone = { herdr: createHerdrSurface, tmux: createTmuxSurface, cmux: createCmuxSurface }[kind](
      { executable: '/nonexistent/multiplexer', env: mux.env });
    expect(await gone.inspect(opened.ref)).toMatchObject({ state: 'unknown', cause: { code: 'unreachable' } });
    expect(await gone.close(opened.ref)).toMatchObject({ outcome: 'failed' });
    expect(await gone.open(view)).toMatchObject({ ok: false, cause: { code: 'unreachable' } });
  });

  it('gives up at its deadline instead of waiting on a hung multiplexer', async () => {
    const mux = setup(kind);
    // The open budget starts at 0; every later reading is 300 ms before its end, and the first call hangs.
    let readings = 0;
    const now = () => (readings++ === 0 ? 0 : 9_700);
    const hang = { herdr: 'tab list', tmux: 'list-panes', cmux: 'tree' }[kind];
    const run: CommandRunner = (executable, args, options) =>
      mux.run(executable, args, { ...options, env: { ...options.env, FAKE_MUX_HANG: hang } });
    const create = { herdr: createHerdrSurface, tmux: createTmuxSurface, cmux: createCmuxSurface }[kind];
    const opened = await create({ executable: kind, env: mux.env, run, now }).open(view);
    expect(opened).toMatchObject({ ok: false, cause: { code: 'timeout' } });
  });
});

describe('herdr placement and metadata', () => {
  it('opens a crew tab for the first run, stamps run and ticket, and types the display command', async () => {
    const mux = setup('herdr');
    const opened = await adapter('herdr', mux).open(view);
    expect(opened).toMatchObject({ ok: true, ref: { scope: '/tmp/herdr.sock', container: 'w1' } });
    const state = mux.state() as unknown as { tabs: { label: string }[]; panes: { label?: string; tokens: object; typed: string[]; cwd: string }[] };
    expect(state.tabs.map((tab) => tab.label)).toEqual(['pilot', 'crew · 1']);
    expect(state.panes[1]).toMatchObject({ label: 'WORK-1', cwd: '/work/tree', tokens: { run: RUN, ticket: 'DEV-925' },
      typed: ['claude attach 6d5ea8bb'] });
    expect(mux.state().log.every((entry) => entry.socket === '/tmp/herdr.sock')).toBe(true);
  });

  it('fills the crew grid of four, then opens a second crew tab', async () => {
    const mux = setup('herdr');
    const surface = adapter('herdr', mux);
    for (let index = 1; index <= 5; index += 1) {
      expect(await surface.open({ ...view, runId: `run_00000000-0000-4000-8000-00000000000${String(index)}` }))
        .toMatchObject({ ok: true, ref: { label: `WORK-${String(index)}` } });
    }
    const state = mux.state() as unknown as { tabs: { label: string }[]; panes: { direction?: string }[] };
    expect(state.tabs.map((tab) => tab.label)).toEqual(['pilot', 'crew · 4', 'crew 2 · 1']);
    expect(state.panes.slice(2, 5).map((pane) => pane.direction)).toEqual(['right', 'down', 'down']);
  });

  it('keeps reviews in their own tab and leaves a ticketless run without ticket metadata', async () => {
    const mux = setup('herdr');
    const opened = await adapter('herdr', mux).open({ ...view, role: 'review', ticket: undefined });
    expect(opened).toMatchObject({ ok: true, ref: { label: 'REVIEW-1' } });
    const state = mux.state() as unknown as { tabs: { label: string }[]; panes: { tokens: object }[] };
    expect(state.tabs.map((tab) => tab.label)).toEqual(['pilot', 'review · 1']);
    expect(state.panes[1]?.tokens).toEqual({ run: RUN });
  });

  it.each(['pane rename', 'pane report-metadata', 'pane run'])('closes the pane it created when %s fails', async (step) => {
    const mux = setup('herdr', { FAKE_MUX_FAIL: step });
    expect(await adapter('herdr', mux).open(view)).toMatchObject({ ok: false, cause: { code: 'exit-nonzero', step } });
    const state = mux.state() as unknown as { tabs: { label: string }[]; panes: unknown[] };
    expect(state.panes).toHaveLength(1);
    expect(state.tabs.map((tab) => tab.label)).toEqual(['pilot']);
  });

  it('refuses a display command a shell would expand, before touching the layout', async () => {
    const mux = setup('herdr');
    expect(await adapter('herdr', mux).open({ ...view, command: ['claude', 'attach', '$(id)'] }))
      .toMatchObject({ ok: false, cause: { code: 'not-representable' } });
    expect(mux.state().log ?? []).toEqual([]);
  });

  it('relabels the crew tab when a run surface closes', async () => {
    const mux = setup('herdr');
    const surface = adapter('herdr', mux);
    const first = await surface.open(view);
    await surface.open({ ...view, runId: OTHER });
    if (!first.ok) throw new Error('open failed');
    await surface.close(first.ref);
    expect((mux.state() as unknown as { tabs: { label: string }[] }).tabs.map((tab) => tab.label))
      .toEqual(['pilot', 'crew · 1']);
  });
  it('relabels the crew tab when it finds the pane already closed by a person', async () => {
    const mux = setup('herdr');
    const surface = adapter('herdr', mux);
    const first = await surface.open(view);
    await surface.open({ ...view, runId: OTHER });
    if (!first.ok) throw new Error('open failed');
    mux.write((state) => { state['panes'] = (state['panes'] as { pane_id: string }[]).filter((pane) => pane.pane_id !== first.ref.id); });
    expect(await surface.close(first.ref)).toEqual({ outcome: 'already-absent' });
    expect((mux.state() as unknown as { tabs: { label: string }[] }).tabs.map((tab) => tab.label))
      .toEqual(['pilot', 'crew · 1']);
  });
});

describe('tmux placement and marker', () => {
  it('runs the display command as argv, beside the caller, then stacked below', async () => {
    const mux = setup('tmux');
    const surface = adapter('tmux', mux);
    await surface.open(view);
    await surface.open({ ...view, runId: OTHER });
    const state = mux.state() as unknown as { socket: string; panes: { id: string; title: string; run?: string; command?: string[];
      direction?: string; from?: string; cwd?: string }[] };
    expect(state.socket).toBe('/tmp/tmux-501/default');
    expect(state.panes[1]).toMatchObject({ title: 'WORK-1', run: RUN, command: ['claude', 'attach', '6d5ea8bb'],
      direction: 'right', from: '%1', cwd: '/work/tree' });
    expect(state.panes[2]).toMatchObject({ title: 'WORK-2', direction: 'down', from: state.panes[1]?.id });
  });

  it('refuses a one-word display command, which tmux would hand to sh -c', async () => {
    const mux = setup('tmux');
    expect(await adapter('tmux', mux).open({ ...view, command: ['claude'] }))
      .toMatchObject({ ok: false, cause: { code: 'not-representable' } });
  });

  it('kills the pane it created when the marker cannot be set', async () => {
    const mux = setup('tmux', { FAKE_MUX_FAIL: 'set-option' });
    expect(await adapter('tmux', mux).open(view)).toMatchObject({ ok: false, cause: { step: 'set-option' } });
    expect((mux.state() as unknown as { panes: unknown[] }).panes).toHaveLength(1);
  });
});

describe('cmux, carrying the former mission presentation script', () => {
  it('stacks runs beside the coordinator, then below the last one, titled with their run', async () => {
    const mux = setup('cmux');
    const surface = adapter('cmux', mux);
    for (const runId of [RUN, OTHER, 'run_00000000-0000-4000-8000-000000000003']) await surface.open({ ...view, runId });
    const state = mux.state() as unknown as { surfaces: { ref: string; title: string; direction?: string; from?: string; command?: string }[];
      status: Record<string, string> };
    expect(state.surfaces.map((known) => known.direction)).toEqual([undefined, 'right', 'down', 'down']);
    expect(state.surfaces[2]?.from).toBe(state.surfaces[1]?.ref);
    expect(state.surfaces[1]).toMatchObject({ title: `WORK-1 | ${RUN}`, command: 'claude attach 6d5ea8bb' });
    expect(state.status['void-WORK-1']).toBe('WORK-1 | DEV-925');
    expect(mux.state().log.every((entry) => entry.socket === '/tmp/cmux.sock')).toBe(true);
  });

  it('ignores foreign surfaces rather than refusing to show the run', async () => {
    const mux = setup('cmux');
    mux.write((state) => { (state['surfaces'] as unknown[]).push({ ref: 'surface:9', title: 'user work', type: 'terminal' }); });
    expect(await adapter('cmux', mux).open(view)).toMatchObject({ ok: true, ref: { label: 'WORK-1' } });
  });

  it('attributes nothing when the tree shows more than one new surface', async () => {
    const mux = setup('cmux', { FAKE_MUX_EXTRA: '1' });
    expect(await adapter('cmux', mux).open(view)).toMatchObject({ ok: false, cause: { code: 'needs-reconciliation' } });
    expect(mux.state().log.map((entry) => entry.step)).not.toContain('close-surface');
  });

  it('closes the split it created when the title cannot be set', async () => {
    const mux = setup('cmux', { FAKE_MUX_FAIL: 'rename-tab' });
    expect(await adapter('cmux', mux).open(view)).toMatchObject({ ok: false, cause: { step: 'rename-tab' } });
    expect((mux.state() as unknown as { surfaces: unknown[] }).surfaces).toHaveLength(1);
  });

  it('propagates a failed split as the cause, with no surface left behind', async () => {
    const mux = setup('cmux', { FAKE_MUX_FAIL: 'new-split' });
    expect(await adapter('cmux', mux).open(view)).toMatchObject({ ok: false, cause: { step: 'new-split' } });
    expect((mux.state() as unknown as { surfaces: unknown[] }).surfaces).toHaveLength(1);
  });

  it('reads a malformed tree as a failure, never as an empty workspace', async () => {
    const mux = setup('cmux');
    mux.write((state) => { state['workspace'] = 'OTHER'; });
    expect(await adapter('cmux', mux).open(view)).toMatchObject({ ok: false });
  });
});

describe('no multiplexer', () => {
  it('opens nothing and closes nothing', async () => {
    const none = createNoSurface();
    expect(await none.open(view)).toMatchObject({ ok: false, cause: { code: 'not-detected' } });
    expect(none.kind).toBe('none');
  });
});
