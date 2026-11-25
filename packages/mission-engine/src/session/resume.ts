// One offline composition for every resume consumer.
//
// The checkpoint owns session residue and Git owns the tree identity. This pure module composes those observations;
// it never reads a tracker, reconstructs a conversation, or invents missing state.

import type { Checkpoint } from './checkpoint.js';

export interface ResumeGitInput {
  readonly branch: string | undefined;
  readonly head: string | undefined;
  readonly dirtyFiles: number;
}

/** Supported read locations, relative to the observed project. */
export type CheckpointPath =
  | '.void/machine/checkpoint.md'
  | '.void/local/checkpoint.md'
  | '.void/session/current.md';

export interface ResumeBundleInput {
  readonly project: { readonly name: string; readonly path: string };
  readonly now: number;
  readonly git: ResumeGitInput;
  readonly checkpoint: Checkpoint | undefined;
  readonly checkpointWrittenAt?: number;
  readonly checkpointPath?: CheckpointPath;
}

export type ResumeGapReason =
  | 'checkpoint-absent'
  | 'checkpoint-empty'
  | 'checkpoint-stale'
  | 'checkpoint-branch-moved'
  | 'checkpoint-head-moved';

export interface ResumeGap {
  readonly reason: ResumeGapReason;
  readonly detail: string;
}

export interface ResumeBundle {
  readonly schemaVersion: 2;
  readonly project: { readonly name: string; readonly path: string };
  readonly checkpoint?: Checkpoint;
  readonly checkpointPath?: CheckpointPath;
  readonly checkpointNotice?: string;
  readonly git: {
    readonly branch?: string;
    readonly head?: string;
    readonly dirtyFiles: number;
  };
  readonly gaps: readonly ResumeGap[];

}

const DAY_MS = 86_400_000;
const STALE_DAYS = 7;
const CONTEXT_CHARS_MAX = 4_000;
const CHECKPOINT_NOTICE = 'Observations and intentions to verify; no authorization.';

function checkpointGap(input: ResumeBundleInput): ResumeGap | undefined {
  if (input.checkpoint === undefined) {
    return {
      reason: 'checkpoint-absent',
      detail: 'no .void/machine/checkpoint.md; invoke void-checkpoint before ending a session',
    };
  }
  if (input.checkpoint.isEmpty) {
    return {
      reason: 'checkpoint-empty',
      detail: 'the checkpoint exists but carries no recognised session residue',
    };
  }
  if (input.checkpointWrittenAt === undefined) return undefined;
  const ageDays = Math.max(0, Math.floor((input.now - input.checkpointWrittenAt) / DAY_MS));
  return ageDays > STALE_DAYS
    ? {
        reason: 'checkpoint-stale',
        detail: `the checkpoint is ${String(ageDays)} days old`,
      }
    : undefined;
}

function treeGaps(input: ResumeBundleInput): readonly ResumeGap[] {
  const gaps: ResumeGap[] = [];
  const checkpoint = input.checkpoint;
  if (
    checkpoint?.branch !== undefined &&
    input.git.branch !== undefined &&
    checkpoint.branch !== input.git.branch
  ) {
    gaps.push({
      reason: 'checkpoint-branch-moved',
      detail: `checkpoint branch ${checkpoint.branch}; current branch ${input.git.branch}`,
    });
  }
  if (
    checkpoint?.head !== undefined &&
    input.git.head !== undefined &&
    checkpoint.head !== input.git.head
  ) {
    gaps.push({
      reason: 'checkpoint-head-moved',
      detail: `checkpoint HEAD ${checkpoint.head}; current HEAD ${input.git.head}`,
    });
  }
  return gaps;
}

export function composeResumeBundle(input: ResumeBundleInput): ResumeBundle {
  const gaps = [
    checkpointGap(input),
    ...treeGaps(input),
  ].filter(
    (gap): gap is ResumeGap => gap !== undefined,
  );
  return {
    schemaVersion: 2,
    project: input.project,
    ...(input.checkpoint === undefined ? {} : {
      checkpoint: input.checkpoint,
      checkpointPath: input.checkpointPath ?? '.void/machine/checkpoint.md',
      checkpointNotice: CHECKPOINT_NOTICE,
    }),
    git: {
      ...(input.git.branch === undefined ? {} : { branch: input.git.branch }),
      ...(input.git.head === undefined ? {} : { head: input.git.head }),
      dirtyFiles: input.git.dirtyFiles,
    },
    gaps,
  };
}

function checkpointContext(checkpoint: Checkpoint): readonly string[] {
  return [
    checkpoint.date === undefined ? undefined : `Checkpoint date: ${checkpoint.date}`,
    checkpoint.objective === undefined ? undefined : `Objective: ${checkpoint.objective}`,
    checkpoint.position === undefined ? undefined : `Position: ${checkpoint.position}`,
    checkpoint.state === undefined ? undefined : `State: ${checkpoint.state}`,
    checkpoint.engagedWork === undefined ? undefined : `Engaged work: ${checkpoint.engagedWork}`,
    checkpoint.plannedWork === undefined ? undefined : `Planned work: ${checkpoint.plannedWork}`,
    checkpoint.nextAction === undefined ? undefined : `Next action: ${checkpoint.nextAction}`,
    checkpoint.openLoops.length === 0
      ? undefined
      : `Open loops: ${checkpoint.openLoops.join('; ')}`,
    checkpoint.deadEnds.length === 0
      ? undefined
      : `Dead ends: ${checkpoint.deadEnds.join('; ')}`,
    checkpoint.assumptions.length === 0
      ? undefined
      : `Unverified assumptions: ${checkpoint.assumptions.join('; ')}`,
  ].filter((line): line is string => line !== undefined);
}

function boundedResumeLines(
  required: readonly string[],
  optional: readonly string[],
): string {
  const requiredText = required.join('\n');
  const optionalText = optional.join('\n');
  const complete = `${requiredText}\n${optionalText}\n`;
  if (complete.length <= CONTEXT_CHARS_MAX) return complete;
  const notice = 'Summary truncated; read the full checkpoint before resuming work.';
  // Only fixed notices and a supported relative path are required. User prose
  // cannot crowd out the pointer or make a partial summary look exhaustive.
  const prefix = `${requiredText}\n${notice}\n`;
  return `${prefix}${optionalText.slice(0, CONTEXT_CHARS_MAX - prefix.length - 4)}...\n`;
}

export function renderResumeContext(bundle: ResumeBundle): string {
  const usefulCheckpoint = bundle.checkpoint !== undefined && !bundle.checkpoint.isEmpty;
  if (!usefulCheckpoint) return '';
  const required = ['[void-machine resume]'];
  if (usefulCheckpoint) {
    required.push(`Full checkpoint: ${bundle.checkpointPath ?? '.void/machine/checkpoint.md'} (project-relative)`);
    required.push(CHECKPOINT_NOTICE);
  }
  const optional: string[] = [`Project: ${bundle.project.name}`];
  if (bundle.git.branch !== undefined) optional.push(`Branch: ${bundle.git.branch}`);
  if (bundle.git.head !== undefined) optional.push(`HEAD: ${bundle.git.head}`);
  if (bundle.git.dirtyFiles > 0) optional.push(`Dirty files: ${String(bundle.git.dirtyFiles)}`);
  if (usefulCheckpoint && bundle.checkpoint !== undefined) {
    optional.push(...checkpointContext(bundle.checkpoint));
  }
  optional.push(
    ...bundle.gaps.map((gap) => `Gap: ${gap.detail}`),
  );
  return boundedResumeLines(required, optional);
}
