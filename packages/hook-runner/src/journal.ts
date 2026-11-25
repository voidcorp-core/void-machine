import { type Dirent, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { legacyVoidPath, voidMachinePath } from './void-layout.js';

/**
 * Read the mission journals of a project.
 *
 * Both locations, never one: a project whose installed harness predates the
 * `machine/` split keeps writing to `.void/runs` while its older history sits
 * under `.void/machine/runs`. Reading whichever exists first returns half a
 * story in either direction, which is exactly how a guardrail ends up calling a
 * live harness dead. The half-migrated state is a real defect, and `doctor`
 * reports it as one (the `void layout` check); a reader that silently dropped
 * half the evidence would not fix it, only hide it.
 *
 * Discovery is bounded and refuses symlinks, so local telemetry cannot turn this
 * read into an arbitrary file read.
 */
export interface JournalReadOptions {
  /** Keep only the N most recently written missions. Absent means every mission. */
  readonly recentMissions?: number;
  /** Ceiling on the bytes read across all missions. */
  readonly maxBytes?: number;
}

const MISSION_DIRECTORY = /^mis_[A-Za-z0-9_-]{8,100}$/;
const MAX_MISSION_LOGS = 10_000;
const MAX_JOURNAL_BYTES = 64 * 1024 * 1024;

interface JournalFile {
  readonly path: string;
  readonly modifiedMs: number;
  readonly bytes: number;
}

function regularFile(path: string): boolean {
  try {
    const info = lstatSync(path);
    return info.isFile() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

function missionEntries(runs: string): Dirent[] {
  try {
    const info = lstatSync(runs);
    if (!info.isDirectory() || info.isSymbolicLink()) return [];
    return readdirSync(runs, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && MISSION_DIRECTORY.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_MISSION_LOGS);
  } catch {
    return [];
  }
}

function journalFiles(root: string): JournalFile[] {
  const locations = [voidMachinePath(root, 'runs'), legacyVoidPath(root, 'runs')]
    .filter((directory, index, all) => all.indexOf(directory) === index);
  const files: JournalFile[] = [];
  for (const runs of locations) {
    for (const entry of missionEntries(runs)) {
      const path = join(runs, entry.name, 'events.jsonl');
      if (!regularFile(path)) continue;
      try {
        const info = statSync(path);
        files.push({ path, modifiedMs: info.mtimeMs, bytes: info.size });
      } catch {
        // A concurrently rotated or unreadable log is skipped.
      }
    }
  }
  return files;
}

/** The mission journals of `root`, oldest first, as one text body. */
export function readMissionJournals(root: string, options: JournalReadOptions = {}): string {
  const ceiling = options.maxBytes ?? MAX_JOURNAL_BYTES;
  let files = journalFiles(root);
  if (options.recentMissions !== undefined) {
    // Recency is ranked across both locations at once. Ranking one location
    // before the other would make the newest missions of a half-migrated
    // project invisible, which is the very case this reader exists for.
    files = [...files]
      .sort((a, b) => b.modifiedMs - a.modifiedMs)
      .slice(0, Math.max(0, options.recentMissions));
  }
  const parts: string[] = [];
  let bytes = 0;
  for (const file of [...files].sort((a, b) => a.modifiedMs - b.modifiedMs)) {
    if (file.bytes > ceiling || bytes + file.bytes > ceiling) break;
    try {
      parts.push(readFileSync(file.path, 'utf8'));
      bytes += file.bytes;
    } catch {
      // Same reason as above: a log that vanished between stat and read.
    }
  }
  return parts.join('\n');
}

