// tdd-cover: e2e packages/cli/src/commands/agents-workers.test.ts
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MAX_EVENT_LOG_BYTES, legacyVoidPath, previousMachinePath, voidMachinePath, voidReadPath,
  writeSequencedEventOnce } from '@voidcorp/hook-runner';
import { type CanonicalEvent, type JsonValue, type WorkerEvent, type WorkerSnapshot,
  parseWorkerEvent, projectWorkers, replayEventLog } from '@voidcorp/mission-engine';
import { resolveMachineRoot } from '@voidcorp/void-machine/agents';
import { readBoundedProjectFile } from '../safe-read.js';
import { requireOpenMission } from './mission-lifecycle.js';
import { collectKnownSecrets, redactArgv, redactText } from './redact.js';

const MAX_MISSIONS = 1024;
const MAX_PROJECT_BYTES = 256 * 1024 * 1024;
const MISSION = /^mis_[A-Za-z0-9_-]{8,100}$/;
export interface WorkerObservation {
  readonly observationId: string;
  readonly kind: string;
  readonly payload: unknown;
}
export interface WorkersStatus {
  readonly schemaVersion: 1;
  readonly complete: boolean;
  readonly workers: readonly WorkerSnapshot[];
  readonly issues: readonly { readonly missionId?: string; readonly code: string }[];
}
export function workersProject(cwd: string): string {
  const resolved = resolveMachineRoot(cwd);
  if (!resolved.ok) throw new Error(resolved.cause);
  return dirname(dirname(resolved.root));
}
function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 5000,
    maxBuffer: 4096, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}
async function verifyDispatch(root: string, event: WorkerEvent): Promise<void> {
  if (event.kind !== 'worker.dispatched') return;
  const value = event.payload;
  if (workersProject(value.worktree) !== root || await realpath(value.worktree) !== value.worktree) {
    throw new Error('WORKER_WORKTREE_MISMATCH: expected an absolute canonical worktree in this project');
  }
  const branch = git(value.worktree, ['branch', '--show-current']) || 'detached';
  if (branch === 'detached' && git(value.worktree, ['rev-parse', 'HEAD']) !== value.headSha) {
    throw new Error('WORKER_HEAD_MISMATCH');
  }
  if (branch !== value.branch) throw new Error('WORKER_BRANCH_MISMATCH');
}

/** Native observations and legacy transitions use the same validated, idempotent journal writer. */
export async function recordWorker(root: string, missionId: string, observation: WorkerObservation) {
  if (!MISSION.test(missionId)) throw new Error('WORKER_MISSION_INVALID');
  const directory = await lstat(voidReadPath(root, 'runs', missionId));
  if (directory.isSymbolicLink() || !directory.isDirectory()) throw new Error('WORKER_MISSION_UNSAFE');
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/.test(observation.observationId)) {
    throw new Error('WORKER_OBSERVATION_INVALID: provide a stable observationId');
  }
  const parsed = parseWorkerEvent(observation.kind, observation.payload);
  if (!parsed.ok) throw new Error(`WORKER_EVENT_INVALID: ${parsed.issue}`);
  const event = parsed.event;
  if (event.kind === 'worker.dispatched' && event.payload.missionId !== missionId) {
    throw new Error('WORKER_MISSION_MISMATCH');
  }
  const serialized = JSON.stringify(event.payload);
  const secrets = collectKnownSecrets();
  if (redactText(serialized, secrets) !== serialized
    || (event.kind === 'worker.dispatched' && event.payload.attachCommand !== 'unknown'
      && JSON.stringify(redactArgv(event.payload.attachCommand, secrets)) !== JSON.stringify(event.payload.attachCommand))) {
    throw new Error('WORKER_EVENT_CONTAINS_SECRET: remove sensitive values before publication');
  }
  const identity = event.kind === 'worker.state' ? observation.observationId : event.kind;
  const eventId = `evt_${createHash('sha256').update(`${missionId}\0${event.payload.runId}\0${event.kind}\0${identity}`).digest('hex')}`;
  const draft = { source: 'void-machine:workers', kind: event.kind, subject: event.payload.runId,
    correlationId: missionId, payload: event.payload as unknown as JsonValue };
  return writeSequencedEventOnce({ root, missionId, eventId, draft,
    async validate(events) {
      await verifyDispatch(root, event);
      requireOpenMission(events);
      const candidate: CanonicalEvent = { schemaVersion: 1, seq: (events.at(-1)?.seq ?? 0) + 1,
        eventId, missionId, ts: new Date().toISOString(), ...draft };
      const projected = projectWorkers([...events, candidate], missionId);
      if (projected.issues.length > 0) throw new Error(`WORKER_TRANSITION_INVALID: ${projected.issues.join('; ')}`);
    },
  });
}

const missing = (error: unknown) => typeof error === 'object' && error !== null
  && 'code' in error && error.code === 'ENOENT';

async function missionLogs(root: string, issues: { missionId?: string; code: string }[]) {
  const logs: { missionId: string; path: string }[] = [];
  const missions = new Set<string>();
  for (const directory of [voidMachinePath(root, 'runs'), previousMachinePath(root, 'runs'), legacyVoidPath(root, 'runs')]) {
    try {
      const info = await lstat(directory);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('unsafe directory');
      const entries = await readdir(directory, { withFileTypes: true });
      if (entries.length > MAX_MISSIONS) issues.push({ code: 'mission-limit-exceeded' });
      for (const entry of entries.slice(0, MAX_MISSIONS).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!MISSION.test(entry.name)) continue;
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
          issues.push({ missionId: entry.name, code: 'unsafe-mission-directory' }); continue;
        }
        if (missions.has(entry.name)) { issues.push({ missionId: entry.name, code: 'duplicate-mission-location' }); continue; }
        missions.add(entry.name);
        logs.push({ missionId: entry.name, path: join(directory, entry.name, 'events.jsonl') });
      }
    } catch (error) { if (!missing(error)) issues.push({ code: 'mission-discovery-failed' }); }
  }
  return logs;
}

/** Reads files only. No runtime query, Surface, repair, write or implicit reconciliation. */
export async function workersStatus(root: string): Promise<WorkersStatus> {
  const workers: WorkerSnapshot[] = [];
  const issues: { missionId?: string; code: string }[] = [];
  const logs = await missionLogs(root, issues);
  let bytes = 0;
  for (const log of logs) {
    try {
      const info = await lstat(log.path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_EVENT_LOG_BYTES) {
        throw new Error('unsafe or oversized journal');
      }
      if (bytes + info.size > MAX_PROJECT_BYTES) { issues.push({ missionId: log.missionId, code: 'project-byte-limit' }); continue; }
      const file = await readBoundedProjectFile({ root, inputPath: log.path, maxBytes: Math.min(MAX_EVENT_LOG_BYTES, MAX_PROJECT_BYTES - bytes),
        pathEscapeMessage: 'unsafe journal', invalidMessage: 'invalid journal' });
      bytes += Buffer.byteLength(file.body);
      const stream = replayEventLog(file.body);
      if (stream.continuity === 'partial' || stream.duplicateEventIds > 0 || (file.body !== '' && !file.body.endsWith('\n'))) {
        issues.push({ missionId: log.missionId, code: 'journal-incomplete' });
      }
      const projected = projectWorkers(stream.events, log.missionId);
      for (const issue of projected.issues) issues.push({ missionId: log.missionId, code: issue });
      workers.push(...projected.workers);
    } catch { issues.push({ missionId: log.missionId, code: 'journal-unreadable' }); }
  }
  workers.sort((a, b) => a.missionId.localeCompare(b.missionId) || a.runId.localeCompare(b.runId));
  return { schemaVersion: 1, complete: issues.length === 0, workers, issues };
}
