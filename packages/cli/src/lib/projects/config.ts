// Where to look for projects.
//
// The configuration is a list of ROOTS, never a list of projects. This repo
// already contains the counter-example: `~/.void/projects/` is a registry of
// per-project pointers, and on this machine it holds 15 997 entries — almost
// all of them temp directories left by test runs — while knowing only 3 of the
// 8 real projects, because a registry only learns a project once a hook has run
// inside it. Roots plus a marker cannot go stale that way.
//
// Zero configuration must still produce a useful answer, so the default is
// derived from where the command runs rather than left empty: a tool that asks
// for setup before showing anything is a tool that never gets used.

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

export interface DiscoveryConfigResolved {
  readonly roots: readonly string[];
  readonly exclude: readonly string[];
  /** `declared` when a config file supplied the roots, `derived` otherwise. */
  readonly source: 'declared' | 'derived';
  /** The config file consulted, whether or not it existed. */
  readonly path: string;
}

export interface ReadDiscoveryOptions {
  readonly globalDir: string;
  readonly cwd: string;
  readonly home?: string;
  readonly strict?: boolean;
}

const CONFIG_FILE = 'discovery.json';

/**
 * Kept out of the config on purpose: these are never worth walking, and leaving
 * them to configuration means every machine has to remember them.
 */
const ALWAYS_EXCLUDE: readonly string[] = ['**/node_modules/**', '**/.git/**'];

function expand(path: string, home: string): string {
  if (path === '~') return home;
  return path.startsWith('~/') ? join(home, path.slice(2)) : path;
}

/** The nearest ancestor of `from` that carries the project marker. */
function enclosingProject(from: string): string | undefined {
  let current = resolve(from);
  for (;;) {
    if (existsSync(join(current, '.void', 'config.json'))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * With nothing declared, the neighbours of the current project are the park.
 * Run from inside any project, that finds the others with no setup at all;
 * run from outside one, the working directory is the honest guess.
 */
function derivedRoots(cwd: string): readonly string[] {
  const project = enclosingProject(cwd);
  return [project === undefined ? resolve(cwd) : dirname(project)];
}

function declaredRoots(raw: unknown, home: string): readonly string[] | undefined {
  if (typeof raw !== 'object' || raw === undefined) return undefined;
  const roots = (raw as { roots?: unknown }).roots;
  if (!Array.isArray(roots)) return undefined;
  const usable = roots
    .filter((root): root is string => typeof root === 'string' && root.trim() !== '')
    .map((root) => expand(root.trim(), home))
    // A relative root has no meaningful base here: the command may run from
    // anywhere, so resolving it would mean a different park each time.
    .filter((root) => isAbsolute(root));
  return usable.length === 0 ? undefined : usable;
}

function declaredExclude(raw: unknown): readonly string[] {
  const exclude = (raw as { exclude?: unknown } | undefined)?.exclude;
  if (!Array.isArray(exclude)) return ALWAYS_EXCLUDE;
  const usable = exclude.filter((glob): glob is string => typeof glob === 'string');
  return [...ALWAYS_EXCLUDE, ...usable];
}

/** Advisory readers retain fallback; mutating all-project operations require strict input. */
export function readDiscoveryConfig(options: ReadDiscoveryOptions): DiscoveryConfigResolved {
  const home = options.home ?? homedir();
  const path = join(options.globalDir, CONFIG_FILE);

  let parsed: unknown;
  try {
    if (options.strict) {
      const info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw new Error('Discovery configuration must be a bounded regular file');
    }
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (options.strict && !(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw new Error(`Invalid discovery configuration at ${path}; repair it before update --all`, { cause: error });
    }
    parsed = undefined;
  }
  if (options.strict && parsed !== undefined) {
    z.object({ roots: z.array(z.string().min(1).max(4096).refine(value => isAbsolute(expand(value, home))))
      .min(1).max(128), exclude: z.array(z.string().min(1).max(4096)).max(128).optional() }).parse(parsed);
  }
  if (Array.isArray(parsed)) parsed = undefined;

  const roots = declaredRoots(parsed, home);
  return roots === undefined
    ? { roots: derivedRoots(options.cwd), exclude: ALWAYS_EXCLUDE, source: 'derived', path }
    : { roots, exclude: declaredExclude(parsed), source: 'declared', path };
}
