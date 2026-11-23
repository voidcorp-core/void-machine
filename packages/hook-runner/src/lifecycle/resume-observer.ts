import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import {
  composeResumeBundle,
  type CheckpointPath,
  type ResumeBundle,
  renderResumeContext,
} from '@voidcorp/mission-engine/session';
import { parseCheckpoint } from './checkpoint-codec.js';

const CHECKPOINT_PATHS: readonly CheckpointPath[] = [
  '.void/machine/checkpoint.md',
  '.void/local/checkpoint.md',
  '.void/session/current.md',
] as const;
const MAX_READ_BYTES = 500_000;
const GIT_TIMEOUT_MS = 200;

export interface ResumeObservation {
  readonly bundle: ResumeBundle;
  readonly context: string;
  readonly checkpointWrittenAt?: number;
}

function readBounded(path: string): string | undefined {
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_READ_BYTES) return undefined;
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function git(root: string, args: readonly string[]): string | undefined {
  try {
    return execFileSync('git', [...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

function gitObservation(root: string): {
  readonly branch: string | undefined;
  readonly head: string | undefined;
  readonly dirtyFiles: number;
} {
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = git(root, ['rev-parse', 'HEAD']);
  const dirty = git(root, ['status', '--porcelain']);
  return {
    branch: branch === 'HEAD' ? undefined : branch,
    head,
    dirtyFiles: dirty === undefined || dirty === '' ? 0 : dirty.split(/\r?\n/).length,
  };
}

function checkpointObservation(root: string): {
  readonly checkpoint?: ReturnType<typeof parseCheckpoint>;
  readonly checkpointPath?: CheckpointPath;
  readonly checkpointWrittenAt?: number;
} {
  for (const relative of CHECKPOINT_PATHS) {
    const path = join(root, relative);
    const raw = readBounded(path);
    if (raw === undefined) continue;
    try {
      return { checkpoint: parseCheckpoint(raw), checkpointPath: relative, checkpointWrittenAt: statSync(path).mtimeMs };
    } catch {
      return { checkpoint: parseCheckpoint(raw), checkpointPath: relative };
    }
  }
  return {};
}

export function observeResume(
  root: string,
  now: number,
): ResumeObservation {
  const checkpoint = checkpointObservation(root);
  const bundle = composeResumeBundle({
    project: { name: basename(root), path: root },
    now,
    git: gitObservation(root),
    checkpoint: checkpoint.checkpoint,
    ...(checkpoint.checkpointPath === undefined ? {} : { checkpointPath: checkpoint.checkpointPath }),
    ...(checkpoint.checkpointWrittenAt === undefined
      ? {}
      : { checkpointWrittenAt: checkpoint.checkpointWrittenAt }),
  });
  return {
    bundle,
    context: renderResumeContext(bundle),
    ...(checkpoint.checkpointWrittenAt === undefined
      ? {}
      : { checkpointWrittenAt: checkpoint.checkpointWrittenAt }),
  };
}
