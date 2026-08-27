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
import {
  mergeMechanicalContextBlock,
  type MechanicalContextState,
} from '@voidcorp/mission-engine/session';

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

    expect(observed.context).toContain('[void-harness resume]');
    expect(observed.context).toContain('Program: portable-resume');
    expect(observed.context).toContain('Progress: github at voidcorp/repo');
    expect(observed.context).toContain('Objective: Wire portable resume hooks.');
    expect(observed.context).toContain(`HEAD: ${head}`);
    expect(observed.context.length).toBeLessThanOrEqual(4_000);
  });

  it('stays silent when neither a program nor a useful checkpoint exists', () => {
    expect(observeResume(project(), Date.now()).context).toBe('');
  });

  it('exposes a complete mechanical continuity status after compaction', () => {
    const root = project();
    const state: MechanicalContextState = {
      schemaVersion: 1,
      objectiveHash: `sha256:${'a'.repeat(64)}`,
      workRevision: 1,
      semanticRevision: 1,
      nudgeEmitted: false,
      transcriptFingerprint: `sha256:${'b'.repeat(64)}`,
      transcriptCursorBytes: 0,
      lastMeasurementAtMs: 0,
      lastUsedTokens: 0,
      readFiles: [],
      modifiedFiles: [],
      readFilesOverflow: 0,
      modifiedFilesOverflow: 0,
      clearPending: false,
      lastResumeSource: 'none',
    };
    const merged = mergeMechanicalContextBlock('## Objective\n\nResume me.\n', state);
    if (!merged.ok) throw new Error(merged.error);
    writeFileSync(join(root, '.void', 'machine', 'checkpoint.md'), merged.value);

    const observed = observeResume(root, Date.now(), { source: 'compact' });

    expect(observed.bundle.continuity.status).toBe('complete');
    expect(observed.context).toContain('Context continuity: complete');
  });
});
