// The product's identity: which repository hosts it, which npm package ships it, which commands
// start it. It is written once, in packages/core/src/data/identity.json, and read here by every
// TypeScript consumer. The import is bundled into the CLI and into the hook runtime, so an
// installed copy carries the identity of the release that built it and reads no file at run time.
//
// Manifests that cannot import (package.json, plugin.json, workflows) repeat the values; the
// identity contract test fails the moment one of them disagrees with this source.
import document from '../../core/src/data/identity.json' with { type: 'json' };

export interface ProductIdentity {
  readonly repository: { readonly owner: string; readonly name: string };
  /** `owner/name`, the form GitHub, gh and the Actions context use. */
  readonly repositorySlug: string;
  readonly repositoryUrl: string;
  /** Slugs the repository carried before a rename. GitHub redirects git and web traffic to the new
   * name, but not a workflow's `uses:`, so a reference to one of these is broken, not merely old. */
  readonly formerRepositorySlugs: readonly string[];
  readonly packageName: string;
  /** Names the package was published under before, each up to and including its last major. */
  readonly formerPackages: readonly FormerPackage[];
  /** The package a given release was published under; the current one for anything else. */
  readonly packageFor: (version: string) => string;
  readonly commands: {
    readonly primary: string;
    readonly aliases: readonly string[];
    /** Still installed and still working, with a one-line notice on stderr. */
    readonly deprecated: readonly string[];
  };
  /** The delimiters of the blocks the product writes into a consumer's files. */
  readonly markers: {
    /** CLAUDE.md and AGENTS.md. */
    readonly agentDoc: ManagedMarkers;
    /** The mechanical block of `.void/machine/checkpoint.md`. */
    readonly contextContinuity: ManagedMarkers;
    /** `.gitignore` and `.git/info/exclude`. */
    readonly gitignore: ManagedMarkers;
  };
  /** Settings a person sets in the environment: `<prefix><NAME>`, read by `productSetting`. */
  readonly environment: {
    readonly prefix: string;
    /** Prefixes still read after a rename; the current one wins when both are set. */
    readonly deprecated: readonly string[];
  };
}

export interface MarkerPair {
  readonly begin: string;
  readonly end: string;
}

/**
 * A block written before a rename carries the old namespace, and a consumer keeps it until the
 * next write. Every write therefore uses `current`, and every read accepts any pair of
 * `recognized`, so the old block is found and replaced in place instead of duplicated.
 */
export interface ManagedMarkers {
  readonly current: MarkerPair;
  /** `current` first, then each deprecated namespace in declaration order. */
  readonly recognized: readonly MarkerPair[];
}

export interface FormerPackage {
  readonly name: string;
  readonly lastMajor: number;
}

// GitHub owner and repository names, npm package names and bin names all fit this shape; a
// slash or a space in any of them would silently change what a guard compares.
const SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== undefined && value !== null && !Array.isArray(value); // allow-null: narrowing parsed JSON
}

function segment(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SEGMENT.test(value)) {
    throw new Error(`product identity: ${field} must be a lowercase name without separators`);
  }
  return value;
}

function segments(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`product identity: ${field} must be a list`);
  return value.map((entry, index) => segment(entry, `${field}[${index}]`));
}

function formerPackages(value: unknown): readonly FormerPackage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('product identity: formerPackages must be a list');
  return value.map((entry: unknown, index) => {
    const record = isRecord(entry) ? entry : {};
    const lastMajor = record['lastMajor'];
    if (typeof lastMajor !== 'number' || !Number.isInteger(lastMajor) || lastMajor < 0) {
      throw new Error(`product identity: formerPackages[${index}].lastMajor must be a whole number`);
    }
    return { name: segment(record['name'], `formerPackages[${index}].name`), lastMajor };
  });
}

// A namespace sits inside an HTML comment and a shell comment: no space, no `>`, no `-->`.
const NAMESPACE = SEGMENT;
const PREFIX = /^[A-Z][A-Z0-9_]*_$/;

function exclusive(current: string, deprecated: readonly string[], field: string): void {
  if (deprecated.includes(current)) throw new Error(`product identity: ${current} is both current and deprecated (${field})`);
}

function pattern(value: unknown, shape: RegExp, field: string, rule: string): string {
  if (typeof value !== 'string' || !shape.test(value)) throw new Error(`product identity: ${field} must be ${rule}`);
  return value;
}

function patterns(value: unknown, shape: RegExp, field: string, rule: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`product identity: ${field} must be a list`);
  return value.map((entry, index) => pattern(entry, shape, `${field}[${index}]`, rule));
}

function managed(namespaces: readonly string[], pair: (namespace: string) => MarkerPair): ManagedMarkers {
  const recognized = namespaces.map(pair);
  const [current] = recognized;
  if (current === undefined) throw new Error('product identity: markers.namespace is required');
  return { current, recognized };
}

function markers(value: unknown): ProductIdentity['markers'] {
  const record = isRecord(value) ? value : {};
  const rule = 'a lowercase name without separators';
  const namespace = pattern(record['namespace'], NAMESPACE, 'markers.namespace', rule);
  const deprecated = patterns(record['deprecated'], NAMESPACE, 'markers.deprecated', rule);
  exclusive(namespace, deprecated, 'markers');
  const namespaces = [namespace, ...deprecated];
  return {
    agentDoc: managed(namespaces, (name) => ({ begin: `<!-- ${name}:begin -->`, end: `<!-- ${name}:end -->` })),
    contextContinuity: managed(namespaces, (name) => ({
      begin: `<!-- ${name}:context-continuity:begin -->`,
      end: `<!-- ${name}:context-continuity:end -->`,
    })),
    gitignore: managed(namespaces, (name) => ({ begin: `# ${name}:begin`, end: `# ${name}:end` })),
  };
}

function environment(value: unknown): ProductIdentity['environment'] {
  const record = isRecord(value) ? value : {};
  const rule = 'an upper-case prefix ending in _';
  const prefix = pattern(record['prefix'], PREFIX, 'environment.prefix', rule);
  const deprecated = patterns(record['deprecated'], PREFIX, 'environment.deprecated', rule);
  exclusive(prefix, deprecated, 'environment');
  return { prefix, deprecated };
}

const MAJOR = /^(0|[1-9]\d*)\.\d+\.\d+/;

/** Validate an identity document and derive the forms every consumer needs. Throws on any doubt. */
export function parseProductIdentity(value: unknown): ProductIdentity {
  if (!isRecord(value)) throw new Error('product identity: document must be an object');
  const repository = isRecord(value['repository']) ? value['repository'] : {};
  const owner = segment(repository['owner'], 'repository.owner');
  const name = segment(repository['name'], 'repository.name');
  const formerNames =
    repository['formerNames'] === undefined ? [] : segments(repository['formerNames'], 'repository.formerNames');
  const commands = isRecord(value['commands']) ? value['commands'] : {};
  const primary = segment(commands['primary'], 'commands.primary');
  const aliases = segments(commands['aliases'], 'commands.aliases');
  const deprecated = segments(commands['deprecated'], 'commands.deprecated');
  const current = [primary, ...aliases];
  const clash = deprecated.find((command) => current.includes(command));
  if (clash !== undefined) throw new Error(`product identity: ${clash} is both current and deprecated`);
  const packageName = segment(value['packageName'], 'packageName');
  const former = formerPackages(value['formerPackages']);
  // A version under several former names belongs to the oldest name that still covered it.
  const byLastMajor = [...former].sort((left, right) => left.lastMajor - right.lastMajor);
  const packageFor = (version: string): string => {
    const match = MAJOR.exec(version);
    if (match === null) return packageName;
    const major = Number(match[1]);
    return byLastMajor.find((entry) => major <= entry.lastMajor)?.name ?? packageName;
  };
  return {
    repository: { owner, name },
    repositorySlug: `${owner}/${name}`,
    repositoryUrl: `https://github.com/${owner}/${name}`,
    formerRepositorySlugs: formerNames.map((former) => `${owner}/${former}`),
    packageName,
    formerPackages: former,
    packageFor,
    commands: { primary, aliases, deprecated },
    markers: markers(value['markers']),
    environment: environment(value['environment']),
  };
}

export const PRODUCT_IDENTITY: ProductIdentity = parseProductIdentity(document);

/** The command every message tells a person to run: never a deprecated one, which would answer
 * the advice with a deprecation notice. */
export const PRODUCT_COMMAND: string = PRODUCT_IDENTITY.commands.primary;

/**
 * The one place a product setting is read from the environment. `name` is the part after the
 * prefix (`NO_TRIM` for `VOID_MACHINE_NO_TRIM`). The current prefix wins whenever it is set, even
 * to an empty string; a deprecated prefix is consulted only when the current one is absent, so an
 * override written before the rename keeps working until the person renames it.
 */
export function productSetting(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  identity: ProductIdentity = PRODUCT_IDENTITY,
): string | undefined {
  for (const prefix of [identity.environment.prefix, ...identity.environment.deprecated]) {
    const value = env[`${prefix}${name}`];
    if (value !== undefined) return value;
  }
  return undefined;
}
