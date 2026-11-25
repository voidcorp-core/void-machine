/**
 * A ticket written without looking is a ticket written twice.
 *
 * On 2026-08-06 DEV-591 was created about an unstable test suite while DEV-561
 * had covered the same subject since 2026-08-03, at high priority. The two share
 * no word in their titles -- "suite de tests instable" against "contention des
 * tests" -- so searching the phrasing would have found nothing, and searching the
 * subject would have found it immediately.
 *
 * The expensive half was not the duplicate. DEV-561 carried an explicit finding:
 * an intermittent test is a question nobody has answered, not noise to isolate.
 * DEV-591 recommended precisely what DEV-561 forbade, because nobody read it.
 *
 * These clauses decay the same way every process step does: they get compressed
 * into "check for duplicates", which reads as advice and changes nothing.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SKILL = readFileSync(
  new URL('../../packages/core/src/skills/void-ticket/SKILL.md', import.meta.url),
  'utf8',
);

/** Markdown reflows; these assertions are about wording, not line breaks. */
const flat = SKILL.replace(/\s+/g, ' ').toLowerCase();

describe('void-ticket searches the tracker before it creates', () => {
  it('makes the search a step before creation, not an aside', () => {
    expect(flat).toContain('search the tracker before');
  });

  it('searches the subject rather than the phrasing, which is what made DEV-591 invisible', () => {
    expect(flat).toMatch(/subject.{0,60}(never|not) on the (title|phrasing|wording)/);
  });

  it('includes closed tickets, the ones most costly to reopen unchanged', () => {
    expect(flat).toMatch(/clos(ed|e)/);
  });

  it('requires reading the whole overlapping ticket, since the value is in the reasoning', () => {
    expect(flat).toMatch(/read(ing)? .{0,60}(in full|the whole|entire)/);
  });

  it('offers exactly two outcomes on an overlap, and creating in silence is neither', () => {
    expect(flat).toContain('enrich');
    expect(flat).toMatch(/name (the )?difference|names? what is different|nam(e|ing) the difference/);
  });

  it('never merges on its own, because a resemblance is not an identity', () => {
    expect(flat).toMatch(/never merge|no automatic merge|merging .{0,40}human/);
  });

  it('keeps writing when the tracker is unreachable, saying so rather than blocking', () => {
    expect(flat).toMatch(/unreachable|unavailable/);
  });

});
