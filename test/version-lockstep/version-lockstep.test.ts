/**
 * Tests for scripts/check-version-lockstep.mjs — the lockstep version guard.
 * Behavioral drift checks complement the CLI guard run against the candidate.
 */

import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM script, no types
import { findDrift } from '../../scripts/check-version-lockstep.mjs';

describe('findDrift', () => {
  it('returns [] when every file matches the canonical version', () => {
    const entries = [
      { file: 'a', version: '0.6.0' },
      { file: 'b', version: '0.6.0' },
    ];
    expect(findDrift('0.6.0', entries)).toEqual([]);
  });

  it('flags every file that diverges', () => {
    const entries = [
      { file: 'a', version: '0.6.0' },
      { file: 'b', version: '0.5.4' },
      { file: 'c', version: '0.7.0' },
    ];
    const drift = findDrift('0.6.0', entries);
    expect(drift).toHaveLength(2);
    expect(drift[0]).toContain('b');
    expect(drift[1]).toContain('c');
  });
});
