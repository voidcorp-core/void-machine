// tdd-cover: e2e packages/cli/src/commands/agents-workers.test.ts
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { voidReadPath, MAX_EVENT_LOG_BYTES, writeSequencedEventOnce } from '@voidcorp/hook-runner';
import { parseWorkerEvent, replayEventLog, type WorkerDispatch, type WorkerState } from '@voidcorp/mission-engine';
import type { AgentsContext, RunRecord } from '@voidcorp/void-machine/agents';
import { readBoundedProjectFile } from '../safe-read.js';
import { recordWorker } from './workers.js';

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 5000,
    maxBuffer: 4096, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}
async function ensureLegacyMission(root: string, run: RunRecord): Promise<void> {
  try {
    const file = await readBoundedProjectFile({ root,
      inputPath: voidReadPath(root, 'runs', run.missionId, 'events.jsonl'), maxBytes: MAX_EVENT_LOG_BYTES,
      pathEscapeMessage: 'WORKER_UNSAFE_JOURNAL', invalidMessage: 'WORKER_INVALID_JOURNAL' });
    if (file.body.trim() !== '') return;
  } catch (error) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  await writeSequencedEventOnce({ root, missionId: run.missionId,
    eventId: `evt_${createHash('sha256').update(`legacy-mission:${run.missionId}`).digest('hex')}`,
    draft: { source: 'void-harness:mission', kind: 'mission.started', subject: 'mission',
      correlationId: run.missionId, payload: { title: 'Delegated workers', mode: 'fast' } },
    validate(events) { if (events.length > 0) throw new Error('WORKER_MISSION_ALREADY_STARTED: retry publication'); },
  });
}

async function dispatchMetadata(root: string, context: AgentsContext, run: RunRecord): Promise<WorkerDispatch> {
  try {
    const file = await readBoundedProjectFile({ root,
      inputPath: voidReadPath(root, 'runs', run.missionId, 'events.jsonl'), maxBytes: MAX_EVENT_LOG_BYTES,
      pathEscapeMessage: 'WORKER_UNSAFE_JOURNAL', invalidMessage: 'WORKER_INVALID_JOURNAL' });
    const previous = replayEventLog(file.body).events.find(event => event.kind === 'worker.dispatched' && event.subject === run.runId);
    if (previous !== undefined) {
      const parsed = parseWorkerEvent(previous.kind, previous.payload);
      if (!parsed.ok || parsed.event.kind !== 'worker.dispatched') throw new Error('WORKER_INVALID_DISPATCH');
      return parsed.event.payload;
    }
  } catch (error) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const branch = git(run.cwd, ['branch', '--show-current']) || 'detached';
  const command = context.runtimes[run.runtime].attachCommand({ name: run.name, ...run.binding });
  return { schemaVersion: 1, runId: run.runId, missionId: run.missionId, ticket: run.ticket ?? 'unknown',
    role: run.role, runtime: run.runtime, worktree: run.cwd, branch,
    ...(branch === 'detached' ? { headSha: git(run.cwd, ['rev-parse', 'HEAD']) } : {}),
    attachCommand: command ?? 'unknown' };
}

/** Replays persistent transitions, so a failed publication is repaired without another runtime action. */
export async function publishLegacyWorkers(root: string, context: AgentsContext, runIds: readonly string[]): Promise<void> {
  for (const runId of runIds) {
    const run = await context.store.read(runId);
    if (run === undefined) throw new Error(`WORKER_RUN_UNKNOWN: ${runId}`);
    if (run.binding === undefined) continue; // A lost launch is not an acknowledged dispatch.
    const acknowledged = run.transitions.find(step => step.to === 'dispatched'
      || step.to === 'working' || step.to === 'turn-ended' || step.to === 'waiting-human');
    if (acknowledged === undefined) continue;
    await ensureLegacyMission(root, run);
    await recordWorker(root, run.missionId, { observationId: 'legacy-dispatch', kind: 'worker.dispatched',
      payload: await dispatchMetadata(root, context, run) });
    for (const step of run.transitions.filter(step => step.seq >= acknowledged.seq)) {
      if (step.to === 'retired') {
        await recordWorker(root, run.missionId, { observationId: 'legacy-finished', kind: 'worker.finished',
          payload: { schemaVersion: 1, runId, outcome: 'succeeded' } });
        continue;
      }
      const uncertain = step.to === 'reconciling' || (step.to === 'failed' && step.from === 'reconciling');
      const state: WorkerState = step.to === 'accepted' ? 'done'
        : (step.to === 'failed' || step.to === 'stopped') && !uncertain ? 'failed'
          : step.to === 'dispatched' || step.to === 'working' ? 'running' : 'blocked';
      await recordWorker(root, run.missionId, { observationId: `legacy-transition-${String(step.seq)}`,
        kind: 'worker.state', payload: { schemaVersion: 1, runId, state,
          observedAt: new Date(step.at).toISOString(), ...(state === 'blocked' ? { reason: step.to } : {}) } });
      if (state === 'failed') await recordWorker(root, run.missionId, { observationId: 'legacy-finished',
        kind: 'worker.finished', payload: { schemaVersion: 1, runId, outcome: step.to === 'stopped' ? 'stopped' : 'failed' } });
    }
  }
}
