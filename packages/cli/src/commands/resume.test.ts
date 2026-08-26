import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resume } from './resume.js';

const roots: string[] = [];
const PROGRAM =
  '---\nschemaVersion: 1\nstatus: executing\nprogram: demo\nplan: docs/plans/demo.md\nspec: docs/specs/demo.md\nprogress:\n  provider: jira\n  scope: ACME\n  order: [X-1, X-2]\n  states:\n    ready: [Todo]\n    started: [Doing]\n    review: [Review]\n    done: [Done]\nautopilot:\n  schemaVersion: 1\n  enabled: false\n  mergeGate: human\n---\n';

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(withProgram = true): { readonly root: string; readonly output: () => string } {
  const root = mkdtempSync(join(tmpdir(), 'void-resume-command-'));
  roots.push(root);
  mkdirSync(join(root, '.void'), { recursive: true });
  writeFileSync(join(root, '.void', 'config.json'), '{}\n');
  if (withProgram) writeFileSync(join(root, '.void', 'program.md'), PROGRAM);
  let written = '';
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    written += String(chunk);
    return true;
  });
  return { root, output: () => written };
}

describe('resume command', () => {
  it('renders the canonical program with generic work units', async () => {
    const capture = project();

    await resume([]);

    expect(capture.output()).toContain('demo');
    expect(capture.output()).not.toContain('tickets');
  });

  it('renders the versioned ResumeBundle as JSON', async () => {
    const capture = project();

    await resume(['--json']);

    const bundle = JSON.parse(capture.output()) as Record<string, unknown>;
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle).toHaveProperty('project');
    expect(bundle).toHaveProperty('git');
    expect(bundle).not.toHaveProperty('recentDecisions');
  });

  it('renders bounded hook context from the same bundle', async () => {
    const capture = project();

    await resume(['--context']);

    expect(capture.output()).toContain('Program: demo');
    expect(capture.output().length).toBeLessThanOrEqual(4_000);
  });

  it('keeps context silent without a program or useful checkpoint', async () => {
    const capture = project(false);

    await resume(['--context']);

    expect(capture.output()).toBe('');
  });
});
