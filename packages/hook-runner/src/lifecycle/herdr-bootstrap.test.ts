import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeHerdrMetadata, type MetadataRun } from './herdr-metadata-executor.js';

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'herdr-bootstrap-')));
  const common = join(root, '.git');
  mkdirSync(common);
  const calls: string[][] = [];
  const env = { HOME: root, HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HERDR_SOCKET_PATH: '/test/socket' };
  const pane = { pane_id: 'w1:p1', workspace_id: 'w1', cwd: root, label: 'ORCH' };
  const run: MetadataRun = (command, args) => {
    calls.push([command, ...args]);
    if (command === 'git') return common;
    if (command === 'ps') return '1';
    if (args[1] === 'list') return JSON.stringify({ result: { panes: [pane] } });
    if (args[1] === 'process-info') return JSON.stringify({ result: { process_info: {
      pane_id: pane.pane_id, foreground_processes: [{ pid: process.pid }],
    } } });
    throw Error('unexpected command');
  };
  return { root, common, env, pane, run, calls };
}
const start = { hook_event_name: 'SessionStart', source: 'startup' };

describe('consumer worker host bootstrap before any mission exists', () => {
  it.each(['codex', 'claude'] as const)('advises the %s coordinator using a proven host without launching anything', runtime => {
    const f = fixture();
    const result = executeHerdrMetadata(start, f.root, f.env, runtime, f.run);
    expect(result.status).toBe('ok');
    expect(result.output?.hookSpecificOutput.additionalContext).toContain('void-orchestrate');
    expect(result.output?.hookSpecificOutput.additionalContext).toContain('w1:p1');
    expect(result.details).toMatchObject({ host: 'herdr', mission: 'absent' });
    expect(f.calls.map(call => call.slice(0, 2))).toEqual([
      ['git', 'rev-parse'], ['herdr', 'pane'], ['herdr', 'pane'],
    ]);
  });
  it('performs no discovery outside Herdr', () => {
    const f = fixture();
    expect(executeHerdrMetadata(start, f.root, {}, 'codex', f.run).status).toBe('skipped');
    expect(f.calls).toEqual([]);
  });
  it.each(['foreign-project', 'duplicate-coordinator', 'unproven-process', 'denied-transport', 'stale-pane'])
  ('diagnoses %s without a launch or metadata write', scenario => {
    const f = fixture();
    if (scenario === 'stale-pane') f.env.HERDR_PANE_ID = 'w9:p9';
    const foreign = realpathSync(mkdtempSync(join(tmpdir(), 'herdr-foreign-')));
    const run: MetadataRun = (command, args, options) => {
      if (command === 'herdr' && scenario === 'denied-transport') throw Error('permission denied');
      if (args[1] === 'list' && scenario === 'foreign-project') {
        return JSON.stringify({ result: { panes: [{ ...f.pane, cwd: foreign }] } });
      }
      if (args[1] === 'list' && scenario === 'duplicate-coordinator') {
        return JSON.stringify({ result: { panes: [f.pane, { ...f.pane, pane_id: 'w1:p2', cwd: `${f.root}/.` }] } });
      }
      if (args[1] === 'process-info' && scenario === 'unproven-process') {
        return JSON.stringify({ result: { process_info: { pane_id: f.pane.pane_id,
          foreground_processes: [{ pid: process.pid + 100000 }] } } });
      }
      return f.run(command, args, options);
    };
    const result = executeHerdrMetadata(start, f.root, f.env, 'codex', run);
    expect(result.status).toBe('degraded');
    expect(result.diagnostic).toBeTruthy();
    expect(result.output?.hookSpecificOutput.additionalContext).toContain('Native delegation');
    expect(f.calls.flat()).not.toContain('report-metadata');
    expect(f.calls.flat()).not.toContain('start');
  });
  it('does not bootstrap past an invalid explicit mission selection', () => {
    const f = fixture();
    mkdirSync(join(f.root, '.void/machine'), { recursive: true });
    writeFileSync(join(f.root, '.void/machine/orchestra-selection.json'), '{}');
    const result = executeHerdrMetadata(start, f.root, f.env, 'claude', f.run);
    expect(result.status).toBe('degraded');
    expect(f.calls).toHaveLength(1);
  });
  it('does not run bootstrap discovery on Stop or SessionEnd', () => {
    for (const hook_event_name of ['Stop', 'SessionEnd']) {
      const f = fixture();
      expect(executeHerdrMetadata({ hook_event_name }, f.root, f.env, 'codex', f.run).status).toBe('skipped');
      expect(f.calls).toHaveLength(1);
    }
  });
});
