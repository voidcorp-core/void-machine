/**
 * The autopilot skill is a contract, and these are the clauses that make it safe.
 *
 * Two properties are worth a gate rather than a review comment, because both
 * decay silently: that autopilot delegates the ticket cycle instead of restating
 * it, and that workers are denied every remote effect. A skill file drifts one
 * helpful paragraph at a time.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LoopAction } from '../../packages/cli/src/lib/autopilot/loop.js';

/** Every action the kernel can return; the type below fails to compile when one is missing. */
const LOOP_ACTION_KINDS = [
  'assign',
  'wait',
  'hand-back-to-worker',
  'mark-human-wait',
  'enable-auto-merge',
  'disable-auto-merge',
  'review',
  'requeue',
  'drain',
  'freeze',
  'recap',
] as const satisfies readonly LoopAction['kind'][];
const everyKindListed: [Exclude<LoopAction['kind'], (typeof LOOP_ACTION_KINDS)[number]>] extends [never]
  ? true
  : never = true;

const SKILL = readFileSync(new URL('../../packages/core/skills/void-autopilot/SKILL.md', import.meta.url), 'utf8');
const TICKET_RUNNER = readFileSync(
  new URL('../../packages/core/skills/void-implement/SKILL.md', import.meta.url),
  'utf8',
);

function body(source: string): string {
  return source.slice(source.indexOf('\n---', 4) + 4);
}

/** Markdown reflows; these assertions are about wording, not line breaks. */
function flat(source: string): string {
  return source.replace(/\s+/g, ' ');
}

describe('autopilot skill frontmatter', () => {
  it('declares both runtimes, because the plan is runtime-neutral by design', () => {
    // The runtimes declaration is harness metadata, so it lives in the sidecar:
    // a SKILL.md carries only the six fields the Agent Skills spec defines.
    expect(readFileSync(new URL('../../packages/core/skills/void-autopilot/harness.yaml', import.meta.url), 'utf8'))
      .toContain('runtimes: [claude, codex]');
  });

});

describe('delegation to implement', () => {
  it('names implement as the one owner of the per-ticket cycle', () => {
    expect(body(SKILL)).toMatch(/void-implement/);
    expect(body(SKILL)).toMatch(/owns no ticket cycle/i);
  });

  it('does not restate the quality passes implement owns', () => {
    // Autopilot may NAME the skill; it may not re-specify its passes. Two copies
    // of the cycle drift, and a ticket then gets a different standard depending
    // on how it was started.
    const passes = [
      'Architecture pass',
      'Migration safety',
      'TDD implementation',
      'Async + idempotency',
      'End-to-end tests',
      'UX/UI pass',
      'Security pass',
      'Verification before completion',
    ];
    const restated = passes.filter((pass) => body(SKILL).includes(pass));
    expect(restated).toEqual([]);

    // Sanity: those headings really are implement's, so the check above is
    // testing something real rather than passing on a typo.
    expect(passes.every((pass) => TICKET_RUNNER.includes(pass))).toBe(true);
  });

  it('does not carry a triage table of its own', () => {
    expect(body(SKILL)).not.toMatch(/\|\s*Pass\s*\|\s*Fires when/i);
  });
});

describe('remote effects stay with the roles that own them', () => {
  // The loop hands a worker its own branch and pull request, and nothing past
  // them: the merge is GitHub's, the verdict the reviewer's, Done the loop's.
  it('states that workers never merge, arm a merge, post the verdict, or finish a ticket', () => {
    const mayNot = /May not:([\s\S]*?)\n\n/.exec(body(SKILL))?.[1] ?? '';
    expect(mayNot).toMatch(/enable auto-merge/i);
    expect(mayNot).toMatch(/merge anything/i);
    expect(mayNot).toMatch(/post or record a verdict, run `autopilot review`/);
    expect(mayNot).toMatch(/Done/);
    expect(mayNot).toMatch(/close or cancel/i);
  });

  // The section that added the shared-ref prohibition sat 130 lines above this
  // list and left it untouched. A canonical list that stops being canonical is
  // the version a reader trusts.
  it('carries every prohibition in the one list a reader treats as canonical', () => {
    const mayNot = flat(/May not:([\s\S]*?)\n\n/.exec(body(SKILL))?.[1] ?? '');
    expect(mayNot).toMatch(/git state the repository shares/i);
    expect(mayNot).toMatch(/refs\/stash/);
    // `.void/machine` is shared between worktrees the same way, and the harness
    // writes it on purpose, so the journals are named rather than left to the
    // class above -- see the decision that runtime state from a worktree
    // belongs to the repository.
    expect(mayNot).toMatch(/prune the mission journals/i);
  });

  it('keeps the merge a declaration, never a flag', () => {
    expect(body(SKILL)).toMatch(/never merges/i);
    expect(body(SKILL)).toMatch(/mergeGate: human/);
    // The flag must not reappear as a CAPABILITY. Naming it to say it does not
    // exist is the opposite, and forbidding the string outright forbids saying so
    // -- which is how this assertion first fired on prose that agreed with it.
    const flat = body(SKILL).replace(/\s+/g, ' ');
    const mentions = [...flat.matchAll(/[^.]*--auto-merge[^.]*\./g)].map((m) => m[0]);
    for (const sentence of mentions) {
      expect(sentence, sentence).toMatch(/\bno\b|\bnot\b|never|refus/i);
    }
  });

  it('gives every worker its worktree before it starts', () => {
    expect(flat(body(SKILL))).toMatch(/worktree before it starts/i);
    expect(flat(body(SKILL))).toMatch(/never chooses its own checkout and never works in the main one/i);
  });

  it('keeps migrations out of production', () => {
    expect(flat(body(SKILL))).toMatch(/dev\/local/i);
  });
});

describe('the curator ranks, and never disposes', () => {
  it('walks the tracker in the declared order and ranks on the project, not the label', () => {
    expect(flat(body(SKILL))).toMatch(/Todo, then Backlog, then Triage/);
    expect(flat(body(SKILL))).toMatch(/not by the priority label/i);
  });

  it('justifies every move, enriches through void-ticket, and never closes', () => {
    expect(flat(body(SKILL))).toMatch(/every ticket you move a justification/i);
    expect(flat(body(SKILL))).toMatch(/goes through `void-ticket` before it can be declared `ready`/);
    expect(flat(body(SKILL))).toMatch(/Never close, cancel or delete/);
    expect(flat(body(SKILL))).toMatch(/Re-rank after every merge/);
  });
});

describe('the review is local, bound to the head and to the session it delegated', () => {
  // A verdict read on GitHub can be written by anyone who comments; the loop
  // merges on the record the kernel wrote after delegating the reviewer itself.
  it('delegates the reviewer on the exact head and records its verdict locally', () => {
    expect(flat(body(SKILL))).toMatch(/checks its `HEAD` before and after the run, refuses a change that touches a protected path, whose configuration the reviewer would load, and delegates the reviewer there/);
    expect(flat(body(SKILL))).toMatch(/only from the native session the runtime lists under that run/);
    expect(flat(body(SKILL))).toMatch(/`\.void\/machine\/autopilot\/reviews\/<ticket>\/<head>\.json`; `next` decides on that record alone/);
    expect(flat(body(SKILL))).toMatch(/A verdict posted on the pull request is a copy for people/);
  });

  it('lets no agent post a verdict, and delegates a failed review again rather than approving it', () => {
    expect(flat(body(SKILL))).toMatch(/The review verdict is the local record above, never a comment/);
    expect(flat(body(SKILL))).toMatch(/May not: enable auto-merge, merge anything, post or record a verdict, run `autopilot review`/);
    expect(flat(body(SKILL))).toMatch(/a reviewer that failed without a verdict is an attempt it delegates again, not a round/);
  });

  it('blocks only on a scenario, files advisories once, and stops at two rounds', () => {
    expect(flat(body(SKILL))).toMatch(/Only what is wrong or dangerous, with a concrete scenario/);
    expect(flat(body(SKILL))).toMatch(/single Triage issue per ticket/);
    expect(flat(body(SKILL))).toMatch(/round 2 is handed round 1's blocking findings and checks only those/i);
  });
});

describe('the orchestrator acts on every action the kernel returns', () => {
  it('lists every kind the kernel declares', () => {
    expect(everyKindListed).toBe(true);
  });

  it.each(LOOP_ACTION_KINDS)('tells the orchestrator what to do on %s', (kind) => {
    expect(SKILL.split('\n').some((line) => line.startsWith(`| \`${kind}\` |`))).toBe(true);
  });

  it('fingerprints the shared state around each unit', () => {
    expect(body(SKILL)).toMatch(/fingerprint --before <ticket>/);
    expect(body(SKILL)).toMatch(/fingerprint --after <ticket>/);
  });
});

describe('provenance', () => {
  it('ships a .source next to the skill', () => {
    const source = readFileSync(new URL('../../packages/core/skills/void-autopilot/.source', import.meta.url), 'utf8');
    expect(source).toMatch(/backlog-autopilot/);
    expect(source).toMatch(/worktree/i);
  });

  it('records what was dropped from its predecessor, not only what was kept', () => {
    const audit = readFileSync(new URL('../../docs/plans/skill-audits/void-autopilot.md', import.meta.url), 'utf8');
    expect(audit).toMatch(/What was dropped/i);
    expect(audit).toMatch(/auto-merge/i);
  });
});
