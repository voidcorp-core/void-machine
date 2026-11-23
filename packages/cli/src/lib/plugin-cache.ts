// Health of the installed plugin cache: the hooks a plugin.json wires must
// actually exist on disk and be executable, or the enforcement layer is dead
// even though `doctor` otherwise looks fine (audit 2026-07-09, issue #68).
//
// Pure helpers (wiredHooks, hookHealthIssues) are unit-tested against fixtures;
// locating the real Claude Code cache dir is a best-effort concern of doctor.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface PluginManifest {
  readonly hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
}

/**
 * The distinct `hooks/<name>.{sh,mjs}` paths a plugin manifest wires, relative to the
 * plugin root. Reads every event → matcher → hook command and extracts the
 * hook asset reference (ignoring interpreter prefixes and runtime arguments).
 */
export function wiredHooks(manifest: PluginManifest): readonly string[] {
  const found = new Set<string>();
  for (const entries of Object.values(manifest.hooks ?? {})) {
    for (const entry of entries) {
      for (const hook of entry.hooks ?? []) {
        const m = hook.command?.match(/hooks\/[A-Za-z0-9._-]+\.(?:sh|mjs)/);
        if (m) found.add(m[0]);
      }
    }
  }
  return [...found].sort();
}

/**
 * Problems with the wired hooks under `pluginDir`: each must exist and be
 * executable when launched directly (owner/group/other x bit). Node `.mjs`
 * assets only need to exist because the manifest passes them to `node`.
 * empty when every wired hook is present and executable.
 */
export function hookHealthIssues(pluginDir: string, manifest: PluginManifest): readonly string[] {
  const issues: string[] = [];
  for (const rel of wiredHooks(manifest)) {
    const abs = join(pluginDir, rel);
    if (!existsSync(abs)) {
      issues.push(`${rel}: wired in plugin.json but missing from the plugin cache`);
      continue;
    }
    // 0o111 = any execute bit. A hook the shell cannot exec silently no-ops.
    if (rel.endsWith('.sh') && (statSync(abs).mode & 0o111) === 0) {
      issues.push(`${rel}: present but not executable (chmod +x)`);
    }
  }
  return issues;
}

/**
 * Best-effort location of the installed plugin dir for `pluginName` under the
 * Claude Code plugin cache (~/.claude/plugins/cache/<owner>/<plugin>/<version>).
 * Returns the newest version dir that carries a .claude-plugin/plugin.json, or
 * undefined when nothing plausible is found (a first install before restart).
 */
export function locatePluginDir(cacheRoot: string, pluginName: string): string | undefined {
  if (!existsSync(cacheRoot)) return undefined;
  const candidates: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return;
    if (existsSync(join(dir, '.claude-plugin', 'plugin.json')) && dir.includes(pluginName)) {
      candidates.push(dir);
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), depth + 1);
    }
  };
  try {
    walk(cacheRoot, 0);
  } catch {
    return undefined;
  }
  if (candidates.length === 0) return undefined;
  // Newest by directory name (version dirs sort lexically close enough; the
  // exact pick only matters when several versions are cached side by side).
  return candidates.sort().at(-1);
}
