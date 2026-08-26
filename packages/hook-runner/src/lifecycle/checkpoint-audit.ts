import type { Checkpoint } from '@voidcorp/mission-engine/session';

export interface CheckpointAuditInput {
  readonly now: number;
  readonly checkpoint: Pick<Checkpoint, 'isEmpty'> &
    Partial<Pick<Checkpoint, 'branch' | 'head'>> | undefined;
  readonly checkpointWrittenAt?: number;
  readonly git: {
    readonly branch?: string;
    readonly head?: string;
  };
}

export interface CheckpointAudit {
  readonly status: 'ok' | 'degraded';
  readonly reasons: readonly string[];
}

const DAY_MS = 86_400_000;
const STALE_DAYS = 7;

export function auditCheckpoint(input: CheckpointAuditInput): CheckpointAudit {
  const reasons: string[] = [];
  if (input.checkpoint === undefined) reasons.push('checkpoint-absent');
  else if (input.checkpoint.isEmpty) reasons.push('checkpoint-empty');

  if (
    input.checkpoint !== undefined
    && input.checkpointWrittenAt !== undefined
    && Math.max(0, input.now - input.checkpointWrittenAt) > STALE_DAYS * DAY_MS
  ) {
    reasons.push('checkpoint-stale');
  }
  if (
    input.checkpoint?.branch !== undefined
    && input.git.branch !== undefined
    && input.checkpoint.branch !== input.git.branch
  ) {
    reasons.push('checkpoint-branch-moved');
  }
  if (
    input.checkpoint?.head !== undefined
    && input.git.head !== undefined
    && input.checkpoint.head !== input.git.head
  ) {
    reasons.push('checkpoint-head-moved');
  }
  return reasons.length === 0
    ? { status: 'ok', reasons }
    : { status: 'degraded', reasons };
}
