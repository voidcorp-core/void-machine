// Which projects on this machine the harness manages.
//
// A project is any directory carrying `.void/config.json`. There is deliberately
// NO registry: a registry is mutable global state that rots — moved paths,
// deleted repos, entries nobody remembers to add — and every stale entry has to
// be explained to whoever reads the view. The marker cannot go stale, and a new
// project appears without anyone registering it.
//
// Failure is per-path, never global: this feeds a view that reads the whole
// park at once, so one unreadable directory reports itself and the rest still
// answers.

import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import picomatch from 'picomatch';

export interface DiscoveryConfig {
  /** Directories to scan. `~` is the caller's to expand. */
  readonly roots: readonly string[];
  /** Glob patterns whose matches are never entered. */
  readonly exclude: readonly string[];
}

export interface DiscoveredProject {
  /** Display name. NOT an identity — two projects may share one. */
  readonly name: string;
  /** Absolute, symlink-resolved path. This is the identity. */
  readonly path: string;
}

export interface UnreadablePath {
  readonly path: string;
  readonly reason: string;
}

export interface DiscoveryResult {
  readonly projects: readonly DiscoveredProject[];
  readonly unreadable: readonly UnreadablePath[];
}

export interface DiscoveryOptions {
  /** How far below a root to look. Bounded so a scan cannot walk a disk. */
  readonly maxDepth?: number;
  readonly requireComplete?: boolean;
}

/**
 * Four levels covers `~/Developer/<project>` and a grouping directory above it.
 * A project buried deeper is declared explicitly rather than found by widening
 * the sweep for everyone.
 */
const DEFAULT_MAX_DEPTH = 4;

/** Never entered, whatever the configuration says. Cheap and always right. */
const ALWAYS_SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
  'vendor',
  'Library',
]);

function isProjectRoot(dir: string): boolean {
  return existsSync(join(dir, '.void', 'config.json'));
}

/**
 * True when `dir` is a git worktree rather than a repository of its own.
 *
 * A worktree checks out the same `.void/config.json`, so the marker alone
 * cannot tell them apart — found on the real park, where two sesame worktrees
 * appeared as separate projects. It matters beyond tidiness: autopilot creates
 * one worktree per ticket, so a run would otherwise fill the view with phantom
 * projects competing for attention with their own parent.
 *
 * The signal is structural: in a worktree, `.git` is a FILE holding a `gitdir:`
 * pointer, where a normal repository has a directory.
 */
function isGitWorktree(dir: string): boolean {
  const dotGit = join(dir, '.git');
  try {
    return statSync(dotGit).isFile();
  } catch {
    return false;
  }
}

/** Resolve through symlinks so a cycle is detectable by identity. */
function physical(path: string): string | undefined {
  try {
    return realpathSync(resolve(path));
  } catch {
    return undefined;
  }
}

export function discoverProjects(
  config: DiscoveryConfig,
  options: DiscoveryOptions = {},
): DiscoveryResult {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const excluded = config.exclude.length > 0 ? picomatch(config.exclude as string[]) : undefined;

  const found = new Map<string, DiscoveredProject>();
  const unreadable: UnreadablePath[] = [];
  // Keyed on the physical path, which is what makes a symlink cycle terminate
  // and what stops overlapping roots from reporting a project twice.
  const visited = new Set<string>();

  function walk(dir: string, depth: number): void {
    const real = physical(dir);
    if (real === undefined) {
      unreadable.push({ path: dir, reason: 'not readable' });
      return;
    }
    if (visited.has(real)) return;
    if (visited.size >= 10_000) {
      unreadable.push({ path: real, reason: 'discovery directory limit exceeded' });
      return;
    }
    visited.add(real);

    if (isProjectRoot(real)) {
      // Stop here either way: a project's own subdirectories are its business,
      // and a nested marker is far more likely a fixture than a second project.
      // A worktree stops too, but is not reported — it is the same project on
      // another branch, not another project.
      if (options.requireComplete || !isGitWorktree(real)) found.set(real, { name: basename(real), path: real });
      return;
    }

    if (depth >= maxDepth && !options.requireComplete) return;

    let entries: readonly string[];
    try {
      entries = readdirSync(real);
    } catch {
      unreadable.push({ path: real, reason: 'not readable' });
      return;
    }

    for (const entry of entries) {
      if (entry.startsWith('.') || ALWAYS_SKIP.has(entry)) continue;
      const child = join(real, entry);
      if (excluded?.(child) === true) continue;
      try {
        if (!statSync(child).isDirectory()) continue;
      } catch {
        if (options.requireComplete) unreadable.push({ path: child, reason: 'not readable' });
        continue;
      }
      if (depth >= maxDepth) {
        unreadable.push({ path: child, reason: 'discovery depth limit reached; declare this root explicitly' });
        continue;
      }
      walk(child, depth + 1);
    }
  }

  for (const root of config.roots) walk(root, 0);

  return {
    projects: [...found.values()].sort((a, b) => (a.path < b.path ? -1 : 1)),
    unreadable,
  };
}
