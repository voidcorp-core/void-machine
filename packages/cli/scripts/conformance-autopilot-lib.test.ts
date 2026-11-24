import { describe, expect, it } from 'vitest';
import { assertPortableConsumerSkill } from './conformance-autopilot-lib.mjs';

describe('Autopilot consumer skill portability', () => {
  it('allows repository paths used only as footprint examples', () => {
    expect(() =>
      assertPortableConsumerSkill([
        '`packages/**/*.test.ts` and `packages/core/src/b` can overlap.',
        '`packages/core/src/templates/` and `./packages/core/src/templates` are the same area.',
      ].join('\n')),
    ).not.toThrow();
  });

  it('rejects executable and linked dependencies on the harness monorepo', () => {
    expect(() =>
      assertPortableConsumerSkill('Run `node packages/cli/dist/bin/void-machine.mjs status`.\n'),
    ).toThrow(/packages\/cli/);
    expect(() =>
      assertPortableConsumerSkill('[internal rule](../../../packages/core/src/skills/void-tdd/SKILL.md)'),
    ).toThrow(/packages\/core/);
  });
});
