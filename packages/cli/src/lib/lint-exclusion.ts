// Keep the harness out of the consumer's lint.
//
// `.claude/` holds files this repo wrote, in formats their engines define. The
// autopilot workflow script is the sharp case: valid for the Workflow engine,
// rejected by any standard JavaScript parser, because it carries
// `export const meta` and a top-level `return` at once. A project that lints
// `**/*.js` then fails on code it does not own and cannot fix.
//
// The harness caused that, so the harness clears it — at install time, where a
// single decision covers every consumer, instead of leaving each one to
// discover it three files into an afternoon.
//
// This module reads and reports; it never writes. Two reasons, both learned the
// hard way. The config belongs to the project, and the install transaction
// rolls back byte-for-byte only over files it owns — an edit here would survive
// a failed install that claimed to have restored everything. And appending
// `!.claude` to a config with no `files.includes` produces a lone negation,
// which per Biome's documentation matches nothing at all: the repair would have
// silently stopped the project linting anything.

import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import picomatch from 'picomatch';

/** What we add to a Biome `files.includes` list. */
export const HARNESS_LINT_EXCLUSION = '!.claude';

const BIOME_FILES = ['biome.json', 'biome.jsonc'];
const HARNESS_PROBES = ['.claude', '.claude/workflows/autopilot.workflow.js'];
const MAX_BIOME_CONFIG_READS = 32;
const OTHER_LINTERS = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.ts',
  '.eslintrc.json',
  '.eslintrc.cjs',
  '.oxlintrc.json',
];

/** What the project's linter config says about `.claude`, read only. */
export type LintExclusionState =
  | { readonly kind: 'excluded'; readonly file: string }
  | { readonly kind: 'missing'; readonly file: string; readonly instruction: string }
  | { readonly kind: 'manual'; readonly file: string; readonly instruction: string }
  | { readonly kind: 'no-linter' };

/**
 * Read-only inspection, for `doctor`.
 *
 * A diagnostic that repairs what it measures cannot be run to find out whether
 * something is wrong — it would always report health, having just created it.
 */
export async function inspectHarnessLintExclusion(projectRoot: string): Promise<LintExclusionState> {
  const biome = BIOME_FILES.map((name) => join(projectRoot, name)).find((path) => existsSync(path));
  if (biome !== undefined) {
    const name = relative(projectRoot, biome);
    const scope = await resolveBiomeIncludes(projectRoot, name);
    if (scope.kind === 'failure') return manual(name, scope.reason);

    const harnessScope = harnessCanEnter(scope.includes);
    if (harnessScope.kind === 'failure') return manual(name, harnessScope.reason);
    if (!harnessScope.included) {
      return { kind: 'excluded', file: name };
    }
    return {
      kind: 'missing',
      file: name,
      instruction: `add \`${HARNESS_LINT_EXCLUSION}\` to files.includes in ${name} (keep a positive pattern such as \`**\` before it — a lone negation matches nothing in Biome)`,
    };
  }
  const other = OTHER_LINTERS.find((name) => existsSync(join(projectRoot, name)));
  if (other !== undefined) {
    return manual(other, 'this linter is configured in code');
  }
  return { kind: 'no-linter' };
}

type ResolutionFailure = { readonly kind: 'failure'; readonly reason: string };

type IncludesResolution =
  | { readonly kind: 'resolved'; readonly includes: readonly string[] | undefined }
  | ResolutionFailure;

type ParsedBiomeConfig = {
  readonly extendedConfigs: readonly string[];
  readonly includes: readonly string[] | undefined;
};

type ParseResolution =
  | { readonly kind: 'parsed'; readonly config: ParsedBiomeConfig }
  | ResolutionFailure;

type ScopeResolution =
  | { readonly kind: 'scope'; readonly included: boolean }
  | ResolutionFailure;

type ReadBudget = { remaining: number };

async function resolveBiomeIncludes(projectRoot: string, configName: string): Promise<IncludesResolution> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(projectRoot);
  } catch {
    return { kind: 'failure', reason: 'cannot read the project root' };
  }
  return readBiomeIncludes(canonicalRoot, join(canonicalRoot, configName), new Set(), {
    remaining: MAX_BIOME_CONFIG_READS,
  });
}

async function readBiomeIncludes(
  projectRoot: string,
  configPath: string,
  ancestors: ReadonlySet<string>,
  budget: ReadBudget,
): Promise<IncludesResolution> {
  if (budget.remaining === 0) {
    return { kind: 'failure', reason: `extends chain exceeds ${MAX_BIOME_CONFIG_READS} config reads` };
  }
  budget.remaining -= 1;
  const boundedPath = resolve(configPath);
  if (!isInside(projectRoot, boundedPath)) {
    return { kind: 'failure', reason: `extended config is outside the project: ${configPath}` };
  }

  let canonicalPath: string;
  let text: string;
  try {
    canonicalPath = await realpath(boundedPath);
    if (!isInside(projectRoot, canonicalPath)) {
      return { kind: 'failure', reason: `extended config is outside the project: ${configPath}` };
    }
    text = await readFile(canonicalPath, 'utf8');
  } catch {
    return { kind: 'failure', reason: `cannot read extended config ${displayPath(projectRoot, boundedPath)}` };
  }

  if (ancestors.has(canonicalPath)) {
    return { kind: 'failure', reason: `extends cycle at ${displayPath(projectRoot, canonicalPath)}` };
  }

  const parsed = parseBiomeConfig(text, displayPath(projectRoot, canonicalPath));
  if (parsed.kind === 'failure') return parsed;

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(canonicalPath);
  let inheritedIncludes: readonly string[] | undefined;
  // Biome 2.4 merges extended configs in declaration order, then applies the
  // local config. A later files.includes list replaces the inherited list.
  // Refs: https://biomejs.dev/guides/big-projects/ and
  // https://biomejs.dev/reference/configuration/.
  for (const extendedConfig of parsed.config.extendedConfigs) {
    const inherited = await readBiomeIncludes(
      projectRoot,
      resolve(dirname(canonicalPath), extendedConfig),
      nextAncestors,
      budget,
    );
    if (inherited.kind === 'failure') return inherited;
    if (inherited.includes !== undefined) inheritedIncludes = inherited.includes;
  }

  return {
    kind: 'resolved',
    includes: parsed.config.includes ?? inheritedIncludes,
  };
}

function parseBiomeConfig(text: string, file: string): ParseResolution {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: 'failure', reason: `${file} is not plain JSON` };
  }
  if (!isRecord(value)) return { kind: 'failure', reason: `${file} does not contain a JSON object` };

  const extendedConfigs = extendedConfigList(value.extends);
  if (extendedConfigs === 'invalid') {
    return { kind: 'failure', reason: `${file} has an invalid extends value` };
  }

  const files = value.files;
  if (!isAbsent(files) && !isRecord(files)) {
    return { kind: 'failure', reason: `${file} has an invalid files value` };
  }
  const includesValue = isRecord(files) ? files.includes : undefined;
  const includes = stringArray(includesValue);
  if (includes === 'invalid') {
    return { kind: 'failure', reason: `${file} has an invalid files.includes value` };
  }

  return {
    kind: 'parsed',
    config: {
      extendedConfigs: extendedConfigs ?? [],
      includes,
    },
  };
}

function extendedConfigList(value: unknown): readonly string[] | undefined | 'invalid' {
  if (isAbsent(value)) return undefined;
  if (typeof value === 'string') return [value];
  return stringArray(value);
}

function stringArray(value: unknown): readonly string[] | undefined | 'invalid' {
  if (isAbsent(value)) return undefined;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) return 'invalid';
  return value;
}

function harnessCanEnter(includes: readonly string[] | undefined): ScopeResolution {
  if (includes === undefined) return { kind: 'scope', included: true };

  let included = false;
  for (const entry of includes) {
    const parsed = parseInclude(entry);
    if (parsed === undefined) {
      return { kind: 'failure', reason: `files.includes contains an empty pattern: ${JSON.stringify(entry)}` };
    }
    try {
      const matches = picomatch(parsed.pattern, { dot: true });
      if (HARNESS_PROBES.some((probe) => matches(probe))) included = !parsed.excluded;
    } catch {
      return { kind: 'failure', reason: `files.includes contains an invalid pattern: ${entry}` };
    }
  }
  return { kind: 'scope', included };
}

function parseInclude(entry: string): { readonly excluded: boolean; readonly pattern: string } | undefined {
  let pattern = entry.trim();
  const excluded = pattern.startsWith('!');
  if (pattern.startsWith('!!')) pattern = pattern.slice(2);
  else if (excluded) pattern = pattern.slice(1);
  if (pattern.startsWith('./')) pattern = pattern.slice(2);
  return pattern === '' ? undefined : { excluded, pattern };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isAbsent(value: unknown): boolean {
  return value === undefined || Object.prototype.toString.call(value) === '[object Null]';
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

function displayPath(root: string, path: string): string {
  const displayed = relative(root, path);
  return displayed === '' ? '.' : displayed;
}

function manual(file: string, why: string): { kind: 'manual'; file: string; instruction: string } {
  return {
    kind: 'manual',
    file,
    instruction: `${why}: add \`${HARNESS_LINT_EXCLUSION}\` to ${file} (after a positive pattern such as \`**\`) so the harness is not linted as project source`,
  };
}
