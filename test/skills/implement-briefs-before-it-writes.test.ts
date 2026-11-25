import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const skill = readFileSync(
  new URL('../../packages/core/src/skills/void-implement/SKILL.md', import.meta.url), 'utf8',
);

describe('preparation advice in the implement cycle', () => {

  it('preserves authentic invocation and unchanged canonical envelopes', () => {
    for (const field of ['runtime', 'agentName', 'missionId', 'contextPack', 'reviewSubject', 'reviewScope']) {
      expect(skill).toContain(field);
    }
    expect(skill).toContain('record actual starts/results');
    expect(skill).toContain('author-owned evidence obligations');
    expect(skill).toContain('at most four');
  });

});
