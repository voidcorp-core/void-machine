import { describe, expect, it } from 'vitest';
import { parseCheckpoint } from '../test/checkpoint-markers.js';
import {
  composeResumeBundle,
  type ResumeBundleInput,
  renderResumeContext,
} from './resume.js';

const NOW = Date.parse('2026-08-17T12:00:00Z');

function input(over: Partial<ResumeBundleInput> = {}): ResumeBundleInput {
  return {
    project: { name: 'alpha', path: '/p/alpha' },
    now: NOW,
    git: { branch: 'main', head: 'abc1234', dirtyFiles: 2 },
    checkpoint: parseCheckpoint(
      '---\ndate: 2026-08-17\nbranch: main\nhead: abc1234\n---\n\n## Objective\n\nShip the bundle.\n\n## Next action\n\nWire the CLI.\n',
    ),
    checkpointWrittenAt: NOW - 3_600_000,
    ...over,
  };
}

describe('composeResumeBundle', () => {
  it('composes checkpoint and git without remote execution state', () => {
    const bundle = composeResumeBundle(input());

    expect(bundle.schemaVersion).toBe(2);
    expect(bundle.project).toEqual({ name: 'alpha', path: '/p/alpha' });
    expect(bundle.git).toEqual({ branch: 'main', head: 'abc1234', dirtyFiles: 2 });
    expect(bundle).not.toHaveProperty('program');
    expect(bundle.checkpoint?.nextAction).toBe('Wire the CLI.');
    expect(bundle.gaps).toEqual([]);
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

    expect(context).not.toMatch(/Program:|Plan:|Progress:/);
    expect(context).toContain('Next action: Wire the CLI.');
    expect(context).not.toMatch(/Recent decisions|remote state|git diff/i);
  });

  it('adds no reconstruction instruction when no useful resume context exists', () => {
    expect(renderResumeContext(composeResumeBundle(input({ checkpoint: undefined })))).toBe('');
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

it('resumes an explicit semantic checkpoint without tracking prerequisites', () => {
  const bundle = composeResumeBundle(input());
  expect(bundle.gaps).toEqual([]);
  const rendered = renderResumeContext(bundle);
  expect(rendered).toContain('Objective: Ship the bundle.');
  expect(rendered).toContain('Next action: Wire the CLI.');
  expect(rendered).not.toMatch(/mechanical|semantic revision|seal|Reconstruct context before any mutation|Context continuity/);
});


it('renders work observations and intentions without claiming authority', () => {
  const checkpoint = parseCheckpoint('## Engaged work\n\n- A-1: worker uncertain.\n\n## Planned work\n\n2. A-3\n1. A-2\n');
  const context = renderResumeContext(composeResumeBundle(input({ checkpoint })));
  expect(context).toContain('Engaged work: - A-1: worker uncertain.');
  expect(context).toContain('Planned work: 2. A-3\n1. A-2');
  expect(context).toContain('Full checkpoint: .void/machine/checkpoint.md');
  expect(context).toContain('Observations and intentions to verify; no authorization.');
  expect(context).not.toContain('Summary truncated');
});

it('keeps the complete checkpoint pointer and limits before oversized optional content', () => {
  const checkpoint = parseCheckpoint(`## Engaged work\n\n${'x'.repeat(10_000)}\n\n## Planned work\n\nA-9`);
  const bundle = composeResumeBundle(input({
    project: { name: 'p'.repeat(5_000), path: '/p/alpha' }, checkpoint,
  }));
  const context = renderResumeContext(bundle);
  expect(context.length).toBeLessThanOrEqual(4_000);
  expect(context).toContain('Full checkpoint: .void/machine/checkpoint.md');
  expect(context).toContain('Observations and intentions to verify; no authorization.');
  expect(context).toContain('Summary truncated; read the full checkpoint before resuming work.');
  expect(bundle.checkpoint).toHaveProperty('engagedWork', 'x'.repeat(10_000));
  expect(bundle.checkpoint).toHaveProperty('plannedWork', 'A-9');
});
