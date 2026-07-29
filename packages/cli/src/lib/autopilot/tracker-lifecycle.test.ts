import { describe, expect, it } from 'vitest';
import {
  planTrackerLifecycle,
  reconcileLifecycle,
  type LifecycleInput,
  type LifecycleTicket,
} from './tracker-lifecycle.js';

const MERGE = '00000000000000000000000000000000000000c0';

/** `exactOptionalPropertyTypes` is on, so an override must be able to say "absent". */
type Loose<T> = { [K in keyof T]?: T[K] | undefined };

function ticket(over: Loose<LifecycleTicket> & { id: string }): LifecycleTicket {
  const merged = { disposition: 'included', state: 'In Progress', range: '0000000000a0..0000000000a1', ...over };
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as unknown as LifecycleTicket;
}

function input(over: Partial<LifecycleInput> = {}): LifecycleInput {
  return {
    stage: 'published',
    runId: 'run-a',
    states: { review: 'In Review', done: 'Done' },
    pullRequest: { number: 7, url: 'https://github.com/o/r/pull/7' },
    mergeSha: null,
    tickets: [
      ticket({ id: 'DEV-1' }),
      ticket({ id: 'DEV-2' }),
    ],
    ...over,
  };
}

function transitions(plan: ReturnType<typeof planTrackerLifecycle>): string[] {
  return plan.actions
    .filter((action) => action.kind === 'set-state')
    .map((action) => `${action.ticketId}->${action.toState}`);
}

describe('planTrackerLifecycle at publication', () => {
  it('moves only the included tickets to review, with the pull request and their range', () => {
    const plan = planTrackerLifecycle(input());

    expect(transitions(plan)).toEqual(['DEV-1->In Review', 'DEV-2->In Review']);
    const comment = plan.actions.find((action) => action.kind === 'comment' && action.ticketId === 'DEV-1');
    expect(comment?.body).toContain('https://github.com/o/r/pull/7');
    expect(comment?.body).toContain('0000000000a0..0000000000a1');
  });

  it('never transitions an excluded ticket, and says why and how to resume it', () => {
    const plan = planTrackerLifecycle(
      input({
        tickets: [
          ticket({ id: 'DEV-1' }),
          ticket({
            id: 'DEV-3',
            disposition: 'excluded',
            range: undefined,
            cause: 'its range carried a commit the worker never declared',
            resume: 'rerun DEV-3 from a clean worktree',
          }),
        ],
      }),
    );

    expect(transitions(plan)).toEqual(['DEV-1->In Review']);
    const comment = plan.actions.find((action) => action.ticketId === 'DEV-3');
    expect(comment?.kind).toBe('comment');
    expect(comment?.body).toContain('never declared');
    expect(comment?.body).toContain('rerun DEV-3 from a clean worktree');
  });

  it('refuses to move anything to review without the pull request it would link', () => {
    expect(() => planTrackerLifecycle(input({ pullRequest: null }))).toThrow(/AUTOPILOT_CONTRACT/);
  });

  it('skips a ticket that already sits in the target state instead of writing again', () => {
    const plan = planTrackerLifecycle(
      input({ tickets: [ticket({ id: 'DEV-1', state: 'In Review' }), ticket({ id: 'DEV-2' })] }),
    );

    expect(transitions(plan)).toEqual(['DEV-2->In Review']);
    expect(plan.skipped).toContainEqual({
      ticketId: 'DEV-1',
      kind: 'set-state',
      why: 'the ticket already sits in `In Review`',
    });
  });
});

describe('planTrackerLifecycle after a merge', () => {
  const merged = (over: Partial<LifecycleInput> = {}): LifecycleInput =>
    input({ stage: 'merged', mergeSha: MERGE, tickets: [ticket({ id: 'DEV-1', state: 'In Review' })], ...over });

  it('closes only the included tickets, naming the merge commit', () => {
    const plan = planTrackerLifecycle(merged());

    expect(transitions(plan)).toEqual(['DEV-1->Done']);
    expect(plan.actions.find((action) => action.kind === 'comment')?.body).toContain(MERGE.slice(0, 12));
  });

  it('refuses to close anything without an observed merge commit', () => {
    expect(() => planTrackerLifecycle(merged({ mergeSha: null }))).toThrow(/AUTOPILOT_CONTRACT/);
  });

  it('leaves an excluded ticket exactly where it is', () => {
    const plan = planTrackerLifecycle(
      merged({
        tickets: [
          ticket({ id: 'DEV-1', state: 'In Review' }),
          ticket({ id: 'DEV-3', disposition: 'excluded', state: 'In Progress', cause: 'suite red', resume: 'rerun it' }),
        ],
      }),
    );

    expect(transitions(plan)).toEqual(['DEV-1->Done']);
    expect(plan.actions.some((action) => action.ticketId === 'DEV-3' && action.kind === 'set-state')).toBe(false);
  });
});

describe('planTrackerLifecycle on abort', () => {
  it('releases every lease, comments the resume trail, and moves no ticket forward', () => {
    const plan = planTrackerLifecycle(input({ stage: 'aborted' }));

    expect(transitions(plan)).toEqual([]);
    expect(plan.actions.filter((action) => action.kind === 'release-lease').map((a) => a.ticketId)).toEqual([
      'DEV-1',
      'DEV-2',
    ]);
    expect(plan.actions.find((action) => action.kind === 'comment')?.body).toMatch(/resume/i);
  });

  it('needs no pull request, because aborting is not publishing', () => {
    expect(() => planTrackerLifecycle(input({ stage: 'aborted', pullRequest: null }))).not.toThrow();
  });
});

describe('idempotency keys', () => {
  it('derives every key from the run, the ticket, the stage and the action', () => {
    const plan = planTrackerLifecycle(input());
    const keys = plan.actions.map((action) => action.idempotencyKey);

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => key.startsWith('run-a:'))).toBe(true);
  });

  it('produces the same keys when the same stage is replanned', () => {
    expect(planTrackerLifecycle(input()).actions.map((a) => a.idempotencyKey)).toEqual(
      planTrackerLifecycle(input()).actions.map((a) => a.idempotencyKey),
    );
  });
});

describe('reconcileLifecycle', () => {
  it('converges only when every planned action was applied', () => {
    const plan = planTrackerLifecycle(input());
    const all = plan.actions.map((action) => ({ idempotencyKey: action.idempotencyKey, ok: true }));

    expect(reconcileLifecycle(plan, all)).toMatchObject({ converged: true, pending: [] });
  });

  it('keeps a partial write pending rather than calling the run synced', () => {
    const plan = planTrackerLifecycle(input());
    const applied = plan.actions
      .slice(0, 1)
      .map((action) => ({ idempotencyKey: action.idempotencyKey, ok: true }));

    const outcome = reconcileLifecycle(plan, applied);
    expect(outcome.converged).toBe(false);
    expect(outcome.pending).toHaveLength(plan.actions.length - 1);
    expect(outcome.detail).toMatch(/tracker-reconciliation/);
  });

  it('treats a write that came back failed as not applied', () => {
    const plan = planTrackerLifecycle(input());
    const applied = plan.actions.map((action) => ({ idempotencyKey: action.idempotencyKey, ok: false }));

    expect(reconcileLifecycle(plan, applied).converged).toBe(false);
  });

  it('ignores a receipt for an action nobody planned instead of counting it', () => {
    const plan = planTrackerLifecycle(input());
    const applied = [
      ...plan.actions.map((action) => ({ idempotencyKey: action.idempotencyKey, ok: true })),
      { idempotencyKey: 'run-a:DEV-9:set-state:published', ok: true },
    ];

    const outcome = reconcileLifecycle(plan, applied);
    expect(outcome.converged).toBe(true);
    expect(outcome.unexpected).toEqual(['run-a:DEV-9:set-state:published']);
  });
});
