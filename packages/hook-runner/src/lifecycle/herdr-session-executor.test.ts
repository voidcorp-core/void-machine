import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeHerdrSession, type SessionRun } from './herdr-session-executor.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'session-executor-')); roots.push(root);
  const codex = join(root, '.codex'); mkdirSync(codex);
  writeFileSync(join(codex, 'herdr-agent-state.sh'), 'exit 0\n');
  const env = { HOME: root, HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HERDR_SOCKET_PATH: 'fixture' };
  const input = Buffer.from(' { "hook_event_name":"SessionStart" }\n\n');
  return { env, input };
}
const discovery = (pids: number[]) => Buffer.from(JSON.stringify({ result: { process_info: {
  pane_id: 'w1:p1', foreground_processes: pids.map(pid => ({ pid })),
} } }));

describe('Herdr session ownership budgets', () => {
  it('stops a parent cycle without relaying', () => {
    const f = fixture(); let lookups = 0;
    const run: SessionRun = (command) => {
      if (command === 'herdr') return discovery([2147483647]);
      if (command === 'ps') { lookups++; return Buffer.from(String(process.pid)); }
      throw Error('unexpected native relay');
    };
    expect(executeHerdrSession(f.input, f.env, 'codex', run).diagnostic)
      .toContain('parent-cycle');
    expect(lookups).toBe(1);
  });

  it('bounds a noncyclic parent walk to 64 lookups', () => {
    const f = fixture(); let lookups = 0;
    const run: SessionRun = (command) => {
      if (command === 'herdr') return discovery([2147483647]);
      if (command === 'ps') { lookups++; return Buffer.from(String(process.pid + lookups)); }
      throw Error('unexpected native relay');
    };
    expect(executeHerdrSession(f.input, f.env, 'codex', run).diagnostic)
      .toContain('parent-depth-exceeded');
    expect(lookups).toBe(64);
  });

  it('shares the discovery deadline rather than renewing each process budget', () => {
    const f = fixture(); let now = 0;
    const timeouts: number[] = [];
    const run: SessionRun = (command, _args, options) => {
      timeouts.push(options.timeout); now += 1000;
      if (command === 'herdr') return discovery([2147483647]);
      if (command === 'ps') return Buffer.from(String(process.pid + 1));
      throw Error('unexpected native relay');
    };
    expect(executeHerdrSession(f.input, f.env, 'codex', run, () => now).diagnostic)
      .toContain('discovery-deadline');
    expect(timeouts).toEqual([2000, 1000]);
  });

  it('passes an independent relay budget and the unmodified buffer once', () => {
    const f = fixture(); const relayed: Uint8Array[] = [];
    const run: SessionRun = (command, args, options) => {
      expect(options.shell).toBe(false); expect(options.maxBuffer).toBe(262144);
      expect(options.killSignal).toBe('SIGKILL');
      if (command === 'herdr') return discovery([process.pid]);
      expect(command).toBe('sh'); expect(args.at(-1)).toBe('session');
      expect(options.timeout).toBe(1000);
      if (options.input !== undefined) relayed.push(options.input);
      return Buffer.from('native\n');
    };
    const result = executeHerdrSession(f.input, f.env, 'codex', run);
    expect(result.status).toBe('ok'); expect(result.output).toEqual(Buffer.from('native\n'));
    expect(relayed).toEqual([f.input]);
  });
});
