// When a proof stops proving anything.
//
// A verification is a claim about a specific tree: this command, on this
// integration SHA, over this diff. Change any of the three and the claim is
// about something that no longer exists. Reusing it is how a run publishes a
// branch whose suite was last green before a rebase.
//
// So proofs are bound, not stored. Every one carries the integration SHA it ran
// against, a hash of the diff it covered, and the exact argv. Freshness is
// recomputed rather than remembered, because a stale flag is itself a thing
// that can go stale.
//
// Bias: anything unrecognised is stale. A proof wrongly re-run costs minutes; a
// stale proof wrongly trusted costs the guarantee the whole range exists for.

export interface VerificationProof {
  readonly name: string;
  /** argv that produced it, run with shell:false. */
  readonly command: readonly string[];
  /** Integration SHA the command ran against. */
  readonly integrationSha: string;
  /** Hash of the diff the proof covers. */
  readonly diffHash: string;
  /** sha256 of the command output. */
  readonly outputHash: string;
  readonly passed: boolean;
}

export interface ProofContext {
  readonly integrationSha: string;
  readonly diffHash: string;
  /** Commands the current verification plan requires. */
  readonly requiredCommands: readonly (readonly string[])[];
}

export type StaleReason =
  | 'integration-moved'
  | 'diff-changed'
  | 'command-changed'
  | 'failed'
  | 'malformed';

export interface ProofStatus {
  readonly name: string;
  readonly fresh: boolean;
  readonly reason?: StaleReason;
  readonly detail?: string;
}

export interface ProofAssessment {
  readonly schemaVersion: 1;
  readonly statuses: readonly ProofStatus[];
  /** Commands the plan requires that have no fresh passing proof. */
  readonly missing: readonly (readonly string[])[];
  /** True only when every required command has a fresh passing proof. */
  readonly sealed: boolean;
}

const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;

function sameCommand(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((word, index) => word === b[index]);
}

function assess(proof: VerificationProof, context: ProofContext): ProofStatus {
  const wellFormed =
    typeof proof?.name === 'string' &&
    proof.name.trim() !== '' &&
    Array.isArray(proof.command) &&
    proof.command.length > 0 &&
    proof.command.every((word) => typeof word === 'string') &&
    SHA.test(proof.integrationSha) &&
    HASH.test(proof.diffHash) &&
    HASH.test(proof.outputHash) &&
    typeof proof.passed === 'boolean';
  if (!wellFormed) {
    return { name: proof?.name ?? '', fresh: false, reason: 'malformed', detail: 'the proof does not match the contract' };
  }

  if (!proof.passed) {
    return { name: proof.name, fresh: false, reason: 'failed', detail: 'the command did not pass' };
  }
  if (proof.integrationSha !== context.integrationSha) {
    return {
      name: proof.name,
      fresh: false,
      reason: 'integration-moved',
      detail: `proved against ${proof.integrationSha}, now at ${context.integrationSha}`,
    };
  }
  if (proof.diffHash !== context.diffHash) {
    return {
      name: proof.name,
      fresh: false,
      reason: 'diff-changed',
      detail: 'the diff the proof covered is not the diff being published',
    };
  }
  if (!context.requiredCommands.some((required) => sameCommand(required, proof.command))) {
    return {
      name: proof.name,
      fresh: false,
      reason: 'command-changed',
      detail: `\`${proof.command.join(' ')}\` is not a command the current plan requires`,
    };
  }
  return { name: proof.name, fresh: true };
}

/** Recompute which proofs still hold, and whether publication may proceed. */
export function assessProofs(
  proofs: readonly VerificationProof[],
  context: ProofContext,
): ProofAssessment {
  const statuses = proofs.map((proof) => assess(proof, context));

  const proven = proofs.filter((_, index) => statuses[index]?.fresh === true);
  const missing = context.requiredCommands.filter(
    (required) => !proven.some((proof) => sameCommand(required, proof.command)),
  );

  return {
    schemaVersion: 1,
    statuses,
    missing,
    // Sealed means every required command has a fresh passing proof — not that
    // nothing failed. An absent proof and a red one both block publication.
    sealed: missing.length === 0 && context.requiredCommands.length > 0,
  };
}
