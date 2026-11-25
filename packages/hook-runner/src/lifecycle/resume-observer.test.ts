import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { observeResume } from './resume-observer.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'void-resume-hook-'));
  roots.push(root);
  mkdirSync(join(root, '.void', 'machine'), { recursive: true });
  writeFileSync(join(root, '.void', 'config.json'), '{}\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'test'], { cwd: root });
  return root;
}

function writeProgram(root: string): void {
  writeFileSync(
    join(root, '.void', 'program.md'),
    `---
schemaVersion: 1
status: executing
program: portable-resume
plan: docs/plans/resume.md
spec: docs/specs/resume.md
progress:
  provider: github
  scope: voidcorp/repo
autopilot:
  schemaVersion: 1
  enabled: false
  mergeGate: human
---
`,
  );
}

function writeCheckpoint(root: string, head: string): void {
  writeFileSync(
    join(root, '.void', 'machine', 'checkpoint.md'),
    `---
date: 2026-08-26
branch: ${execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim()}
head: ${head}
---

## Objective

Wire portable resume hooks.

## Next action

Run the hook parity tests.
`,
  );
}

describe('observeResume', () => {
  it('renders the same bounded ResumeBundle context from program, checkpoint and Git', () => {
    const root = project();
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    writeProgram(root);
    writeCheckpoint(root, head);

    const observed = observeResume(root, Date.parse('2026-08-26T12:00:00Z'));

    expect(observed.context).toContain('[void-machine resume]');
    expect(observed.context).not.toContain('Program:');
    expect(observed.bundle).not.toHaveProperty('program');
    expect(observed.context).toContain('Objective: Wire portable resume hooks.');
    expect(observed.context).toContain(`HEAD: ${head}`);
    expect(observed.context.length).toBeLessThanOrEqual(4_000);
  });

  it.each([
    ['malformed', 'absent'], ['malformed', 'empty'],
    ['competing', 'absent'], ['competing', 'empty'],
  ])('surfaces a %s programme with an %s checkpoint without imposing recovery', (kind, checkpoint) => {
    const root = project();
    if (kind === 'malformed') {
      writeFileSync(join(root, '.void', 'program.md'), 'not a programme descriptor\n');
    } else {
      writeProgram(root);
      writeFileSync(join(root, '.void', 'active.md'), '# competing descriptor\n');
    }
    if (checkpoint === 'empty') writeFileSync(join(root, '.void', 'machine', 'checkpoint.md'), '');

    const observed = observeResume(root, Date.now());
    expect(observed.bundle.gaps.map(gap => gap.reason)).toEqual([checkpoint === 'empty' ? 'checkpoint-empty' : 'checkpoint-absent']);
    expect(observed.context).toBe('');
    expect(observed.context.length).toBeLessThanOrEqual(4_000);
    expect(observed.context).not.toMatch(/Reconstruct context|mechanical|void-checkpoint|before any mutation/i);
  });

  it('reports missing observations without imposing a checkpoint repair', () => {
    const observed = observeResume(project(), Date.now());
    expect(observed.context).toBe('');
    expect(observed.bundle.gaps.map(gap => gap.reason)).toContain('checkpoint-absent');
  });
});


it('reads full handoff from a legacy path while bounding injected context without rewriting', () => {
  const root = project();
  mkdirSync(join(root, '.void', 'session'));
  const path = join(root, '.void', 'session', 'current.md');
  const raw = `## Engaged work\n\n${'worker uncertain; '.repeat(300)}\n\n## Planned work\n\nA-3\nA-2\n`;
  writeFileSync(path, raw);
  const observed = observeResume(root, Date.now());
  expect(observed.bundle).toHaveProperty('checkpointPath', '.void/session/current.md');
  expect(observed.bundle.checkpoint).toHaveProperty('plannedWork', 'A-3\nA-2');
  expect(observed.context).toContain('Full checkpoint: .void/session/current.md');
  expect(observed.context).toContain('Observations and intentions to verify; no authorization.');
  expect(observed.context).toContain('Summary truncated; read the full checkpoint before resuming work.');
  expect(observed.context.length).toBeLessThanOrEqual(4_000);
  expect(readFileSync(path, 'utf8')).toBe(raw);
});
