/**
 * The `void-` prefix has to be an invariant, not an observation.
 *
 * The ignore block stops naming the harness's skills one by one and matches
 * `.claude/skills/void-*​/` instead, which is what lets 82 owned directories cost
 * two lines and stay right about a skill added after the last install. That
 * design is only sound if a shipped skill cannot NOT carry the prefix.
 *
 * Both `docs/ARCHITECTURE.md` and the decision record cited
 * `scripts/anti-bloat-check.sh` as the thing enforcing it. It did not: its naming
 * loop checked name==folder, charset, kind, gerunds, agent-nouns and filler
 * suffixes, and never the prefix. The claim was found false by the union review
 * of PR #295 — a false citation under the sentence the whole design rests on.
 *
 * So this asserts both halves: that the surface is prefixed today, and that the
 * gate would actually catch it if it stopped being.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function shippedSkillDirectories(): string[] {
  const roots = [join(ROOT, 'packages/core/src/skills')];
  for (const pack of readdirSync(join(ROOT, 'packages/packs'), { withFileTypes: true })) {
    if (pack.isDirectory()) roots.push(join(ROOT, 'packages/packs', pack.name, 'src', 'skills'));
  }
  return roots.flatMap((root) => {
    try {
      return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  });
}

describe('every shipped skill carries the void- prefix', () => {
  it('holds across core and every pack, which is what the ignore pattern relies on', () => {
    const shipped = shippedSkillDirectories();
    expect(shipped.length).toBeGreaterThan(40);
    expect(shipped.filter((name) => !name.startsWith('void-'))).toEqual([]);
  });
});

// The half that was missing. Asserting the surface is prefixed today proves
// nothing about tomorrow; what makes it an invariant is a build that fails.
describe('anti-bloat-check refuses a shipped skill without the prefix', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fixtureWithSkill(name: string): string {
    const root = mkdtempSync(join(tmpdir(), 'void-prefix-gate-'));
    roots.push(root);
    const skill = join(root, 'packages', 'core', 'src', 'skills', name);
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, 'SKILL.md'), `---\nname: ${name}\ndescription: probe.\n---\n\n# ${name}\n`);
    writeFileSync(join(skill, 'harness.yaml'), 'kind: standard\n');
    mkdirSync(join(root, 'packages', 'packs'), { recursive: true });
    return root;
  }

  const runGate = (root: string): string => {
    const result = spawnSync('bash', [join(ROOT, 'scripts', 'anti-bloat-check.sh')], {
      cwd: root,
      encoding: 'utf8',
    });
    return `${result.stdout}${result.stderr}`;
  };

  // Asserted on ONE line rather than on the output as a whole. Checking that the
  // name appears somewhere and the word "prefix" appears somewhere is satisfied
  // by two unrelated lines, so it would still pass against a gate that never
  // named the offender -- which is the only thing that makes the refusal useful.
  it('names the unprefixed skill on the line that refuses it', () => {
    const refusal = runGate(fixtureWithSkill('tdd'))
      .split('\n')
      .find((line) => line.includes('FAIL') && /prefix/i.test(line));
    expect(refusal).toBeDefined();
    expect(refusal).toContain('tdd');
    expect(refusal).toContain('void-');
  });

  it('says nothing about a skill that carries it', () => {
    const output = runGate(fixtureWithSkill('void-tdd'));
    expect(output).not.toMatch(/void-tdd.*prefix|prefix.*void-tdd/i);
  });
});
