// tdd-cover: e2e packages/cli/src/lib/runs/usage-sessions.test.ts
import { MAX_EVENT_LOG_BYTES, writeSequencedEventOnce } from '@voidcorp/hook-runner';
import { replayEventLog, type CanonicalEvent } from '@voidcorp/mission-engine';
import { relative } from 'node:path';
import { z } from 'zod';
import { requireData } from '../cheatsheet/read.js';
import { observedMissionLifecycle, requireOpenMission } from './mission-lifecycle.js';
import { eventLogPath } from './store.js';
import { MAX_USAGE_LINKS, USAGE_SOURCE, sameUsageAnchor, scanUsageSource, usageEventId,
  usageMissionId, usageReferenceSchema, type UsageInterval } from './usage-session-contract.js';

const requestSchema = z.strictObject({ root: z.string().min(1), missionId: usageMissionId,
  sourceMissionId: usageMissionId, action: z.enum(['bind', 'unbind']) });
export interface UsageScope { readonly missionId: string; readonly events: readonly CanonicalEvent[] }
export type UsageLink = { readonly sourceMissionId: string; readonly status: 'unavailable' }
  | { readonly sourceMissionId: string; readonly status: 'open' | 'closed'; readonly interval: UsageInterval };

export async function readUsageJournal(root: string, missionId: string): Promise<readonly CanonicalEvent[]> {
  const path = await eventLogPath(root, usageMissionId.parse(missionId));
  const stream = replayEventLog(await requireData(root, relative(root, path), MAX_EVENT_LOG_BYTES));
  if (stream.continuity !== 'complete' || stream.duplicateEventIds > 0
    || stream.events.some(event => event.missionId !== missionId || event.correlationId !== missionId)) {
    throw new Error('USAGE_SOURCE_INTEGRITY: unreadable, duplicate or mixed journal; no usage attributed');
  }
  return stream.events;
}

async function reference(root: string, target: string, source: string, interval: UsageInterval,
  write: typeof writeSequencedEventOnce): Promise<void> {
  try {
    await write({ root, missionId: target, eventId: usageEventId('reference', target, source),
      draft: { source: USAGE_SOURCE, kind: 'usage.session.linked', subject: source, correlationId: target,
        payload: { sourceMissionId: source, opening: interval.opening } },
      validate: events => {
        observedMissionLifecycle(events);
        if (events.filter(event => event.kind === 'usage.session.linked').length >= MAX_USAGE_LINKS) {
          throw new Error('USAGE_LINK_LIMIT: at most 32 source journals per mission');
        }
      } });
  } catch {
    throw new Error('USAGE_REFERENCE_PENDING: source receipt is durable; retry the same command to repair the target reference');
  }
}

/** Source is authoritative. Target reference is a retryable second write, not an atomic transaction. */
export async function changeUsageSession(input: unknown, write = writeSequencedEventOnce): Promise<UsageLink> {
  const request = requestSchema.parse(input);
  const { root, missionId, sourceMissionId, action } = request;
  if (sourceMissionId === missionId) throw new Error('USAGE_SELF_LINK: source and target must differ');
  const targetEvents = await readUsageJournal(root, missionId);
  observedMissionLifecycle(targetEvents);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const scanned = scanUsageSource(await readUsageJournal(root, sourceMissionId), sourceMissionId);
    const interval = scanned.intervals.get(missionId);
    if (interval !== undefined && (action === 'bind' || interval.closing !== undefined)) {
      await reference(root, missionId, sourceMissionId, interval, write);
      return { sourceMissionId, status: interval.closing === undefined ? 'open' : 'closed', interval };
    }
    if (action === 'unbind' && interval === undefined) throw new Error('USAGE_NOT_BOUND: no prospective interval exists');
    if (action === 'bind') {
      requireOpenMission(targetEvents);
      if (scanned.active !== undefined) throw new Error('USAGE_SOURCE_BUSY: close the active target before binding another');
      if (targetEvents.filter(event => event.kind === 'usage.session.linked').length >= MAX_USAGE_LINKS) {
        throw new Error('USAGE_LINK_LIMIT: at most 32 source journals per mission');
      }
    }
    try {
      await write({ root, missionId: sourceMissionId, eventId: usageEventId(action, missionId, sourceMissionId),
        draft: { source: USAGE_SOURCE, kind: action === 'bind' ? 'usage.session.opened' : 'usage.session.closed',
          subject: missionId, correlationId: sourceMissionId,
          payload: { targetMissionId: missionId, previous: scanned.prefix,
            ...(interval === undefined ? {} : { opening: interval.opening }) } },
        validate: events => {
          if (!sameUsageAnchor(scanUsageSource(events, sourceMissionId).prefix, scanned.prefix)) {
            throw new Error('USAGE_SOURCE_CHANGED: source appended during binding; retry');
          }
        } });
    } catch (error) {
      if (error instanceof Error && (error.message.startsWith('USAGE_SOURCE_CHANGED:')
        || error.message.startsWith('HOOK_EVENT_ID_CONFLICT:'))) continue;
      throw error;
    }
    const updated = scanUsageSource(await readUsageJournal(root, sourceMissionId), sourceMissionId).intervals.get(missionId);
    if (updated === undefined) throw new Error('USAGE_BOUNDARY_INVALID: written interval is missing');
    await reference(root, missionId, sourceMissionId, updated, write);
    return { sourceMissionId, status: updated.closing === undefined ? 'open' : 'closed', interval: updated };
  }
  throw new Error('USAGE_SOURCE_CHANGED: concurrent writes prevented a stable boundary; retry the same command');
}

/** Resolve only explicit references. Foreign event mission IDs remain untouched. */
export async function readUsageSessions(root: string, missionId: string, events: readonly CanonicalEvent[]): Promise<{
  readonly scopes: readonly UsageScope[]; readonly links: readonly UsageLink[]; readonly notes: readonly string[];
}> {
  const references = events.filter(event => event.missionId === missionId && event.kind === 'usage.session.linked');
  const scopes: UsageScope[] = []; const links: UsageLink[] = []; const notes: string[] = [];
  if (references.length > MAX_USAGE_LINKS) return { scopes, links,
    notes: ['Linked usage unavailable: source reference limit exceeded.'] };
  const seen = new Set<string>();
  const sourceCounts = new Map<string, number>();
  for (const event of references) {
    const parsed = usageReferenceSchema.safeParse(event.payload);
    if (parsed.success) sourceCounts.set(parsed.data.sourceMissionId,
      (sourceCounts.get(parsed.data.sourceMissionId) ?? 0) + 1);
  }
  for (const event of references) {
    const parsed = usageReferenceSchema.safeParse(event.payload);
    const source = parsed.success ? parsed.data.sourceMissionId : 'unknown';
    if (seen.has(source)) continue;
    seen.add(source);
    try {
      if (!parsed.success || event.source !== USAGE_SOURCE || event.subject !== source
        || event.correlationId !== missionId || source === missionId || sourceCounts.get(source) !== 1) {
        throw new Error('USAGE_REFERENCE_INVALID');
      }
      const sourceEvents = await readUsageJournal(root, source);
      const interval = scanUsageSource(sourceEvents, source).intervals.get(missionId);
      if (interval === undefined || !sameUsageAnchor(interval.opening, parsed.data.opening)) {
        throw new Error('USAGE_BOUNDARY_INVALID');
      }
      scopes.push({ missionId: source, events: sourceEvents.filter(candidate => candidate.seq > interval.opening.seq
        && (interval.closing === undefined || candidate.seq < interval.closing.seq)) });
      links.push({ sourceMissionId: source, status: interval.closing === undefined ? 'open' : 'closed', interval });
      notes.push(`${source}: ${interval.closing === undefined ? 'provisional/shared-session' : 'closed shared-session interval'}; `
        + 'explicit attribution, not worker isolation or authentication.');
    } catch {
      links.push({ sourceMissionId: source, status: 'unavailable' });
      notes.push(`${source}: linked usage unavailable; no counts attributed from this source.`);
    }
  }
  return { scopes, links, notes };
}
