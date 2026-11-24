import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  it('keeps historical programmes out of local resume output', async () => {
    const capture = project();

    await resume([]);

    expect(capture.output()).not.toContain('demo');
    expect(capture.output()).not.toContain('tickets');
  });

  it('renders the versioned ResumeBundle as JSON', async () => {
    const capture = project();

    await resume(['--json']);

    const bundle = JSON.parse(capture.output()) as Record<string, unknown>;
    expect(bundle.schemaVersion).toBe(2);
    expect(bundle).not.toHaveProperty('program');
    expect(bundle).toHaveProperty('project');
    expect(bundle).toHaveProperty('git');
    expect(bundle).not.toHaveProperty('recentDecisions');
  });

  it('renders bounded hook context from the same bundle', async () => {
    const capture = project();

    await resume(['--context']);

    expect(capture.output()).toBe('');
    expect(capture.output().length).toBeLessThanOrEqual(4_000);
  });

  it('emits no automatic recovery instruction without useful resume context', async () => {
    const capture = project(false);

    await resume(['--context']);

    expect(capture.output()).toBe('');
  });
});


it.each(['human', '--json', '--context'])('reads work handoff in %s without rewriting its legacy file', async format => {
  const capture = project(false);
  const reference = `https://example.com/${'project-reference/'.repeat(20)}A-2`;
  const raw = `## Engaged work\n\n- A-1: worker uncertain.\n\n## Planned work\n\n2. ${reference}\n1. A-3\n`;
  const path = join(capture.root, '.void', 'local', 'checkpoint.md');
  mkdirSync(join(capture.root, '.void', 'local'));
  writeFileSync(path, raw);
  await resume(format === 'human' ? [] : [format]);
  expect(capture.output()).toContain(reference);
  expect(capture.output()).toContain('worker uncertain.');
  if (format === '--json') {
    expect(JSON.parse(capture.output())).toMatchObject({
      checkpointPath: '.void/local/checkpoint.md',
      checkpointNotice: 'Observations and intentions to verify; no authorization.',
      checkpoint: { engagedWork: '- A-1: worker uncertain.', plannedWork: `2. ${reference}\n1. A-3`, isEmpty: false },
    });
  } else {
    expect(capture.output()).toContain('Observations and intentions to verify; no authorization.');
    expect(capture.output()).toContain('.void/local/checkpoint.md');
  }
  expect(readFileSync(path, 'utf8')).toBe(raw);
});
