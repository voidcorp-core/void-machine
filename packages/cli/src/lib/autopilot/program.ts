// The program contract: durable global context and explicit automation consent.
//
// `.void/program.md` is a descriptor, never a cursor: it deliberately holds no
// current or next unit. A declared progress provider owns mutable execution
// state; the core only understands its generic roles and opaque locator.
//
// Every field is validated on read. A file that is present but wrong is an
// error, never a shrug: silently falling back to a default would let a typo in
// `mergeGate` hand a merge to a machine.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { autopilotFailure } from './errors.js';

export type ProgramStatus = 'executing' | 'completed';

export interface ProgressStates {
  readonly ready: readonly string[];
  readonly started: readonly string[];
  readonly review: readonly string[];
  readonly done: readonly string[];
}

export interface ProgressLocator {
  /** Capability id resolved by an adapter only when a remote action is needed. */
  readonly provider: string;
  /** Native workspace/project/repository query, opaque to the core. */
  readonly scope: string;
  /** Deterministic tie-break order among simultaneously ready work units. */
  readonly order: readonly string[];
  readonly states: ProgressStates;
}

export interface AutopilotOwnership {
  /** Paths a single writer must own; anything touching them runs sequentially. */
  readonly sequential: readonly string[];
  /** Generated artefacts only the reconciler may rebuild. */
  readonly reconcileOnly: readonly string[];
}

export interface AutopilotConfig {
  readonly schemaVersion: 1;
  readonly enabled: boolean;
  /** Ceiling on one cluster, 1..4. */
  readonly clusterSize: number;
  /** `auto` resolves develop then main; anything else must exist. */
  readonly base: string;
  /** Only `human` is accepted: merging is the human boundary of the feature. */
  readonly mergeGate: 'human';
  /** argv arrays, executed with shell:false. */
  readonly verifyCommands: readonly (readonly string[])[];
  readonly ownership: AutopilotOwnership;
}

export interface ProgramDescriptor {
  readonly schemaVersion: 1;
  readonly status: ProgramStatus;
  readonly program: string;
  readonly plan: string;
  readonly spec: string;
  readonly progress?: ProgressLocator;
  readonly humanGates: readonly string[];
  readonly autopilot: AutopilotConfig;
}

/**
 * Where the pointer lives now, and where it lived before.
 *
 * It is harness machinery — remove the harness and it means nothing — so it
 * belongs in `.void/`. The previous location is still read, because a project
 * migrates on `update` and until then a reader that only knew the new path would
 * report a running program as absent, which is worse than reading an old path.
 */
export const PROGRAM_PATH = join('.void', 'program.md');
export const LEGACY_PROGRAM_PATHS = [
  join('.void', 'active.md'),
  join('plans', 'ACTIVE.md'),
] as const;

/** Locate the only declared program, or return the canonical write path. */
export function programPath(root: string): string {
  const candidates = [PROGRAM_PATH, ...LEGACY_PROGRAM_PATHS];
  const present = candidates.filter((candidate) => existsSync(join(root, candidate)));
  if (present.length > 1) {
    invalid(
      'multiple program descriptor files make the source of truth ambiguous',
      `found ${present.map((path) => `\`${path}\``).join(', ')}`,
      `keep only \`${PROGRAM_PATH}\`; migrate or remove the legacy duplicate after comparing it`,
    );
  }
  return present[0] ?? PROGRAM_PATH;
}
const MAX_CLUSTER_SIZE = 4;

function invalid(problem: string, cause: string, fix: string): never {
  throw autopilotFailure('AUTOPILOT_PROGRAM', problem, cause, fix);
}

function frontmatterOf(text: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (match === null) {
    invalid(
      'the program descriptor carries no frontmatter',
      'the file does not open with a `---` delimited YAML block',
      'start the file with a `---` block declaring schemaVersion, status, program, plan, spec and autopilot',
    );
  }
  return match[1] as string;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(
      `the program descriptor has no usable \`${field}\` block`,
      `\`${field}\` is ${Array.isArray(value) ? 'a list' : String(value)}, not a mapping`,
      `declare \`${field}:\` as a mapping of its documented fields`,
    );
  }
  return value as Record<string, unknown>;
}

function requiredString(source: Record<string, unknown>, field: string, context: string): string {
  const value = source[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid(
      `the program descriptor is missing \`${context}.${field}\``,
      value === undefined ? `\`${field}\` is absent` : `\`${field}\` is not a non-empty string`,
      `set \`${field}\` in the \`${context}\` block to the value it names`,
    );
  }
  return value;
}

function nonEmptyStringList(value: unknown, field: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)
  ) {
    invalid(
      `the program descriptor has no usable \`${field}\``,
      `\`${field}\` must be a non-empty list of non-empty strings`,
      `declare \`${field}\` as a YAML list naming the provider values actually used`,
    );
  }
  return value as string[];
}

/**
 * Repo-relative and non-escaping. A program that can point at `/etc` or `../`
 * is a path traversal with a YAML syntax, so the check lives at the contract
 * boundary rather than at each consumer.
 */
function confinedPath(value: string, field: string): string {
  if (isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
    invalid(
      `the program descriptor \`${field}\` leaves the repository`,
      `\`${value}\` is absolute or walks up out of the project root`,
      `set \`${field}\` to a path relative to the repository root, without \`..\``,
    );
  }
  return value;
}

function pathList(value: unknown, field: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
    invalid(
      `the program descriptor \`${field}\` is not a list of paths`,
      `\`${field}\` must be a list of non-empty strings`,
      `declare \`${field}\` as a YAML list of repo-relative path patterns`,
    );
  }
  return (value as string[]).map((entry) => confinedPath(entry, field));
}

function verifyCommands(value: unknown): readonly (readonly string[])[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    invalid(
      'the program descriptor `autopilot.verifyCommands` is not a list',
      `\`verifyCommands\` is ${String(value)}`,
      'declare `verifyCommands` as a list of argv arrays, for example `- [pnpm, test]`',
    );
  }
  return value.map((command) => {
    // argv arrays only: a bare string would have to be split by a shell, and
    // shell:false is precisely what keeps a project's verify step from being an
    // injection point.
    if (
      !Array.isArray(command) ||
      command.length === 0 ||
      command.some((word) => typeof word !== 'string' || word.trim().length === 0)
    ) {
      invalid(
        'the program descriptor has an unusable entry in `autopilot.verifyCommands`',
        `\`${JSON.stringify(command)}\` is not a non-empty array of non-empty strings`,
        'write each command as an argv array, for example `- [pnpm, test]`; commands run with shell:false',
      );
    }
    return command as string[];
  });
}

function parseAutopilot(value: unknown): AutopilotConfig {
  if (value === undefined) {
    invalid(
      'the program descriptor declares no `autopilot` block',
      'the contract requires an explicit autopilot decision, even a negative one',
      'add an `autopilot:` block with `schemaVersion: 1`, `enabled: false` and `mergeGate: human` to opt out',
    );
  }
  const block = record(value, 'autopilot');

  const schemaVersion = block.schemaVersion;
  if (schemaVersion !== 1) {
    invalid(
      'the program descriptor declares an autopilot schema this CLI cannot read',
      schemaVersion === undefined
        ? '`autopilot.schemaVersion` is absent'
        : `\`autopilot.schemaVersion\` is ${String(schemaVersion)}`,
      'set `autopilot.schemaVersion: 1`, or upgrade the harness to a version that reads this schema',
    );
  }

  if (typeof block.enabled !== 'boolean') {
    invalid(
      'the program descriptor does not say whether autopilot is enabled',
      '`autopilot.enabled` is not a boolean',
      'set `autopilot.enabled` to true or false; consent is never inferred',
    );
  }

  if (block.mergeGate !== 'human') {
    invalid(
      'the program descriptor declares a merge gate autopilot will not honour',
      `\`autopilot.mergeGate\` is ${String(block.mergeGate)}, and only \`human\` exists`,
      'set `autopilot.mergeGate: human`; merging the integration PR is a human action',
    );
  }

  const clusterSize = block.clusterSize ?? MAX_CLUSTER_SIZE;
  if (!Number.isInteger(clusterSize) || (clusterSize as number) < 1 || (clusterSize as number) > MAX_CLUSTER_SIZE) {
    invalid(
      'the program descriptor declares an unusable cluster size',
      `\`autopilot.clusterSize\` is ${String(clusterSize)}, outside 1..${MAX_CLUSTER_SIZE}`,
      `set \`autopilot.clusterSize\` between 1 and ${MAX_CLUSTER_SIZE}`,
    );
  }

  const base = block.base ?? 'auto';
  if (typeof base !== 'string' || base.trim().length === 0) {
    invalid(
      'the program descriptor declares an unusable base branch',
      '`autopilot.base` is not a non-empty string',
      'set `autopilot.base` to `auto`, or to the exact name of an existing branch',
    );
  }

  const ownership = block.ownership === undefined ? {} : record(block.ownership, 'autopilot.ownership');
  return {
    schemaVersion: 1,
    enabled: block.enabled,
    clusterSize: clusterSize as number,
    base,
    mergeGate: 'human',
    verifyCommands: verifyCommands(block.verifyCommands),
    ownership: {
      sequential: pathList(ownership.sequential, 'autopilot.ownership.sequential'),
      reconcileOnly: pathList(ownership.reconcileOnly, 'autopilot.ownership.reconcileOnly'),
    },
  };
}

function parseProgress(value: unknown): ProgressLocator | undefined {
  if (value === undefined) return undefined;
  const block = record(value, 'progress');
  const states = record(block.states, 'progress.states');
  return {
    provider: requiredString(block, 'provider', 'progress'),
    scope: requiredString(block, 'scope', 'progress'),
    order: nonEmptyStringList(block.order, 'progress.order'),
    states: {
      ready: nonEmptyStringList(states.ready, 'progress.states.ready'),
      started: nonEmptyStringList(states.started, 'progress.states.started'),
      review: nonEmptyStringList(states.review, 'progress.states.review'),
      done: nonEmptyStringList(states.done, 'progress.states.done'),
    },
  };
}

function parseLegacyProgress(value: unknown): ProgressLocator {
  const block = record(value, 'tracker');
  return {
    provider: requiredString(block, 'provider', 'tracker'),
    scope: requiredString(block, 'scope', 'tracker'),
    order: nonEmptyStringList(block.issues, 'tracker.issues'),
    states: {
      ready: nonEmptyStringList(block.readyStates, 'tracker.readyStates'),
      started: [requiredString(block, 'startedState', 'tracker')],
      review: [requiredString(block, 'reviewState', 'tracker')],
      done: nonEmptyStringList(block.doneStates, 'tracker.doneStates'),
    },
  };
}

function parseRoot(text: string): Record<string, unknown> {
  const frontmatter = frontmatterOf(text);
  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatter);
  } catch (error) {
    invalid(
      'the program descriptor frontmatter is not valid YAML',
      error instanceof Error ? error.message : String(error),
      'fix the YAML syntax reported above in the frontmatter block',
    );
  }
  return record(parsed, 'frontmatter');
}

function parseStatus(root: Record<string, unknown>): ProgramStatus {
  const status = root.status;
  if (status !== 'executing' && status !== 'completed') {
    invalid(
      'the program descriptor declares an unknown status',
      `\`status\` is ${String(status)}`,
      'set `status` to `executing` while the program runs, or `completed` once it is finished',
    );
  }
  return status;
}

function parseHumanGates(root: Record<string, unknown>): readonly string[] {
  const humanGates = root.humanGates;
  if (
    humanGates !== undefined &&
    (!Array.isArray(humanGates) ||
      humanGates.some((gate) => typeof gate !== 'string' || gate.trim().length === 0))
  ) {
    invalid(
      'the program descriptor lists unusable human gates',
      '`humanGates` must be a list of non-empty work-unit identifiers',
      'declare `humanGates` as a YAML list of provider-native ids, or remove it',
    );
  }
  return (humanGates as string[] | undefined) ?? [];
}

function descriptorOf(
  root: Record<string, unknown>,
  progress: ProgressLocator | undefined,
): ProgramDescriptor {
  const autopilot = parseAutopilot(root.autopilot);
  if (autopilot.enabled && progress === undefined) {
    invalid(
      'the program enables autopilot without a progress source',
      '`autopilot.enabled` is true but `progress` is absent',
      'declare a progress provider and its state roles, or set `autopilot.enabled: false`',
    );
  }
  return {
    schemaVersion: 1,
    status: parseStatus(root),
    program: requiredString(root, 'program', 'frontmatter'),
    plan: confinedPath(requiredString(root, 'plan', 'frontmatter'), 'plan'),
    spec: confinedPath(requiredString(root, 'spec', 'frontmatter'), 'spec'),
    ...(progress === undefined ? {} : { progress }),
    humanGates: parseHumanGates(root),
    autopilot,
  };
}

/** Pure: validate canonical `.void/program.md` frontmatter. */
export function parseProgramDescriptor(text: string): ProgramDescriptor {
  const root = parseRoot(text);
  if (root.schemaVersion !== 1) {
    invalid(
      'the program descriptor declares a schema this CLI cannot read',
      root.schemaVersion === undefined
        ? '`schemaVersion` is absent'
        : `\`schemaVersion\` is ${String(root.schemaVersion)}`,
      'set `schemaVersion: 1`, or upgrade the harness to a version that reads this schema',
    );
  }
  return descriptorOf(root, parseProgress(root.progress));
}

function parseLegacyDescriptor(text: string): ProgramDescriptor {
  const root = parseRoot(text);
  if (root.schemaVersion !== undefined) return parseProgramDescriptor(text);
  return descriptorOf(root, parseLegacyProgress(root.tracker));
}

/**
 * Read the program descriptor, or undefined when the project declares none.
 *
 * Absent is a normal state — most projects run no program. Present-but-invalid
 * is not: it surfaces, because a broken contract that reads as "no program"
 * would silently disable every guarantee the file exists to carry.
 */
export function readProgramDescriptor(root: string, relativePath?: string): ProgramDescriptor | undefined {
  relativePath = relativePath ?? programPath(root);
  const rootPath = resolve(root);
  const target = resolve(rootPath, relativePath);
  if (isAbsolute(relativePath) || (target !== rootPath && !target.startsWith(rootPath + sep))) {
    invalid(
      'the requested program descriptor is outside the project root',
      `\`${relativePath}\` resolves to ${target}, which is not under ${rootPath}`,
      'pass a path relative to the project root, without `..`',
    );
  }

  let text: string;
  try {
    text = readFileSync(target, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    invalid(
      'the program descriptor could not be read',
      error instanceof Error ? error.message : String(error),
      'check the file permissions, then run the command again',
    );
  }
  return LEGACY_PROGRAM_PATHS.includes(relativePath)
    ? parseLegacyDescriptor(text)
    : parseProgramDescriptor(text);
}
