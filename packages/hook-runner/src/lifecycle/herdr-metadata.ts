import type { OrchestraSnapshot } from './orchestra-reader.js';

const STATE_TTL = 86_400_000;
const CONTEXT_TTL = 7_200_000;
const PANE_KEYS = ['mission', 'worker', 'ticket', 'wstatus', 'ctx'];
const WORKSPACE_KEYS = ['mission', 'wstatus', 'workers'];

/** Keep the epoch out of floating-point nanosecond arithmetic; use one clock. */
export function metadataSequence(originMs: number, elapsedMs: number): bigint {
  const nanoseconds = (ms: number) => BigInt(Math.trunc(ms)) * 1_000_000n
    + BigInt(Math.trunc((ms % 1) * 1_000_000));
  return nanoseconds(originMs) + nanoseconds(elapsedMs);
}

/** Sequence is captured before discovery, never after a slow snapshot read. */
export function metadataCommands(
  snapshot: OrchestraSnapshot,
  event: { readonly hook_event_name: string; readonly source?: string },
  sequence: bigint,
  contextPercent?: number,
  workspaceMission?: string,
): readonly (readonly string[])[] {
  const { mission, pane, worker, coordinator, workers } = snapshot;
  const commands: string[][] = [];
  let seq = sequence;
  const patch = (kind: 'pane' | 'workspace', id: string, fields: string[], ttl: number) => {
    commands.push([kind, 'report-metadata', id, '--source', 'void-machine',
      ...fields, '--ttl-ms', String(ttl), '--seq', String(seq++)]);
  };
  const clear = (keys: readonly string[]) => keys.flatMap(key => ['--clear-token', key]);
  if (mission.status === 'done' || mission.status === 'failed') {
    for (const owned of coordinator ? snapshot.ownedPanes ?? [pane] : [pane]) {
      if (owned.tokens?.['mission'] === mission.mission) patch('pane', owned.pane_id, clear(PANE_KEYS), STATE_TTL);
    }
    if (coordinator && workspaceMission === mission.mission) {
      patch('workspace', pane.workspace_id, clear(WORKSPACE_KEYS), STATE_TTL);
    }
    return commands;
  }
  if (event.hook_event_name === 'SessionEnd') return commands;
  if (event.hook_event_name === 'SessionStart' && event.source === 'clear') {
    patch('pane', pane.pane_id, clear(['ctx']), CONTEXT_TTL);
  }
  const fields = ['--token', `mission=${mission.mission}`, '--token', `wstatus=${worker?.status ?? mission.status}`];
  if (worker !== undefined) fields.push('--token', `worker=${worker.label}`, '--token', `ticket=${worker.ticket}`);
  patch('pane', pane.pane_id, fields, STATE_TTL);
  if (coordinator) {
    const active = workers.filter(item => item.status === 'running').length;
    const blocked = workers.filter(item => item.status === 'blocked').length;
    patch('workspace', pane.workspace_id, ['--token', `mission=${mission.mission}`,
      '--token', `wstatus=${mission.status}`, '--token', `workers=${active} active, ${blocked} blocked`], STATE_TTL);
  }
  if (contextPercent !== undefined && Number.isFinite(contextPercent) && contextPercent >= 0) {
    patch('pane', pane.pane_id, ['--token', `ctx=${Math.round(contextPercent)}%`], CONTEXT_TTL);
  }
  return commands;
}
