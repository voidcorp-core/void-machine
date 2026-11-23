import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
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
    expect(observed.context).toContain('Program: portable-resume');
    expect(observed.context).toContain('Progress: github at voidcorp/repo');
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
    const diagnostic = kind === 'malformed'
      ? 'invalid program descriptor: .void/program.md'
      : 'multiple program descriptors: .void/program.md, .void/active.md';
    expect(observed.bundle.gaps).toContainEqual({ reason: 'program-invalid', detail: diagnostic });
    expect(observed.context).toContain(`Gap: ${diagnostic}`);
    expect(observed.context.length).toBeLessThanOrEqual(4_000);
    expect(observed.context).not.toMatch(/Reconstruct context|mechanical|void-checkpoint|before any mutation/i);
  });

  it('reports missing observations without imposing a checkpoint repair', () => {
    const observed = observeResume(project(), Date.now());
    expect(observed.context).toBe('');
    expect(observed.bundle.gaps.map(gap => gap.reason)).toContain('checkpoint-absent');
  });
});
