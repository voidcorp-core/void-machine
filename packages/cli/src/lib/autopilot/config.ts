// The persisted declaration grammar. General readers preserve v2; only the
// authority reader admits explicit v3. Neither path reads historical programmes.
import { isAbsolute } from 'node:path';
import { z } from 'zod';

export const HUMAN_WAIT_LABEL = 'void:human-wait';
const text = z.string().refine(value => value.trim().length > 0, 'must be non-empty');
const strings = z.array(text);
const path = text.refine(value => !isAbsolute(value) && !value.split(/[\\/]/).includes('..'),
  'must be a repository-relative path without parent traversal');
const paths = z.array(path);
const states = z.strictObject({ ready: strings.nonempty(), started: strings.nonempty(),
  review: strings.nonempty(), done: strings.nonempty() });
const progress = z.strictObject({ provider: text, scope: text, states });

export const autopilotAuthoritySchema = z.strictObject({
  schemaVersion: z.union([z.literal(2), z.literal(3)]),
  enabled: z.boolean(),
  clusterSize: z.number().int().min(1).max(4).default(4),
  base: text.default('auto'),
  deployBranch: text.optional(),
  humanWaitLabel: text.max(50).refine(value => value.trim() === value,
    'must not contain surrounding whitespace').optional(),
  protectedPaths: paths.default([]),
  verifyCommands: z.array(strings.nonempty()).default([]),
  ownership: z.strictObject({ sequential: paths.default([]), reconcileOnly: paths.default([]) })
    .default({ sequential: [], reconcileOnly: [] }),
  progress,
  humanGates: strings.default([]),
}).refine(value => value.deployBranch === undefined || value.deployBranch !== value.base,
  { path: ['deployBranch'], message: 'the integration branch must not deploy' });

export interface ProgressStates {
  readonly ready: readonly string[];
  readonly started: readonly string[];
  readonly review: readonly string[];
  readonly done: readonly string[];
}
/** Native project and milestone locator, opaque to the kernel. */
export interface ProgressScope {
  readonly provider: string;
  readonly scope: string;
  readonly states: ProgressStates;
}
export type AutopilotDeclaration = z.infer<typeof autopilotAuthoritySchema>;
export interface AutopilotOwnership {
  readonly sequential: readonly string[];
  readonly reconcileOnly: readonly string[];
}
export interface AutopilotConfig {
  readonly schemaVersion: 2 | 3;
  readonly clusterSize: number;
  readonly base: string;
  readonly deployBranch?: string | undefined;
  readonly humanWaitLabel?: string | undefined;
  readonly protectedPaths: readonly string[];
  readonly verifyCommands: readonly (readonly string[])[];
  readonly ownership: AutopilotOwnership;
}
