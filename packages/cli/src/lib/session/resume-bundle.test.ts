import { describe, expect, it } from 'vitest';
import type { ProgramDescriptor } from '../autopilot/program.js';
import { parseCheckpoint } from './checkpoint.js';
import {
  composeResumeBundle,
  type ResumeBundleInput,
  renderResumeContext,
} from './resume-bundle.js';

const NOW = Date.parse('2026-08-17T12:00:00Z');

function program(): ProgramDescriptor {
  return {
    schemaVersion: 1,
    status: 'executing',
    program: 'knowledge-and-resume',
    plan: 'docs/plans/knowledge.md',
    spec: 'docs/specs/knowledge.md',
    progress: {
      provider: 'jira',
      scope: 'ACME/KNOW',
      order: ['KNOW-1'],
      states: { ready: ['Todo'], started: ['Doing'], review: ['Review'], done: ['Done'] },
    },
    humanGates: [],
    autopilot: {
      schemaVersion: 1,
      enabled: false,
      clusterSize: 4,
      base: 'auto',
      mergeGate: 'human',
      verifyCommands: [],
      ownership: { sequential: [], reconcileOnly: [] },
    },
  };
}

function input(over: Partial<ResumeBundleInput> = {}): ResumeBundleInput {
  return {
    project: { name: 'alpha', path: '/p/alpha' },
    now: NOW,
    git: { branch: 'main', head: 'abc1234', dirtyFiles: 2 },
    program: program(),
    checkpoint: parseCheckpoint(
      '---\ndate: 2026-08-17\nbranch: main\nhead: abc1234\n---\n\n## Objective\n\nShip the bundle.\n\n## Next action\n\nWire the CLI.\n',
    ),
    checkpointWrittenAt: NOW - 3_600_000,
    ...over,
  };
}

describe('composeResumeBundle', () => {
  it('composes program checkpoint and git without remote execution state', () => {
    const bundle = composeResumeBundle(input());

    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.project).toEqual({ name: 'alpha', path: '/p/alpha' });
    expect(bundle.git).toEqual({ branch: 'main', head: 'abc1234', dirtyFiles: 2 });
    expect(bundle.program).toEqual({
      status: 'executing',
      program: 'knowledge-and-resume',
      plan: 'docs/plans/knowledge.md',
      spec: 'docs/specs/knowledge.md',
      progress: { provider: 'jira', scope: 'ACME/KNOW' },
    });
    expect(bundle.checkpoint?.nextAction).toBe('Wire the CLI.');
    expect(bundle.gaps).toEqual([]);
  });

  it('names an absent or invalid program without hiding a useful checkpoint', () => {
    const absent = composeResumeBundle(input({ program: undefined }));
    const invalid = composeResumeBundle(input({ program: undefined, programError: 'bad YAML' }));

    expect(absent.gaps.map((gap) => gap.reason)).toContain('program-absent');
    expect(invalid.gaps).toContainEqual({ reason: 'program-invalid', detail: 'bad YAML' });
    expect(invalid.checkpoint?.objective).toBe('Ship the bundle.');
  });

  it('distinguishes an absent, empty and stale checkpoint', () => {
    const absent = composeResumeBundle(input({ checkpoint: undefined }));
    const empty = composeResumeBundle(input({ checkpoint: parseCheckpoint('# empty\n') }));
    const stale = composeResumeBundle(input({ checkpointWrittenAt: NOW - 9 * 86_400_000 }));

    expect(absent.gaps.map((gap) => gap.reason)).toContain('checkpoint-absent');
    expect(empty.gaps.map((gap) => gap.reason)).toContain('checkpoint-empty');
    expect(stale.gaps.map((gap) => gap.reason)).toContain('checkpoint-stale');
  });

  it('detects both branch and head drift', () => {
    const checkpoint = parseCheckpoint(
      '---\nbranch: feature/old\nhead: deadbee\n---\n\n## Objective\n\nOld tree.\n',
    );

    const reasons = composeResumeBundle(input({ checkpoint })).gaps.map((gap) => gap.reason);

    expect(reasons).toContain('checkpoint-branch-moved');
    expect(reasons).toContain('checkpoint-head-moved');
  });
});

describe('renderResumeContext', () => {
  it('renders the local resume data without decisions, tracker output or diffs', () => {
    const context = renderResumeContext(composeResumeBundle(input()));

    expect(context).toContain('Program: knowledge-and-resume');
    expect(context).toContain('Plan: docs/plans/knowledge.md');
    expect(context).toContain('Progress: jira at ACME/KNOW');
    expect(context).toContain('Next action: Wire the CLI.');
    expect(context).not.toMatch(/Recent decisions|remote state|git diff/i);
  });

  it('is silent when neither a program nor a useful checkpoint exists', () => {
    const bundle = composeResumeBundle(
      input({ program: undefined, checkpoint: parseCheckpoint('# empty\n') }),
    );

    expect(renderResumeContext(bundle)).toBe('');
  });

  it('stays within the hook context budget', () => {
    const checkpoint = parseCheckpoint(
      `## Objective\n\n${'x'.repeat(10_000)}\n\n## State\n\n${'y'.repeat(10_000)}\n`,
    );

    expect(renderResumeContext(composeResumeBundle(input({ checkpoint }))).length).toBeLessThanOrEqual(
      4_000,
    );
  });
});
