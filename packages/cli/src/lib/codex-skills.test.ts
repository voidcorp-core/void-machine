import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CODEX_SKILLS_DIR,
  codexSkillsHealth,
  isCodexEligible,
  listCodexSkills,
  packSkillsDir,
  parseFrontmatter,
  wireCodexSkills,
} from './codex-skills.js';

const here = dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = resolve(here, '..', '..', '..', 'core', 'dist'); // the real skills source

const tmps: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmps.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * Build a fake source tree. `runtimes` goes in the co-located `harness.yaml`,
 * not in the SKILL.md: a skill file carries only what the Agent Skills spec
 * defines, so it stays portable and passes the official validator.
 */
function fakeSource(skills: Record<string, string[] | undefined>): string {
  const root = tmp('void-codex-skillsrc-');
  for (const [name, runtimes] of Object.entries(skills)) {
    mkdirSync(join(root, 'skills', name), { recursive: true });
    writeFileSync(join(root, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: x\n---\nbody\n`);
    if (runtimes !== undefined) {
      writeFileSync(join(root, 'skills', name, 'harness.yaml'), `runtimes: [${runtimes.join(', ')}]\n`);
    }
  }
  return root;
}

describe('parseFrontmatter', () => {
  it('extracts the leading YAML block', () => {
    const fm = parseFrontmatter('---\nname: void-tdd\nruntimes: [claude, codex]\n---\nbody');
    expect(fm.name).toBe('void-tdd');
    expect(fm.runtimes).toEqual(['claude', 'codex']);
  });

  it('extracts frontmatter after a Windows checkout converts line endings', () => {
    const fm = parseFrontmatter('---\r\nname: tdd\r\nruntimes: [claude, codex]\r\n---\r\nbody');

    expect(fm.runtimes).toEqual(['claude', 'codex']);
  });

  it('returns {} for no frontmatter, never throwing', () => {
    expect(parseFrontmatter('no frontmatter here')).toEqual({});
  });

  it('recovers runtimes from a frontmatter that strict YAML rejects (unquoted colon in description)', () => {
    // This exact shape appears in ~7 core skills (e.g. "Iron Law: ...") — strict
    // YAML throws, but the skill must still reach Codex.
    const md = '---\nname: dbg\ndescription: Four phases: no fix without a test. Use on bug.\nruntimes: [claude, codex]\n---\nbody';
    expect(parseFrontmatter(md).runtimes).toEqual(['claude', 'codex']);
    expect(isCodexEligible(parseFrontmatter(md))).toBe(true);
  });
});

describe('isCodexEligible', () => {
  it('is true only when runtimes includes codex', () => {
    expect(isCodexEligible({ runtimes: ['claude', 'codex'] })).toBe(true);
    expect(isCodexEligible({ runtimes: ['claude'] })).toBe(false);
    expect(isCodexEligible({})).toBe(false); // opt-in: no runtimes -> not eligible
  });
});

describe('listCodexSkills', () => {
  it('returns only codex-opted skills, sorted, excluding claude-only', async () => {
    const src = fakeSource({ alpha: ['claude', 'codex'], beta: ['claude'], gamma: ['codex'], delta: undefined });
    expect(await listCodexSkills(src)).toEqual(['alpha', 'gamma']);
  });

  it('finds the real core skills and every one it returns opts into codex', async () => {
    const names = await listCodexSkills(CORE_ROOT);
    expect(names.length).toBeGreaterThan(20); // ~36 core skills today
    // spot-check a known-core skill is present
    expect(names).toContain('void-tdd');
  });

  it('returns [] when the source has no skills dir', async () => {
    expect(await listCodexSkills(tmp('void-empty-'))).toEqual([]);
  });
});

describe('wireCodexSkills + codexSkillsHealth', () => {
  it('stages each eligible skill as .agents/skills/<name>/SKILL.md and reports healthy', async () => {
    const src = fakeSource({ alpha: ['claude', 'codex'], beta: ['claude'] });
    const project = tmp('void-codex-skills-');
    const count = await wireCodexSkills(project, src);
    expect(count).toBe(1); // only alpha
    expect(existsSync(join(project, CODEX_SKILLS_DIR, 'alpha', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(project, CODEX_SKILLS_DIR, 'beta'))).toBe(false); // claude-only not staged
    const health = await codexSkillsHealth(project);
    expect(health.ok).toBe(true);
    expect(health.detail).toContain('1 skill');
  });

  it('is idempotent', async () => {
    const src = fakeSource({ alpha: ['codex'] });
    const project = tmp('void-codex-skills-');
    expect(await wireCodexSkills(project, src)).toBe(1);
    await expect(wireCodexSkills(project, src)).resolves.toBe(1);
  });

  it('stages pack skills too, and copies the WHOLE skill folder (not just SKILL.md), minus .source', () => {
    const src = fakeSource({ alpha: ['codex'] });
    // a pack with one codex skill carrying an extra script + a .source sidecar
    const skillDir = join(src, 'packs', 'pack-nextjs', 'skills', 'route-group');
    mkdirSync(join(skillDir, 'scripts'), { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: route-group\ndescription: x\n---\nbody\n');
    writeFileSync(join(skillDir, 'harness.yaml'), 'runtimes: [codex]\n');
    writeFileSync(join(skillDir, 'scripts', 'gen.sh'), '# helper\n');
    writeFileSync(join(skillDir, '.source'), 'internal metadata\n');
    return (async () => {
      const project = tmp('void-codex-skills-');
      const count = await wireCodexSkills(project, src, ['pack-nextjs']);
      expect(count).toBe(2); // alpha (core) + route-group (pack)
      // whole folder copied
      expect(existsSync(join(project, CODEX_SKILLS_DIR, 'route-group', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(project, CODEX_SKILLS_DIR, 'route-group', 'scripts', 'gen.sh'))).toBe(true);
      // void-internal .source excluded
      expect(existsSync(join(project, CODEX_SKILLS_DIR, 'route-group', '.source'))).toBe(false);
      expect(readFileSync(join(project, CODEX_SKILLS_DIR, 'route-group', 'scripts', 'gen.sh'), 'utf8')).toContain('helper');
    })();
  });

  it('packSkillsDir resolves the tarball layout (sourceRoot/packs/<dir>/skills)', () => {
    const src = fakeSource({ alpha: ['codex'] });
    const dir = join(src, 'packs', 'pack-nextjs', 'skills');
    mkdirSync(dir, { recursive: true });
    expect(packSkillsDir(src, 'pack-nextjs')).toBe(dir);
    expect(packSkillsDir(src, 'pack-absent')).toBeUndefined();
  });

  it('health flags a project with no .agents/skills dir', async () => {
    const health = await codexSkillsHealth(tmp('void-codex-skills-'));
    expect(health.ok).toBe(false);
    expect(health.detail).toContain('missing');
  });

  it('health flags an empty .agents/skills dir (present but nothing staged)', async () => {
    const project = tmp('void-codex-skills-');
    mkdirSync(join(project, CODEX_SKILLS_DIR), { recursive: true });
    const health = await codexSkillsHealth(project);
    expect(health.ok).toBe(false);
    expect(health.detail).toContain('no SKILL.md');
  });

  it('health ignores a stray directory without a SKILL.md', async () => {
    const src = fakeSource({ alpha: ['codex'] });
    const project = tmp('void-codex-skills-');
    await wireCodexSkills(project, src);
    mkdirSync(join(project, CODEX_SKILLS_DIR, 'stray'), { recursive: true });
    await rm(join(project, CODEX_SKILLS_DIR, 'alpha', 'SKILL.md'));
    // alpha's SKILL.md gone and stray has none -> nothing discoverable
    const health = await codexSkillsHealth(project);
    expect(health.ok).toBe(false);
  });
});
