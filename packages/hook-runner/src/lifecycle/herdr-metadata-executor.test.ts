import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeHerdrMetadata, type MetadataRun } from './herdr-metadata-executor.js';
import { projectIdentity } from './orchestra-reader.js';

function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'metadata-executor-')));
  const common = join(root, '.git'); mkdirSync(common);
  const directory = join(root, '.local/state/orchestra', projectIdentity(common), 'mission-1');
  mkdirSync(directory, { recursive: true });
  const mission = { schema: 1, mission: 'mission-1', project: projectIdentity(common), status: 'running',
    repository: common, updated_at: '2026-10-08T10:00:00.000Z', workers: [],
    coordinator: { label: 'ORCH', worktree: root, workspace: 'stale' } };
  writeFileSync(join(directory, 'mission.md'), `---\n${JSON.stringify(mission)}\n---\nProof\n`);
  const calls: string[][] = [];
  const run: MetadataRun = (command, args, options) => {
    expect(options.shell).toBe(false);
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.timeout).toBeLessThanOrEqual(2000);
    expect(options.maxBuffer).toBe(262144);
    if (command === 'git') return common;
    calls.push([...args]);
    if (args[1] === 'list') return JSON.stringify({ result: { type: 'pane_list', panes: [
      { pane_id: 'wA:p2', workspace_id: 'wA', cwd: root, label: 'ORCH', revision: 123 },
    ] } });
    if (args[1] === 'get') return JSON.stringify({ result: { workspace: { tokens: { mission: 'mission-1' } } } });
    // Herdr 0.9.0 report-metadata succeeds silently (real CLI conformance capture).
    return '';
  };
  return { root, common, directory, mission, run, calls };
}

describe('bounded Herdr lifecycle boundary', () => {
  it.each(['{}', '{"error":{"message":"refused"}}', 'invalid'])('refuses invalid metadata acknowledgement %s', output => {
    const f = setup();
    const result = executeHerdrMetadata({ hook_event_name: 'Stop' }, f.root,
      { HOME: f.root, HERDR_ENV: '1' }, 'codex', (command, args, options) =>
        args[1] === 'report-metadata' ? output : f.run(command, args, options));
    expect(result.status).toBe('degraded');
  });
  it('accepts a supplied JSON success acknowledgement', () => {
    const f = setup();
    const result = executeHerdrMetadata({ hook_event_name: 'Stop' }, f.root,
      { HOME: f.root, HERDR_ENV: '1' }, 'codex', (command, args, options) =>
        args[1] === 'report-metadata' ? '{"result":{}}' : f.run(command, args, options));
    expect(result.status).toBe('ok');
  });
  it('discovers from common Git identity, publishes on the freshly resolved pane and injects central path', () => {
    const f = setup();
    const result = executeHerdrMetadata({ hook_event_name: 'SessionStart', source: 'resume' }, f.root,
      { HOME: f.root, HERDR_ENV: '1', HERDR_PANE_ID: 'w9:p1' }, 'codex', f.run);
    expect(result.status).toBe('ok');
    expect(result.output?.hookSpecificOutput.additionalContext).toContain('.local/state/orchestra/');
    expect(f.calls.filter(args => args[1] === 'report-metadata').flat()).toContain('wA:p2');
    expect(f.calls.flat()).not.toContain('w9:p1');
  });
  it('diagnoses transport refusal without attempting a cleanup', () => {
    const f = setup();
    const result = executeHerdrMetadata({ hook_event_name: 'SessionEnd' }, f.root,
      { HOME: f.root, HERDR_ENV: '1' }, 'codex', (command, args, options) => {
        if (command === 'herdr') throw Error('permission denied');
        return f.run(command, args, options);
      });
    expect(result.status).toBe('degraded');
    expect(result.diagnostic).toContain('permission denied');
    expect(f.calls).toEqual([]);
  });
  it('does nothing outside Herdr and diagnoses a malformed successful transport response', () => {
    const f = setup();
    expect(executeHerdrMetadata({}, f.root, {}, 'codex', f.run).status).toBe('skipped');
    const result = executeHerdrMetadata({ hook_event_name: 'Stop' }, f.root,
      { HOME: f.root, HERDR_ENV: '1' }, 'codex', (command, args, options) =>
        command === 'herdr' ? '{}' : f.run(command, args, options));
    expect(result.status).toBe('degraded');
  });
});

describe('selected coordinator lifecycle projection', () => {
  it.each(['codex', 'claude'] as const)('projects explicit blocked selection through %s lifecycle inputs', runtime => {
    const f = setup();
    writeFileSync(join(f.directory, 'mission.md'), `---\n${JSON.stringify({ ...f.mission, status: 'blocked' })}\n---\n`);
    const other = join(f.directory, '..', 'running'); mkdirSync(other);
    writeFileSync(join(other, 'mission.md'), `---\n${JSON.stringify({ ...f.mission, mission: 'running' })}\n---\n`);
    mkdirSync(join(f.root, '.void/machine'), { recursive: true });
    writeFileSync(join(f.root, '.void/machine/orchestra-selection.json'), JSON.stringify({
      schema: 1, project: f.mission.project, mission: 'mission-1',
      coordinator: { label: 'ORCH', worktree: f.root },
    }));
    for (const source of ['startup', 'resume', 'clear', 'compact']) {
      f.calls.length = 0;
      const result = executeHerdrMetadata({ hook_event_name: 'SessionStart', source }, f.root,
        { HOME: f.root, HERDR_ENV: '1' }, runtime, f.run);
      expect(result.status).toBe('ok');
      expect(result.output?.hookSpecificOutput.additionalContext).toContain(f.directory);
      const published = f.calls.filter(args => args[1] === 'report-metadata').flat();
      expect(published).toContain('mission=mission-1');
      expect(published).toContain('wstatus=blocked');
      expect(published).not.toContain('mission=running');
    }
  });
  it('does not clear foreign pane or workspace tokens for an explicitly selected terminal mission', () => {
    const f = setup();
    writeFileSync(join(f.directory, 'mission.md'), `---\n${JSON.stringify({ ...f.mission, status: 'done' })}\n---\n`);
    mkdirSync(join(f.root, '.void/machine'), { recursive: true });
    writeFileSync(join(f.root, '.void/machine/orchestra-selection.json'), JSON.stringify({
      schema: 1, project: f.mission.project, mission: 'mission-1',
      coordinator: { label: 'ORCH', worktree: f.root },
    }));
    const result = executeHerdrMetadata({ hook_event_name: 'Stop' }, f.root,
      { HOME: f.root, HERDR_ENV: '1' }, 'codex', (command, args, options) => {
        if (args[1] === 'list') return JSON.stringify({ result: { panes: [
          { pane_id: 'wA:p2', workspace_id: 'wA', cwd: f.root, label: 'ORCH', tokens: { mission: 'other' } },
        ] } });
        if (args[1] === 'get') return JSON.stringify({ result: { workspace: { tokens: { mission: 'other' } } } });
        return f.run(command, args, options);
      });
    expect(result.status).toBe('ok');
    expect(result.details).toMatchObject({ mission: 'mission-1', published: 0 });
    expect(f.calls.filter(args => args[1] === 'report-metadata')).toEqual([]);
  });
});
