import { existsSync } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import picomatch from 'picomatch';
import { classifyMaterialized, isCoOwned } from '@voidcorp/hook-runner';
import type { CheckResult } from './prerequisites.js';
import { ownedInstallPaths } from './void-migration.js';

// Read-only advice: project analyzer configuration is outside the install transaction.
// Ownership is per file, never inferred from a shared runtime directory.
const BIOME_FILES = ['biome.json', 'biome.jsonc'];
const KNIP_FILES = ['knip.json', 'knip.jsonc', '.knip.json', '.knip.jsonc',
  'knip.ts', 'knip.js', 'knip.config.ts', 'knip.config.js'];
const MAX_BIOME_CONFIG_READS = 32;
const MAX_EXAMPLES = 5;
const SCRIPT = /\.[cm]?[jt]sx?$/i;
const BIOME_ASSET = /\.(?:[cm]?[jt]sx?|jsonc?|css|graphql|gql)$/i;
const OTHER_LINTERS = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.ts',
  '.eslintrc.json', '.eslintrc.cjs', '.oxlintrc.json'];

/** Inspect actual attested assets against each supported analyzer, without running it. */
export async function inspectHarnessLintExclusion(root: string): Promise<readonly CheckResult[]> {
  const checks: CheckResult[] = [];
  const biome = BIOME_FILES.find((name) => existsSync(join(root, name)));
  const knip = KNIP_FILES.find((name) => existsSync(join(root, name)));
  const other = OTHER_LINTERS.find((name) => existsSync(join(root, name)));
  const packageKnip = knip === undefined ? await readPackageKnip(root) : undefined;
  if (biome === undefined && knip === undefined && packageKnip === undefined && other === undefined) {
    return [{ name: 'lint boundary', ok: true, status: 'pass', message: 'no analyzer config found' }];
  }
  const owned = await analyzerPaths(root);
  if (biome !== undefined) {
    const scope = await resolveBiomeIncludes(root, biome);
    checks.push(owned.kind === 'failure' ? manual('lint boundary', biome, owned.reason)
      : scope.kind === 'failure' ? manual('lint boundary', biome, scope.reason)
      : inspectBiome(biome, owned.paths, scope.includes));
  } else if (other !== undefined) {
    checks.push(manual('lint boundary', other, 'this analyzer configuration needs manual inspection'));
  }
  if (knip !== undefined || packageKnip !== undefined) {
    const file = knip ?? 'package.json';
    checks.push(owned.kind === 'failure' ? manual('knip boundary', file, owned.reason)
      : await inspectKnip(root, file, owned.paths.filter((path) => SCRIPT.test(path)), packageKnip));
  }
  return checks;
}

async function analyzerPaths(root: string): Promise<{ kind: 'paths'; paths: string[] } | ResolutionFailure> {
  const owned = await ownedInstallPaths(root);
  if (owned === undefined) return { kind: 'failure', reason: 'ownership unknown: no valid manifest or receipt' };
  const paths: string[] = [];
  try {
    const canonicalRoot = await realpath(root);
    for (const path of [...owned].sort()) {
      if (isCoOwned(path) || classifyMaterialized(path) !== 'derived' || !BIOME_ASSET.test(path)) continue;
      const full = join(root, path);
      if (!existsSync(full)) continue;
      if (!isInside(canonicalRoot, await realpath(full))) {
        return { kind: 'failure', reason: `owned path resolves outside the project: ${path}` };
      }
      if ((await lstat(full)).isFile()) paths.push(path);
    }
  } catch {
    return { kind: 'failure', reason: 'cannot inspect owned analyzer files' };
  }
  return { kind: 'paths', paths };
}

function inspectBiome(file: string, paths: readonly string[], includes: readonly string[] | undefined): CheckResult {
  const exposed: string[] = [];
  for (const path of paths) {
    const scope = harnessCanEnter(path, includes);
    if (scope.kind === 'failure') return manual('lint boundary', file, scope.reason);
    if (scope.included) exposed.push(path);
  }
  return boundary('lint boundary', file, exposed, 'files.includes', true);
}

async function readPackageKnip(root: string): Promise<unknown> {
  if (!existsSync(join(root, 'package.json'))) return undefined;
  const parsed = await readAnalyzerConfig(root, 'package.json');
  return parsed.kind === 'parsed' && isRecord(parsed.value) ? parsed.value.knip : undefined;
}

async function readAnalyzerConfig(root: string, file: string): Promise<
  { kind: 'parsed'; value: unknown } | ResolutionFailure
> {
  try {
    const canonicalRoot = await realpath(root);
    const path = await realpath(join(root, file));
    if (!isInside(canonicalRoot, path)) return { kind: 'failure', reason: 'config resolves outside the project' };
    return { kind: 'parsed', value: JSON.parse(await readFile(path, 'utf8')) };
  } catch {
    return { kind: 'failure', reason: 'config is unreadable or not plain JSON' };
  }
}

async function inspectKnip(root: string, file: string, paths: readonly string[], embedded?: unknown): Promise<CheckResult> {
  if (!file.endsWith('.json') && !file.endsWith('.jsonc')) {
    return manual('knip boundary', file, 'executable configuration is not evaluated');
  }
  const read = embedded === undefined ? await readAnalyzerConfig(root, file) : { kind: 'parsed' as const, value: embedded };
  if (read.kind === 'failure') return manual('knip boundary', file, read.reason);
  if (!isRecord(read.value)) return manual('knip boundary', file, 'config must be an object');
  // Deliberately bounded subset, documented by Knip schema 6. Workspaces, plugins,
  // project scopes and mode-specific patterns need the analyzer's own evaluation.
  // https://knip.dev/reference/configuration/#ignorefiles
  const config = read.value;
  const unsupported = Object.keys(config).some((key) => !['$schema', 'ignore', 'ignoreFiles'].includes(key));
  const ignore = stringArray(config.ignore);
  const unused = stringArray(config.ignoreFiles);
  if (unsupported || ignore === 'invalid' || unused === 'invalid'
      || [...(ignore ?? []), ...(unused ?? [])].some((pattern) => pattern.startsWith('!') || pattern.endsWith('!') || pattern.trim() === '')) {
    return manual('knip boundary', file, 'unsupported static config or mode-specific patterns; inspect manually');
  }
  try {
    const matches = picomatch([...(ignore ?? [])], { dot: true });
    const check = boundary('knip boundary', file, paths.filter((path) => !matches(path)),
      file === 'package.json' ? 'knip.ignore' : 'ignore', false);
    return unused !== undefined && check.status === 'advisory'
      ? { ...check, message: `${check.message}; ignoreFiles suppresses unused files only` } : check;
  } catch {
    return manual('knip boundary', file, 'invalid ignore patterns');
  }
}

function boundary(name: string, file: string, exposed: readonly string[], field: string, negate: boolean): CheckResult {
  if (exposed.length === 0) return { name, ok: true, status: 'pass', message: `${file}: no owned analyzer files exposed` };
  const sample = exposed.slice(0, MAX_EXAMPLES);
  const patterns = sample.map((path) => `\`${negate ? '!' : ''}${path}\``).join(', ');
  const remainder = exposed.length > MAX_EXAMPLES ? `; inspect the remaining ${exposed.length - MAX_EXAMPLES} owned files in the install manifest` : '';
  return {
    name, ok: true, status: 'advisory',
    message: `${file}: ${exposed.length} owned file(s) lack an explicit analyzer exclusion: ${sample.join(', ')}`,
    fix: `review ${field} in ${file}: exclude ${patterns}${remainder}`
      + (negate ? ' (keep a positive pattern such as `**` before exclusions; a lone negation matches nothing in Biome)' : '')
      + '; keep project-owned neighbors in scope',
  };
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

function harnessCanEnter(path: string, includes: readonly string[] | undefined): ScopeResolution {
  if (includes === undefined) return { kind: 'scope', included: true };

  let included = false;
  for (const entry of includes) {
    const parsed = parseInclude(entry);
    if (parsed === undefined) {
      return { kind: 'failure', reason: `files.includes contains an empty pattern: ${JSON.stringify(entry)}` };
    }
    try {
      const matches = picomatch(parsed.pattern, { dot: true });
      // A directory pattern also governs its descendants (Biome `!.claude`).
      const segments = path.split('/');
      const candidates = segments.map((_, index) => segments.slice(0, index + 1).join('/'));
      if (candidates.some((candidate) => matches(candidate))) included = !parsed.excluded;
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

function manual(name: string, file: string, reason: string): CheckResult {
  return { name, ok: true, status: 'unknown', message: `${file}: ${reason}`,
    fix: 'inspect analyzer scope manually for attested harness assets; keep project-owned files in scope' };
}
