import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const skill = readFileSync(
  new URL('../../packages/core/skills/void-implement/SKILL.md', import.meta.url), 'utf8',
);
const passes = skill.split('\n').filter(line => /^\d+\. \*\*/.test(line));

describe('preparation advice in the implement cycle', () => {
  it('uses the primary domain expert for coding work and keeps final review mandatory', () => {
    const advice = passes.find(line => line.includes('Targeted preparation advice')) ?? '';
    expect(advice).toContain('(IF production behavior, a coding contract or implementation structure changes)');
    expect(advice).toContain('invoke the primary domain specialist before implementation');
    expect(advice).toContain('reuse its advice');
    expect(advice).toContain('distinct risk');
    expect(advice).toContain('not an automatic canonical gate');
    expect(advice).toContain('void-orchestrate');
    expect(skill).toContain('Normal\n   dispatch starts the writer without a compulsory preparation panel');
    expect(passes.find(line => line.includes('**Review**'))).toContain('(ALWAYS)');
  });

  it('preserves authentic invocation and unchanged canonical envelopes', () => {
    for (const field of ['runtime', 'agentName', 'missionId', 'contextPack', 'reviewSubject', 'reviewScope']) {
      expect(skill).toContain(field);
    }
    expect(skill).toContain('record actual starts/results');
    expect(skill).toContain('author-owned evidence obligations');
    expect(skill).toContain('at most four');
  });

  it('keeps the numbered professional passes in order', () => {
    expect(passes.map(line => Number(line.slice(0, line.indexOf('.')))))
      .toEqual(passes.map((_, index) => index + 1));
    expect(passes.findIndex(line => line.includes('Targeted preparation advice')))
      .toBeLessThan(passes.findIndex(line => line.includes('TDD implementation')));
  });
});
