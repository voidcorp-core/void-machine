import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { governingSkill, RULE_NAMES, withGoverningSkill } from './governing-skill.js';

// A refusal must name an existing skill.
const here = dirname(fileURLToPath(import.meta.url));
const packages = join(here, '..', '..', '..');


describe('governingSkill', () => {
  it('names a skill that exists on disk for every rule', () => {
    for (const rule of RULE_NAMES) {
      const skill = governingSkill(rule);
      const path = join(packages, 'core', 'src', 'skills', skill, 'SKILL.md');
      expect(readFileSync(path, 'utf8'), `${rule} points at ${skill}`).toContain('---');
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
