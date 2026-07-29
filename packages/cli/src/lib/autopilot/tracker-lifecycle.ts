// Moving tickets, and the proof each move requires.
//
// The tracker is where the outside world reads what happened, so a wrong write
// here is worse than a missing one: a ticket marked Done is a ticket nobody
// looks at again. Each stage therefore demands its own evidence.
//
//   published — an open pull request to link. Included tickets go to review with
//               the request and their exact range; excluded ones are commented
//               and NOT moved. A ticket that did not land must not sit in a state
//               that says it is waiting to be merged.
//   merged    — an observed merge commit. Without it there is nothing to close on,
//               and inferring the merge is the failure this whole range exists to
//               prevent.
//   aborted   — nothing. Leases are released, the resume trail is written, and no
//               ticket moves forward. Giving a cluster back is not progress.
//
// Every action carries an idempotency key derived from the run, the ticket, the
// action and the stage. A tracker write can return unknown; the next attempt has
// to be recognisable as the same write rather than as a second one.
//
// Pure. It emits actions and judges receipts; the skill performs them.

import { autopilotFailure } from './errors.js';

export type TicketDisposition = 'included' | 'excluded';

export interface LifecycleTicket {
  readonly id: string;
  readonly disposition: TicketDisposition;
  /** Native state observed on the ticket right now. */
  readonly state: string;
  /** Commit range attributable to the ticket, for the included. */
  readonly range?: string;
  /** Why it was left out. */
  readonly cause?: string;
  /** What someone does to get it moving again. */
  readonly resume?: string;
}

export type LifecycleStage = 'published' | 'merged' | 'aborted';

export interface LifecycleInput {
  readonly stage: LifecycleStage;
  readonly runId: string;
  /** Native state names, from the active program. */
  readonly states: { readonly review: string; readonly done: string };
  readonly pullRequest: { readonly number: number; readonly url: string } | null;
  /** Observed merge commit; required to close anything. */
  readonly mergeSha?: string | null;
  readonly tickets: readonly LifecycleTicket[];
}

export type TrackerActionKind = 'set-state' | 'comment' | 'release-lease';

export interface TrackerAction {
  readonly ticketId: string;
  readonly kind: TrackerActionKind;
  readonly toState?: string;
  readonly body?: string;
  readonly idempotencyKey: string;
}

export interface SkippedAction {
  readonly ticketId: string;
  readonly kind: TrackerActionKind;
  readonly why: string;
}

export interface LifecyclePlan {
  readonly schemaVersion: 1;
  readonly stage: LifecycleStage;
  readonly actions: readonly TrackerAction[];
  readonly skipped: readonly SkippedAction[];
}

export interface ActionReceipt {
  readonly idempotencyKey: string;
  readonly ok: boolean;
}

export interface LifecycleReconciliation {
  readonly converged: boolean;
  /** Keys of actions with no successful receipt. */
  readonly pending: readonly string[];
  /** Receipts for actions this plan never contained. */
  readonly unexpected: readonly string[];
  readonly detail: string;
}

function keyOf(input: LifecycleInput, ticketId: string, kind: TrackerActionKind): string {
  return `${input.runId}:${ticketId}:${kind}:${input.stage}`;
}

export function planTrackerLifecycle(input: LifecycleInput): LifecyclePlan {
  const actions: TrackerAction[] = [];
  const skipped: SkippedAction[] = [];

  const included = input.tickets.filter((ticket) => ticket.disposition === 'included');
  const excluded = input.tickets.filter((ticket) => ticket.disposition === 'excluded');

  const transition = (ticket: LifecycleTicket, toState: string): void => {
    if (ticket.state === toState) {
      skipped.push({
        ticketId: ticket.id,
        kind: 'set-state',
        why: `the ticket already sits in \`${toState}\``,
      });
      return;
    }
    actions.push({
      ticketId: ticket.id,
      kind: 'set-state',
      toState,
      idempotencyKey: keyOf(input, ticket.id, 'set-state'),
    });
  };

  const comment = (ticketId: string, body: string): void => {
    actions.push({ ticketId, kind: 'comment', body, idempotencyKey: keyOf(input, ticketId, 'comment') });
  };

  if (input.stage === 'published') {
    if (input.pullRequest === null) {
      throw autopilotFailure(
        'AUTOPILOT_CONTRACT',
        'tickets cannot move to review without the pull request they would link',
        'the lifecycle was planned for the published stage with no pull request',
        'publish the integration branch first, then plan the tracker lifecycle from the observed request',
      );
    }
    const pr = input.pullRequest;
    for (const ticket of included) {
      transition(ticket, input.states.review);
      comment(
        ticket.id,
        [
          `Integrated into pull request #${pr.number} — ${pr.url}`,
          `Commit range: \`${ticket.range ?? 'unrecorded'}\``,
          'Merging is a human action; this ticket stays in review until the pull request lands.',
        ].join('\n'),
      );
    }
    for (const ticket of excluded) {
      // Deliberately no transition. A ticket that did not land keeps whatever
      // state it had, so nobody reads it as waiting on a merge that omits it.
      comment(
        ticket.id,
        [
          `Left out of pull request #${pr.number}.`,
          `Cause: ${ticket.cause ?? 'not recorded'}`,
          `Resume: ${ticket.resume ?? 'not recorded'}`,
        ].join('\n'),
      );
    }
    return { schemaVersion: 1, stage: input.stage, actions, skipped };
  }

  if (input.stage === 'merged') {
    const mergeSha = input.mergeSha ?? null;
    if (mergeSha === null || mergeSha === '') {
      throw autopilotFailure(
        'AUTOPILOT_CONTRACT',
        'tickets cannot be closed without an observed merge commit',
        'the lifecycle was planned for the merged stage with no merge sha',
        'observe the pull request until GitHub reports its merge commit, then plan this stage again',
      );
    }
    for (const ticket of included) {
      transition(ticket, input.states.done);
      comment(
        ticket.id,
        [
          `Merged as \`${mergeSha.slice(0, 12)}\`${
            input.pullRequest === null ? '' : ` through pull request #${input.pullRequest.number}`
          }.`,
          `Commit range: \`${ticket.range ?? 'unrecorded'}\``,
        ].join('\n'),
      );
    }
    // Excluded tickets get nothing here: they were already told at publication
    // why they were left out, and a merge that does not contain them is not news.
    return { schemaVersion: 1, stage: input.stage, actions, skipped };
  }

  for (const ticket of input.tickets) {
    actions.push({
      ticketId: ticket.id,
      kind: 'release-lease',
      idempotencyKey: keyOf(input, ticket.id, 'release-lease'),
    });
    comment(
      ticket.id,
      [
        `Run \`${input.runId}\` was aborted; the lease on this ticket is released.`,
        `State: ${ticket.state}. Nothing was deleted — the branch and its commits are preserved.`,
        `Resume: ${ticket.resume ?? 'plan a new cluster; this ticket is available again'}`,
      ].join('\n'),
    );
  }
  return { schemaVersion: 1, stage: input.stage, actions, skipped };
}

/**
 * Judge what the tracker actually accepted.
 *
 * A partial write is the dangerous case: half the cluster moved, and a run that
 * called itself synced would leave the rest silently behind. So convergence is
 * all-or-nothing, and what is left is named.
 */
export function reconcileLifecycle(
  plan: LifecyclePlan,
  receipts: readonly ActionReceipt[],
): LifecycleReconciliation {
  const succeeded = new Set(receipts.filter((receipt) => receipt.ok).map((receipt) => receipt.idempotencyKey));
  const planned = new Set(plan.actions.map((action) => action.idempotencyKey));

  const pending = plan.actions
    .map((action) => action.idempotencyKey)
    .filter((key) => !succeeded.has(key));
  const unexpected = receipts
    .map((receipt) => receipt.idempotencyKey)
    .filter((key) => !planned.has(key));

  return {
    converged: pending.length === 0,
    pending,
    unexpected,
    detail:
      pending.length === 0
        ? `every ${plan.stage} action was applied`
        : `${pending.length} ${plan.stage} action(s) did not converge; the run stays in tracker-reconciliation until they do`,
  };
}
