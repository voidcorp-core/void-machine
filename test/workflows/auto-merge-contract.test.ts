import { describe, expect, it } from 'vitest';
import { assertAutoMergeAllowed } from '../../scripts/auto-merge-contract.mjs';
import { PRODUCT_IDENTITY } from '../../packages/hook-runner/src/identity.js';

// Auto-merge is the default way a pull request lands on develop: branch
// protection and the required deterministic checks decide
// when. Only a pull request into main is refused: promoting develop to main,
// and merging the release pull request, are the two human release actions.

const armed = {
  autoMergeRequest: { enabledAt: '2026-08-21T10:00:00Z' },
  baseRefName: 'develop',
  headRefName: 'work/dev-42',
};

const expected = { repository: PRODUCT_IDENTITY.repositorySlug, forbiddenBase: 'main' };

describe('auto-merge contract', () => {
  it('allows an armed auto-merge into develop, from any branch', () => {
    expect(assertAutoMergeAllowed(armed, expected)).toBe('allowed');
    const backMerge = { ...armed, headRefName: 'chore/back-merge-main' };
    expect(assertAutoMergeAllowed(backMerge, expected)).toBe('allowed');
  });

  it('reads an unarmed pull request as such, whatever its base', () => {
    expect(assertAutoMergeAllowed({ ...armed, autoMergeRequest: null }, expected)).toBe('unarmed');
    const promotion = { autoMergeRequest: null, baseRefName: 'main', headRefName: 'develop' };
    expect(assertAutoMergeAllowed(promotion, expected)).toBe('unarmed');
  });

  it.each([
    ['the promotion', { baseRefName: 'main', headRefName: 'develop' }],
    ['the release pull request', { baseRefName: 'main', headRefName: 'release-please--branches--main' }],
    ['any other pull request into main', { baseRefName: 'main' }],
  ])('refuses an armed auto-merge on %s', (_name, mutation) => {
    expect(() => assertAutoMergeAllowed({ ...armed, ...mutation }, expected)).toThrow(/main/);
  });

  it('refuses an input it cannot read rather than allowing it', () => {
    expect(() => assertAutoMergeAllowed({ ...armed, autoMergeRequest: 'yes' }, expected)).toThrow(
      /malformed/,
    );
    expect(() => assertAutoMergeAllowed({ ...armed, baseRefName: undefined }, expected)).toThrow(
      /base/,
    );
    expect(() => assertAutoMergeAllowed(armed, { ...expected, forbiddenBase: '' })).toThrow(
      /forbidden base/,
    );
  });
});
