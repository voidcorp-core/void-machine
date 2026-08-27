import { describe, expect, it } from 'vitest';
import {
  mergeMechanicalContextBlock,
  parseCheckpoint,
  type MechanicalContextState,
} from './checkpoint.js';
import {
  composeResumeBundle,
  type ResumeBundleInput,
  type ResumeProgramInput,
  renderResumeContext,
} from './resume.js';

const NOW = Date.parse('2026-08-17T12:00:00Z');

function program(): ResumeProgramInput {
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

function mechanical(over: Partial<MechanicalContextState> = {}): MechanicalContextState {
  return {
    schemaVersion: 1,
    objectiveHash: `sha256:${'a'.repeat(64)}`,
    workRevision: 3,
    semanticRevision: 3,
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
    ...over,
  };
}

function checkpointWithMechanical(state: MechanicalContextState): ReturnType<typeof parseCheckpoint> {
  const merged = mergeMechanicalContextBlock(
    '## Objective\n\nShip the bundle.\n\n## Next action\n\nWire the CLI.\n',
    state,
  );
  if (!merged.ok) throw new Error(merged.error);
  return parseCheckpoint(merged.value);
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
    expect(bundle.gaps).toContainEqual({
      reason: 'mechanical-block-absent',
      detail: 'the mechanical context block is absent',
    });
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

  it('marks equal mechanical and semantic revisions complete', () => {
    const bundle = composeResumeBundle(input({ checkpoint: checkpointWithMechanical(mechanical()) }));

    expect(bundle.continuity).toEqual({ status: 'complete', reasons: [] });
    expect(bundle.gaps.map((gap) => gap.reason)).not.toContain('checkpoint-semantic-stale');
  });

  it('marks missing or stale mechanical state degraded with bounded reasons', () => {
    const missing = composeResumeBundle(input());
    const stale = composeResumeBundle(input({
      checkpoint: checkpointWithMechanical(mechanical({ semanticRevision: 2 })),
    }));

    expect(missing.continuity.status).toBe('degraded');
    expect(missing.continuity.reasons).toContain('mechanical-block-absent');
    expect(stale.continuity).toEqual({
      status: 'degraded',
      reasons: ['semantic-revision-behind'],
    });
  });

  it('forces clear degraded until the semantic checkpoint catches up', () => {
    const checkpoint = checkpointWithMechanical(mechanical());
    const cleared = composeResumeBundle(input({ checkpoint, resumeSource: 'clear' }));

    expect(cleared.continuity).toEqual({
      status: 'degraded',
      reasons: ['clear-not-reconciled'],
    });
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

  it('renders the continuity status without inventing a next action', () => {
    const checkpoint = checkpointWithMechanical(mechanical({ semanticRevision: 2 }));
    const context = renderResumeContext(composeResumeBundle(input({ checkpoint })));

    expect(context).toContain('Context continuity: degraded');
    expect(context).toContain('semantic revision is behind mechanical work');
    expect(context).toContain('Reconstruct context before any mutation.');
  });

  it('renders the bounded cumulative read and modified working sets', () => {
    const checkpoint = checkpointWithMechanical(mechanical({
      readFiles: ['src/read.ts'],
      modifiedFiles: ['src/changed.ts'],
      readFilesOverflow: 2,
    }));
    const context = renderResumeContext(composeResumeBundle(input({ checkpoint })));

    expect(context).toContain('Read files: src/read.ts (+2 older)');
    expect(context).toContain('Modified files: src/changed.ts');
  });
});
