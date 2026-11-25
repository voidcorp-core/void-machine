/**
 * A skill is agnostic. Its frontmatter carries nothing this harness invented.
 *
 * The Agent Skills specification defines six fields, and the official validator
 * refuses everything else:
 *
 *     $ npx skills-ref validate packages/core/src/skills/tdd
 *     Unexpected fields in frontmatter: activation, enforcement, eval_targets,
 *     kind, owner, runtimes. Only allowed-tools, compatibility, description,
 *     license, metadata, name are allowed.
 *
 * Seven fields were ours: `kind`, `owner`, `runtimes`, `enforcement`,
 * `eval_targets`, `activation`, `triggers`. None is read by any runtime — they
 * feed this repository's own graph, and `runtimes` additionally tells the
 * installer which skills go to Codex. A skill exported anywhere else carried
 * them for nothing, and failed validation because of them.
 *
 * They now live in a co-located `harness.yaml`, excluded from what a consumer
 * receives exactly as `.source` already is. So the installed SKILL.md is byte
 * for byte the source, and the source is portable.
 *
 * Two Claude Code-specific fields were dropped rather than moved.
 * `disable-model-invocation` only ever worked on one runtime out of three, so it
 * guaranteed nothing while looking like it did; the skills that used it say
 * "only when a human asks" in their first section, and loading a skill is not
 * running it. `when_to_use` folds into `description`, which the spec already
 * asks to say both what a skill does and when to use it.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The complete set the specification allows in a SKILL.md. */
const SPEC_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);

/** Every core and pack skill directory, as [label, absolute path]. */
function skillDirectories(): [string, string][] {
  const found: [string, string][] = [];
  const core = join(ROOT, 'packages/core/src/skills');
  for (const name of readdirSync(core)) {
    if (existsSync(join(core, name, 'SKILL.md'))) found.push([name, join(core, name)]);
  }
  const packs = join(ROOT, 'packages/packs');
  for (const pack of readdirSync(packs)) {
    const dir = join(packs, pack, 'src', 'skills');
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (existsSync(join(dir, name, 'SKILL.md'))) found.push([`${pack}/${name}`, join(dir, name)]);
    }
  }
  return found;
}

const SKILLS = skillDirectories();

function frontmatterKeys(path: string): string[] {
  const text = readFileSync(join(path, 'SKILL.md'), 'utf8');
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  return block
    .split('\n')
    .filter((line) => /^[A-Za-z_][A-Za-z0-9_-]*:/.test(line))
    .map((line) => line.slice(0, line.indexOf(':')));
}

describe('the skill file carries only what the specification defines', () => {
  it('finds the skills to check, so an empty sweep cannot pass silently', () => {
    expect(SKILLS.length).toBeGreaterThan(30);
    expect(SKILLS.some(([label]) => label.includes('/'))).toBe(true);
  });

  it.each(SKILLS)('%s declares no field outside the spec', (_label, path) => {
    const extra = frontmatterKeys(path).filter((key) => !SPEC_FIELDS.has(key));
    expect(extra).toEqual([]);
  });

  it.each(SKILLS)('%s keeps its description within the discovery budget', (_label, path) => {
    const text = readFileSync(join(path, 'SKILL.md'), 'utf8');
    const rawDescription = /^description:\s*(.*)$/m.exec(text)?.[1] ?? '';
    const pairedQuotes = rawDescription.length >= 2 && (
      (rawDescription.startsWith('"') && rawDescription.endsWith('"')) ||
      (rawDescription.startsWith("'") && rawDescription.endsWith("'"))
    );
    const description = pairedQuotes ? rawDescription.slice(1, -1) : rawDescription;
    expect(description.length).toBeGreaterThan(0);
    // 500 stays below half of what the portable spec allows. The 250-character
    // editorial target is reported by anti-bloat-check; this assertion owns the
    // hard validity boundary.
    expect(description.length).toBeLessThanOrEqual(500);
  });
});

describe('what belongs to the harness travels beside the skill', () => {
  it.each(SKILLS)('%s carries a harness.yaml', (_label, path) => {
    expect(existsSync(join(path, 'harness.yaml'))).toBe(true);
  });

  // Read with a regex rather than a YAML parser: `yaml` is a workspace-package
  // dependency and this suite runs at the root. The production reader parses
  // properly; here the point is that the two fields are declared at all.
  it.each(SKILLS)('%s declares its kind and its runtimes there', (_label, path) => {
    const meta = readFileSync(join(path, 'harness.yaml'), 'utf8');
    expect(/^kind:\s*(action|standard)\s*$/m.test(meta), `kind in ${path}`).toBe(true);
    expect(/^runtimes:\s*\[.*\]\s*$/m.test(meta), `runtimes in ${path}`).toBe(true);
  });
});
