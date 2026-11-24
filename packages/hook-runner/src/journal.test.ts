import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readMissionJournals } from './journal.js';

// The journals of one project sit at two locations at once: a project whose
// installed harness predates the machine/ split keeps writing to the old one
// while its history sits under the new. Reading whichever exists first returns
// half a story, which is how a guardrail would call a live harness dead.
const roots: string[] = [];

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'void-journal-'));
  roots.push(root);
  return root;
}

function mission(root: string, location: 'machine' | 'legacy', id: string, body: string, mtimeS?: number): void {
  const runs = location === 'machine' ? join(root, '.void', 'machine', 'runs') : join(root, '.void', 'runs');
  const dir = join(runs, id);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'events.jsonl');
  writeFileSync(file, body);
  if (mtimeS !== undefined) utimesSync(file, mtimeS, mtimeS);
}

const MIS_A = 'mis_aaaaaaaaaaaaaaaa';
const MIS_B = 'mis_bbbbbbbbbbbbbbbb';
const MIS_C = 'mis_cccccccccccccccc';

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('readMissionJournals', () => {
  it('returns both locations, so a half-migrated project keeps its whole history', () => {
    const root = project();
    mission(root, 'machine', MIS_A, '{"seq":1}\n');
    mission(root, 'legacy', MIS_B, '{"seq":2}\n');
    const body = readMissionJournals(root);
    expect(body).toContain('{"seq":1}');
    expect(body).toContain('{"seq":2}');
  });

  it('returns nothing for a project that never recorded anything', () => {
    expect(readMissionJournals(project())).toBe('');
  });

  it('skips a directory whose name is not a mission id', () => {
    const root = project();
    mission(root, 'machine', MIS_A, '{"seq":1}\n');
    mkdirSync(join(root, '.void', 'machine', 'runs', 'notamission'), { recursive: true });
    writeFileSync(join(root, '.void', 'machine', 'runs', 'notamission', 'events.jsonl'), '{"seq":99}\n');
    expect(readMissionJournals(root)).not.toContain('99');
  });

  it('refuses a symlinked journal, so local telemetry cannot redirect the read', () => {
    const root = project();
    mission(root, 'machine', MIS_A, '{"seq":1}\n');
    const secret = join(root, 'secret.jsonl');
    writeFileSync(secret, '{"seq":666}\n');
    const dir = join(root, '.void', 'machine', 'runs', MIS_B);
    mkdirSync(dir, { recursive: true });
    symlinkSync(secret, join(dir, 'events.jsonl'));
    expect(readMissionJournals(root)).not.toContain('666');
  });

  it('keeps only the most recently written missions when asked for the recent ones', () => {
    const root = project();
    mission(root, 'machine', MIS_A, '{"seq":1}\n', 1_000);
    mission(root, 'legacy', MIS_B, '{"seq":2}\n', 2_000);
    mission(root, 'machine', MIS_C, '{"seq":3}\n', 3_000);
    const body = readMissionJournals(root, { recentMissions: 2 });
    expect(body).toContain('{"seq":3}');
    expect(body).toContain('{"seq":2}');
    expect(body).not.toContain('{"seq":1}');
  });

  it('ranks recency across both locations, never one location before the other', () => {
    const root = project();
    mission(root, 'machine', MIS_A, '{"seq":1}\n', 1_000);
    mission(root, 'legacy', MIS_B, '{"seq":2}\n', 9_000);
    expect(readMissionJournals(root, { recentMissions: 1 })).toContain('{"seq":2}');
  });

  it('stops at the byte ceiling rather than reading an unbounded amount', () => {
    const root = project();
    mission(root, 'machine', MIS_A, `${'a'.repeat(4_000)}\n`);
    mission(root, 'machine', MIS_B, `${'b'.repeat(4_000)}\n`);
    expect(readMissionJournals(root, { maxBytes: 5_000 }).length).toBeLessThan(9_000);
  });
});

