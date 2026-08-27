import { describe, expect, it } from 'vitest';
import {
  mergeMechanicalContextBlock,
  parseCheckpoint,
  parseMechanicalContextBlock,
  type MechanicalContextState,
} from './checkpoint.js';

/**
 * The checkpoint answers one question — what was happening just before the
 * stop — and the parser is deliberately TOLERANT. It is written by an agent in
 * prose, at the end of a session, under time pressure; a parser that rejects an
 * imperfect file would throw away the only record of where the work was.
 *
 * So: take the sections you recognise, ignore the rest, never throw.
 */

const FULL = `---
date: 2026-08-17
branch: folpe/dev-622
head: a1b2c3d
---

# Session checkpoint

## Objective

Build the projects view so several projects can be read at once.

## Position

Phase 1 of 4 done; the checkpoint itself is next.

## State

Discovery, summary and the served view are green. 88 tests.

## Next action

Run \`pnpm cli resume\` in sesame and check the output against the real tree.

## Open loops

- The launch token is one-shot, which may be wrong for a dashboard.
- \`.void/runs\` pollution is filed but not fixed.

## Dead ends

- Tried a registry first; it knew 3 projects of 8.

## Working set

- packages/cli/src/lib/projects/read.ts
- packages/cli/src/commands/ui.ts
`;

describe('parseCheckpoint', () => {
  it('reads every known section', () => {
    const checkpoint = parseCheckpoint(FULL);

    expect(checkpoint.objective).toBe(
      'Build the projects view so several projects can be read at once.',
    );
    expect(checkpoint.position).toBe('Phase 1 of 4 done; the checkpoint itself is next.');
    expect(checkpoint.nextAction).toContain('pnpm cli resume');
    expect(checkpoint.openLoops).toHaveLength(2);
    expect(checkpoint.deadEnds).toHaveLength(1);
    expect(checkpoint.workingSet).toEqual([
      'packages/cli/src/lib/projects/read.ts',
      'packages/cli/src/commands/ui.ts',
    ]);
  });

  it('reads the branch, head and date out of the frontmatter', () => {
    const checkpoint = parseCheckpoint(FULL);

    expect(checkpoint.branch).toBe('folpe/dev-622');
    expect(checkpoint.head).toBe('a1b2c3d');
    expect(checkpoint.date).toBe('2026-08-17');
  });

  // The resume line is what a project card shows, so it must be the single most
  // useful sentence: what I was doing, not the first line of the file.
  it('uses the objective as the resume line', () => {
    expect(parseCheckpoint(FULL).resumeLine).toBe(
      'Build the projects view so several projects can be read at once.',
    );
  });

  it('falls back to the next action when there is no objective', () => {
    const checkpoint = parseCheckpoint('# Checkpoint\n\n## Next action\n\nOpen `auth.ts:40`.\n');

    expect(checkpoint.resumeLine).toBe('Open `auth.ts:40`.');
  });

  it('matches section titles regardless of case and spacing', () => {
    const checkpoint = parseCheckpoint('## NEXT ACTION\n\nDo the thing.\n\n##   open loops\n\n- x\n');

    expect(checkpoint.nextAction).toBe('Do the thing.');
    expect(checkpoint.openLoops).toEqual(['x']);
  });

  it('accepts a section written with a different heading level', () => {
    expect(parseCheckpoint('### Objective\n\nShip it.\n').objective).toBe('Ship it.');
  });

  it('keeps a multi-line section as one block', () => {
    const checkpoint = parseCheckpoint('## State\n\nFirst line.\nSecond line.\n');

    expect(checkpoint.state).toBe('First line.\nSecond line.');
  });

  it('ignores sections it does not know', () => {
    const checkpoint = parseCheckpoint('## Objective\n\nX.\n\n## Weather\n\nSunny.\n');

    expect(checkpoint.objective).toBe('X.');
  });

  it('reports an empty checkpoint rather than failing', () => {
    const checkpoint = parseCheckpoint('');

    expect(checkpoint.resumeLine).toBe(undefined);
    expect(checkpoint.openLoops).toEqual([]);
    expect(checkpoint.isEmpty).toBe(true);
  });

  it('treats a file with only headings as empty', () => {
    expect(parseCheckpoint('# Session checkpoint\n\n## Objective\n\n').isEmpty).toBe(true);
  });

  it.each([
    ['no frontmatter', '## Objective\n\nX.\n'],
    ['broken frontmatter', '---\n: :\n---\n\n## Objective\n\nX.\n'],
    ['a nul byte', `## Objective\n\nX${String.fromCharCode(0)}.\n`],
    ['a very long section', `## Objective\n\n${'x'.repeat(200_000)}\n`],
  ])('never throws on %s', (_label, raw) => {
    expect(() => parseCheckpoint(raw)).not.toThrow();
  });

  it('bounds the resume line so one runaway paragraph cannot break a card', () => {
    const checkpoint = parseCheckpoint(`## Objective\n\n${'x'.repeat(5_000)}\n`);

    expect((checkpoint.resumeLine ?? '').length).toBeLessThanOrEqual(200);
  });

  it('accepts both dash and star bullets', () => {
    const checkpoint = parseCheckpoint('## Open loops\n\n- one\n* two\n');

    expect(checkpoint.openLoops).toEqual(['one', 'two']);
  });

  // Found by reading a real checkpoint back: an item wrapped onto a second line
  // lost its tail silently, which is data loss dressed as formatting.
  it('keeps a bullet that wraps onto the next line whole', () => {
    const checkpoint = parseCheckpoint(
      '## Open loops\n\n- the fate of DEV-459 is undecided: they contradict\n  the command center spec\n- second item\n',
    );

    expect(checkpoint.openLoops).toEqual([
      'the fate of DEV-459 is undecided: they contradict the command center spec',
      'second item',
    ]);
  });

  it('does not let a blank line glue two bullets together', () => {
    const checkpoint = parseCheckpoint('## Open loops\n\n- one\n\n- two\n');

    expect(checkpoint.openLoops).toEqual(['one', 'two']);
  });
});

const MECHANICAL: MechanicalContextState = {
  schemaVersion: 1,
  objectiveHash: `sha256:${'a'.repeat(64)}`,
  workRevision: 4,
  semanticRevision: 4,
  nudgeEmitted: false,
  transcriptFingerprint: `sha256:${'b'.repeat(64)}`,
  transcriptCursorBytes: 128,
  lastMeasurementAtMs: 0,
  lastUsedTokens: 0,
  readFiles: [],
  modifiedFiles: [],
  readFilesOverflow: 0,
  modifiedFilesOverflow: 0,
  clearPending: false,
  lastResumeSource: 'none',
};

describe('mechanical context block', () => {
  it('adds and parses exactly one bounded block without changing semantic prose', () => {
    const semantic = '## Objective\n\nPreserve the semantic checkpoint.\n';
    const merged = mergeMechanicalContextBlock(semantic, MECHANICAL);

    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.value).toContain(semantic.trimEnd());
    expect(parseMechanicalContextBlock(merged.value)).toEqual({
      status: 'valid',
      state: MECHANICAL,
    });
    expect(parseCheckpoint(merged.value).objective).toBe('Preserve the semantic checkpoint.');
  });

  it('replaces only the existing mechanical block', () => {
    const first = mergeMechanicalContextBlock('## Objective\n\nKeep me.\n', MECHANICAL);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const replacement = { ...MECHANICAL, workRevision: 5 };
    const second = mergeMechanicalContextBlock(first.value, replacement);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.match(/void-harness:context-continuity:begin/g)).toHaveLength(1);
    expect(second.value).toContain('## Objective\n\nKeep me.');
    expect(parseMechanicalContextBlock(second.value)).toEqual({
      status: 'valid',
      state: replacement,
    });
  });

  it.each([
    [
      'multiple blocks',
      '<!-- void-harness:context-continuity:begin -->\n<!-- void-harness:context-continuity:end -->\n'.repeat(2),
    ],
    ['missing end marker', '<!-- void-harness:context-continuity:begin -->\n'],
    ['end marker before begin', '<!-- void-harness:context-continuity:end -->\n<!-- void-harness:context-continuity:begin -->\n'],
  ])('refuses %s without returning rewritten markdown', (_label, raw) => {
    expect(mergeMechanicalContextBlock(raw, MECHANICAL)).toEqual({
      ok: false,
      error: 'ambiguous-mechanical-block',
    });
  });
});

describe('advanceMechanicalContext', () => {
  it('keeps the 20 most recent unique paths and counts displaced paths', async () => {
    const { advanceMechanicalContext } = await import('./checkpoint.js');
    const existing = Array.from({ length: 20 }, (_value, index) => `src/file-${String(index)}.ts`);

    const next = advanceMechanicalContext(
      { ...MECHANICAL, readFiles: existing },
      { readFiles: ['src/file-4.ts', 'src/file-20.ts'] },
    );

    expect(next.readFiles).toEqual([...existing.filter((path) => path !== 'src/file-4.ts').slice(1), 'src/file-4.ts', 'src/file-20.ts']);
    expect(next.readFilesOverflow).toBe(1);
    expect(next.workRevision).toBe(MECHANICAL.workRevision + 1);
  });

  it('does not advance a revision for a duplicate observation', async () => {
    const { advanceMechanicalContext } = await import('./checkpoint.js');
    const state = { ...MECHANICAL, readFiles: ['src/a.ts'] };

    expect(advanceMechanicalContext(state, { readFiles: ['src/a.ts'] })).toEqual(state);
  });

  it('resets only when the authoritative Objective hash changes', async () => {
    const { advanceMechanicalContext } = await import('./checkpoint.js');
    const nextObjective = `sha256:${'c'.repeat(64)}`;
    const state = {
      ...MECHANICAL,
      readFiles: ['src/a.ts'],
      modifiedFiles: ['src/b.ts'],
      readFilesOverflow: 2,
      modifiedFilesOverflow: 3,
      clearPending: true,
    };

    const unchanged = advanceMechanicalContext(state, { objectiveHash: state.objectiveHash });
    const reset = advanceMechanicalContext(state, { objectiveHash: nextObjective });

    expect(unchanged).toEqual(state);
    expect(reset).toMatchObject({
      objectiveHash: nextObjective,
      workRevision: state.workRevision + 1,
      semanticRevision: state.workRevision + 1,
      readFiles: [],
      modifiedFiles: [],
      readFilesOverflow: 0,
      modifiedFilesOverflow: 0,
      clearPending: false,
    });
  });

  it('marks clear degraded once, then reconciles a successful semantic checkpoint', async () => {
    const { advanceMechanicalContext } = await import('./checkpoint.js');
    const cleared = advanceMechanicalContext(MECHANICAL, { resumeSource: 'clear' });

    expect(cleared).toMatchObject({
      workRevision: MECHANICAL.workRevision + 1,
      semanticRevision: MECHANICAL.semanticRevision,
      nudgeEmitted: false,
      clearPending: true,
      lastResumeSource: 'clear',
    });
    expect(advanceMechanicalContext(cleared, { resumeSource: 'clear' })).toEqual(cleared);
    expect(advanceMechanicalContext(cleared, { semanticCheckpointWritten: true })).toMatchObject({
      workRevision: cleared.workRevision,
      semanticRevision: cleared.workRevision,
      clearPending: false,
    });
  });
});
