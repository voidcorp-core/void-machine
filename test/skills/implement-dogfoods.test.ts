/**
 * Six defects shipped on 2026-08-06 with typecheck, lint, 2,700 tests and five CI
 * checks green. What caught them: the agent using the thing on the real
 * repository, five times; the harness itself once. The human merge gate caught
 * none, and CI caught none.
 *
 * One announced "5 path(s) not extracted (... 2 unresolved-import)" about two
 * files it had read, parsed and indexed -- the exact lie the feature existed to
 * prevent -- and it was found by running the command on the repo, after merge.
 *
 * So the pass does not ask whether the tests pass. It asks whether anyone ran
 * the thing and read what came back, which is a different question, and the only
 * one that had a hit rate.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SKILL = readFileSync(
  new URL('../../packages/core/skills/void-implement/SKILL.md', import.meta.url),
  'utf8',
);
const flat = SKILL.replace(/\s+/g, ' ').toLowerCase();

describe('void-implement requires the shipped surface to be run', () => {

  it('states an observable predicate, like every other conditional pass', () => {
    expect(flat).toMatch(/cli command|executable surface|hook, .{0,40}command/);
  });

  it('demands the real repository, since a fixture is what would have missed them', () => {
    expect(flat).toMatch(/real repos(itory)?/);
    expect(flat).toMatch(/fixture/);
  });

  it('separates having run it from the tests being green', () => {
    expect(flat).toMatch(/did not crash|not a reading|is not an observation/);
  });

  it('requires the output to be quoted in the evidence, not summarised', () => {
    expect(flat).toMatch(/quoted|not summaris|not summariz/);
  });


});

describe('the doctrine points at the ship pass without a number that drifts', () => {
  it.each(['CLAUDE.md', 'AGENTS.md'])('%s names the pass rather than counting to it', (file) => {
    const doc = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    const row = doc.split('\n').find((line) => line.includes('Ship a PR')) ?? '';
    expect(row).not.toMatch(/pass \d+/);
    expect(row.toLowerCase()).toContain('ship pass');
  });
});
