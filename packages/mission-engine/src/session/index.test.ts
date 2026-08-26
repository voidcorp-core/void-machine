import { describe, expect, it } from 'vitest';
import { composeResumeBundle, parseCheckpoint } from './index.js';

describe('session public surface', () => {
  it('exposes checkpoint parsing and ResumeBundle composition together', () => {
    expect(parseCheckpoint).toBeTypeOf('function');
    expect(composeResumeBundle).toBeTypeOf('function');
  });
});
