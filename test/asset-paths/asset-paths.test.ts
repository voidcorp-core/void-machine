import { describe, expect, it } from 'vitest';
import { deadPaths, harnessPaths, knownVoidPath, layoutEntries } from '../../scripts/check-asset-paths.mjs';

// Skills are prose an agent reads, and they name paths in that prose. When the
// layout moves, every one of those sentences is wrong and nothing says so:
// moving the programme pointer left four assets still routing to `plans/ACTIVE.md`,
// found by reading rather than by the build. On its first run this check found
// four more that reading had missed.
describe('harnessPaths', () => {
  it('reads a path the harness owns the meaning of', () => {
    expect(harnessPaths('read `.void/program.md` first')).toEqual(['.void/program.md']);
  });

  // An illustration is the consuming project's business, and asserting on it
  // would make the check wrong rather than strict.
  it('ignores a path that belongs to the consuming project', () => {
    expect(harnessPaths('any change to `apps/checkout/src/` triggers strict mode')).toEqual([]);
  });

  it('ignores prose that merely mentions a name, unquoted', () => {
    expect(harnessPaths('the old plans/ACTIVE.md contract, since moved')).toEqual([]);
  });

  it('reports each path once, sorted', () => {
    expect(harnessPaths('`docs/plans/a.md` and `docs/specs/b.md` and `docs/plans/a.md`'))
      .toEqual(['docs/plans/a.md', 'docs/specs/b.md']);
  });
});

describe('deadPaths', () => {
  const exists = (path: string): boolean => ['docs/specs'].includes(path);
  // `.void/` is answered by the table, so the fixture declares what it classifies.
  const entries = new Set(['program.md']);

  it('reports a path that resolves to nothing', () => {
    expect(deadPaths(['.void/program.md', 'plans/ACTIVE.md'], exists, entries)).toEqual([
      'plans/ACTIVE.md',
    ]);
  });

  // A skill saying specs live in `docs/specs/` is right whether or not one has
  // been written yet, so a location is checked as a directory.
  it('checks a trailing slash as a location, not a file', () => {
    expect(deadPaths(['docs/specs/'], exists)).toEqual([]);
  });

  // The same for a filename pattern: it describes where something will be
  // written, and demanding it already exist would fail on an empty project.
  it('checks a placeholder as the directory that holds it', () => {
    expect(deadPaths(['docs/specs/YYYY-MM-DD-<topic>.md'], exists)).toEqual([]);
    expect(deadPaths(['docs/absent/YYYY-MM-DD-<topic>.md'], exists)).toEqual([
      'docs/absent/YYYY-MM-DD-<topic>.md',
    ]);
  });

  it('says nothing when every path resolves', () => {
    expect(deadPaths(['.void/program.md'], exists, entries)).toEqual([]);
  });
});

// `.void/` is answered by the layout table, never by the filesystem. The two
// ignored levels are written at runtime, so a clone has no
// `.void/machine/checkpoint.md` and never should: CI proved that by failing on a
// sentence that was correct.
describe('layoutEntries and knownVoidPath', () => {
  const source = [
    "export const VOID_OWNERSHIP: Readonly<Record<string, Ownership>> = Object.freeze({",
    "  'program.md': 'project',",
    "  // a comment holding a brace } to trip a lazy match",
    "  hooks: 'derived',",
    "  runs: 'observed',",
    "});",
  ].join('\n');

  it('reads a quoted key and a bare one alike', () => {
    expect(layoutEntries(source)).toEqual(new Set(['program.md', 'hooks', 'runs']));
  });

  it('reads past a comment that contains a closing brace', () => {
    expect(layoutEntries(source).has('runs')).toBe(true);
  });

  it('accepts a path under a level directory by the entry it names', () => {
    const entries = layoutEntries(source);
    expect(knownVoidPath('.void/machine/runs/mis_x/events.jsonl', entries)).toBe(true);
    expect(knownVoidPath('.void/program.md', entries)).toBe(true);
  });

  it('refuses a path the table does not classify', () => {
    expect(knownVoidPath('.void/invented.md', layoutEntries(source))).toBe(false);
  });
})
