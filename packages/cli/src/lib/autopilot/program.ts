// The program contract: durable global context and explicit automation consent.
//
// `.void/program.md` is a descriptor, never a cursor: it deliberately holds no
// current or next unit. A declared progress provider owns mutable execution
// state; the core only understands its generic roles and opaque locator.
//
// Every field is validated on read. A file that is present but wrong is an
// error, never a shrug: silently falling back to a default would let a typo in
// the base or the deploying branch put a merge in the wrong place.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { autopilotFailure } from './errors.js';
import { type AutopilotConfig, type ProgressLocator, confinedPath, nonEmptyStringList, parseAutopilot, parseHumanGates, parseProgressScope, record, requiredString } from './config.js';
export type { AutopilotConfig, AutopilotOwnership, ProgressLocator, ProgressStates } from './config.js';

export type ProgramStatus = 'executing' | 'completed';

export interface ProgramDescriptor {
  readonly schemaVersion: 1;
  readonly status: ProgramStatus;
  readonly program: string;
  readonly plan: string;
  readonly spec: string;
  readonly progress?: ProgressLocator;
  readonly humanGates: readonly string[];
  /** Present when the program consents to autopilot; absent is the opt-out. */
  readonly autopilot?: AutopilotConfig;
  /**
   * True when a block was written and then took its consent back with
   * `enabled: false`.
   *
   * The block itself is not returned. A consent taken back and a block never
   * written forbid exactly the same thing, and returning one value for both is
   * what stops the next authorisation point from forgetting to read a flag --
   * the defect this field exists to close. What it carries is the REASON, so a
   * refusal can name what the author wrote instead of reporting a block they can
   * see sitting there as missing.
   */
  readonly autopilotConsentWithheld: boolean;
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

function parseProgress(value: unknown): ProgressLocator | undefined {
  if (value === undefined) return undefined;
  const block = record(value, 'progress');
  return { ...parseProgressScope(value), order: nonEmptyStringList(block.order, 'progress.order') };
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

function descriptorOf(
  root: Record<string, unknown>,
  progress: ProgressLocator | undefined,
): ProgramDescriptor {
  const autopilot = parseAutopilot(root.autopilot);
  // A block that parsed into nothing is one that took its consent back; there is
  // no other way for it to be present and produce no config.
  const autopilotConsentWithheld = root.autopilot !== undefined && autopilot === undefined;
  // Consent without a provider is a request the core cannot serve: it would have
  // to infer remote progress, which is exactly what it must never do.
  if (autopilot !== undefined && progress === undefined) {
    invalid(
      'the program declares autopilot without a progress source',
      'an `autopilot` block is present but `progress` is absent',
      'declare a progress provider and its state roles, or remove the `autopilot` block to opt out',
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
    autopilotConsentWithheld,
    ...(autopilot === undefined ? {} : { autopilot }),
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
