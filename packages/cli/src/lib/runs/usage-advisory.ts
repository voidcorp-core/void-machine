// tdd-cover: e2e packages/cli/src/lib/runs/usage-sessions.test.ts
import { writeSequencedEventOnce } from '@voidcorp/hook-runner';
import { validNativeContextId } from '@voidcorp/mission-engine';
import { z } from 'zod';
import { findCoreSource } from '../paths.js';
import { loadSpecialists } from '../specialists/load.js';
import { requireOpenMission } from './mission-lifecycle.js';
import { usageEventId, usageMissionId } from './usage-session-contract.js';
import { readUsageJournal } from './usage-sessions.js';

const advisorySchema = z.strictObject({ root: z.string().min(1), missionId: usageMissionId,
  specialistId: z.string().regex(/^core:[a-z0-9]+(?:-[a-z0-9]+)*$/), runtime: z.enum(['claude', 'codex']),
  contextId: z.string().refine(validNativeContextId) });

/** Declared observation of an actual native start, never an authenticated formal review receipt. */
export async function recordUsageAdvisory(input: unknown) {
  const request = advisorySchema.parse(input);
  const specialists = await loadSpecialists(await findCoreSource());
  if (!specialists.some(specialist => specialist.id === request.specialistId)) {
    throw new Error('USAGE_SPECIALIST_UNKNOWN: use a canonical specialist role from the catalogue');
  }
  await readUsageJournal(request.root, request.missionId);
  const recorded = await writeSequencedEventOnce({ root: request.root, missionId: request.missionId,
    eventId: usageEventId('advisory', request.missionId, request.runtime, request.contextId),
    draft: { source: 'coordinator-observed', kind: 'usage.advisory.started', subject: request.specialistId,
      correlationId: request.missionId, payload: { runtime: request.runtime, contextId: request.contextId } },
    validate: requireOpenMission });
  return { eventId: recorded.event.eventId, provenance: 'coordinator-observed' as const };
}
