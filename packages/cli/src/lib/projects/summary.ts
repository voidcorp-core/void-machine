// One project, reduced to what answers "where should I put my attention?".
//
// Pure: callers gather the observations, this decides what they mean. Keeping
// the judgement here is what lets the CLI and the served view agree by
// construction instead of by discipline.
//
// There is deliberately NO health score. A percentage invites optimising the
// number, and a project at 94% tells nobody what to do. What earns a place is a
// named reason with the evidence behind it; severity orders the list and
// nothing aggregates it.

import type { DecisionsObservation } from './decisions-source.js';
import type { DiscoveredProject } from './discover.js';

export interface GitSignals {
  /** False when the directory is not a git repository, or git is unusable. */
  readonly available: boolean;
  readonly branch: string | undefined;
  readonly head?: string;
  readonly dirtyFiles: number;
  readonly unpushedCommits: number;
  readonly lastCommitAt: number | undefined;
  readonly commitsToday: number;
}

export interface ProgramSignal {
  readonly program: string;
  readonly provider: string | undefined;
  readonly unitCount: number;
}

export interface CheckpointSignal {
  /** The one line that says where the last session stopped. */
  readonly resumeLine: string;
  readonly writtenAt: number;
}

export interface SummaryInput {
  readonly ref: DiscoveredProject;
  /** Injected so the same input always yields the same summary. */
  readonly now: number;
  readonly git: GitSignals;
  readonly decisions: DecisionsObservation;
  readonly planCount: number;
  readonly program?: ProgramSignal;
  /** Absent until the session checkpoint ships. Absence is a fact, not a fault. */
  readonly checkpoint?: CheckpointSignal;
}

/**
 * Things that can be LOST. That is the whole membership rule, and it is what
 * keeps the list short enough to be read.
 */
export type AttentionReason = 'uncommitted-changes' | 'unpushed-commits';

/** Things that drifted from a convention. Real, but nothing is at risk today. */
export type ConformanceReason = 'decisions-drift';

export interface Attention {
  readonly reason: AttentionReason;
  readonly detail: string;
}

export interface Conformance {
  readonly reason: ConformanceReason;
  readonly detail: string;
}

export interface ProjectSummary {
  readonly name: string;
  readonly path: string;
  readonly branch: string | undefined;
  readonly dirtyFiles: number;
  readonly commitsToday: number;
  /** Whole days since the last commit. Absent when there is no git history. */
  readonly idleDays: number | undefined;
  readonly decisions: DecisionsObservation;
  readonly planCount: number;
  readonly program: ProgramSignal | undefined;
  readonly resumeLine: string | undefined;
  /** Ordered most severe first. Empty means nothing at risk here. */
  readonly attention: readonly Attention[];
  /** Convention drift. Shown, never counted as attention. */
  readonly conformance: readonly Conformance[];
}

const DAY_MS = 86_400_000;

/**
 * Severity order, and the reasoning behind it.
 *
 * Uncommitted work first: it exists only on this machine and only in this
 * checkout, so it is the one state that can be lost outright. Unpushed commits
 * next: they survive locally but nothing else can see them.
 *
 * Format drift is deliberately NOT here. Measured on the real park, it affects
 * 5 projects out of 8, so counting it flagged everything and the view stopped
 * telling anyone where to look. A signal that fires everywhere is not a signal.
 */
const SEVERITY: readonly AttentionReason[] = ['uncommitted-changes', 'unpushed-commits'];

function idleDaysOf(git: GitSignals, now: number): number | undefined {
  if (!git.available || git.lastCommitAt === undefined) return undefined;
  // A clock skew or a rewritten date must not read as negative time.
  return Math.max(0, Math.floor((now - git.lastCommitAt) / DAY_MS));
}

function attentionOf(input: SummaryInput): readonly Attention[] {
  const found: Attention[] = [];

  if (input.git.available && input.git.dirtyFiles > 0) {
    found.push({
      reason: 'uncommitted-changes',
      detail: `${String(input.git.dirtyFiles)} file(s) changed and not committed`,
    });
  }
  if (input.git.available && input.git.unpushedCommits > 0) {
    found.push({
      reason: 'unpushed-commits',
      detail: `${String(input.git.unpushedCommits)} commit(s) exist only on this machine`,
    });
  }
  return [...found].sort((a, b) => SEVERITY.indexOf(a.reason) - SEVERITY.indexOf(b.reason));
}

function conformanceOf(input: SummaryInput): readonly Conformance[] {
  if (input.decisions.liveMonolithEntries === 0) return [];
  return [{
    reason: 'decisions-drift',
    detail:
      `${String(input.decisions.liveMonolithEntries)} decision(s) still written into ` +
      'docs/DECISIONS.md, which is not the format the harness reads',
  }];
}

/** Reduce one project's observations to its summary. Never throws. */
export function summarizeProject(input: SummaryInput): ProjectSummary {
  return {
    name: input.ref.name,
    path: input.ref.path,
    branch: input.git.available ? input.git.branch : undefined,
    dirtyFiles: input.git.dirtyFiles,
    commitsToday: input.git.commitsToday,
    idleDays: idleDaysOf(input.git, input.now),
    decisions: input.decisions,
    planCount: input.planCount,
    program: input.program,
    resumeLine: input.checkpoint?.resumeLine,
    attention: attentionOf(input),
    conformance: conformanceOf(input),
  };
}
