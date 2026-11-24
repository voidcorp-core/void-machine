import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { governingSkill, RULE_NAMES } from '../../packages/hook-runner/src/enforcement/governing-skill.js';

const ROOT = new URL('../../', import.meta.url);


/** Skills that exist on disk, which is what a name has to resolve to. */
function skillExists(name: string): boolean {
  try {
    readFileSync(new URL(`packages/core/skills/${name}/SKILL.md`, ROOT), 'utf8');
    return true;
  } catch {
    return false;
  }
}

describe('every enforcement rule names the doctrine it enforces', () => {
  it.each(RULE_NAMES)('%s resolves to a skill that exists', (rule) => {
    const skill = governingSkill(rule);
    expect(skill).not.toBe('');
    expect(skillExists(skill), `${rule} -> ${skill}`).toBe(true);
  });

  /**
   * End to end, through the bundle a consumer actually runs. The unit test above
   * proves the table; this proves the sentence reaches the person who was just
   * refused, which is the only place it does any good.
   */
  it('names the doctrine in the refusal a consumer sees', () => {
    const bundle = fileURLToPath(new URL('packages/core/hooks/_void-hook.mjs', ROOT));
    // The same silence, one screen down: this returned green when the bundle was
    // absent, so the only check that proves the sentence reaches a refused person
    // was skipped by whoever had not run `pnpm hooks:build` — reported as passing.
    // CI builds first, so there the absence is a failure and not a condition.
    if (!existsSync(bundle)) {
      expect(
        process.env.CI,
        'the hook bundle is missing; run `pnpm hooks:build` (in CI this is a failure, not a skip)',
      ).toBeUndefined();
      return;
    }
    const root = fileURLToPath(ROOT).replace(/\/$/, '');
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: `${root}/packages/cli/src/probe.ts`, content: `const token = 'ghp_${'a'.repeat(36)}';` },
    });
    const run = spawnSync(process.execPath, [bundle, 'enforce', 'secret-content', 'claude'], {
      input: payload,
      encoding: 'utf8',
      env: { ...process.env, VOID_PROJECT_ROOT: root },
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('security-guidance');
  });
});
