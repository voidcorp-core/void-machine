// What the remote actually says, after a crash or in a new session.
//
// A run resumes by reading GitHub, never by trusting the cursor it left behind.
// The failure this module exists to prevent is the cheerful one: a session comes
// back, cannot find its pull request, and concludes the work landed. An absent
// pull request is an absence. A closed one is a refusal. Only a merge commit is
// a merge.
//
// The order of the questions is itself load-bearing:
//
//   1. Is this even our pull request? A different head or base means we are
//      looking at someone else's work and every later answer would be about it.
//   2. Is it already over? Merged and closed both end the publication loop, and
//      neither is affected by drift below.
//   3. Did the base move? Then the proofs describe a tree that no longer exists,
//      and the rebase decides the head — so drift outranks a diverged head.
//   4. Does the remote carry our tree? If not, push again before reading checks
//      that ran on something else.
//   5. Only then, the checks.
//
// Pure. It observes nothing; the skill hands it a reading and applies the answer.

import { autopilotFailure } from './errors.js';
import { type ObservedCheck, planCheckResponse } from './publish-plan.js';
import type { BoundaryReading } from './transition-oracle.js';

export interface PullRequestObservation {
  readonly number: number;
  readonly state: 'open' | 'closed' | 'merged';
  /** Branch the pull request is built from. */
  readonly headRef: string;
  readonly headSha: string;
  readonly baseRef: string;
  /** Tip of the base branch as observed, used to detect drift. */
  readonly baseSha: string;
  /** Commit the merge produced, null unless GitHub reports one. */
  readonly mergeSha: string | null;
  readonly checks: readonly ObservedCheck[];
}

export interface RecoveryExpectation {
  readonly integrationBranch: string;
  /** Local head of the integration branch. */
  readonly integrationSha: string;
  readonly baseBranch: string;
  /** Base tip the run was leased against and proved on. */
  readonly baseSha: string;
}

export interface RecoveryInput {
  readonly expected: RecoveryExpectation;
  readonly pullRequest: BoundaryReading<PullRequestObservation>;
}

export type RecoveryKind =
  /** No pull request exists yet; publish. */
  | 'publish'
  /** The pull request exists but the remote head lags; push the same branch. */
  | 'republish'
  /** The base moved; rebase, reconcile again, re-run the whole suite. */
  | 'rebase'
  | 'await-checks'
  | 'fix-checks'
  /** Green and waiting for the human merge. */
  | 'ready'
  | 'merged'
  /** Something a run may not decide on its own. */
  | 'blocked'
  /** The reading was not complete enough to act on. */
  | 'observe-again';

export interface RecoveryVerdict {
  readonly kind: RecoveryKind;
  readonly detail: string;
  readonly pullRequestNumber: number | null;
  /** Set only by `merged`, and only from an observed merge commit. */
  readonly mergeSha: string | null;
  /** True when the local proofs no longer describe the tree to publish. */
  readonly staleProofs: boolean;
}

const SHA = /^[0-9a-f]{40}$/;

function short(sha: string): string {
  return sha.slice(0, 12);
}

export function recoverRemote(input: RecoveryInput): RecoveryVerdict {
  const { expected } = input;
  for (const [field, value] of [
    ['integrationSha', expected.integrationSha],
    ['baseSha', expected.baseSha],
  ] as const) {
    if (!SHA.test(value)) {
      throw autopilotFailure(
        'AUTOPILOT_CONTRACT',
        'recovery was asked to compare against something that is not a commit',
        `\`expected.${field}\` is ${JSON.stringify(value)}`,
        'resolve both the integration branch and the base to full commit ids before recovering',
      );
    }
  }

  const verdict = (
    kind: RecoveryKind,
    detail: string,
    over: Partial<RecoveryVerdict> = {},
  ): RecoveryVerdict => ({
    kind,
    detail,
    pullRequestNumber: null,
    mergeSha: null,
    staleProofs: false,
    ...over,
  });

  const reading = input.pullRequest;
  switch (reading.kind) {
    case 'nil':
    case 'empty':
      // Not "it merged and disappeared": nothing was observed, so nothing was
      // published, and publishing is idempotent against an existing request.
      return verdict('publish', 'no pull request was observed for this branch; publish one');
    case 'error':
      return verdict('blocked', `the pull request boundary failed: ${reading.detail}`);
    case 'contradiction':
      return verdict('blocked', `the pull request boundary contradicted itself: ${reading.detail}`);
    case 'partial':
      return verdict(
        'observe-again',
        `the pull request boundary answered only partially (${reading.detail}); read it again before acting`,
      );
    default:
      break;
  }

  const pr = reading.value;
  const on = { pullRequestNumber: pr.number };

  if (pr.headRef !== expected.integrationBranch) {
    return verdict(
      'blocked',
      `the observed pull request is built from \`${pr.headRef}\`, not from \`${expected.integrationBranch}\`; it is not this run's`,
      on,
    );
  }
  if (pr.baseRef !== expected.baseBranch) {
    return verdict(
      'blocked',
      `the observed pull request targets \`${pr.baseRef}\` while this run was leased against \`${expected.baseBranch}\``,
      on,
    );
  }

  if (pr.state === 'merged') {
    if (pr.mergeSha === null || !SHA.test(pr.mergeSha)) {
      return verdict(
        'blocked',
        'the pull request reports merged without a merge commit; a state without its proof is a contradiction, not a merge',
        on,
      );
    }
    const failed = pr.checks.filter(
      (check) => check.required && !['success', 'skipped', 'neutral'].includes(check.conclusion),
    );
    if (failed.length > 0) {
      return verdict(
        'blocked',
        `the pull request merged while ${failed
          .map((check) => check.name)
          .join(', ')} was not green; report it rather than close the tickets on it`,
        on,
      );
    }
    return verdict('merged', `merged as ${short(pr.mergeSha)}`, { ...on, mergeSha: pr.mergeSha });
  }

  if (pr.state === 'closed') {
    return verdict(
      'blocked',
      `pull request #${pr.number} was closed without merging; reopen it or abort the run, but nothing here is done`,
      on,
    );
  }

  if (pr.baseSha !== expected.baseSha) {
    return verdict(
      'rebase',
      `\`${expected.baseBranch}\` moved from ${short(expected.baseSha)} to ${short(pr.baseSha)}; rebase, reconcile again and re-run the whole suite`,
      { ...on, staleProofs: true },
    );
  }

  if (pr.headSha !== expected.integrationSha) {
    return verdict(
      'republish',
      `the remote head is ${short(pr.headSha)} while the integration branch is at ${short(expected.integrationSha)}; push the same branch again`,
      on,
    );
  }

  const response = planCheckResponse(pr.checks);
  switch (response.action) {
    case 'fix':
      return verdict('fix-checks', response.detail, on);
    case 'escalate':
      return verdict('blocked', response.detail, on);
    case 'wait':
      return verdict('await-checks', response.detail, on);
    default:
      return verdict('ready', response.detail, on);
  }
}
