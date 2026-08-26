// What a session needs to pick a project back up.
//
// Pure: callers gather, this composes. Same seam as the projects view, and for
// the same reason — the CLI and anything served later must answer identically.
//
// It composes ONLY what exists. There is no reconstruction from git history and
// no inference from a conversation: the checkpoint is the canonical record of
// where the work stood, and a resume that guessed would be confidently wrong
// exactly when it is trusted most. What is missing is reported as missing.

import type { DecisionsObservation } from '../projects/decisions-source.js';
import type { GitSignals, ProgramSignal } from '../projects/summary.js';
import type { Checkpoint } from './checkpoint.js';

export interface ResumeInput {
  readonly name: string;
  readonly path: string;
  readonly now: number;
  readonly git: GitSignals;
  readonly decisions: DecisionsObservation;
  readonly checkpoint?: Checkpoint;
  /** Age of the checkpoint file, for judging how much to trust it. */
  readonly checkpointWrittenAt?: number;
  readonly program?: ProgramSignal;
}

/** Why a resume is less useful than it should be. Named, never silent. */
export type ResumeGapReason =
  | 'no-checkpoint'
  | 'empty-checkpoint'
  | 'stale-checkpoint'
  | 'branch-moved'
  | 'no-decisions';

export interface ResumeGap {
  readonly reason: ResumeGapReason;
  readonly detail: string;
}

export interface ResumeReport {
  readonly name: string;
  readonly path: string;
  readonly branch: string | undefined;
  readonly dirtyFiles: number;
  readonly checkpoint: Checkpoint | undefined;
  readonly checkpointAgeDays: number | undefined;
  readonly recentDecisions: readonly { readonly title: string; readonly date?: string }[];
  readonly program: ProgramSignal | undefined;
  readonly gaps: readonly ResumeGap[];
}

const DAY_MS = 86_400_000;
/**
 * Past a week a checkpoint describes a tree that has usually moved on. It is
 * still shown — an old note beats no note — but its age is stated so the reader
 * discounts it deliberately rather than trusting it by default.
 */
const STALE_DAYS = 7;

function ageDays(writtenAt: number | undefined, now: number): number | undefined {
  if (writtenAt === undefined) return undefined;
  return Math.max(0, Math.floor((now - writtenAt) / DAY_MS));
}

function gapsOf(input: ResumeInput, age: number | undefined): readonly ResumeGap[] {
  const gaps: ResumeGap[] = [];

  if (input.checkpoint === undefined) {
    gaps.push({
      reason: 'no-checkpoint',
      detail:
        'no .void/machine/checkpoint.md — run the checkpoint skill before a clear, an '
        + 'interruption, or the end of a day, so the next session starts from a record',
    });
  } else if (input.checkpoint.isEmpty) {
    gaps.push({
      reason: 'empty-checkpoint',
      detail: 'the checkpoint exists but carries no section this reader recognises',
    });
  } else if (age !== undefined && age > STALE_DAYS) {
    gaps.push({
      reason: 'stale-checkpoint',
      detail: `the checkpoint is ${String(age)} days old; the tree has probably moved since`,
    });
  }

  // A checkpoint written on another branch describes work that is not in front
  // of you. Worth saying: it is the difference between resuming and being
  // confused by someone else's context.
  const recorded = input.checkpoint?.branch;
  if (recorded !== undefined && input.git.branch !== undefined && recorded !== input.git.branch) {
    gaps.push({
      reason: 'branch-moved',
      detail: `the checkpoint was written on \`${recorded}\`, the tree is on \`${input.git.branch}\``,
    });
  }

  if (input.decisions.count === 0) {
    gaps.push({
      reason: 'no-decisions',
      detail: 'no decision record found, so "why is it like this" has no answer here',
    });
  }

  return gaps;
}

/** Compose a resume report. Never throws. */
export function composeResume(input: ResumeInput): ResumeReport {
  const checkpointAgeDays = ageDays(input.checkpointWrittenAt, input.now);
  return {
    name: input.name,
    path: input.path,
    branch: input.git.available ? input.git.branch : undefined,
    dirtyFiles: input.git.dirtyFiles,
    checkpoint: input.checkpoint,
    checkpointAgeDays,
    recentDecisions: input.decisions.recent,
    program: input.program,
    gaps: gapsOf(input, checkpointAgeDays),
  };
}
