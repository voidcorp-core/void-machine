/**
 * The skill described an order the controller refuses.
 *
 * `void-implement` says, in its "Canonical team orchestration" section, to take
 * every next action from the pure controller. That controller returns
 * `invoke-specialists` at `stage: 'pre-implementation'` as its FIRST action in
 * `team` mode -- probed live on 2026-08-30, mission `mis_c8fafb06`. Its numbered
 * cycle then put TDD at pass 5 and Review at pass 10, so a reader following the
 * prose wrote code first and convened the panel afterwards.
 *
 * Both statements were in the same file and nothing noticed, because prose has
 * no compiler. This is the closest thing it gets: the pass that convenes the
 * panel must be numbered before the pass that writes, and the stage name the
 * controller returns is read from the controller's own module rather than
 * retyped here -- a token this test spelled itself would survive the controller
 * renaming it.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SKILL = readFileSync(
  new URL('../../packages/core/skills/void-implement/SKILL.md', import.meta.url),
  'utf8',
);
const CONTROLLER = readFileSync(
  new URL('../../packages/mission-engine/src/orchestration/controller.ts', import.meta.url),
  'utf8',
);

/** One entry per numbered pass, in the order the skill lists them. */
const PASSES = SKILL.split('\n')
  .filter((line) => /^\d+\. \*\*/.test(line))
  .map((line) => ({
    number: Number(line.slice(0, line.indexOf('.'))),
    title: line.slice(line.indexOf('**') + 2, line.indexOf('**', line.indexOf('**') + 2)),
    body: line,
  }));

function passMatching(pattern: RegExp): (typeof PASSES)[number] | undefined {
  return PASSES.find((pass) => pattern.test(pass.body));
}

describe('the implement cycle briefs before it writes', () => {
  it('numbers its passes without a gap, so "before" is a fact and not a reading', () => {
    expect(PASSES.map((pass) => pass.number))
      .toEqual(PASSES.map((_pass, index) => index + 1));
  });

  it('convenes the panel in a numbered pass, not only in the orchestration preamble', () => {
    expect(passMatching(/invoke-specialists|convene/i)).toBeDefined();
  });

  it('puts that pass before the one that writes production code', () => {
    const convene = passMatching(/invoke-specialists|convene/i);
    const write = passMatching(/TDD implementation/);

    expect(convene?.number).toBeDefined();
    expect(write?.number).toBeDefined();
    expect(convene?.number ?? Number.POSITIVE_INFINITY)
      .toBeLessThan(write?.number ?? Number.NEGATIVE_INFINITY);
  });

  it('names the stage the controller actually returns first', () => {
    // Read from the controller rather than spelled here: a token this test wrote
    // itself would outlive the controller renaming the stage.
    expect(CONTROLLER).toContain("'pre-implementation'");
    expect(SKILL).toContain('pre-implementation');
  });

  it('hands the specialist the pack rather than describing one in the abstract', () => {
    // `contextPack` is the envelope field a skill can actually pass. Before the
    // pack existed the prose promised "bounded context pack" and nothing carried
    // one, which is the promise-without-a-mechanism this repository keeps paying for.
    expect(SKILL).toContain('contextPack');
  });

  it('uses native orchestration with the unchanged envelope and real provenance', () => {
    const convene = passMatching(/invoke-specialists|convene/i)?.body ?? '';
    expect(convene).toContain('void-orchestrate');
    for (const field of ['contextPack', 'reviewSubject', 'reviewScope', 'agentName', 'runtime', 'missionId']) {
      expect(convene).toContain(field);
    }
    expect(convene).toContain('actual');
    expect(convene).toContain('at most four');
    expect(convene).not.toContain('agents dispatch');
  });
});
