import { describe, expect, it } from 'vitest';
import { parseCLI } from 'vitest/node';
import { stressPlan } from '../../scripts/stress-proof.mjs';

describe('scheduled stress proof plan', () => {
  it('assigns a stable seed to every fast attempt', () => {
    expect(stressPlan('fast', 2, 10_401)).toEqual([
      {
        attempt: 1,
        commands: [['pnpm', 'test:fast', '--sequence.shuffle', '--sequence.seed=10401']],
        seed: 10_401,
      },
      {
        attempt: 2,
        commands: [['pnpm', 'test:fast', '--sequence.shuffle', '--sequence.seed=10402']],
        seed: 10_402,
      },
    ]);
  });

  it('runs every fixed resource lane in a complete attempt', () => {
    expect(stressPlan('complete', 1, 20_401)[0]?.commands).toEqual([
      ['pnpm', 'test:cpu', '--sequence.shuffle', '--sequence.seed=20401'],
      ['pnpm', 'test:filesystem', '--sequence.shuffle', '--sequence.seed=20401'],
      ['pnpm', 'test:subprocess', '--sequence.shuffle', '--sequence.seed=20401'],
      ['pnpm', 'test:network', '--sequence.shuffle', '--sequence.seed=20401'],
    ]);
  });

  it('passes shuffle and each seed as actual Vitest options through pnpm scripts', () => {
    for (const attempt of stressPlan('complete', 2, 20_401)) {
      for (const command of attempt.commands) {
        // pnpm forwards every argument after the script name, including a literal --.
        const parsed = parseCLI(['vitest', 'run', ...command.slice(2)]);
        expect(parsed.options.sequence).toEqual({ shuffle: true, seed: attempt.seed });
      }
    }
  });

  it('refuses an unbounded or unsupported campaign', () => {
    expect(() => stressPlan('fast', 21, 1)).toThrow(/attempt/i);
    expect(() => stressPlan('fast', 2, 2_147_483_647)).toThrow(/seed/i);
    expect(() => stressPlan('unknown', 1, 1)).toThrow(/mode/i);
  });
});
