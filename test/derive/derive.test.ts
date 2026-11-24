import { describe, expect, it } from 'vitest';
import { dirtyPaths, producedBy } from '../../scripts/derive.mjs';

// The whole point of this pair is that neither of them names an artefact. Seven
// generated files each had their own build command and their own freshness gate,
// and the eighth was always going to be missing from whichever list someone
// updated last. Comparing the working tree before and after derivation covers
// what gets added later, without anyone remembering to say so.
describe('dirtyPaths', () => {
  it('reads a path whether the change is staged, unstaged, or both', () => {
    const porcelain = ' M a.ts\nM  b.ts\nMM c.ts';
    expect(dirtyPaths(porcelain)).toEqual(new Set(['a.ts', 'b.ts', 'c.ts']));
  });

  it('reads an untracked file, which is what a brand new artefact looks like', () => {
    expect(dirtyPaths('?? docs/CHEATSHEET.md')).toEqual(new Set(['docs/CHEATSHEET.md']));
  });

  it('says nothing about a clean tree', () => {
    expect(dirtyPaths('')).toEqual(new Set());
    expect(dirtyPaths('\n')).toEqual(new Set());
  });
});

describe('producedBy', () => {
  it('reports what derivation changed', () => {
    expect(producedBy(new Set(), new Set(['model.json']))).toEqual(['model.json']);
  });

  // Work in flight is not a stale artefact. Reporting it would make the check
  // fail on any dirty tree, which is how a gate gets bypassed rather than fixed.
  it('ignores what was already dirty before derivation ran', () => {
    expect(producedBy(new Set(['src/mine.ts']), new Set(['src/mine.ts', 'model.json'])))
      .toEqual(['model.json']);
  });

  it('is empty when derivation changed nothing', () => {
    expect(producedBy(new Set(['a']), new Set(['a']))).toEqual([]);
  });

  it('sorts, so the report reads the same twice', () => {
    expect(producedBy(new Set(), new Set(['b', 'a']))).toEqual(['a', 'b']);
  });
});

