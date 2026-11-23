import { describe, expect, it } from 'vitest';
import {
  prefixedTokens,
  skillDirectorySegments,
  unresolvedTokens,
} from '../../scripts/check-skill-references.mjs';

// The `void-` prefix exists so a reference to a shipped skill is greppable. This
// checker makes every prefixed token in code resolve, so renames cannot leave
// a runtime pointing at a skill directory that no longer exists.
//
// The failure it targets happened: `runtime-adapters.ts` probed
// `.claude/skills/tdd/SKILL.md` to decide whether a local install had
// materialized. The prefix pass renamed the directory, the probe missed, the
// install read as absent, and `init` failed reporting sixteen missing
// specialists — a message pointing nowhere near the cause.
describe('prefixedTokens', () => {
  it('reads a token out of a path built segment by segment', () => {
    expect(prefixedTokens("join(root, '.claude', 'skills', 'void-tdd')")).toEqual(['void-tdd']);
  });

  it('reads a token out of a slash-written path', () => {
    expect(prefixedTokens('.claude/skills/void-checkpoint/SKILL.md')).toEqual(['void-checkpoint']);
  });

  it('reports each token once, sorted, however many times it appears', () => {
    expect(prefixedTokens('void-tdd then void-plan then void-tdd')).toEqual(['void-plan', 'void-tdd']);
  });

  // `_void-hook.mjs` and `my_void-thing` are identifiers of this harness's own
  // machinery, not references to a skill. A leading word character means the
  // token is part of a longer name.
  it('ignores a token that runs out of a longer identifier', () => {
    expect(prefixedTokens('_void-hook.mjs and x_void-tdd')).toEqual([]);
  });

  it('stops the token at the first character a directory name cannot carry', () => {
    expect(prefixedTokens('void-tdd.SKILL, void-plan_x')).toEqual(['void-plan', 'void-tdd']);
  });

  it('says nothing about a bare name, which no longer names a shipped skill', () => {
    expect(prefixedTokens('compose tdd and testing')).toEqual([]);
  });
});

describe('unresolvedTokens', () => {
  const resolvable = new Set(['void-tdd', 'void-autopilot', 'void-backlog-loop']);

  it('reports a token that resolves to nothing', () => {
    expect(unresolvedTokens(['void-tdd', 'void-session-handoff'], resolvable))
      .toEqual(['void-session-handoff']);
  });

  it('says nothing when every token resolves', () => {
    expect(unresolvedTokens(['void-tdd', 'void-autopilot'], resolvable)).toEqual([]);
  });

  // A retired name is still ours, and the register that carries the redirection
  // has to spell it. Reporting it would make the redirection unwritable.
  it('accepts a retired name, which the redirection register must be able to spell', () => {
    expect(unresolvedTokens(['void-backlog-loop'], resolvable)).toEqual([]);
  });

  it('reports each unresolved token once, sorted', () => {
    expect(unresolvedTokens(['void-b', 'void-a', 'void-b'], resolvable)).toEqual(['void-a', 'void-b']);
  });
});

// The sentinel that broke `init` carried no prefix at all: it joined
// `'skills', 'tdd', 'SKILL.md'`. Nothing about the token `tdd` says it names a
// skill, so the prefixed-token check cannot see it. What does say so is the
// `SKILL.md` that follows: a segment before it IS a skill directory, whatever it
// is spelled.
describe('skillDirectorySegments', () => {
  it('reads the segment out of a path built segment by segment', () => {
    expect(skillDirectorySegments("join(root, '.claude', 'skills', 'tdd', 'SKILL.md')"))
      .toEqual(['tdd']);
  });

  it('reads the segment out of a slash-written path', () => {
    expect(skillDirectorySegments('.agents/skills/void-tdd/SKILL.md')).toEqual(['void-tdd']);
  });

  it('reports each segment once, sorted', () => {
    expect(skillDirectorySegments('skills/b/SKILL.md skills/a/SKILL.md skills/b/SKILL.md'))
      .toEqual(['a', 'b']);
  });

  // `join(source, 'skills')` beside `join(source, 'specialists')` names two
  // sibling directories, not a skill. Only a segment `SKILL.md` follows counts.
  it('says nothing about a directory no SKILL.md follows', () => {
    expect(skillDirectorySegments("const inputs = ['agents', 'skills', 'specialists'];")).toEqual([]);
  });
});
