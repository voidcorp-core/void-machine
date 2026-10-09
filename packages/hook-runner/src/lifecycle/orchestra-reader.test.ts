import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDocument, projectIdentity, readOrchestra } from './orchestra-reader.js';

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
