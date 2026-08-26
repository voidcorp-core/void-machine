import { describe, expect, it } from 'vitest';
import { parseCheckpoint } from './checkpoint.js';

describe('checkpoint public boundary', () => {
  it('exposes the shared tolerant parser', () => {
    expect(parseCheckpoint('## Objective\n\nResume once.\n').objective).toBe('Resume once.');
  });
});
