// Shared authority grammar. Legacy YAML keeps its consent semantics; new JSON
// declarations require explicit consent and reject unknown fields.
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { PRODUCT_COMMAND } from '@voidcorp/hook-runner';
import { autopilotFailure } from './errors.js';

/**
 * The tracker label of a ticket handed to a person, unless the project names
 * another in `autopilot.humanWaitLabel`. One name, so the orchestrator that sets
 * it and the one that reads it back after a restart can never disagree.
 */
export const HUMAN_WAIT_LABEL = 'void:human-wait';
const MAX_CLUSTER_SIZE = 4;
function invalid(problem: string, cause: string, fix: string): never {
  throw autopilotFailure('AUTOPILOT_PROGRAM', problem, cause, fix);
}

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
  /**
   * 2 is the single merge mode. 1 is the 4.0 contract, whose `mergeGate` chose
   * between a person and the machine: still read, so resume and doctor work on
   * a programme not migrated yet, and refused by the loop until it is.
   */
  readonly schemaVersion: 1 | 2;
  /**
   * Tickets the continuous loop keeps in flight at once, 1..4: one worker and
   * one pull request each. The name predates the loop, from the cluster engine.
   */
  readonly clusterSize: number;
  /** `auto` resolves develop then main; anything else must exist. */
  readonly base: string;
  /**
   * The `mergeGate` a schema 1 programme declared, raw. Only carried so the
   * loop can refuse it with the migration that fits: a former human gate must
   * never be read as consent to merge on its own.
   */
  readonly legacyMergeGate?: string;
  /**
   * The branch that deploys, which the loop never merges into.
   *
   * Absent, it is the repository's default branch as GitHub reports it, never a
   * guessed name: `main` would put the refusal in the wrong place in a project
   * that ships from `production`.
   */
  readonly deployBranch?: string;
  /**
   * The tracker label the continuous loop puts on a ticket it hands to a
   * person, and reads back after a restart. Absent means the loop's default.
   */
  readonly humanWaitLabel?: string;
  /**
   * Paths the continuous loop never merges itself, on top of the harness floor
   * in `loop.ts`. Only an addition: the floor is not read from here, so no list
   * written here can shrink it.
   */
  readonly protectedPaths: readonly string[];
  /** argv arrays, executed with shell:false. */
  readonly verifyCommands: readonly (readonly string[])[];
  readonly ownership: AutopilotOwnership;
}

export function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(
      `the program descriptor has no usable \`${field}\` block`,
      `\`${field}\` is ${Array.isArray(value) ? 'a list' : String(value)}, not a mapping`,
      `declare \`${field}:\` as a mapping of its documented fields`,
    );
  }
  return value as Record<string, unknown>;
}

export function requiredString(source: Record<string, unknown>, field: string, context: string): string {
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

export function nonEmptyStringList(value: unknown, field: string): readonly string[] {
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
export function confinedPath(value: string, field: string): string {
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

/** Legacy programmes grant consent by declaring the block unless explicitly disabled. */
function consentGranted(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'boolean') {
    invalid(
      'the program descriptor states its autopilot consent as something other than a boolean',
      `\`autopilot.enabled\` is ${String(value)}, and a consent is either true or false`,
      'write `autopilot.enabled: false` to withhold it, `true` to grant it, or leave the field out',
    );
  }
  return value;
}

export function parseAutopilot(value: unknown): AutopilotConfig | undefined {
  if (value === undefined) return undefined;
  const block = record(value, 'autopilot');
  const granted = consentGranted(block.enabled);

  const schemaVersion = block.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    invalid(
      'the program descriptor declares an autopilot schema this CLI cannot read',
      schemaVersion === undefined
        ? '`autopilot.schemaVersion` is absent'
        : `\`autopilot.schemaVersion\` is ${String(schemaVersion)}`,
      'set `autopilot.schemaVersion: 2`, or upgrade the harness to a version that reads this schema',
    );
  }
  const legacyMergeGate = block.mergeGate;
  if (schemaVersion === 2 && legacyMergeGate !== undefined) {
    invalid(
      'the program descriptor declares a merge gate, and autopilot has none',
      `\`autopilot.mergeGate\` is ${String(legacyMergeGate)}; the loop merges on its own unless a person holds the merges`,
      `remove \`mergeGate\`; to keep every merge yours, run \`${PRODUCT_COMMAND} autopilot merges --by-human\``,
    );
  }

  const deployBranch = block.deployBranch;
  if (deployBranch !== undefined && (typeof deployBranch !== 'string' || deployBranch.trim().length === 0)) {
    invalid(
      'the program descriptor declares an unusable deploying branch',
      '`autopilot.deployBranch` is not a non-empty string',
      'set `autopilot.deployBranch` to the exact name of the branch that ships, or remove it for the default branch',
    );
  }
  // Said once here rather than discovered as a refusal on every merge. The loop
  // re-checks the resolved target at merge time regardless, since `base: auto`
  // is only resolved then and can land on this same branch.
  if (deployBranch !== undefined && deployBranch === (block.base ?? 'auto')) {
    invalid(
      'the program integrates straight into the branch it says deploys',
      `\`autopilot.base\` and \`autopilot.deployBranch\` are both ${String(deployBranch)}`,
      'integrate into a branch that does not ship, and promote it to the deploying branch by hand',
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

  // A label both Linear and GitHub accept: at most 50 characters, and no edge
  // whitespace, which trackers trim and a comparison would not.
  const humanWaitLabel = block.humanWaitLabel;
  if (
    humanWaitLabel !== undefined
    && (typeof humanWaitLabel !== 'string'
      || humanWaitLabel.length === 0
      || humanWaitLabel.length > 50
      || humanWaitLabel.trim() !== humanWaitLabel)
  ) {
    invalid(
      'the program descriptor declares an unusable human-wait label',
      `\`autopilot.humanWaitLabel\` is ${JSON.stringify(humanWaitLabel)}`,
      'name a label of 1 to 50 characters with no surrounding space, or remove it for the default',
    );
  }

  // Withheld last, after everything above has been judged. A block that is
  // present but wrong is an error whether or not it is switched off; letting a
  // disabled one rot unread would move the failure to the day someone turns it
  // back on, which is the worst moment to discover it.
  if (!granted) return undefined;
  return {
    schemaVersion,
    clusterSize: clusterSize as number,
    base,
    ...(legacyMergeGate === undefined ? {} : { legacyMergeGate: String(legacyMergeGate) }),
    ...(deployBranch === undefined ? {} : { deployBranch: deployBranch as string }),
    ...(humanWaitLabel === undefined ? {} : { humanWaitLabel: humanWaitLabel as string }),
    protectedPaths: pathList(block.protectedPaths, 'autopilot.protectedPaths'),
    verifyCommands: verifyCommands(block.verifyCommands),
    ownership: {
      sequential: pathList(ownership.sequential, 'autopilot.ownership.sequential'),
      reconcileOnly: pathList(ownership.reconcileOnly, 'autopilot.ownership.reconcileOnly'),
    },
  };
}

export function parseHumanGates(root: Record<string, unknown>): readonly string[] {
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


export type ProgressScope = Omit<ProgressLocator, 'order'>;

export function parseProgressScope(value: unknown): ProgressScope {
  const block = record(value, 'progress');
  const states = record(block.states, 'progress.states');
  return {
    provider: requiredString(block, 'provider', 'progress'),
    scope: requiredString(block, 'scope', 'progress'),
    states: {
      ready: nonEmptyStringList(states.ready, 'progress.states.ready'),
      started: nonEmptyStringList(states.started, 'progress.states.started'),
      review: nonEmptyStringList(states.review, 'progress.states.review'),
      done: nonEmptyStringList(states.done, 'progress.states.done'),
    },
  };
}

// This strict shell owns field types and names only. Values use the same grammar
// as the legacy reader, so two admission paths cannot acquire different rules.
const strings = z.array(z.string());
const declaration = z.strictObject({
  schemaVersion: z.literal(2), enabled: z.boolean(),
  clusterSize: z.number().optional(), base: z.string().optional(),
  deployBranch: z.string().optional(), humanWaitLabel: z.string().optional(),
  protectedPaths: strings.optional(), verifyCommands: z.array(strings).optional(),
  ownership: z.strictObject({ sequential: strings.optional(), reconcileOnly: strings.optional() }).optional(),
  progress: z.strictObject({ provider: z.string(), scope: z.string(),
    states: z.strictObject({ ready: strings, started: strings, review: strings, done: strings }) }),
  humanGates: strings.optional(),
});

export const autopilotAuthoritySchema = declaration.transform((value, context) => {
  try {
    // Validate the configured restrictions even when consent is withheld.
    const settings = parseAutopilot({ ...value, enabled: true });
    if (settings === undefined) throw new Error('autopilot configuration is absent');
    return {
      ...settings, schemaVersion: 2 as const, enabled: value.enabled,
      progress: parseProgressScope(value.progress), humanGates: parseHumanGates(value),
    };
  } catch (error) {
    context.issues.push({ code: 'custom', input: value,
      message: error instanceof Error ? error.message : String(error) });
    return z.NEVER;
  }
});

export type AutopilotDeclaration = z.infer<typeof autopilotAuthoritySchema>;
