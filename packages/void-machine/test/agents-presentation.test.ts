import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { createNoSurface } from '../src/adapters/presentation/none.js';
import { createRunRegistry, resolveMachineRoot } from '../src/adapters/store/run-registry.js';
import {
  type AgentsContext, acceptAgent, agentStatus, dispatchAgent, stopAgent, waitAgents,
} from '../src/application/agents.js';
import type { SurfaceKind } from '../src/core/presentation.js';
import type { AgentRuntimePort, RuntimeCapabilities, SessionState } from '../src/runtime/delegation.js';
import type {
  SurfaceClosing, SurfaceOpening, SurfacePort, SurfacePresence, SurfaceRef, SurfaceView,
} from '../src/runtime/presentation.js';

const SESSION = '6d5ea8bb-764f-4463-b733-8b94509eb25e';
const MISSION = 'mis_presentation-test';
const RUN = 'run_00000000-0000-4000-8000-000000000001';

function repository(): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'vm-surfaces-')));
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: base, stdio: 'ignore' });
  return base;
}

/** What a Claude-like runtime declares: a view, a capture, no schema. */
const capabilities: RuntimeCapabilities = {
  view: { available: true, provenance: 'verified', note: 'attach' },
  capture: { available: true, provenance: 'verified', note: 'hook' },
  structuredOutput: { available: false, provenance: 'documented', note: 'none' },
};

function runtime(options: { attach?: boolean; sessions?: () => ReadonlyMap<string, SessionState> } = {}): AgentRuntimePort {
  return {
    capabilities,
    preflight: async () => ({ ok: true }),
    dispatch: async () => ({ kind: 'acknowledged', handle: '6d5ea8bb' }),
    observe: async () => ({ kind: 'read', sessions: options.sessions?.() ?? new Map() }),
    send: async () => ({ kind: 'acknowledged', handle: '6d5ea8bb' }),
    stop: async () => ({ ok: true }),
    attachCommand: (ref) => options.attach === false || ref.handle === undefined ? undefined
      : ['claude', 'attach', ref.handle],
  };
}

/** A multiplexer whose every answer the test chooses, and which records what it was asked. */
function scriptedSurface(kind: SurfaceKind, script: { open?: (view: SurfaceView) => SurfaceOpening;
  presence?: SurfacePresence; closing?: SurfaceClosing; beforeOpen?: () => Promise<void> } = {}) {
  const opened: SurfaceView[] = [];
  const closed: SurfaceRef[] = [];
  const port: SurfacePort = {
    kind,
    async open(view) {
      await script.beforeOpen?.();
      opened.push(view);
      return script.open?.(view) ?? { ok: true, ref: { kind, scope: '/tmp/mux.sock', container: 'w1', id: 'w1:p9',
        label: 'WORK-1', runId: view.runId } };
    },
    inspect: async () => script.presence ?? { state: 'open' },
    async close(ref) { closed.push(ref); return script.closing ?? { outcome: 'closed' }; },
  };
  return { port, opened, closed };
}

function context(cwd: string, runtimePort: AgentRuntimePort, surface: SurfacePort): AgentsContext & { surfaces: { detected: SurfacePort; reach: () => SurfacePort } } {
  const root = resolveMachineRoot(cwd);
  if (!root.ok) throw new Error(root.cause);
  const now = { value: 10_000 };
  let runs = 0;
  return {
    store: createRunRegistry({ machineRoot: root.root, now: () => now.value }),
    runtimes: { claude: runtimePort, codex: runtimePort },
    surfaces: { detected: surface, reach: () => surface },
    clock: { now: () => now.value, sleep: async (ms) => { now.value += ms; } },
    owner: 'test',
    newRunId: () => `run_00000000-0000-4000-8000-${String(++runs).padStart(12, '0')}`,
    newMissionId: () => MISSION,
  };
}

const input = (cwd: string) => ({ role: 'work' as const, cwd, brief: 'Implement DEV-925.', ticket: 'DEV-925',
  missionId: MISSION });
const listed = (state: 'working' | 'done') => () => new Map([[`vm-${RUN}`, {
  observation: { kind: 'present' as const, state }, binding: { handle: '6d5ea8bb', sessionId: SESSION } }]]);

function recordResult(cwd: string, text: string): void {
  const root = resolveMachineRoot(cwd);
  if (!root.ok) throw new Error(root.cause);
  const claim = JSON.parse(readFileSync(join(root.root, 'agents', 'sessions', `${SESSION}.json`), 'utf8'));
  writeFileSync(claim.resultPath, JSON.stringify({ schemaVersion: 1, sessionId: SESSION, recordedAt: 20_000,
    lastAssistantMessage: text, truncated: false }));
}

/** Every file of the run directory, with its bytes: what closing a surface must leave untouched. */
function evidence(cwd: string): Record<string, string> {
  const root = resolveMachineRoot(cwd);
  if (!root.ok) throw new Error(root.cause);
  const directory = join(root.root, 'runs', MISSION, 'agents', RUN);
  const files: Record<string, string> = {};
  const walk = (path: string, prefix: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.name === 'surface.json' || entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) walk(join(path, entry.name), `${prefix}${entry.name}/`);
      else files[`${prefix}${entry.name}`] = readFileSync(join(path, entry.name), 'utf8');
    }
  };
  walk(directory, '');
  return files;
}

async function acceptable(cwd: string, ctx: AgentsContext): Promise<void> {
  await waitAgents(ctx, [RUN], { any: true, timeoutMs: 10_000 });
  recordResult(cwd, 'Done.');
  await waitAgents(ctx, [RUN], { any: true, timeoutMs: 10_000 });
}

describe('showing a delegated run', () => {
  it('dispatches without opening or recording a presentation surface', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr');
    const ctx = context(cwd, runtime(), surface.port);
    expect(await dispatchAgent(ctx, input(cwd))).toMatchObject({ ok: true, status: { state: 'dispatched' } });
    expect(surface.opened).toEqual([]);
    expect(await ctx.store.readSurface(RUN)).toEqual({ kind: 'absent' });
  });

  it('does not let an unavailable multiplexer affect the dispatched run', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr', { open: () => ({ ok: false, cause: { code: 'unreachable' } }) });
    const ctx = context(cwd, runtime(), surface.port);
    expect(await dispatchAgent(ctx, input(cwd))).toMatchObject({ ok: true, status: { state: 'dispatched' } });
    expect(await agentStatus(ctx, RUN)).toMatchObject({ runs: [{ status: { state: 'dispatched' } }] });
    expect(surface.opened).toEqual([]);
  });

  it('keeps a runtime without an attach command independent of presentation', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr');
    const ctx = context(cwd, runtime({ attach: false }), surface.port);
    expect(await dispatchAgent(ctx, input(cwd))).toMatchObject({ ok: true });
    expect(surface.opened).toEqual([]);
    expect(await ctx.store.readSurface(RUN)).toEqual({ kind: 'absent' });
  });

  it('uses the same native dispatch outside a multiplexer', async () => {
    const cwd = repository();
    expect(await dispatchAgent(context(cwd, runtime(), createNoSurface()), input(cwd)))
      .toMatchObject({ ok: true, status: { state: 'dispatched' } });
  });

  it('never acquires presentation resources and releases the mission lock after dispatch', async () => {
    const cwd = repository();
    let presentationReached = false;
    const surface = scriptedSurface('herdr', { beforeOpen: async () => { presentationReached = true; } });
    const ctx = context(cwd, runtime(), surface.port);
    await dispatchAgent(ctx, input(cwd));
    const lock = await ctx.store.lock(MISSION, 'probe');
    expect(lock).toBeDefined();
    await lock?.release();
    expect(presentationReached).toBe(false);
  });
});

describe('closing the surface of a closed run', () => {
  it('retires and preserves the result without owning presentation cleanup', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr');
    const ctx = context(cwd, runtime({ sessions: listed('done') }), surface.port);
    await dispatchAgent(ctx, input(cwd));
    await acceptable(cwd, ctx);
    expect(await acceptAgent(ctx, RUN)).toMatchObject({ ok: true, state: 'retired', result: { text: 'Done.' } });
    expect(surface.closed).toEqual([]);
    const before = evidence(cwd);
    expect(await agentStatus(ctx, RUN)).toMatchObject({ runs: [{ status: { state: 'retired' } }] });
    expect(evidence(cwd)).toEqual(before);
  });

  it('retires without attempting a failing multiplexer cleanup', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr', { closing: { outcome: 'failed', cause: { code: 'timeout' } } });
    const ctx = context(cwd, runtime({ sessions: listed('done') }), surface.port);
    await dispatchAgent(ctx, input(cwd));
    await acceptable(cwd, ctx);
    expect(await acceptAgent(ctx, RUN)).toMatchObject({ ok: true, state: 'retired' });
    expect(surface.closed).toEqual([]);
  });

  it('never closes the surface when the run cannot be retired', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr');
    const ctx = context(cwd, runtime({ sessions: listed('working') }), surface.port);
    await dispatchAgent(ctx, input(cwd));
    expect(await acceptAgent(ctx, RUN)).toMatchObject({ ok: false });
    expect(surface.closed).toEqual([]);
  });

  it('stops an owned run without closing presentation resources', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr');
    const ctx = context(cwd, runtime(), surface.port);
    await dispatchAgent(ctx, input(cwd));
    expect(await stopAgent(ctx, RUN)).toMatchObject({ ok: true, status: { state: 'stopped' } });
    expect(surface.closed).toEqual([]);
  });

  it('does not allow a presentation callback to stop the runtime during dispatch', async () => {
    const cwd = repository();
    let ctx: AgentsContext | undefined;
    const surface = scriptedSurface('herdr', { beforeOpen: async () => {
      if (ctx !== undefined) await stopAgent(ctx, RUN);
    } });
    ctx = context(cwd, runtime(), surface.port);
    expect(await dispatchAgent(ctx, input(cwd))).toMatchObject({ ok: true, status: { state: 'dispatched' } });
    expect(surface.opened).toEqual([]);
    expect(await stopAgent(ctx, RUN)).toMatchObject({ ok: true, status: { state: 'stopped' } });
  });

  it('reports a native failure without touching any presentation resource', async () => {
    const cwd = repository();
    const failing = () => new Map([[`vm-${RUN}`, { observation: { kind: 'present' as const, state: 'failed' as const },
      binding: { handle: '6d5ea8bb', sessionId: SESSION } }]]);
    const surface = scriptedSurface('herdr');
    const ctx = context(cwd, runtime({ sessions: failing }), surface.port);
    await dispatchAgent(ctx, input(cwd));
    await waitAgents(ctx, [RUN], { any: true, timeoutMs: 10_000 });
    expect(await agentStatus(ctx, RUN)).toMatchObject({ runs: [{ status: { state: 'failed' } }] });
    expect(surface.opened).toEqual([]);
    expect(surface.closed).toEqual([]);
  });

  it('does not create a presentation lock or failure when presentation would hold the mission', async () => {
    const cwd = repository();
    let ctx: AgentsContext | undefined;
    let held: { release(): Promise<void> } | undefined;
    const surface = scriptedSurface('herdr', { beforeOpen: async () => { held = await ctx?.store.lock(MISSION, 'other'); } });
    ctx = context(cwd, runtime(), surface.port);
    expect(await dispatchAgent(ctx, input(cwd))).toMatchObject({ ok: true, status: { state: 'dispatched' } });
    expect(held).toBeUndefined();
    expect(surface.closed).toEqual([]);
  });

  it('preserves a recorded historical orphan without trying to close it', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr', { closing: { outcome: 'failed', cause: { code: 'timeout' } } });
    const ctx = context(cwd, runtime(), surface.port);
    await dispatchAgent(ctx, input(cwd));
    const orphan = { state: 'failed' as const, cause: { code: 'timeout' as const },
      orphan: { kind: 'herdr' as const, scope: '/tmp/mux.sock', id: 'w1:p9', label: 'WORK-1', runId: RUN } };
    await ctx.store.writeSurface(RUN, orphan);
    await agentStatus(ctx, RUN);
    expect(await ctx.store.readSurface(RUN)).toEqual({ kind: 'recorded', record: orphan });
    expect(surface.closed).toEqual([]);
  });
});

describe('what status says about the surface', () => {
  it('keeps the native worker running independently of a closed pane', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr', { presence: { state: 'closed' } });
    const ctx = context(cwd, runtime({ sessions: listed('working') }), surface.port);
    await dispatchAgent(ctx, input(cwd));
    await waitAgents(ctx, [RUN], { any: true, timeoutMs: 10_000 });
    expect(await agentStatus(ctx, RUN)).toMatchObject({ runs: [{ status: { state: 'working' } }] });
    expect(surface.closed).toEqual([]);
  });

  it('reports the recorded run without inspecting an unreachable multiplexer', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr', { presence: { state: 'unknown', cause: { code: 'timeout' } } });
    const ctx = context(cwd, runtime(), surface.port);
    await dispatchAgent(ctx, input(cwd));
    const before = evidence(cwd);
    expect(await agentStatus(ctx, RUN)).toMatchObject({ runs: [{ status: { state: 'dispatched' } }] });
    expect(evidence(cwd)).toEqual(before);
  });

  it('collects after a person closed the pane without another close request', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr', { presence: { state: 'closed' }, closing: { outcome: 'already-absent' } });
    const ctx = context(cwd, runtime({ sessions: listed('done') }), surface.port);
    await dispatchAgent(ctx, input(cwd));
    await acceptable(cwd, ctx);
    expect(await acceptAgent(ctx, RUN)).toMatchObject({ ok: true, state: 'retired' });
    expect(surface.closed).toEqual([]);
  });
});
