import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function skill(name: string): string {
  return readFileSync(new URL(`../../packages/core/skills/${name}/SKILL.md`, import.meta.url), 'utf8').replace(/\s+/g, ' ');
}

describe('proportional delivery preserves quality without improvement loops', () => {
  it('accepts an explicit complete request without manufacturing a ticket or repeated approval', () => {
    expect(skill('void-implement')).toMatch(/explicit user request.*acceptance criteria/i);
    expect(skill('void-brainstorm')).toMatch(/already authorized.*do not.*approval/i);
    expect(skill('void-plan')).toMatch(/already authorized.*do not.*approval/i);
    expect(skill('void-ticket')).toMatch(/not a prerequisite.*explicit user request/i);
  });

  it('stops after acceptance, applicable evidence and independent review are satisfied', () => {
    const implement = skill('void-implement');
    expect(implement).toMatch(/Stop when.*acceptance.*proofs.*review/i);
    expect(implement).toMatch(/optional improvements.*never.*cycle/i);
    expect(implement).toContain('Maximum two correction batches');
    expect(implement).toContain('author-owned evidence obligations');
  });

  it('keeps test-first behavior while accepting evidence without phase commits', () => {
    const tdd = skill('void-tdd');
    expect(tdd).toMatch(/failing test before.*production/i);
    expect(tdd).toMatch(/RED.*command.*result.*before/i);
    expect(tdd).toMatch(/Separate.*RED.*GREEN.*commits.*not required/i);
    expect(tdd).not.toContain('The commit history must show');
    expect(tdd).not.toContain('Explicit Folpe approval');
  });

  it('uses configured thresholds and relevant behavior coverage without a universal percentage', () => {
    const tdd = skill('void-tdd');
    expect(tdd).toMatch(/project.*coverage thresholds.*remain/i);
    expect(tdd).not.toMatch(/100% by default|100% remains the default/);
    expect(tdd).toMatch(/invariants.*error paths.*boundaries/i);
  });

  it('reuses unaffected proofs and reports only applicable verification', () => {
    const verify = skill('void-verify');
    expect(verify).toMatch(/Reuse.*unaffected.*proofs/i);
    expect(verify).toMatch(/do not.*twelve.*checklist/i);
    expect(verify).toMatch(/unknown.*never.*passed/i);
  });

  it('requires demonstrated consequences instead of treating missing test prose as a defect', () => {
    const review = skill('void-code-review');
    expect(review).not.toContain('Correctness / missing test / security / boundary violation:');
    expect(review).toMatch(/missing test.*demonstrated.*risk/i);
    expect(review).toMatch(/advisory.*never.*correction/i);
  });

  it('scopes expensive advice and UI audits while retaining safety and architecture standards', () => {
    const implement = skill('void-implement');
    expect(implement).toMatch(/KISS.*SOLID/);
    expect(implement).toMatch(/affected.*states.*viewports/i);
    expect(implement).toMatch(/final.*security.*does not replace/i);
    expect(implement).toContain('Targeted preparation advice');
  });

  it('does not reintroduce mandatory phase commits through the shipping skill', () => {
    const commits = skill('void-commit-discipline');
    expect(commits).not.toMatch(/bug fix is TWO commits|Combined into one commit = rejected/);
    expect(commits).not.toContain('MUST NOT combine bug-fix');
    expect(commits).toMatch(/Separate.*test.*fix.*commits.*optional/i);
    expect(commits).toMatch(/observed RED.*before.*GREEN/i);
    expect(commits).toMatch(/logical.*bisectable/i);
  });

  it('keeps diff-aware browser QA inside the affected contract through every composed pass', () => {
    const qa = skill('void-qa');
    expect(qa).toMatch(/Diff-aware.*affected.*states.*viewports/i);
    expect(qa).toMatch(/homepage.*only.*affected/i);
    expect(qa).toMatch(/Health score.*only.*full audit/i);
    expect(qa).toMatch(/Visual pass.*only.*materially redesigned/i);
    expect(qa).toMatch(/Diff-aware.*only.*in-scope.*blocking defects/i);
    expect(qa).not.toContain('standard (default) +medium');
    expect(qa).toMatch(/outside.*scope.*do not.*fix loop/i);
  });

});
