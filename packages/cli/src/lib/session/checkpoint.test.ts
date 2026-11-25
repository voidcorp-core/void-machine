import { describe, expect, it } from 'vitest';
import { parseCheckpoint } from './checkpoint.js';

describe('checkpoint public boundary', () => {
  it('exposes the shared tolerant parser', () => {
    expect(parseCheckpoint('## Objective\n\nResume once.\n').objective).toBe('Resume once.');
  });

  it('ignores a legacy mechanical block without losing semantic residue', () => {
    const raw = [
      '## Objective', '', 'Resume once.', '',
      '<!-- void-harness:context-continuity:begin -->', 'schema_version: 9',
      '<!-- void-harness:context-continuity:end -->', '',
    ].join('\n');
    const checkpoint = parseCheckpoint(raw);
    expect(checkpoint.objective).toBe('Resume once.');
    expect(checkpoint).not.toHaveProperty('mechanicalContext');
  });
});
