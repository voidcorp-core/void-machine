// A fingerprint of the Git state every worker of a repository shares.
//
// A worktree isolates the working tree, the index and HEAD, and nothing else.
// The local config (with every file it includes), the stash, tags, notes,
// remotes, the local refs of the base branches, replacement refs, and the hooks
// and info directories of the common Git directory are one set for the whole
// repository. A unit that wrote there changed what every neighbour runs against,
// whatever its own diff looks like (DEV-858). The loop fingerprints that set
// before a unit starts and refuses to publish the unit if it changed.
//
// Digests only, never content: the local config can hold a credential in a
// remote URL, and a record that kept it would carry it to disk. Pure: hashing is
// deterministic and touches nothing; reading git is the adapter's job.

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Admission } from './judgments.js';

export const SHARED_STATE_PARTS = [
  'config',
  'stash',
  'tags',
  'notes',
  'remotes',
  'bases',
  'replace',
  'hooks',
  'info',
] as const;
export type SharedStatePart = (typeof SHARED_STATE_PARTS)[number];

/** What git printed for each shared part, as the adapter read it. */
export type SharedStateReading = Readonly<Record<SharedStatePart, string>>;

const digest = z.string().regex(/^[0-9a-f]{64}$/, { error: 'must be a sha256 digest' });

/** The loop's bases and the branch that deploys: two or three names. */
const PROTECTED_BRANCHES_MAX = 8;

export const fingerprintSchema = z.strictObject({
  schemaVersion: z.literal(4),
  /** The branches whose settings the digest keeps whole; every other upstream is left out. */
  protectedBranches: z.array(z.string().min(1).max(255)).min(1).max(PROTECTED_BRANCHES_MAX),
  digests: z.strictObject({
    config: digest,
    stash: digest,
    tags: digest,
    notes: digest,
    remotes: digest,
    bases: digest,
    replace: digest,
    hooks: digest,
    info: digest,
  }),
});

export const retainedFingerprintSchema = fingerprintSchema.extend({ schemaVersion: z.union([z.literal(3), z.literal(4)]) });
export type SharedFingerprint = z.infer<typeof retainedFingerprintSchema>;

/**
 * `branch.<name>.remote` and `.merge` are the upstream of a branch. Units in
 * flight write them for their own branches (`worktree add -b` from a remote
 * base, `push -u`) and remove them with a merged ticket's branch, so counting
 * them for every branch would let each unit refuse all the others. They are left
 * out for every branch but the protected ones: the same keys on a base make its
 * next pull merge a worker's branch. Every other branch setting stays, since it
 * changes what a neighbour's command does. `git config --list` prints the
 * section and the key in lower case and the branch name as written.
 */
function sharedConfig(config: string, protectedBranches: readonly string[]): string {
  return config
    .split('\n')
    .filter((line) => {
      const equals = line.indexOf('=');
      const key = equals === -1 ? line : line.slice(0, equals);
      const branch = /^branch\.(.+)\.(?:remote|merge)$/.exec(key)?.[1];
      return branch === undefined || protectedBranches.includes(branch);
    })
    .join('\n');
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The digests of a reading, leaving out the upstream of every unprotected branch. */
export function fingerprintOf(
  reading: SharedStateReading,
  protectedBranches: readonly string[],
  schemaVersion: 3 | 4 = 4,
): SharedFingerprint {
  return {
    schemaVersion,
    protectedBranches: [...protectedBranches],
    digests: {
      config: sha256(sharedConfig(reading.config, protectedBranches)),
      stash: sha256(reading.stash),
      tags: sha256(reading.tags),
      notes: sha256(reading.notes),
      remotes: sha256(reading.remotes),
      bases: sha256(reading.bases),
      replace: sha256(reading.replace),
      hooks: sha256(reading.hooks),
      info: sha256(reading.info),
    },
  };
}

/** The parts whose digest differs, in declaration order; empty means untouched. */
export function changedParts(
  before: SharedFingerprint,
  after: SharedFingerprint,
): SharedStatePart[] {
  if (before.schemaVersion !== after.schemaVersion) return [...SHARED_STATE_PARTS];
  return SHARED_STATE_PARTS.filter((part) => before.digests[part] !== after.digests[part]);
}

/** A fingerprint read back from its record: exactly the digests, nothing else. */
export function admitFingerprint(value: unknown): Admission<SharedFingerprint> {
  const parsed = retainedFingerprintSchema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  return { ok: false, reason: `shared state fingerprint refused: ${issues.join('; ')}` };
}
