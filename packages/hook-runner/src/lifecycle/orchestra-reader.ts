import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, opendirSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import {
  type OrchestraMission, type OrchestraPane, type OrchestraWorker,
  matchReport, parseBrief, parseMission, parseReport, resolvePane,
} from './orchestra-codec.js';

const MAX_MISSIONS = 64;
const MAX_DISCOVERY_BYTES = 1_048_576;
export function projectIdentity(canonicalCommonDirectory: string): string {
  return createHash('sha256').update(canonicalCommonDirectory).digest('hex');
}
function absent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
function canonical(path: string): string | undefined {
  try { return realpathSync(path); }
  catch (error) { if (absent(error)) return undefined; throw error; }
}
function missionEntries(root: string): string[] {
  safePath(root);
  const directory = opendirSync(root);
  const entries: string[] = [];
  try {
    for (let i = 0; i <= MAX_MISSIONS; i++) {
      const entry = directory.readSync();
      if (!entry) return entries;
      entries.push(entry.name);
    }
    throw Error('orchestra discovery incomplete: entry limit');
  } finally { directory.closeSync(); }
}
function safePath(path: string): void {
  let current = parse(path).root;
  for (const component of path.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    if (lstatSync(current).isSymbolicLink()) throw Error('orchestra state symlink refused');
  }
}

/** Never read more than limit + one byte; a replaced or growing file is refused. */
export function readDocument(root: string, relativePath: string, limit: number): string {
  if (isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) throw Error('orchestra traversal refused');
  const target = resolve(root, relativePath);
  safePath(target);
  const canonicalRoot = realpathSync(root);
  const rel = relative(canonicalRoot, realpathSync(target));
  if (rel.startsWith('..') || isAbsolute(rel)) throw Error('orchestra path escapes mission');
  const descriptor = openSync(target, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size > limit) throw Error('orchestra state is not a bounded regular file');
    const buffer = Buffer.alloc(limit + 1);
    const count = readSync(descriptor, buffer, 0, buffer.length, 0);
    const after = fstatSync(descriptor);
    const current = lstatSync(target);
    if (count > limit || count !== info.size || info.size !== after.size || info.mtimeMs !== after.mtimeMs
      || current.dev !== info.dev || current.ino !== info.ino) throw Error('orchestra state changed during read');
    safePath(target);
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count));
  } finally { closeSync(descriptor); }
}

export interface OrchestraSnapshot {
  readonly directory: string;
  readonly mission: OrchestraMission;
  readonly pane: OrchestraPane;
  readonly coordinator: boolean;
  readonly worker: OrchestraWorker | undefined;
  readonly workers: readonly OrchestraWorker[];
  readonly ownedPanes?: readonly OrchestraPane[];
}

function effectiveWorkers(directory: string, mission: OrchestraMission): OrchestraWorker[] {
  return mission.workers.map(worker => {
    let briefText: string | undefined;
    try { briefText = readDocument(directory, `workers/${worker.label}/brief.md`, 262_144); }
    catch (error) { if (!absent(error)) throw error; }
    if (briefText !== undefined) {
      const brief = parseBrief(briefText);
      if (brief.mission !== mission.mission || brief.worker !== worker.label || brief.attempt !== worker.attempt) {
        throw Error('foreign or stale orchestra brief');
      }
    }
    let raw: string;
    try { raw = readDocument(directory, `workers/${worker.label}/report.md`, 65_536); }
    catch (error) { if (absent(error)) return worker; throw error; }
    const report = matchReport(mission, worker.label, parseReport(raw));
    return { ...worker, status: report.status };
  });
}

/** Includes terminal missions for safe cleanup; a discovery limit is never a false unique result. */
export function readOrchestra(
  state: string, common: string, cwd: string, inventory: () => readonly OrchestraPane[],
): OrchestraSnapshot | undefined {
  const repository = realpathSync(common);
  const project = projectIdentity(repository);
  const root = join(state, project);
  let entries: string[];
  try { entries = missionEntries(root); }
  catch (error) { if (absent(error)) return undefined; throw error; }
  if (entries.length > MAX_MISSIONS) throw Error('orchestra discovery incomplete: entry limit');
  const canonicalCwd = realpathSync(cwd);
  const candidates: { directory: string; mission: OrchestraMission }[] = [];
  let bytes = 0;
  for (const entry of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(entry)) throw Error('invalid orchestra mission directory');
    const directory = join(root, entry);
    const raw = readDocument(directory, 'mission.md', 65_536);
    bytes += Buffer.byteLength(raw);
    if (bytes > MAX_DISCOVERY_BYTES) throw Error('orchestra discovery incomplete: byte limit');
    const mission = parseMission(raw);
    if (mission.project !== project || mission.repository !== repository || mission.mission !== entry) {
      throw Error('foreign orchestra mission');
    }
    const participants = [mission.coordinator, ...mission.workers];
    if (participants.some(person => canonical(person.worktree) === canonicalCwd)) candidates.push({ directory, mission });
  }
  if (candidates.length === 0) return undefined;
  const inventoryPanes = inventory();
  const active = candidates.filter(item => !['done', 'failed'].includes(item.mission.status));
  const selected = active.length ? active : candidates.filter(({ mission }) =>
    [mission.coordinator, ...mission.workers].some(person => canonical(person.worktree) === canonicalCwd
      && inventoryPanes.some(pane => pane.label === person.label && canonical(pane.cwd) === canonicalCwd
        && pane.tokens?.['mission'] === mission.mission)));
  if (selected.length === 0) return undefined;
  const candidate = selected[0];
  if (selected.length !== 1 || candidate === undefined) throw Error('ambiguous orchestra missions');
  const { mission, directory } = candidate;
  const identities = [mission.coordinator, ...mission.workers]
    .filter(person => canonical(person.worktree) === canonicalCwd);
  if (identities.length !== 1 || identities[0] === undefined) throw Error('ambiguous orchestra participant');
  const identity = identities[0];
  const labels = new Set([mission.coordinator, ...mission.workers].map(person => person.label));
  const panes = inventoryPanes.filter(pane => labels.has(pane.label)).flatMap(pane => {
    const cwd = canonical(pane.cwd);
    return cwd === undefined ? [] : [{ ...pane, cwd }];
  });
  const pane = resolvePane({ label: identity.label, worktree: canonicalCwd }, panes);
  const workers = effectiveWorkers(directory, mission);
  const ownedPanes = [mission.coordinator, ...mission.workers].flatMap(person => {
    const cwd = canonical(person.worktree);
    const matches = panes.filter(pane => pane.label === person.label && pane.cwd === cwd);
    if (matches.length > 1) throw Error('ambiguous orchestra pane identity');
    return matches;
  });
  return { directory, mission, pane, coordinator: identity.label === mission.coordinator.label,
    worker: workers.find(worker => worker.label === identity.label), workers, ownedPanes };
}
