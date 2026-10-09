import { describe, expect, it } from 'vitest';
import { parseBrief, parseMission, parseReport, matchReport, resolvePane } from './orchestra-codec.js';

const worker = {
  label: 'WORK-1', pane_id: 'w9:p1', agent: 'codex', worktree: '/repo/work',
  branch: 'feature', ticket: 'DEV-1016', status: 'running', attempt: 'attempt-1',
};
const mission = {
  schema: 1, mission: 'mission-1', project: 'project-1', status: 'running',
  updated_at: '2026-10-08T10:00:00.000Z', repository: '/repo/.git',
  coordinator: { label: 'ORCH', worktree: '/repo/main', workspace: 'w9' }, workers: [worker],
};
const report = {
  schema: 1, mission: 'mission-1', attempt: 'attempt-1', status: 'done', worker: 'WORK-1',
  branch: 'feature', commits: ['a'.repeat(40)], tests: 'passed',
  updated_at: '2026-10-08T11:00:00.000Z',
};
const doc = (value: unknown) => `---\n${JSON.stringify(value)}\n---\nEvidence here.\n`;

describe('schema 1 orchestra documents', () => {
  it('validates the bounded brief frontmatter and refuses unknown fields', () => {
    const brief = { schema: 1, mission: 'mission-1', attempt: 'attempt-1', worker: 'WORK-1' };
    expect(parseBrief(doc(brief))).toEqual(brief);
    expect(() => parseBrief(doc({ ...brief, extra: true }))).toThrow();
    expect(() => parseBrief(doc(brief) + 'x'.repeat(262144))).toThrow();
  });
  it('reads mission and report without deriving success from a running process', () => {
    expect(parseMission(doc(mission))).toEqual(mission);
    expect(matchReport(parseMission(doc(mission)), worker.label, parseReport(doc(report))))
      .toEqual(report);
  });
  it.each([
    { ...mission, schema: 2 }, { ...mission, unknown: true },
    { ...mission, status: 'idle' }, { ...mission, updated_at: 'yesterday' },
    { ...mission, coordinator: { ...mission.coordinator, server: 'default' } },
    { ...mission, workers: [{ ...worker, status: 'working' }] },
    { ...mission, workers: [worker, worker] },
    { ...mission, workers: [{ ...worker, worktree: '../foreign' }] },
    { ...mission, mission: '../foreign' },
    { ...mission, workers: Array.from({ length: 5 }, (_, i) => ({ ...worker, label: `WORK-${i}` })) },
  ])('refuses unknown, ambiguous or invalid mission fields (%#)', (value) => {
    expect(() => parseMission(doc(value))).toThrow();
  });
  it.each([
    'schema: 1\nschema: 1', 'schema: &schema 1\nmission: *schema',
    'schema: !!str 1', 'schema: [', '? [complex, key]\n: value',
  ])('rejects unsafe YAML before using its fields: %s', (yaml) => {
    expect(() => parseMission(`---\n${yaml}\n---\n`)).toThrow();
  });
  it('rejects missing delimiters, oversized bytes and a second YAML document', () => {
    expect(() => parseMission(JSON.stringify(mission))).toThrow();
    expect(() => parseMission(doc(mission) + 'é'.repeat(32_768))).toThrow();
    expect(() => parseMission(`---\n${JSON.stringify(mission)}\n---\n---\n`)).toThrow();
  });
  it.each([
    { ...report, mission: 'foreign' }, { ...report, attempt: 'old' },
    { ...report, worker: 'WORK-2' }, { ...report, branch: 'other' },
  ])('refuses a stale or foreign report (%#)', (value) => {
    expect(() => matchReport(parseMission(doc(mission)), worker.label, parseReport(doc(value))))
      .toThrow();
  });
  it('keeps a current-attempt report valid after a later mission refresh', () => {
    expect(matchReport(parseMission(doc({ ...mission, updated_at: '2026-10-08T12:00:00.000Z' })),
      worker.label, parseReport(doc(report)))).toEqual(report);
  });
  it.each([{ ...report, tests: 'green' }, { ...report, status: 'planned' },
    { ...report, commits: ['HEAD'] }, { ...report, commits: ['a'.repeat(41)] }, { ...report, extra: 'untrusted' }])
  ('rejects a report outside its schema (%#)', (value) => {
    expect(() => parseReport(doc(value))).toThrow();
  });
});

describe('pane identity is the canonical worktree and label pair', () => {
  const live = { pane_id: 'wA:p7', workspace_id: 'wA', label: 'WORK-1', cwd: '/repo/work' };
  it('returns the actual pane when both persisted hints are stale', () => {
    expect(resolvePane(worker, [live])).toEqual(live);
  });
  it('never chooses by ID, workspace, label alone, or worktree alone', () => {
    expect(() => resolvePane(worker, [{ ...live, label: 'WORK-2' }])).toThrow();
    expect(() => resolvePane(worker, [{ ...live, cwd: '/foreign/work' }])).toThrow();
    expect(() => resolvePane(worker, [])).toThrow();
  });
  it('refuses duplicate live ownership instead of trusting the persisted ID', () => {
    expect(() => resolvePane(worker, [live, { ...live, pane_id: worker.pane_id }])).toThrow();
  });
});
