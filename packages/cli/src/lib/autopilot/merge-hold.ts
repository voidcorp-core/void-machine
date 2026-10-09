// The human hold on merges: the one instruction a person gives the loop about
// who merges, written by `autopilot merges --by-human` and removed by
// `--automatic`.
//
// It lives in the machine's local state, not in `.void/program.md`: the
// programme is protected and versioned, so a hold written there would take
// effect only once a person merged a pull request carrying it, and a dirty tree
// would block the `--ff-only` synchronization. It is read on every tick, so it
// never depends on what an agent remembers.
//
// A hold only ever takes authority away. Anything but a clean absence reads as
// a hold: a damaged or unreadable file keeps the merges a person's.

import { join } from 'node:path';
import { z } from 'zod';

export const MERGE_HOLD_PATH = join('.void', 'machine', 'autopilot', 'merge-hold.json');

export type MergeHold = { readonly held: false } | { readonly held: true; readonly detail: string };

/** What the command read: no file, its text, or why it could not be opened. */
export type MergeHoldReading =
  | { readonly kind: 'absent' }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'unreadable'; readonly cause: string };

const mergeHoldSchema = z.strictObject({
  schemaVersion: z.literal(1),
  mergedBy: z.literal('human'),
  since: z.iso.datetime(),
});

/** The record `merges --by-human` writes. */
export function mergeHoldRecord(since: string): string {
  return `${JSON.stringify(mergeHoldSchema.parse({ schemaVersion: 1, mergedBy: 'human', since }))}\n`;
}

function damaged(cause: string): MergeHold {
  return { held: true, detail: `${MERGE_HOLD_PATH} is unreadable (${cause}), so the merges stay a person's` };
}

/** Pure: the hold a reading states, a hold whenever it cannot say otherwise. */
export function parseMergeHold(reading: MergeHoldReading): MergeHold {
  if (reading.kind === 'absent') return { held: false };
  if (reading.kind === 'unreadable') return damaged(reading.cause);
  let value: unknown;
  try {
    value = JSON.parse(reading.text);
  } catch {
    return damaged('not JSON');
  }
  const parsed = mergeHoldSchema.safeParse(value);
  if (!parsed.success) return damaged('not the record `autopilot merges --by-human` writes');
  return { held: true, detail: `a person holds the merges since ${parsed.data.since}` };
}
