import type { Dirent } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RETIRED_SKILLS, wasEverOurs } from './retired-skills.js';

/**
 * The skills this repository actually ships today — core AND packs.
 *
 * Reading only `core/` was enough while the register held core renames alone. It
 * stopped being enough the day every shipped skill took the `void-` prefix,
 * because a pack skill then became a target like any other and read as dangling.
 */
function shippedSkills(): ReadonlySet<string> {
  const packages = join(fileURLToPath(import.meta.url), '..', '..', '..');
  const roots = [join(packages, 'core', 'src', 'skills')];
  const packs = join(packages, 'packs');
  for (const pack of readdirSync(packs, { withFileTypes: true })) {
    if (pack.isDirectory()) roots.push(join(packs, pack.name, 'src', 'skills'));
  }
  const names = new Set<string>();
  for (const root of roots) {
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) if (entry.isDirectory()) names.add(entry.name);
  }
  return names;
}

describe('the retired-name register', () => {
  it('points every retired name at a skill that is still shipped', () => {
    // The register rots the day a replacement is itself renamed, and it rots in
    // silence: the check would go on printing a remedy naming a skill nobody can
    // invoke either. Read from the shipped skills rather than from a second list,
    // so the assertion cannot drift the way the thing it guards would.
    const shipped = shippedSkills();

    const dangling = Object.entries(RETIRED_SKILLS)
      .filter(([, replacement]) => replacement !== undefined && !shipped.has(replacement))
      .map(([name, replacement]) => `${name} -> ${String(replacement)}`);

    expect(dangling).toEqual([]);
  });

  it('never lists a name that is still shipped under that very name', () => {
    // A live skill listed here would be reported retired the moment someone
    // invoked it, which is the exact opposite of what the register is for.
    const shipped = shippedSkills();

    expect(Object.keys(RETIRED_SKILLS).filter((name) => shipped.has(name))).toEqual([]);
  });

  it('answers for a name it carries and declines every other', () => {
    expect(wasEverOurs('session-handoff')).toBe(true);
    expect(wasEverOurs('defuddle')).toBe(false);
  });
});
