/**
 * A gesture is a skill. There is no second format.
 *
 * Claude Code answers `/<name>` from a skill and from a `commands/<name>.md` file
 * alike, and its own documentation states the two were merged: "Custom commands
 * have been merged into skills [...] both create `/deploy` and work the same
 * way." Skills add what commands never had - a directory for supporting files,
 * `paths`, `disable-model-invocation` - and, decisively here, they are the only
 * format Codex and Kimi understand at all. A command is staged to
 * `.claude/commands/` and nowhere else, so every gesture living there was
 * Claude-only by construction.
 *
 * Keeping both formats also produced the defect that started this: `/void-checkpoint`
 * existed as command and as skill, each with its own description, and the two had
 * drifted into advertising different jobs for one gesture.
 *
 * So the rule is not "one name, one owner" any more. It is stronger and simpler:
 * no shipped surface has a `commands/` directory.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Every directory that ships a runtime surface: the core, then each pack. */
function surfaceRoots(): string[] {
  const packs = join(ROOT, 'packages/packs');
  const roots = [join(ROOT, 'packages/core/src')];
  for (const entry of readdirSync(packs)) {
    const path = join(packs, entry);
    if (statSync(path).isDirectory()) roots.push(join(path, 'src'));
  }
  return roots;
}

function commandNames(root: string): string[] {
  const directory = join(root, 'commands');
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => entry.slice(0, -'.md'.length));
}

function skillNames(root: string): string[] {
  const directory = join(root, 'skills');
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((entry) =>
    existsSync(join(directory, entry, 'SKILL.md')),
  );
}

describe('slash command namespace', () => {
  it('ships no commands directory, because a command is a skill Codex cannot read', () => {
    const withCommands = surfaceRoots()
      .filter((root) => existsSync(join(root, 'commands')))
      .map((root) => root.replace(ROOT, ''));
    expect(withCommands).toEqual([]);
  });


  it('holds across roots too, so one pack cannot shadow another surface', () => {
    const owners = new Map<string, Set<string>>();
    for (const root of surfaceRoots()) {
      const relative = root.replace(ROOT, '');
      for (const name of [...commandNames(root), ...skillNames(root)]) {
        owners.set(name, (owners.get(name) ?? new Set<string>()).add(relative));
      }
    }
    expect(owners.size).toBeGreaterThan(0);
    const shared = [...owners.entries()]
      .filter(([, roots]) => roots.size > 1)
      .map(([name, roots]) => `${name}: ${[...roots].join(', ')}`);
    expect(shared).toEqual([]);
  });

  /** The retained diagnostic gesture is a skill every runtime receives. */
  it.each(['void-doctor'])('keeps %s invocable, as a skill', (name) => {
    const skill = join(ROOT, 'packages/core/src/skills', name, 'SKILL.md');
    expect(existsSync(skill)).toBe(true);
    const body = readFileSync(skill, 'utf8');
    // These run a CLI on request, and the skill says so in its own words rather
    // than through `disable-model-invocation`. That field is Claude-only, so it
    // left the gesture auto-invocable on Codex and Kimi while looking like a
    // guarantee; and loading a skill is not running it.
    expect(body).toMatch(/only when a human asks/i);
  });

  /**
   * `void-feedback` was branch B of `void-learn` rewritten: same agnostic and
   * harness-worthy bar, same `gh issue create`, same HITL. Two copies of one
   * flow, under two names, which the name-collision rule above cannot see.
   */
  it('folds void-feedback into learn rather than keeping the second copy', () => {
    expect(existsSync(join(ROOT, 'packages/core/src/skills/void-feedback'))).toBe(false);
    const learn = readFileSync(join(ROOT, 'packages/core/src/skills/void-learn/SKILL.md'), 'utf8');
    expect(learn).toContain('gh issue create');
    // The trigger phrases folded into `description`, where the spec wants them:
    // it asks a description to say what a skill does and when to use it, and
    // `when_to_use` is a Claude Code extension the other runtimes never read.
    expect(learn).toMatch(/feedback/i);
  });

  /**
   * `${CLAUDE_PLUGIN_ROOT}` is substituted for plugin assets only. It sat
   * unresolved in the installed `void-graph` command, pointing at nothing on
   * every local install.
   */
  it('leaves no plugin-only substitution in a shipped asset', () => {
    const offenders: string[] = [];
    for (const root of surfaceRoots()) {
      const skills = join(root, 'skills');
      if (!existsSync(skills)) continue;
      for (const name of readdirSync(skills)) {
        const file = join(skills, name, 'SKILL.md');
        if (!existsSync(file)) continue;
        if (readFileSync(file, 'utf8').includes('CLAUDE_PLUGIN_ROOT')) {
          offenders.push(`${root.replace(ROOT, '')}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
