import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, readFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readDocument, projectIdentity, readOrchestra } from './orchestra-reader.js';

const readRace = vi.hoisted(() => ({ afterRead: undefined as (() => void) | undefined }));
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, readSync: (...args: Parameters<typeof fs.readSync>) => {
    const count = fs.readSync(...args);
    const race = readRace.afterRead; readRace.afterRead = undefined;
    race?.();
    return count;
  } };
});

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orchestra-')));
  const worktree = join(root, 'work');
  const repository = join(root, 'repo.git');
  mkdirSync(worktree); mkdirSync(repository);
  const project = projectIdentity(repository);
  const state = join(root, 'state');
  const directory = join(state, project, 'mission-1');
  mkdirSync(join(directory, 'workers', 'WORK-1'), { recursive: true });
  const worker = { label: 'WORK-1', agent: 'codex', worktree, branch: 'feature',
    ticket: 'DEV-1016', status: 'running', attempt: 'attempt-2' };
  const mission = { schema: 1, project, mission: 'mission-1', repository,
    updated_at: '2026-10-08T12:00:00.000Z', status: 'running',
    coordinator: { label: 'ORCH', worktree: repository }, workers: [worker] };
  const put = (path: string, data: unknown) => writeFileSync(path, `---\n${JSON.stringify(data)}\n---\nProof.\n`);
  put(join(directory, 'mission.md'), mission);
  const report = { schema: 1, mission: 'mission-1', worker: 'WORK-1', branch: 'feature',
    attempt: 'attempt-2', status: 'blocked', tests: 'not_run', commits: [],
    updated_at: '2026-10-08T13:00:00.000Z' };
  const panes = [
    { pane_id: 'wA:p2', workspace_id: 'wA', cwd: repository, label: 'ORCH' },
    { pane_id: 'wA:p3', workspace_id: 'wA', cwd: worktree, label: 'WORK-1' },
  ];
  return { root, repository, state, worktree, directory, mission, report, put, panes };
}

describe('bounded central file reads', () => {
  it('reads a regular file but rejects traversal, symlinks and oversized content', () => {
    const f = fixture();
    expect(readDocument(f.directory, 'mission.md', 65536)).toContain('schema');
    expect(() => readDocument(f.directory, '../mission.md', 65536)).toThrow();
    symlinkSync(join(f.directory, 'mission.md'), join(f.directory, 'redirect.md'));
    expect(() => readDocument(f.directory, 'redirect.md', 65536)).toThrow();
    symlinkSync(f.directory, join(f.root, 'alias'));
    expect(() => readDocument(join(f.root, 'alias'), 'mission.md', 65536)).toThrow();
    expect(() => readDocument(f.directory, 'mission.md', 10)).toThrow();
  });
  it('separates repositories with the same basename by canonical common directory', () => {
    expect(projectIdentity('/one/project/.git')).not.toBe(projectIdentity('/two/project/.git'));
  });
});

describe('discovery and current report reconciliation', () => {
  it('refuses partial or stale briefs without turning them into an absent report', () => {
    const f = fixture();
    const read = () => readOrchestra(f.state, f.repository, f.worktree, () => f.panes);
    f.put(join(f.directory, 'workers/WORK-1/brief.md'), {
      schema: 1, mission: 'mission-1', worker: 'WORK-1', attempt: 'attempt-2',
    });
    expect(read()?.worker?.status).toBe('running');
    f.put(join(f.directory, 'workers/WORK-1/brief.md'), {
      schema: 1, mission: 'mission-1', worker: 'WORK-1', attempt: 'old',
    });
    expect(read).toThrow('stale orchestra brief');
    writeFileSync(join(f.directory, 'workers/WORK-1/brief.md'), 'partial');
    expect(read).toThrow();
  });
  it('re-reads the live inventory every time and uses a valid current report status', () => {
    const f = fixture();
    f.put(join(f.directory, 'workers/WORK-1/report.md'), f.report);
    let pane = 'wA:p3';
    const inventory = () => f.panes.map(p => p.label === 'WORK-1' ? { ...p, pane_id: pane } : p);
    const read = () => readOrchestra(f.state, f.repository, f.worktree, inventory);
    expect(read()?.worker?.status).toBe('blocked');
    expect(read()?.pane.pane_id).toBe('wA:p3');
    pane = 'wB:p9';
    expect(read()?.pane.pane_id).toBe('wB:p9');
  });
  it('uses manifest status only when a report is absent, never when it is malformed', () => {
    const f = fixture();
    const read = () => readOrchestra(f.state, f.repository, f.worktree, () => f.panes);
    expect(read()?.worker?.status).toBe('running');
    writeFileSync(join(f.directory, 'workers/WORK-1/report.md'), 'partial report');
    expect(read).toThrow();
  });
  it('refuses foreign reports and ambiguous missions', () => {
    const f = fixture();
    f.put(join(f.directory, 'workers/WORK-1/report.md'), { ...f.report, mission: 'foreign' });
    const read = () => readOrchestra(f.state, f.repository, f.worktree, () => f.panes);
    expect(read).toThrow();
    f.put(join(f.directory, 'workers/WORK-1/report.md'), f.report);
    const other = join(f.directory, '..', 'mission-2');
    mkdirSync(other);
    f.put(join(other, 'mission.md'), { ...f.mission, mission: 'mission-2' });
    expect(read).toThrow(/ambiguous/i);
  });
  it('refuses inventory failure and an absent identity instead of selecting a hint', () => {
    const f = fixture();
    expect(() => readOrchestra(f.state, f.repository, f.worktree, () => { throw Error('transport'); }))
      .toThrow('transport');
    expect(() => readOrchestra(f.state, f.repository, f.worktree, () => [])).toThrow();
  });
  it('ignores unrelated missing cwd and archived worktrees while finding the current active mission', () => {
    const f = fixture();
    const archive = join(f.directory, '..', 'archive'); mkdirSync(archive);
    f.put(join(archive, 'mission.md'), { ...f.mission, mission: 'archive', status: 'done',
      coordinator: { label: 'OLD', worktree: '/no-longer-present' }, workers: [] });
    expect(readOrchestra(f.state, f.repository, f.worktree, () => [...f.panes,
      { pane_id: 'w9:p1', workspace_id: 'w9', label: 'UNRELATED', cwd: '/deleted-cwd' },
    ])?.mission.mission).toBe('mission-1');
  });
  it('selects the projected terminal mission without letting archived missions cause ambiguity', () => {
    const f = fixture();
    f.put(join(f.directory, 'mission.md'), { ...f.mission, status: 'done' });
    const archive = join(f.directory, '..', 'archive'); mkdirSync(archive);
    f.put(join(archive, 'mission.md'), { ...f.mission, mission: 'archive', status: 'done' });
    expect(readOrchestra(f.state, f.repository, f.worktree,
      () => f.panes.map(pane => ({ ...pane, tokens: { mission: 'mission-1' } })))?.mission.mission)
      .toBe('mission-1');
  });
  it('refuses an incomplete discovery instead of accepting the first matching mission', () => {
    const f = fixture();
    for (let i = 0; i < 65; i++) mkdirSync(join(f.directory, '..', `extra-${i}`));
    expect(() => readOrchestra(f.state, f.repository, f.worktree, () => f.panes)).toThrow(/incomplete/);
  });
});

function selectionFixture() {
  const f = fixture();
  const selection = { schema: 1, project: f.mission.project, mission: 'mission-1',
    coordinator: f.mission.coordinator };
  const binding = join(f.repository, '.void/machine/orchestra-selection.json');
  mkdirSync(join(f.repository, '.void/machine'), { recursive: true });
  const select = (value: unknown = selection) => writeFileSync(binding, JSON.stringify(value));
  const add = (mission: string, status = 'blocked') => {
    const directory = join(f.directory, '..', mission); mkdirSync(directory);
    f.put(join(directory, 'mission.md'), { ...f.mission, mission, status, workers: [] });
    return directory;
  };
  const read = () => readOrchestra(f.state, f.repository, f.repository, () => f.panes);
  return { ...f, selection, binding, select, add, read };
}

describe('explicit coordinator mission selection', () => {
  it('selects a blocked mission among two blocked and one running with fresh ORCH identity', () => {
    const f = selectionFixture();
    f.put(join(f.directory, 'mission.md'), { ...f.mission, status: 'blocked' });
    f.add('other-blocked'); f.add('other-running', 'running'); f.select();
    const before = readFileSync(join(f.directory, 'mission.md'), 'utf8');
    const read = () => readOrchestra(f.state, f.repository, f.repository,
      () => f.panes.map(pane => ({ ...pane, pane_id: 'fresh:p7', workspace_id: 'fresh' })));
    expect(read()).toMatchObject({ mission: { mission: 'mission-1', status: 'blocked' },
      coordinator: true, pane: { pane_id: 'fresh:p7', workspace_id: 'fresh' } });
    expect(readFileSync(join(f.directory, 'mission.md'), 'utf8')).toBe(before);
    expect(JSON.parse(readFileSync(f.binding, 'utf8'))).toEqual(f.selection);
  });
  it('preserves unique discovery and names ambiguous candidates when unbound', () => {
    const f = selectionFixture();
    expect(f.read()?.mission.mission).toBe('mission-1');
    f.add('mission-2');
    expect(f.read).toThrow(/ambiguous orchestra missions.*mission-1.*mission-2.*ORCH/);
  });
  it('re-reads atomic selection switches and pane changes without changing worker discovery', () => {
    const f = selectionFixture(); f.add('mission-2'); f.select();
    expect(f.read()?.mission.mission).toBe('mission-1');
    const replacement = f.binding + '.next';
    writeFileSync(replacement, JSON.stringify({ ...f.selection, mission: 'mission-2' }));
    renameSync(replacement, f.binding);
    f.panes[0] = { pane_id: 'new:p8', workspace_id: 'new', cwd: f.repository, label: 'ORCH' };
    expect(f.read()).toMatchObject({ mission: { mission: 'mission-2' }, pane: { pane_id: 'new:p8' } });
    expect(readOrchestra(f.state, f.repository, f.worktree, () => f.panes))
      .toMatchObject({ mission: { mission: 'mission-1' }, worker: { attempt: 'attempt-2' } });
  });
  it.each(['absent', '../mission-1', '/mission-1'])('refuses stale or path-like selection %s without fallback', mission => {
    const f = selectionFixture(); f.select({ ...f.selection, mission });
    expect(f.read).toThrow();
  });
  it.each([
    { schema: 2 }, { project: '0'.repeat(64) }, { extra: true }, { mission: 1 },
    { coordinator: { label: 'WORK-1', worktree: '/foreign' } },
  ])('refuses an invalid binding without using the unique mission: %j', change => {
    const f = selectionFixture(); f.select({ ...f.selection, ...change });
    expect(f.read).toThrow();
  });
  it('refuses a binding when central state is absent', () => {
    const f = selectionFixture(); f.select();
    expect(() => readOrchestra(join(f.root, 'missing'), f.repository, f.repository, () => f.panes)).toThrow(/selection/);
  });
  it('refuses selection of a worker role or a noncanonical coordinator worktree', () => {
    const f = selectionFixture();
    const binding = join(f.worktree, '.void/machine/orchestra-selection.json');
    mkdirSync(join(f.worktree, '.void/machine'), { recursive: true });
    writeFileSync(binding, JSON.stringify({ ...f.selection,
      coordinator: { label: 'WORK-1', worktree: f.worktree } }));
    expect(() => readOrchestra(f.state, f.repository, f.worktree, () => f.panes)).toThrow();
    f.select({ ...f.selection, coordinator: { label: 'ORCH', worktree: f.repository + '/.' } });
    expect(f.read).toThrow();
  });
  it.each(['{', 'schema: 1', '{"schema":1,}', '{"schema":1,"schema":1}',
    '{"schema":1,"coordinator":{"label":"ORCH","label":"ORCH"}}'])
    ('rejects invalid JSON or duplicate keys: %s', input => {
      const f = selectionFixture(); writeFileSync(f.binding, input); expect(f.read).toThrow();
    });
  it('rejects duplicate keys in otherwise valid bindings including escaped equivalents', () => {
    const f = selectionFixture();
    const raw = JSON.stringify(f.selection);
    for (const input of [raw.replace('"schema":1', '"schema":1,"schema":1'),
      raw.replace('"label":"ORCH"', '"label":"ORCH","label":"ORCH"'),
      raw.replace('"schema":1', '"schema":1,"\\u0073chema":1')]) {
      writeFileSync(f.binding, input); expect(f.read).toThrow();
    }
  });
  it('accepts exactly 4096 bytes and refuses oversized or invalid UTF-8 bindings', () => {
    const f = selectionFixture(); const raw = JSON.stringify(f.selection);
    writeFileSync(f.binding, raw.padEnd(4096));
    expect(f.read()?.mission.mission).toBe('mission-1');
    writeFileSync(f.binding, raw.padEnd(4097)); expect(f.read).toThrow();
    writeFileSync(f.binding, Buffer.concat([Buffer.from(raw), Buffer.from([0xff])]));
    expect(f.read).toThrow();
  });
  it('refuses selection symlinks and symlinked machine directories', () => {
    const f = selectionFixture();
    const target = join(f.root, 'binding.json'); writeFileSync(target, JSON.stringify(f.selection));
    symlinkSync(target, f.binding); expect(f.read).toThrow(/symlink/);
    const g = fixture(); mkdirSync(join(g.repository, '.void'));
    symlinkSync(join(f.repository, '.void/machine'), join(g.repository, '.void/machine'));
    expect(() => readOrchestra(g.state, g.repository, g.repository, () => g.panes)).toThrow(/symlink/);
  });
  it('refuses missing or duplicate live ORCH identities even with a binding', () => {
    const f = selectionFixture(); f.select();
    expect(() => readOrchestra(f.state, f.repository, f.repository, () => [])).toThrow(/pane identity/);
    expect(() => readOrchestra(f.state, f.repository, f.repository, () => [...f.panes, ...f.panes]))
      .toThrow(/pane identity/);
  });
  it('validates unrelated malformed missions and both discovery limits before selection', () => {
    const f = selectionFixture(); f.select();
    const other = f.add('unrelated'); writeFileSync(join(other, 'mission.md'), 'partial');
    expect(f.read).toThrow();
    const g = selectionFixture(); g.select();
    for (let i = 0; i < 64; i++) g.add(`extra-${i}`);
    expect(g.read).toThrow(/entry limit/);
    const h = selectionFixture(); h.select();
    for (let i = 0; i < 17; i++) {
      const directory = h.add(`extra-${i}`);
      const path = join(directory, 'mission.md');
      writeFileSync(path, readFileSync(path, 'utf8').padEnd(65536));
    }
    expect(h.read).toThrow(/byte limit/);
  });
  it('refuses an atomic replacement during the binding read deterministically', () => {
    const f = selectionFixture(); f.select();
    const replacement = f.binding + '.next';
    writeFileSync(replacement, JSON.stringify(f.selection));
    readRace.afterRead = () => renameSync(replacement, f.binding);
    try { expect(f.read).toThrow(/changed during read/); }
    finally { readRace.afterRead = undefined; }
  });
  it('selects the named terminal mission without relying on another projected mission', () => {
    const f = selectionFixture(); f.select(); f.add('running', 'running');
    f.put(join(f.directory, 'mission.md'), { ...f.mission, status: 'done' });
    expect(f.read()?.mission).toMatchObject({ mission: 'mission-1', status: 'done' });
  });
});
