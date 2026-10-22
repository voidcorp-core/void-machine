import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const skill = readFileSync(
  new URL('../../packages/core/skills/void-implement/SKILL.md', import.meta.url), 'utf8',
);
const passes = skill.split('\n').filter(line => /^\d+\. \*\*/.test(line));

describe('preparation advice in the implement cycle', () => {
  it('keeps advice conditional and final review mandatory', () => {
    const advice = passes.find(line => line.includes('Targeted preparation advice')) ?? '';
    expect(advice).toContain('(IF a concrete risk or unresolved question');
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
