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
    release: async () => undefined,
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

function context(cwd: string, runtimePort: AgentRuntimePort, surface: SurfacePort): AgentsContext {
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
  it('opens a surface running the display command at dispatch, and records it beside the run', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr');
    const receipt = await dispatchAgent(context(cwd, runtime(), surface.port), input(cwd));
    expect(receipt).toMatchObject({ ok: true, surface: { state: 'open', ref: { label: 'WORK-1', id: 'w1:p9' } } });
    expect(surface.opened).toEqual([{ runId: RUN, role: 'work', ticket: 'DEV-925', cwd,
      command: ['claude', 'attach', '6d5ea8bb'] }]);
  });

  it('keeps the run dispatched without a view when the multiplexer fails, and says why', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr', { open: () => ({ ok: false,
      cause: { code: 'unreachable', step: 'tab list' } }) });
    const ctx = context(cwd, runtime(), surface.port);
    expect(await dispatchAgent(ctx, input(cwd))).toMatchObject({ ok: true, status: { state: 'dispatched' },
      surface: { state: 'failed', cause: { code: 'unreachable' } } });
    expect(await agentStatus(ctx, RUN)).toMatchObject({ ok: true, runs: [{ status: { state: 'dispatched' },
      surface: { state: 'failed', cause: { code: 'unreachable' } } }] });
  });

  it('opens nothing for a runtime with no display command, and says so', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr');
    expect(await dispatchAgent(context(cwd, runtime({ attach: false }), surface.port), input(cwd)))
      .toMatchObject({ ok: true, surface: { state: 'none', cause: { code: 'no-display-command' } } });
    expect(surface.opened).toEqual([]);
  });

  it('opens nothing outside a multiplexer: the run is the same native session', async () => {
    const cwd = repository();
    expect(await dispatchAgent(context(cwd, runtime(), createNoSurface()), input(cwd)))
      .toMatchObject({ ok: true, surface: { state: 'none', cause: { code: 'not-detected' } } });
  });

  it('opens the surface after the mission lock is released', async () => {
    const cwd = repository();
    let ctx: AgentsContext | undefined;
    let lockFree = false;
    const surface = scriptedSurface('herdr', { beforeOpen: async () => {
      const lock = await ctx?.store.lock(MISSION, 'probe');
      lockFree = lock !== undefined;
      await lock?.release();
    } });
    ctx = context(cwd, runtime(), surface.port);
    await dispatchAgent(ctx, input(cwd));
    expect(lockFree).toBe(true);
  });
});

describe('closing the surface of a closed run', () => {
  it('closes the surface once the run is retired, and leaves the run and its evidence untouched', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr');
    const ctx = context(cwd, runtime({ sessions: listed('done') }), surface.port);
    await dispatchAgent(ctx, input(cwd));
    await acceptable(cwd, ctx);
    const accepted = await acceptAgent(ctx, RUN);
    expect(accepted).toMatchObject({ ok: true, state: 'retired', surface: { outcome: 'closed' } });
    expect(surface.closed.map((ref) => ref.id)).toEqual(['w1:p9']);
    const before = evidence(cwd);
    expect(await agentStatus(ctx, RUN)).toMatchObject({ runs: [{ status: { state: 'retired' },
      surface: { state: 'closed' } }] });
    expect(evidence(cwd)).toEqual(before);
  });

  it('retires the run even when the multiplexer fails to close the surface, and keeps the surface on record', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr', { closing: { outcome: 'failed', cause: { code: 'timeout' } } });
    const ctx = context(cwd, runtime({ sessions: listed('done') }), surface.port);
    await dispatchAgent(ctx, input(cwd));
    await acceptable(cwd, ctx);
    expect(await acceptAgent(ctx, RUN)).toMatchObject({ ok: true, state: 'retired',
      surface: { outcome: 'failed', cause: { code: 'timeout' } } });
    expect(await agentStatus(ctx, RUN)).toMatchObject({ runs: [{ status: { state: 'retired' },
      surface: { state: 'open', lastClose: { outcome: 'failed' } } }] });
  });

  it('never closes the surface when the run cannot be retired', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr');
    const ctx = context(cwd, runtime({ sessions: listed('working') }), surface.port);
    await dispatchAgent(ctx, input(cwd));
    expect(await acceptAgent(ctx, RUN)).toMatchObject({ ok: false });
    expect(surface.closed).toEqual([]);
  });

  it('closes the surface of a stopped run, which never retires', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr');
    const ctx = context(cwd, runtime(), surface.port);
    await dispatchAgent(ctx, input(cwd));
    expect(await stopAgent(ctx, RUN)).toMatchObject({ ok: true, status: { state: 'stopped' },
      surface: { outcome: 'closed' } });
  });

  it('closes a surface whose open finished after the run was already stopped', async () => {
    const cwd = repository();
    let ctx: AgentsContext | undefined;
    const surface = scriptedSurface('herdr', { beforeOpen: async () => {
      if (ctx !== undefined) await stopAgent(ctx, RUN);
    } });
    ctx = context(cwd, runtime(), surface.port);
    expect(await dispatchAgent(ctx, input(cwd))).toMatchObject({ ok: true, surface: { state: 'closed' } });
    expect(surface.closed.map((ref) => ref.id)).toEqual(['w1:p9']);
  });

  it('keeps open a surface whose run failed while it was opening: a failed run keeps its view', async () => {
    const cwd = repository();
    let ctx: AgentsContext | undefined;
    const failing = () => new Map([[`vm-${RUN}`, { observation: { kind: 'present' as const, state: 'failed' as const },
      binding: { handle: '6d5ea8bb', sessionId: SESSION } }]]);
    const surface = scriptedSurface('herdr', { beforeOpen: async () => {
      if (ctx !== undefined) await waitAgents(ctx, [RUN], { any: true, timeoutMs: 10_000 });
    } });
    ctx = context(cwd, runtime({ sessions: failing }), surface.port);
    expect(await dispatchAgent(ctx, input(cwd))).toMatchObject({ ok: true, surface: { state: 'open' } });
    expect(surface.closed).toEqual([]);
    expect(await agentStatus(ctx, RUN)).toMatchObject({ runs: [{ status: { state: 'failed' },
      surface: { state: 'open' } }] });
  });

  it('closes and records as failed a surface opened while the mission stayed busy', async () => {
    const cwd = repository();
    let ctx: AgentsContext | undefined;
    let held: { release(): Promise<void> } | undefined;
    const surface = scriptedSurface('herdr', { beforeOpen: async () => {
      held = await ctx?.store.lock(MISSION, 'another-command');
    } });
    ctx = context(cwd, runtime(), surface.port);
    const receipt = await dispatchAgent(ctx, input(cwd));
    await held?.release();
    expect(receipt).toMatchObject({ ok: true, surface: { state: 'failed', cause: { code: 'deadline' } } });
    expect(surface.closed.map((ref) => ref.id)).toEqual(['w1:p9']);
    expect(await agentStatus(ctx, RUN)).toMatchObject({ runs: [{ surface: { state: 'failed' } }] });
  });

  it('keeps as orphan a surface it could neither record nor close', async () => {
    const cwd = repository();
    let ctx: AgentsContext | undefined;
    let held: { release(): Promise<void> } | undefined;
    const surface = scriptedSurface('herdr', { closing: { outcome: 'failed', cause: { code: 'timeout' } },
      beforeOpen: async () => { held = await ctx?.store.lock(MISSION, 'another-command'); } });
    ctx = context(cwd, runtime(), surface.port);
    await dispatchAgent(ctx, input(cwd));
    await held?.release();
    expect(await agentStatus(ctx, RUN)).toMatchObject({ runs: [{ surface: { state: 'failed',
      orphan: { id: 'w1:p9' } } }] });
  });
});

describe('what status says about the surface', () => {
  it('says the pane was closed by a person while the run keeps working', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr', { presence: { state: 'closed' } });
    const ctx = context(cwd, runtime({ sessions: listed('working') }), surface.port);
    await dispatchAgent(ctx, input(cwd));
    await waitAgents(ctx, [RUN], { any: true, timeoutMs: 10_000 });
    expect(await agentStatus(ctx, RUN)).toMatchObject({ runs: [{ status: { state: 'working' },
      surface: { state: 'closed-outside', note: expect.stringContaining('the run continues') } }] });
  });

  it('reads an unreachable multiplexer as unknown, never as closed', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr', { presence: { state: 'unknown', cause: { code: 'timeout' } } });
    const ctx = context(cwd, runtime(), surface.port);
    await dispatchAgent(ctx, input(cwd));
    expect(await agentStatus(ctx, RUN)).toMatchObject({ runs: [{ surface: { state: 'unknown',
      cause: { code: 'timeout' } } }] });
  });

  it('closes after a person closed the pane without an error', async () => {
    const cwd = repository();
    const surface = scriptedSurface('herdr', { presence: { state: 'closed' }, closing: { outcome: 'already-absent' } });
    const ctx = context(cwd, runtime({ sessions: listed('done') }), surface.port);
    await dispatchAgent(ctx, input(cwd));
    await acceptable(cwd, ctx);
    expect(await acceptAgent(ctx, RUN)).toMatchObject({ ok: true, state: 'retired',
      surface: { outcome: 'already-absent' } });
  });
});
