// One offline composition for every resume consumer.
//
// The program owns durable global context, the checkpoint owns session residue,
// and Git owns the tree identity. This pure module composes those observations;
// it never reads a tracker, reconstructs a conversation, or invents missing state.

import type { Checkpoint } from './checkpoint.js';

export interface ResumeProgramInput {
  readonly status: 'executing' | 'completed';
  readonly program: string;
  readonly plan: string;
  readonly spec: string;
  readonly progress?: {
    readonly provider: string;
    readonly scope: string;
  };
}

export interface ProgramSummary {
  readonly status: ResumeProgramInput['status'];
  readonly program: string;
  readonly plan: string;
  readonly spec: string;
  readonly progress?: {
    readonly provider: string;
    readonly scope: string;
  };
}

export interface ResumeGitInput {
  readonly branch: string | undefined;
  readonly head: string | undefined;
  readonly dirtyFiles: number;
}

export interface ResumeBundleInput {
  readonly project: { readonly name: string; readonly path: string };
  readonly now: number;
  readonly git: ResumeGitInput;
  readonly program: ResumeProgramInput | undefined;
  readonly programError?: string;
  readonly checkpoint: Checkpoint | undefined;
  readonly checkpointWrittenAt?: number;
  readonly resumeSource?: 'startup' | 'resume' | 'clear' | 'compact' | 'fork';
}

export type ResumeGapReason =
  | 'program-absent'
  | 'program-invalid'
  | 'checkpoint-absent'
  | 'checkpoint-empty'
  | 'checkpoint-stale'
  | 'checkpoint-branch-moved'
  | 'checkpoint-head-moved'
  | 'mechanical-block-absent'
  | 'mechanical-block-invalid'
  | 'checkpoint-semantic-stale'
  | 'precompact-seal-unconfirmed'
  | 'clear-unreconciled';

export type ContinuityReason =
  | 'mechanical-block-absent'
  | 'mechanical-block-invalid'
  | 'semantic-revision-behind'
  | 'precompact-seal-unconfirmed'
  | 'clear-not-reconciled';

export interface ResumeGap {
  readonly reason: ResumeGapReason;
  readonly detail: string;
}

export interface ResumeBundle {
  readonly schemaVersion: 1;
  readonly project: { readonly name: string; readonly path: string };
  readonly program?: ProgramSummary;
  readonly checkpoint?: Checkpoint;
  readonly git: {
    readonly branch?: string;
    readonly head?: string;
    readonly dirtyFiles: number;
  };
  readonly gaps: readonly ResumeGap[];
  readonly continuity: {
    readonly status: 'complete' | 'degraded';
    readonly reasons: readonly ContinuityReason[];
  };
}

const DAY_MS = 86_400_000;
const STALE_DAYS = 7;
const CONTEXT_CHARS_MAX = 4_000;

function summarizeProgram(descriptor: ResumeProgramInput): ProgramSummary {
  return {
    status: descriptor.status,
    program: descriptor.program,
    plan: descriptor.plan,
    spec: descriptor.spec,
    ...(descriptor.progress === undefined
      ? {}
      : {
          progress: {
            provider: descriptor.progress.provider,
            scope: descriptor.progress.scope,
          },
        }),
  };
}

function programGap(input: ResumeBundleInput): ResumeGap | undefined {
  if (input.programError !== undefined) {
    return { reason: 'program-invalid', detail: input.programError };
  }
  if (input.program === undefined) {
    return {
      reason: 'program-absent',
      detail: 'no .void/program.md; resume can still use a local checkpoint and Git',
    };
  }
  return undefined;
}

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

function continuityFor(input: ResumeBundleInput): ResumeBundle['continuity'] {
  if (input.resumeSource === 'clear') {
    return { status: 'degraded', reasons: ['clear-not-reconciled'] };
  }
  const checkpoint = input.checkpoint;
  if (checkpoint?.mechanicalBlockStatus === 'invalid') {
    return { status: 'degraded', reasons: ['mechanical-block-invalid'] };
  }
  const mechanical = checkpoint?.mechanicalContext;
  if (mechanical === undefined) {
    return { status: 'degraded', reasons: ['mechanical-block-absent'] };
  }
  const reasons: ContinuityReason[] = [];
  if (mechanical.semanticRevision < mechanical.workRevision) {
    reasons.push('semantic-revision-behind');
  }
  if (
    input.resumeSource === 'compact'
    && mechanical.sealedWorkRevision !== mechanical.workRevision
  ) {
    reasons.push('precompact-seal-unconfirmed');
  }
  if (mechanical.clearPending) reasons.push('clear-not-reconciled');
  return reasons.length === 0
    ? { status: 'complete', reasons }
    : { status: 'degraded', reasons };
}

function continuityGaps(continuity: ResumeBundle['continuity']): readonly ResumeGap[] {
  return continuity.reasons.map((reason) => {
    switch (reason) {
      case 'mechanical-block-absent':
        return { reason, detail: 'the mechanical context block is absent' };
      case 'mechanical-block-invalid':
        return { reason, detail: 'the mechanical context block is ambiguous or malformed' };
      case 'semantic-revision-behind':
        return {
          reason: 'checkpoint-semantic-stale',
          detail: 'the semantic revision is behind mechanical work',
        };
      case 'precompact-seal-unconfirmed':
        return {
          reason,
          detail: 'the pre-compaction seal is not confirmed for the latest work revision',
        };
      case 'clear-not-reconciled':
        return { reason: 'clear-unreconciled', detail: 'the last clear is not reconciled' };
      default: {
        const exhaustive: never = reason;
        return exhaustive;
      }
    }
  });
}

export function composeResumeBundle(input: ResumeBundleInput): ResumeBundle {
  const continuity = continuityFor(input);
  const gaps = [
    programGap(input),
    checkpointGap(input),
    ...treeGaps(input),
    ...continuityGaps(continuity),
  ].filter(
    (gap): gap is ResumeGap => gap !== undefined,
  );
  return {
    schemaVersion: 1,
    project: input.project,
    ...(input.program === undefined ? {} : { program: summarizeProgram(input.program) }),
    ...(input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint }),
    git: {
      ...(input.git.branch === undefined ? {} : { branch: input.git.branch }),
      ...(input.git.head === undefined ? {} : { head: input.git.head }),
      dirtyFiles: input.git.dirtyFiles,
    },
    gaps,
    continuity,
  };
}

function checkpointContext(checkpoint: Checkpoint): readonly string[] {
  const mechanical = checkpoint.mechanicalContext;
  const readOverflow = mechanical === undefined || mechanical.readFilesOverflow === 0
    ? ''
    : ` (+${String(mechanical.readFilesOverflow)} older)`;
  const modifiedOverflow = mechanical === undefined || mechanical.modifiedFilesOverflow === 0
    ? ''
    : ` (+${String(mechanical.modifiedFilesOverflow)} older)`;
  return [
    checkpoint.date === undefined ? undefined : `Checkpoint date: ${checkpoint.date}`,
    checkpoint.objective === undefined ? undefined : `Objective: ${checkpoint.objective}`,
    checkpoint.position === undefined ? undefined : `Position: ${checkpoint.position}`,
    checkpoint.state === undefined ? undefined : `State: ${checkpoint.state}`,
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
    mechanical === undefined || mechanical.readFiles.length === 0
      ? undefined
      : `Read files: ${mechanical.readFiles.join(', ')}${readOverflow}`,
    mechanical === undefined || mechanical.modifiedFiles.length === 0
      ? undefined
      : `Modified files: ${mechanical.modifiedFiles.join(', ')}${modifiedOverflow}`,
  ].filter((line): line is string => line !== undefined);
}

function boundedResumeLines(
  required: readonly string[],
  optional: readonly string[],
): string {
  const requiredText = required.join('\n');
  const remaining = CONTEXT_CHARS_MAX - requiredText.length - 1;
  if (remaining <= 0 || optional.length === 0) {
    return `${requiredText.slice(0, CONTEXT_CHARS_MAX - 1)}\n`;
  }
  const optionalText = optional.join('\n');
  const boundedOptional = optionalText.length <= remaining
    ? optionalText
    : `${optionalText.slice(0, Math.max(0, remaining - 3))}...`;
  return `${requiredText}\n${boundedOptional}\n`.slice(0, CONTEXT_CHARS_MAX);
}

export function renderResumeContext(bundle: ResumeBundle): string {
  const usefulCheckpoint = bundle.checkpoint !== undefined && !bundle.checkpoint.isEmpty;
  if (
    bundle.program === undefined
    && !usefulCheckpoint
    && bundle.continuity.status === 'complete'
  ) return '';

  const continuityReasons = new Set<ResumeGapReason>([
    'mechanical-block-absent',
    'mechanical-block-invalid',
    'checkpoint-semantic-stale',
    'precompact-seal-unconfirmed',
    'clear-unreconciled',
  ]);
  const required = [
    '[void-harness resume]',
    `Project: ${bundle.project.name}`,
    `Context continuity: ${bundle.continuity.status}`,
    ...(bundle.continuity.status === 'degraded'
      ? ['Reconstruct context before any mutation.']
      : []),
    ...bundle.gaps
      .filter((gap) => continuityReasons.has(gap.reason))
      .map((gap) => `Gap: ${gap.detail}`),
  ];
  const optional: string[] = [];
  if (bundle.git.branch !== undefined) optional.push(`Branch: ${bundle.git.branch}`);
  if (bundle.git.head !== undefined) optional.push(`HEAD: ${bundle.git.head}`);
  if (bundle.git.dirtyFiles > 0) optional.push(`Dirty files: ${String(bundle.git.dirtyFiles)}`);
  if (bundle.program !== undefined) {
    optional.push(`Program: ${bundle.program.program}`);
    optional.push(`Plan: ${bundle.program.plan}`);
    optional.push(`Spec: ${bundle.program.spec}`);
    if (bundle.program.progress !== undefined) {
      optional.push(
        `Progress: ${bundle.program.progress.provider} at ${bundle.program.progress.scope}`,
      );
    }
  }
  if (usefulCheckpoint && bundle.checkpoint !== undefined) {
    optional.push(...checkpointContext(bundle.checkpoint));
  }
  optional.push(
    ...bundle.gaps
      .filter((gap) => !continuityReasons.has(gap.reason))
      .map((gap) => `Gap: ${gap.detail}`),
  );
  return boundedResumeLines(required, optional);
}
