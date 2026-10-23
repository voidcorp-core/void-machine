// tdd-cover: e2e packages/cli/src/lib/runs/usage-sessions.test.ts
import { canonicalJsonHash, type CanonicalEvent } from '@voidcorp/mission-engine';
import { z } from 'zod';

export const usageMissionId = z.string().regex(/^mis_[A-Za-z0-9_-]{8,100}$/);
const anchorSchema = z.strictObject({ seq: z.number().int().nonnegative(),
  eventId: z.string().regex(/^(?:origin|evt_[A-Za-z0-9_-]{8,100})$/),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/) });
const openingSchema = z.strictObject({ targetMissionId: usageMissionId, previous: anchorSchema });
const closingSchema = openingSchema.extend({ opening: anchorSchema });
export const usageReferenceSchema = z.strictObject({ sourceMissionId: usageMissionId, opening: anchorSchema });
export type UsageAnchor = z.infer<typeof anchorSchema>;
export interface UsageInterval {
  readonly targetMissionId: string;
  readonly opening: UsageAnchor;
  readonly closing?: UsageAnchor;
}
export const USAGE_SOURCE = 'void-harness:usage';
export const MAX_USAGE_LINKS = 32;
export const usageEventId = (...parts: readonly string[]): string => `evt_usage_${canonicalJsonHash(parts).slice(7)}`;
export const sameUsageAnchor = (left: UsageAnchor, right: UsageAnchor): boolean =>
  left.seq === right.seq && left.eventId === right.eventId && left.digest === right.digest;

/** Linear bounded hash chain: integrity checks, never authentication or runtime attestation. */
export function scanUsageSource(events: readonly CanonicalEvent[], sourceMissionId: string): {
  readonly prefix: UsageAnchor;
  readonly intervals: ReadonlyMap<string, UsageInterval>;
  readonly active?: UsageInterval;
} {
  let prefix: UsageAnchor = { seq: 0, eventId: 'origin', digest: canonicalJsonHash([]) };
  let active: UsageInterval | undefined;
  const intervals = new Map<string, UsageInterval>();
  const seen = new Set<string>();
  for (const event of events) {
    if (event.seq !== prefix.seq + 1 || event.missionId !== sourceMissionId
      || event.correlationId !== sourceMissionId || seen.has(event.eventId)) {
      throw new Error('USAGE_SOURCE_INTEGRITY: inconsistent source journal');
    }
    seen.add(event.eventId);
    const next = { seq: event.seq, eventId: event.eventId,
      digest: canonicalJsonHash([prefix.digest, event]) };
    if (event.kind === 'usage.session.opened' || event.kind === 'usage.session.closed') {
      const parsed = (event.kind === 'usage.session.opened' ? openingSchema : closingSchema).safeParse(event.payload);
      if (!parsed.success || event.source !== USAGE_SOURCE || event.subject !== parsed.data.targetMissionId
        || !sameUsageAnchor(parsed.data.previous, prefix)) {
        throw new Error('USAGE_BOUNDARY_INVALID: source prefix or receipt changed');
      }
      if (event.kind === 'usage.session.opened') {
        if (active !== undefined || intervals.has(parsed.data.targetMissionId)) {
          throw new Error('USAGE_BOUNDARY_INVALID: overlapping or reopened interval');
        }
        active = { targetMissionId: parsed.data.targetMissionId, opening: next };
        intervals.set(active.targetMissionId, active);
      } else {
        const closed = closingSchema.parse(event.payload);
        if (active === undefined || active.targetMissionId !== closed.targetMissionId
          || !sameUsageAnchor(active.opening, closed.opening)) {
          throw new Error('USAGE_BOUNDARY_INVALID: closure does not match the active interval');
        }
        intervals.set(active.targetMissionId, { ...active, closing: next });
        active = undefined;
      }
    }
    prefix = next;
  }
  return { prefix, intervals, ...(active === undefined ? {} : { active }) };
}
