// tdd-cover: e2e test/cli/mission-usage.test.ts
import type { EventStreamState } from '@voidcorp/mission-engine';
import { hookRunnerCommand, loadCatalog } from '../cheatsheet/load.js';
import { requireData } from '../cheatsheet/read.js';
import { findCoreSource } from '../paths.js';
import { loadMissionControllerPlan } from './store.js';
import { readUsageSessions } from './usage-sessions.js';
import { projectMissionUsage, type MissionUsage } from './usage.js';

/** Read bundled declarations and the exact mission binding; never scan unrelated sessions. */
export async function loadMissionUsage(
  root: string, missionId: string, stream: EventStreamState,
): Promise<MissionUsage> {
  const core = await findCoreSource();
  const catalog = await loadCatalog(core);
  const hookSubjects: Record<string, string> = {};
  for (const entry of catalog.filter(item => item.type === 'hook')) {
    const command = hookRunnerCommand(await requireData(core, `hooks/${entry.name}.sh`, 64 * 1024));
    if (command !== undefined) hookSubjects[`hook:${command.split(' ').at(-1)}`] = entry.name;
  }
  const linked = await readUsageSessions(root, missionId, stream.events);
  const report = projectMissionUsage({ missionId, events: stream.events, catalog, hookSubjects, linkedScopes: linked.scopes });
  const notes = [...linked.notes, ...report.notes];
  if (stream.continuity !== 'complete' || stream.events.some(event => event.missionId !== missionId)) {
    notes.unshift('Journal incomplete or mixed: counts cover readable linked events only, never complete usage.');
  }
  try {
    const stored = await loadMissionControllerPlan(root, missionId);
    const bound = stream.events.some(event => event.missionId === missionId && event.kind === 'mission.started'
      && event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      && Object.entries(event.payload).some(([key, value]) => key === 'routingHash' && value === stored.routingHash));
    notes.unshift(bound ? `Ticket binding: ${JSON.stringify(stored.ticket.path)} (${stored.ticket.contentHash}).`
      : 'Ticket binding unverified; scope is this mission journal, not a proven ticket.');
  } catch {
    notes.unshift('Ticket binding unavailable; scope is this mission/session journal, not a proven ticket.');
  }
  return { ...report, notes, links: linked.links };
}
