import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { governingSkill, RULE_NAMES, withGoverningSkill } from './governing-skill.js';

// The table inside the compiled hook names, for each rule, the skill whose
// doctrine explains a refusal. Two things can rot it without any compiler
// noticing: a skill renamed on disk, and the `enforces` edges of the graph
// drifting away from it. Both are checked here against the real files, because
// a name that no longer resolves is exactly the defect this chantier repaired.
const here = dirname(fileURLToPath(import.meta.url));
const packages = join(here, '..', '..', '..');

function enforcedSkills(): ReadonlySet<string> {
  const relations = readFileSync(join(packages, 'harness-graph', 'relations.graph.yaml'), 'utf8');
  const skills = new Set<string>();
  for (const line of relations.split('\n')) {
    const edge = /to:\s*skill:([a-z0-9-]+).*kind:\s*enforces/.exec(line);
    if (edge?.[1] !== undefined) skills.add(edge[1]);
  }
  return skills;
}

describe('governingSkill', () => {
  it('names a skill that exists on disk for every rule', () => {
    for (const rule of RULE_NAMES) {
      const skill = governingSkill(rule);
      const path = join(packages, 'core', 'skills', skill, 'SKILL.md');
      expect(readFileSync(path, 'utf8'), `${rule} points at ${skill}`).toContain('---');
    }
  });

  it('names a skill the graph already declares a hook enforces', () => {
    const declared = enforcedSkills();
    expect(declared.size).toBeGreaterThan(0);
    for (const rule of RULE_NAMES) {
      expect(declared, `${rule} -> ${governingSkill(rule)}`).toContain(governingSkill(rule));
    }
  });


});

describe('withGoverningSkill', () => {
  it('appends the doctrine as one clause, keeping the refusal readable at a blocked keystroke', () => {
    expect(withGoverningSkill('secret-content', 'secret rejected')).toBe(
      'secret rejected (doctrine: the void-security-guidance skill)',
    );
  });

  it('names the doctrine once, never twice', () => {
    const message = withGoverningSkill('secret-content', 'secret rejected');
    expect(message.match(/doctrine:/g)).toHaveLength(1);
  });
});

describe('RULE_NAMES', () => {
  it('carries every rule the runner can evaluate, in a stable order', () => {
    expect([...RULE_NAMES]).toEqual([...RULE_NAMES].slice().sort());
    expect(new Set(RULE_NAMES).size).toBe(RULE_NAMES.length);
  });

  it('leaves no rule without a doctrine, which is how a rule would refuse anonymously', () => {
    for (const rule of RULE_NAMES) expect(governingSkill(rule)).not.toBe('');
  });
});
