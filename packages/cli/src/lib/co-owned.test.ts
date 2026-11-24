import { describe, expect, it } from 'vitest';
import { CO_OWNED_FILES, isCoOwned } from './co-owned.js';

// The list exists in one place because two sides of a dependency edge read it:
// the install seeds the stage from it, the manifest verification uses it to tell
// a project's own writing apart from drift. A second copy is how the two answers
// start disagreeing.
describe('isCoOwned', () => {
  it('claims the doctrine file the project is told to edit freely', () => {
    expect(isCoOwned('.void/PROJECT-DOCTRINE.md')).toBe(true);
  });

  it('claims the documents the harness only patches a block into', () => {
    expect(isCoOwned('CLAUDE.md')).toBe(true);
    expect(isCoOwned('AGENTS.md')).toBe(true);
    expect(isCoOwned('.gitignore')).toBe(true);
  });

  // A skill is ours outright: an edit to one is an asset diverging from the
  // version it claims, which is the drift the manifest exists to catch.
  it('says nothing about a managed asset, which the harness owns alone', () => {
    expect(isCoOwned('.claude/skills/void-tdd/SKILL.md')).toBe(false);
    expect(isCoOwned('.void/PHILOSOPHY.md')).toBe(false);
    expect(isCoOwned('.void/installed/PHILOSOPHY.md')).toBe(false);
    expect(isCoOwned('.void/hooks/_void-hook.mjs')).toBe(false);
  });

  it('matches the whole path, never a prefix of one', () => {
    expect(isCoOwned('apps/web/CLAUDE.md')).toBe(false);
    expect(isCoOwned('CLAUDE.md.bak')).toBe(false);
  });

  it('is a real list, so an empty one cannot pass this suite silently', () => {
    expect(CO_OWNED_FILES.length).toBeGreaterThanOrEqual(5);
  });
});
