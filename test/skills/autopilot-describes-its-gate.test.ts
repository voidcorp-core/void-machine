/**
 * The shipped skill told consumers the opposite of what the CLI does.
 *
 * For days `void-autopilot/SKILL.md` said "`mergeGate: human` is the only value
 * the programme descriptor accepts" and "You stay the merge gate", while
 * `program.ts` accepted `union-reviewed` and a machine could merge on its own. A
 * consumer reading that skill believed their merges stayed theirs.
 *
 * The continuous loop moved the merge itself to GitHub: the kernel arms
 * auto-merge on the exact head SHA, the merge queue reruns the required checks,
 * and `independent-review` reads the reviewer's verdict. What the skill owes the
 * reader is therefore that gate, stated by the kernel's own vocabulary, and never
 * the claim that was false.
 */

import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SKILL = readFileSync(
  new URL('../../packages/core/skills/void-autopilot/SKILL.md', import.meta.url),
  'utf8',
);

const FLAT = SKILL.replace(/\s+/g, ' ');

describe('the autopilot skill describes the gate the loop applies', () => {
  // The kernel returns `enable-auto-merge` with the head SHA it judged; arming
  // the merge on anything broader would merge a commit nobody reviewed.
  it('arms a merge only on the head SHA the kernel names, never around protection', () => {
    expect(FLAT).toMatch(/autopilot arm --ticket <id> --pr <n> --head <headSha>`: it records the head, arms on exactly that head/);
    expect(FLAT).toMatch(/never `--admin`/);
    expect(FLAT).toMatch(/autopilot disarm --pr <n>`, before the action that follows it/);
  });

  it('names the merge queue and the local review verdict that gate the merge', () => {
    expect(FLAT).toMatch(/merge queue/i);
    expect(FLAT).toMatch(/autopilot review --ticket <id> --pr <n> --head <headSha>/);
    expect(FLAT).toMatch(/`next` decides on that record alone/);
  });

  it('keeps a serial fallback where no merge queue exists', () => {
    expect(FLAT).toMatch(/Serial fallback/);
  });

  it('does not claim human is the only accepted merge gate', () => {
    const flat = SKILL.replace(/\s+/g, ' ');
    expect(flat).not.toMatch(/only value the programme descriptor accepts/i);
    expect(flat).not.toMatch(/`mergeGate: human` is the only/i);
  });

  it('still refuses a flag, which is the part that was always true', () => {
    expect(SKILL.replace(/\s+/g, ' ')).toMatch(/no `--auto-merge`|never merges on a flag/i);
  });

  it('keeps promotion to the deploying branch human, in both gates', () => {
    expect(SKILL.replace(/\s+/g, ' ').toLowerCase()).toMatch(/deploys stays human|promotion .{0,40}human/);
  });
});

/**
 * The same false sentence, in every shipped surface at once.
 *
 * Fixing it on `void-autopilot/SKILL.md` alone left it standing in two other
 * readers: `void-ticket/SKILL.md`, which is what instructs an author writing the
 * program block, and `preflight.ts`, which is what `doctor` prints. Each was
 * found by reading the next file after correcting the last one — the class of
 * defect this repository already paid for, whose only exit is an inventory of
 * every reader in one pass rather than one fix per command.
 *
 * So the net is the glob, not the file. A skill added later inherits it.
 */
describe('no shipped surface claims one merge gate is the only one', () => {
  const SURFACES = globSync('packages/core/skills/*/SKILL.md', {
    cwd: new URL('../../', import.meta.url).pathname,
  });

  it('found the skills to hold, so an empty glob cannot pass as agreement', () => {
    expect(SURFACES.length).toBeGreaterThan(10);
  });

  it.each(SURFACES)('%s does not assert a single accepted gate', (surface) => {
    const flat = readFileSync(new URL(`../../${surface}`, import.meta.url), 'utf8').replace(
      /\s+/g,
      ' ',
    );

    expect(flat).not.toMatch(/`?mergeGate: human`? is the only/i);
    expect(flat).not.toMatch(/only value the programme descriptor accepts/i);
  });
});
