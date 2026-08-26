/**
 * The checkpoint skill is a contract, and two clauses carry its whole value.
 *
 * The first is that it routes before it writes: a handoff that duplicates the
 * tracker, the diff or the doctrine creates a second copy of a fact, and within a
 * day one of them is wrong with no way to tell which. The second is that it names
 * the things no artefact holds — dead ends, unverified assumptions, proof
 * freshness, one executable next action. Both decay the same way: a helpful edit
 * turns the skill into "summarise the session", which is pleasant to write and
 * useless to read.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SKILL = readFileSync(
  new URL('../../packages/core/skills/void-checkpoint/SKILL.md', import.meta.url),
  'utf8',
);

function frontmatter(source: string): string {
  return /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? '';
}

function body(source: string): string {
  return source.slice(source.indexOf('\n---', 4) + 4);
}

/** Markdown reflows; these assertions are about wording, not line breaks. */
function flat(source: string): string {
  return source.replace(/\s+/g, ' ');
}

describe('checkpoint frontmatter', () => {
  it('declares both runtimes, because a handoff is not a Claude-only artefact', () => {
    // The runtimes declaration is harness metadata, so it lives in the sidecar:
    // a SKILL.md carries only the six fields the Agent Skills spec defines.
    expect(readFileSync(new URL('../../packages/core/skills/void-checkpoint/harness.yaml', import.meta.url), 'utf8'))
      .toContain('runtimes: [claude, codex]');
  });

  it('keeps its description within the discovery budget', () => {
    const description = /^description:\s*(.*)$/m.exec(frontmatter(SKILL))?.[1] ?? '';
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(250);
  });

  it('stays under the skill size cap', () => {
    expect(SKILL.split('\n').length).toBeLessThanOrEqual(400);
  });
});

describe('routing comes before writing', () => {
  it('sends execution state to the declared progress source rather than into the checkpoint', () => {
    expect(flat(body(SKILL))).toMatch(/Execution state[\s\S]{0,100}progress source/i);
  });

  it('names every authoritative destination, so the residue is what is left', () => {
    for (const destination of ['program', 'progress source', 'diff', 'doctrine', 'ADR']) {
      expect(body(SKILL), destination).toMatch(new RegExp(destination, 'i'));
    }
  });

  it('requires the authoritative write to happen first, not to be promised', () => {
    expect(flat(body(SKILL))).toMatch(/write it there \*\*first\*\*/i);
  });
});

describe('the residue it exists to capture', () => {
  it('asks for the dead ends, which are the half no artefact records', () => {
    expect(flat(body(SKILL))).toMatch(/did not work/i);
    expect(flat(body(SKILL))).toMatch(/why you stopped/i);
  });

  it('separates a proven claim from an assumed one', () => {
    expect(flat(body(SKILL))).toMatch(/label every unverified belief as unverified/i);
  });

  it('binds a proof to the commit it was proven against', () => {
    expect(flat(body(SKILL))).toMatch(/which command, on which commit/i);
  });

  it('demands one next action specific enough to execute', () => {
    expect(flat(body(SKILL))).toMatch(/is not a next action/i);
  });
});

describe('what it refuses to become', () => {
  it('refuses to be a narrative of the session', () => {
    expect(flat(body(SKILL))).toMatch(/not a plan for what is next/i);
  });

  it('keeps lifecycle hooks advisory and reserves semantic writing for the skill', () => {
    expect(flat(body(SKILL))).toMatch(/UserPromptSubmit[\s\S]{0,160}remind/i);
    expect(flat(body(SKILL))).toMatch(/SessionEnd[\s\S]{0,160}audit/i);
    expect(flat(body(SKILL))).toMatch(/hooks? never write/i);
  });

  it('keeps closing a session apart from completing a unit of work', () => {
    expect(flat(body(SKILL))).toMatch(/a session ending is not a unit completing/i);
  });

  it('refuses to carry a secret into a shared destination', () => {
    expect(flat(body(SKILL))).toMatch(/secret[\s\S]{0,120}redact/i);
  });
});

describe('program and checkpoint ownership', () => {
  it('writes the canonical local checkpoint even when the progress provider is offline', () => {
    expect(flat(body(SKILL))).toMatch(/progress (?:source|provider)[\s\S]{0,180}unavailable/i);
    expect(flat(body(SKILL))).toMatch(/still write[\s\S]{0,100}\.void\/machine\/checkpoint\.md/i);
  });

  it('keeps current and next units out of both durable files', () => {
    expect(flat(body(SKILL))).toMatch(/program[\s\S]{0,120}checkpoint[\s\S]{0,160}current or next unit/i);
  });

  it('binds the checkpoint to both branch and HEAD', () => {
    expect(flat(body(SKILL))).toMatch(/frontmatter[\s\S]{0,100}branch[\s\S]{0,40}head/i);
  });
});

describe('the exit test can actually fail', () => {
  it('asks whether a stranger could act on it without asking a question', () => {
    expect(flat(body(SKILL))).toMatch(/without asking a question/i);
  });

  it('asks whether a reader would repeat a dead end', () => {
    expect(flat(body(SKILL))).toMatch(/repeat one of your dead ends/i);
  });
});

describe('provenance', () => {
  it('ships a .source recording what it took and what it refused', () => {
    const source = readFileSync(
      new URL('../../packages/core/skills/void-checkpoint/.source', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(/context-save/i);
    expect(source).toMatch(/Rejected/i);
  });

  it('records the boundary with the skills it sits next to', () => {
    const audit = readFileSync(
      new URL('../../docs/plans/skill-audits/void-checkpoint.md', import.meta.url),
      'utf8',
    );
    expect(audit).toMatch(/Boundary with `void-learn`/);
    expect(audit).toMatch(/Boundary with `void-retrospective`/);
    expect(audit).toMatch(/What was rejected/i);
  });
});
