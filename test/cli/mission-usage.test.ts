// @test-resource subprocess
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adaptRuntimeInput } from '../../packages/hook-runner/src/runtime-input.js';
import type { CanonicalEvent } from '@voidcorp/mission-engine';

const CLI = resolve(__dirname, '../../packages/cli/bin/void-machine.mjs');
const id = 'mis_0123456789abcdef';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mission-usage-'));
  const git = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
  expect(git.status, git.stderr).toBe(0);
  const directory = join(root, '.void', 'machine', 'runs', id);
  mkdirSync(directory, { recursive: true });
  const event = (seq: number, kind: string, subject: string, payload: CanonicalEvent['payload'] = {}): CanonicalEvent => ({
    schemaVersion: 1, seq, eventId: `evt_0000000${seq}`, missionId: id,
    ts: '2026-10-23T10:00:00.000Z', source: 'runtime:codex', kind, subject, correlationId: id, payload,
  });
  const log = join(directory, 'events.jsonl');
  writeFileSync(log, [event(1, 'mission.started', 'mission', { title: 'Example', mode: 'team' }),
    event(2, 'specialist.started', 'core:devex-docs-engineer'),
    event(3, 'hook.completed', 'hook:tdd-order', { status: 'skipped' }),
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
  return { root, log, directory };
}
function run(root: string, usage = true) {
  return spawnSync(process.execPath, [CLI, 'mission', 'inspect', '--id', id,
    ...(usage ? ['--usage'] : []), '--json'], { cwd: root, encoding: 'utf8', timeout: 15000 });
}

describe('mission usage CLI', () => {
  it('adds counts only on request, maps the real hook owner, and preserves verdict exit semantics', () => {
    const { root } = fixture();
    const ordinary = run(root, false);
    const result = run(root);
    expect(result.status).toBe(ordinary.status);
    expect(result.stderr).toBe('');
    const document = JSON.parse(result.stdout);
    expect(document.status).toBe(JSON.parse(ordinary.stdout).status);
    expect(JSON.parse(ordinary.stdout)).not.toHaveProperty('usage');
    expect(document.usage.rows.find((row: { name: string }) => row.name === 'tdd-guard'))
      .toMatchObject({ observedHits: 1, outcomes: { skipped: 1 } });
    expect(document.usage.rows.find((row: { name: string }) => row.name === 'devex-docs-engineer').observedHits).toBe(1);
    expect(document.usage.rows.find((row: { name: string }) => row.name === 'void-tdd').observedHits).toBe('unknown');
    expect(document.usage.notes.join(' ')).toContain('not a proven ticket');
  });

  it('counts actual native Skill subject namespaces without conflating foreign providers', () => {
    const { root, log } = fixture();
    const events = ['harness:void-tdd', 'core/void-tdd', 'superpowers:void-tdd'].map((name, index) => {
      const adapted = adaptRuntimeInput({ tool_name: 'Skill', tool_input: { skill: name },
        session_id: 'native-session' }, { runtime: 'claude', root, phase: 'activation' });
      if (adapted === undefined) throw new Error('Native Skill fixture did not adapt');
      return { schemaVersion: 1, seq: index + 4, eventId: `evt_native_000${index}`, missionId: id,
        ts: '2026-10-23T10:00:00.000Z', source: adapted.source, kind: adapted.kind,
        subject: adapted.subject, correlationId: id, payload: adapted.payload } satisfies CanonicalEvent;
    });
    writeFileSync(log, readFileSync(log, 'utf8') + events.map(event => JSON.stringify(event)).join('\n') + '\n');
    const report = JSON.parse(run(root).stdout).usage;
    expect(report.rows.find((row: { name: string }) => row.name === 'void-tdd'))
      .toMatchObject({ observedHits: 2, runtimeHits: { claude: 2, codex: 'unknown' } });
    expect(report.rows.find((row: { name: string }) => row.name === 'superpowers:void-tdd'))
      .toMatchObject({ observedHits: 1, catalogued: false });
  });

  it('exposes a damaged journal as incomplete without creating quarantine or leaking invalid payloads', () => {
    const { root, log, directory } = fixture();
    const body = readFileSync(log, 'utf8') + '{PRIVATE_CANARY\n';
    writeFileSync(log, body);
    const before = readdirSync(directory, { recursive: true });
    const result = run(root);
    expect(result.status).toBe(1);
    const document = JSON.parse(result.stdout);
    expect(document.usage.notes.join(' ')).toContain('Journal incomplete');
    expect(result.stdout + result.stderr).not.toContain('PRIVATE_CANARY');
    expect(readFileSync(log, 'utf8')).toBe(body);
    expect(readdirSync(directory, { recursive: true })).toEqual(before);
  });
});
