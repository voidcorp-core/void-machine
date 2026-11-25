import { describe, expect, it } from 'vitest';
import { parseSelfHostArgs, selfHostExitCode } from './self-host.js';

describe('self-host CLI contract', () => {
  it('has one explicit validation without rollout modes', () => {
    expect(parseSelfHostArgs(['sync'])).toEqual({ action: 'sync' });
    expect(parseSelfHostArgs(['doctor'])).toEqual({ action: 'doctor' });
  });

  it.each(['not-installed', 'stale', 'drifted'] as const)(
    'fails structural state %s', (state) => {
      expect(selfHostExitCode(state)).toBe(2);
    },
  );

  it.each(['healthy', 'degraded'] as const)('accepts state %s', (state) => {
    expect(selfHostExitCode(state)).toBe(0);
  });

  it.each(['shadow', 'warn', 'enforce', 'release-gate'])(
    'explains the removed mode %s', (mode) => {
      expect(() => parseSelfHostArgs(['doctor', '--mode', mode])).toThrow('--mode was removed');
    },
  );

  it('rejects unknown flags', () => {
    expect(() => parseSelfHostArgs(['sync', '--unknown'])).toThrow('accepts no options');
  });
});
