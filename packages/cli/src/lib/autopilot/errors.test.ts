import { describe, expect, it } from 'vitest';
import { autopilotFailure } from './errors.js';

describe('autopilotFailure', () => {
  it('preserves the program failure code and actionable fields', () => {
    const error = autopilotFailure('AUTOPILOT_PROGRAM', 'problem', 'cause', 'fix');

    expect(error.failure).toEqual({
      code: 'AUTOPILOT_PROGRAM',
      problem: 'problem',
      cause: 'cause',
      fix: 'fix',
    });
  });
});
