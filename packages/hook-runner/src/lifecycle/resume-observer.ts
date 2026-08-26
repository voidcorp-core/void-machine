import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import {
  composeResumeBundle,
  parseCheckpoint,
  type ResumeBundle,
  type ResumeProgramInput,
  renderResumeContext,
} from '@voidcorp/mission-engine/session';

const PROGRAM_PATHS = [
  join('.void', 'program.md'),
  join('.void', 'active.md'),
  join('plans', 'ACTIVE.md'),
] as const;
const CHECKPOINT_PATHS = [
  join('.void', 'machine', 'checkpoint.md'),
  join('.void', 'local', 'checkpoint.md'),
  join('.void', 'session', 'current.md'),
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

function frontmatter(raw: string): string | undefined {
  return /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1];
}

function cleanScalar(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const clean = value.trim().replace(/^['"]|['"]$/g, '');
  return clean === '' ? undefined : clean;
}

function rootScalar(block: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cleanScalar(new RegExp(`^${escaped}:\\s*(.+?)\\s*$`, 'm').exec(block)?.[1]);
}

function nestedBlock(block: string, key: string): string | undefined {
  const lines = block.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${key}:` && /^\S/.test(line));
  if (start < 0) return undefined;
  const nested: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    nested.push(line.replace(/^ {2}/, ''));
  }
  return nested.join('\n');
}

function programFrom(raw: string, legacy: boolean): ResumeProgramInput | undefined {
  const block = frontmatter(raw);
  if (block === undefined) return undefined;
  if (!legacy && rootScalar(block, 'schemaVersion') !== '1') return undefined;
  const status = rootScalar(block, 'status');
  const program = rootScalar(block, 'program');
  const plan = rootScalar(block, 'plan');
  const spec = rootScalar(block, 'spec');
  if (
    (status !== 'executing' && status !== 'completed')
    || program === undefined
    || plan === undefined
    || spec === undefined
  ) {
    return undefined;
  }
  const progressBlock = nestedBlock(block, legacy ? 'tracker' : 'progress');
  const provider = progressBlock === undefined ? undefined : rootScalar(progressBlock, 'provider');
  const scope = progressBlock === undefined ? undefined : rootScalar(progressBlock, 'scope');
  return {
    status,
    program,
    plan,
    spec,
    ...(provider === undefined || scope === undefined
      ? {}
      : { progress: { provider, scope } }),
  };
}

function observeProgram(root: string): {
  readonly program: ResumeProgramInput | undefined;
  readonly programError?: string;
} {
  const present = PROGRAM_PATHS.filter((relative) => existsSync(join(root, relative)));
  if (present.length === 0) return { program: undefined };
  if (present.length > 1) {
    return {
      program: undefined,
      programError: `multiple program descriptors: ${present.join(', ')}`,
    };
  }
  const relative = present[0];
  if (relative === undefined) return { program: undefined };
  const raw = readBounded(join(root, relative));
  const program = raw === undefined ? undefined : programFrom(raw, relative !== PROGRAM_PATHS[0]);
  return program === undefined
    ? { program: undefined, programError: `invalid program descriptor: ${relative}` }
    : { program };
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
  readonly checkpointWrittenAt?: number;
} {
  for (const relative of CHECKPOINT_PATHS) {
    const path = join(root, relative);
    const raw = readBounded(path);
    if (raw === undefined) continue;
    try {
      return { checkpoint: parseCheckpoint(raw), checkpointWrittenAt: statSync(path).mtimeMs };
    } catch {
      return { checkpoint: parseCheckpoint(raw) };
    }
  }
  return {};
}

export function observeResume(root: string, now: number): ResumeObservation {
  const checkpoint = checkpointObservation(root);
  const bundle = composeResumeBundle({
    project: { name: basename(root), path: root },
    now,
    git: gitObservation(root),
    ...observeProgram(root),
    checkpoint: checkpoint.checkpoint,
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
