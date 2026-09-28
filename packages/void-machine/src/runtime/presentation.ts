// tdd-cover: e2e packages/void-machine/test/agents-presentation.test.ts
import type { SurfaceCause, SurfaceKind, SurfaceRole } from '../core/presentation.js';

/**
 * The presentation port: a multiplexer opens a surface that runs a display command, labels it,
 * says whether it is still there, and closes it. It knows no agent and decides no state; every
 * answer is a value, so a multiplexer that fails never fails the run it would have shown.
 */

export interface SurfaceView {
  /** The run shown, stamped on the surface so that only its owner ever closes it. */
  readonly runId: string;
  readonly role: SurfaceRole;
  readonly ticket: string | undefined;
  readonly cwd: string;
  /** The runtime's display command, as argv. */
  readonly command: readonly string[];
}

export interface SurfaceRef {
  readonly kind: SurfaceKind;
  /** The multiplexer server the surface lives on: its socket, never the environment of a later call. */
  readonly scope: string;
  /** The workspace the surface was opened in, when the multiplexer has one. */
  readonly container?: string;
  readonly id: string;
  /** `WORK-n` or `REVIEW-n`, chosen by the adapter against the labels already shown. */
  readonly label: string;
  readonly runId: string;
}

export type SurfaceOpening =
  | { readonly ok: true; readonly ref: SurfaceRef }
  /** `orphan` is a surface created before the failure that could not be closed again. */
  | { readonly ok: false; readonly cause: SurfaceCause; readonly orphan?: SurfaceRef };

/**
 * `closed` only when the multiplexer answered without the surface; `foreign` when the id now
 * shows something that does not carry this run's marker; `unknown` when nothing answered.
 */
export type SurfacePresence =
  | { readonly state: 'open' | 'closed' | 'foreign' }
  | { readonly state: 'unknown'; readonly cause: SurfaceCause };

export type SurfaceClosing =
  | { readonly outcome: 'closed' | 'already-absent' }
  | { readonly outcome: 'skipped' | 'failed'; readonly cause: SurfaceCause };

export interface SurfacePort {
  readonly kind: SurfaceKind | 'none';
  open(view: SurfaceView): Promise<SurfaceOpening>;
  inspect(ref: SurfaceRef): Promise<SurfacePresence>;
  /** Closes only a surface that still carries the ref's label and run marker. */
  close(ref: SurfaceRef): Promise<SurfaceClosing>;
}

/** What a run's surface became, persisted beside the run. */
export type SurfaceRecord =
  | { readonly state: 'opening'; readonly at: number }
  | { readonly state: 'open'; readonly ref: SurfaceRef; readonly lastClose?: SurfaceClosing }
  | { readonly state: 'closed'; readonly ref: SurfaceRef; readonly outcome: 'closed' | 'already-absent' }
  | { readonly state: 'none'; readonly cause: SurfaceCause }
  | { readonly state: 'failed'; readonly cause: SurfaceCause; readonly orphan?: SurfaceRef };

/** The surface a record still holds on screen, if any: an open one, or the orphan of a failed open. */
export function heldSurface(record: SurfaceRecord | undefined): SurfaceRef | undefined {
  if (record?.state === 'open') return record.ref;
  return record?.state === 'failed' ? record.orphan : undefined;
}
