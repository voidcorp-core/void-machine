/**
 * The shipped prose promised a switch nobody read.
 *
 * The `CLAUDE.md` injected into every consumer said the `autopilot` block "is
 * never inferred: `enabled: false`, an absent block, or an unreadable one
 * forbids autonomous selection entirely", and the skill said the same. The field
 * was declared in a type and consulted nowhere: a person who wrote
 * `enabled: false` to stop the autopilot, and read their own doctrine to check,
 * was not protected. The failure was open, silent, and on the harness's
 * strongest safety claim (DEV-678).
 *
 * Naming the field in the prose is what created the promise, so the prose is
 * held to the code here rather than trusted. Each way of withholding consent is
 * EXERCISED against the parser and then required to appear in what ships. Delete
 * the support and this goes red; delete the sentence and it goes red too.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseProgramDescriptor } from '../../packages/cli/src/lib/autopilot/program.js';
import { harnessBlock } from '../../packages/cli/src/lib/claude-md.js';

const SKILL = readFileSync(
  new URL('../../packages/core/skills/void-autopilot/SKILL.md', import.meta.url),
  'utf8',
);

const INJECTED = harnessBlock({
  doctrines: [{ name: 'void', description: 'universal craftsman skills' }],
  enabledPlugins: ['void'],
  enabledPacks: [],
});

const BLOCK = `autopilot:
  schemaVersion: 2
  clusterSize: 2
  base: auto
  verifyCommands:
    - [pnpm, test]
  ownership:
    sequential: []
    reconcileOnly: []`;

function descriptor(block: string): string {
  return `---
schemaVersion: 1
status: executing
program: void-harness-v3
plan: docs/plans/p.md
spec: docs/specs/s.md
progress:
  provider: linear
  scope: voidcorp/DEV
  order: [DEV-1]
  states:
    ready: [Backlog]
    started: [In Progress]
    review: [In Review]
    done: [Done]
humanGates: []
${block}
---

# Program
`;
}

/** Whether a descriptor grants autonomous selection, however it was written. */
function grantsConsent(text: string): boolean {
  try {
    return parseProgramDescriptor(text).autopilot !== undefined;
  } catch {
    // An unreadable block is a refusal, not a crash the caller may ignore.
    return false;
  }
}

/** Every way a programme withholds consent, with the word the prose uses for it. */
const WITHHOLDINGS = [
  {
    what: 'a block that says enabled: false',
    named: /enabled:\s*false/,
    descriptor: descriptor(BLOCK.replace('  schemaVersion: 2', '  schemaVersion: 2\n  enabled: false')),
  },
  {
    what: 'no block at all',
    named: /absent|missing/i,
    descriptor: descriptor(''),
  },
  {
    what: 'a block nothing can read',
    named: /unreadable/i,
    descriptor: descriptor('autopilot: [not, a, block]'),
  },
] as const;

describe('the autopilot consent the prose promises is the one the code reads', () => {
  it.each(WITHHOLDINGS)('refuses consent on $what', ({ descriptor: text }) => {
    expect(grantsConsent(text)).toBe(false);
  });

  it.each(WITHHOLDINGS)('names $what in the CLAUDE.md every consumer receives', ({ named }) => {
    expect(INJECTED).toMatch(named);
  });

  it.each(WITHHOLDINGS)('names $what in the skill a runtime loads', ({ named }) => {
    expect(SKILL).toMatch(named);
  });

  // The control. Without it every assertion above would still pass on a parser
  // that refused every programme ever written.
  it('grants consent to a declared block that withholds nothing', () => {
    expect(grantsConsent(descriptor(BLOCK))).toBe(true);
  });
});
