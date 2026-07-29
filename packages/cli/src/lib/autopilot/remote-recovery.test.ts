import { describe, expect, it } from 'vitest';
import type { ObservedCheck } from './publish-plan.js';
import {
  recoverRemote,
  type PullRequestObservation,
  type RecoveryInput,
} from './remote-recovery.js';
import type { BoundaryReading } from './transition-oracle.js';

const HEAD = '00000000000000000000000000000000000000aa';
const OLD_HEAD = '00000000000000000000000000000000000000ab';
const BASE = '00000000000000000000000000000000000000b0';
const MOVED_BASE = '00000000000000000000000000000000000000b1';
const MERGE = '00000000000000000000000000000000000000c0';

const green: ObservedCheck[] = [
  { name: 'validate', required: true, conclusion: 'success', ownedByDiff: true },
];

function observation(over: Partial<PullRequestObservation> = {}): PullRequestObservation {
  return {
    number: 7,
    state: 'open',
    headRef: 'autopilot/cluster-1',
    headSha: HEAD,
    baseRef: 'main',
    baseSha: BASE,
    mergeSha: null,
    checks: green,
    ...over,
  };
}

function input(over: Partial<RecoveryInput> = {}): RecoveryInput {
  return {
    expected: {
      integrationBranch: 'autopilot/cluster-1',
      integrationSha: HEAD,
      baseBranch: 'main',
      baseSha: BASE,
    },
    pullRequest: { kind: 'value', value: observation() },
    ...over,
  };
}

function withPr(
  reading: BoundaryReading<PullRequestObservation>,
  over: Partial<RecoveryInput> = {},
): RecoveryInput {
  return input({ pullRequest: reading, ...over });
}

describe('recoverRemote', () => {
  it('publishes when the remote holds no pull request for this branch', () => {
    const verdict = recoverRemote(withPr({ kind: 'nil' }));

    expect(verdict.kind).toBe('publish');
  });

  it('never reads an absent pull request as a merge', () => {
    for (const reading of [{ kind: 'nil' } as const, { kind: 'empty' } as const]) {
      expect(recoverRemote(withPr(reading)).kind).not.toBe('merged');
    }
  });

  it('refuses to act on a boundary that failed or contradicted itself', () => {
    expect(recoverRemote(withPr({ kind: 'error', detail: 'gh: 502' })).kind).toBe('blocked');
    expect(recoverRemote(withPr({ kind: 'contradiction', detail: 'state and merge sha disagree' })).kind).toBe(
      'blocked',
    );
    expect(recoverRemote(withPr({ kind: 'partial', detail: 'checks not read' })).kind).toBe('observe-again');
  });

  it('refuses a pull request that does not come from our integration branch', () => {
    const verdict = recoverRemote(
      withPr({ kind: 'value', value: observation({ headRef: 'someone/else' }) }),
    );

    expect(verdict.kind).toBe('blocked');
    expect(verdict.detail).toMatch(/someone\/else/);
  });

  it('refuses a pull request aimed at another base', () => {
    const verdict = recoverRemote(
      withPr({ kind: 'value', value: observation({ baseRef: 'develop' }) }),
    );

    expect(verdict.kind).toBe('blocked');
    expect(verdict.detail).toMatch(/develop/);
  });

  it('reports a merge only with the merge commit that proves it', () => {
    const verdict = recoverRemote(
      withPr({ kind: 'value', value: observation({ state: 'merged', mergeSha: MERGE }) }),
    );

    expect(verdict).toMatchObject({ kind: 'merged', mergeSha: MERGE });
  });

  it('treats a merged state without a merge commit as a contradiction, not as a merge', () => {
    const verdict = recoverRemote(
      withPr({ kind: 'value', value: observation({ state: 'merged', mergeSha: null }) }),
    );

    expect(verdict.kind).toBe('blocked');
    expect(verdict.detail).toMatch(/merge commit/i);
  });

  it('escalates a merge that landed with a required check not green', () => {
    const verdict = recoverRemote(
      withPr({
        kind: 'value',
        value: observation({
          state: 'merged',
          mergeSha: MERGE,
          checks: [{ name: 'validate', required: true, conclusion: 'failure', ownedByDiff: true }],
        }),
      }),
    );

    expect(verdict.kind).toBe('blocked');
    expect(verdict.detail).toMatch(/validate/);
  });

  it('never turns a closed pull request into a merged one', () => {
    const verdict = recoverRemote(withPr({ kind: 'value', value: observation({ state: 'closed' }) }));

    expect(verdict.kind).toBe('blocked');
    expect(verdict.detail).toMatch(/closed/);
  });

  it('rebases and re-proves when the base branch moved under the run', () => {
    const verdict = recoverRemote(
      withPr({ kind: 'value', value: observation({ baseSha: MOVED_BASE }) }),
    );

    expect(verdict.kind).toBe('rebase');
    expect(verdict.staleProofs).toBe(true);
    expect(verdict.detail).toMatch(/main/);
  });

  it('republishes when the remote head lags the local integration commit', () => {
    const verdict = recoverRemote(
      withPr({ kind: 'value', value: observation({ headSha: OLD_HEAD }) }),
    );

    expect(verdict.kind).toBe('republish');
    expect(verdict.detail).toContain(OLD_HEAD.slice(0, 12));
  });

  it('treats base drift ahead of a head that also diverged, because the rebase decides the head', () => {
    const verdict = recoverRemote(
      withPr({ kind: 'value', value: observation({ headSha: OLD_HEAD, baseSha: MOVED_BASE }) }),
    );

    expect(verdict.kind).toBe('rebase');
  });

  it('drives the checks once the remote matches the local tree', () => {
    expect(recoverRemote(input()).kind).toBe('ready');

    const pending = recoverRemote(
      withPr({
        kind: 'value',
        value: observation({
          checks: [{ name: 'validate', required: true, conclusion: 'pending', ownedByDiff: true }],
        }),
      }),
    );
    expect(pending.kind).toBe('await-checks');

    const red = recoverRemote(
      withPr({
        kind: 'value',
        value: observation({
          checks: [{ name: 'validate', required: true, conclusion: 'failure', ownedByDiff: true }],
        }),
      }),
    );
    expect(red.kind).toBe('fix-checks');
    expect(red.detail).toMatch(/validate/);
  });

  it('keeps the pull request number on every verdict that has one', () => {
    expect(recoverRemote(input()).pullRequestNumber).toBe(7);
    expect(recoverRemote(withPr({ kind: 'nil' })).pullRequestNumber).toBeNull();
  });

  it('rejects an expectation that is not a resolved commit', () => {
    expect(() =>
      recoverRemote(
        input({
          expected: {
            integrationBranch: 'autopilot/cluster-1',
            integrationSha: 'HEAD',
            baseBranch: 'main',
            baseSha: BASE,
          },
        }),
      ),
    ).toThrow(/AUTOPILOT_CONTRACT/);
  });
});
