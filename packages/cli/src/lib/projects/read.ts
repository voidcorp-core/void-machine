// The I/O edge: gather one project's observations, then hand them to the pure
// summariser.
//
// Two properties this module must never break.
//
// It NEVER WRITES. The view is a projection; a read that repairs or regenerates
// is how a dashboard quietly becomes a second source of truth.
//
// It NEVER THROWS for one project. Eight projects are read at once, and a
// permission error on one of them must cost that one project's detail, not the
// whole answer.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readProgramDescriptor } from '../autopilot/program.js';
import { type DecisionEntry, observeDecisions } from './decisions-source.js';
import type { DiscoveredProject } from './discover.js';
import {
  type CheckpointSignal,
  type GitSignals,
  type ProgramSignal,
  type ProjectSummary,
  summarizeProject,
} from './summary.js';

const NO_GIT: GitSignals = Object.freeze({
  available: false,
  branch: undefined,
  dirtyFiles: 0,
  unpushedCommits: 0,
  lastCommitAt: undefined,
  commitsToday: 0,
});

/** Bounded so a pathological repository cannot stall the whole view. */
const GIT_TIMEOUT_MS = 2_000;
const MAX_READ_BYTES = 4_000_000;

function git(cwd: string, args: readonly string[]): string | undefined {
  try {
    return execFileSync('git', args as string[], {
      cwd,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

function readText(path: string): string | undefined {
  try {
    if (statSync(path).size > MAX_READ_BYTES) return undefined;
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function countLines(value: string | undefined): number {
  if (value === undefined || value === '') return 0;
  return value.split(/\r?\n/).filter((line) => line.trim() !== '').length;
}

export function readGitSignals(path: string): GitSignals {
  const branch = git(path, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === undefined) return NO_GIT;
  const head = git(path, ['rev-parse', 'HEAD']);

  const lastCommitRaw = git(path, ['log', '-1', '--format=%ct']);
  const lastCommitAt =
    lastCommitRaw === undefined || !/^\d+$/.test(lastCommitRaw)
      ? undefined
      : Number(lastCommitRaw) * 1_000;

  // `@{u}` fails when the branch has no upstream. That resolves to zero rather
  // than to a guess: without a remote to compare against, "how many commits are
  // only here" has no answer, and inventing one would put a number in the view
  // that nothing backs.
  const unpushedRaw = git(path, ['rev-list', '--count', '@{u}..HEAD']);
  const unpushedCommits =
    unpushedRaw !== undefined && /^\d+$/.test(unpushedRaw) ? Number(unpushedRaw) : 0;

  return {
    available: true,
    branch: branch === 'HEAD' ? undefined : branch,
    ...(head === undefined ? {} : { head }),
    dirtyFiles: countLines(git(path, ['status', '--porcelain'])),
    unpushedCommits,
    lastCommitAt,
    commitsToday: countLines(git(path, ['log', '--since=midnight', '--format=%H'])),
  };
}

/** How many per-file records get their real title read from disk. */
const TITLED_RECENT = 8;

/**
 * Per-file decisions.
 *
 * The filename carries the date and a collision-free suffix, so the whole set
 * can be COUNTED and ORDERED without opening anything. Only the most recent few
 * are opened to recover their real `title:` — the filename slug reads as
 * `partial-means-completeness-in-doubt--eb74b522-4442-409f...`, which is not a
 * sentence anyone wants in a card. Reading all 132 in each of 8 projects would
 * cost a thousand file reads for five lines of output.
 */
export function readDecisions(root: string): ReturnType<typeof observeDecisions> {
  const dir = join(root, 'docs', 'decisions-log');
  let perFile: DecisionEntry[] = [];
  try {
    if (existsSync(dir)) {
      const names = readdirSync(dir)
        .filter((name) => name.endsWith('.md'))
        .sort()
        .reverse();
      perFile = names.map((name, index) => {
        const date = /^(\d{4}-\d{2}-\d{2})/.exec(name)?.[1];
        const slug = name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
        const title =
          index < TITLED_RECENT ? (frontmatterTitle(join(dir, name)) ?? slug) : slug;
        return date === undefined ? { title } : { title, date };
      });
    }
  } catch {
    perFile = [];
  }
  return observeDecisions({ monolith: readText(join(root, 'docs', 'DECISIONS.md')), perFile });
}

/** The `title:` line of an ADR, without paying for a YAML parse. */
function frontmatterTitle(path: string): string | undefined {
  const raw = readText(path);
  if (raw === undefined) return undefined;
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1];
  if (block === undefined) return undefined;
  for (const line of block.split(/\r?\n/)) {
    const match = /^title:\s*(.+?)\s*$/.exec(line) ?? undefined;
    if (match === undefined) continue;
    const value = (match[1] ?? '').replace(/^["']|["']$/g, '').trim();
    return value === '' ? undefined : value;
  }
  return undefined;
}

function readPlanCount(root: string): number {
  // `docs/plans/` is where a plan belongs — it survives the harness, like an ADR
  // — but the root `plans/` is where every project still has them today.
  for (const dir of [join(root, 'docs', 'plans'), join(root, 'plans')]) {
    try {
      const count = readdirSync(dir).filter((name) => name.endsWith('.md')).length;
      if (count > 0) return count;
    } catch {
      // try the next location
    }
  }
  return 0;
}

/**
 * The declared program, when the project runs one. Read for display only: the
 * declared provider owns execution state, and reaching it would put the network on the
 * path of a view that must stay offline.
 */
export function readProgram(root: string): ProgramSignal | undefined {
  try {
    const descriptor = readProgramDescriptor(root);
    if (descriptor?.status !== 'executing') return undefined;
    return {
      program: descriptor.program,
      provider: descriptor.progress?.provider,
      unitCount: descriptor.progress?.order.length ?? 0,
    };
  } catch {
    return undefined;
  }
}

/**
 * The session checkpoint. Absent everywhere until it ships, which is why the
 * whole view is designed to be useful without it.
 */
function readCheckpoint(root: string): CheckpointSignal | undefined {
  // Newest location first, then each older one: a project migrates on `update`.
  const candidates = [
    join(root, '.void', 'machine', 'checkpoint.md'),
    join(root, '.void', 'local', 'checkpoint.md'),
    join(root, '.void', 'session', 'current.md'),
  ];
  const path = candidates.find((candidate) => readText(candidate) !== undefined);
  if (path === undefined) return undefined;
  const raw = readText(path);
  if (raw === undefined) return undefined;
  // Strip the frontmatter BLOCK, not lines that merely look like it: filtering
  // line by line let `date: 2026-08-17` through as the resume line.
  const body = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n([\s\S]*))?$/.exec(raw)?.[1] ?? raw;
  const resumeLine = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== '' && !line.startsWith('#'));
  if (resumeLine === undefined) return undefined;
  try {
    return { resumeLine, writtenAt: statSync(path).mtimeMs };
  } catch {
    return undefined;
  }
}

/** Read one project and summarise it. Never writes, never throws. */
export function readProjectSummary(ref: DiscoveredProject, now: number): ProjectSummary {
  return summarizeProject({
    ref,
    now,
    git: readGitSignals(ref.path),
    decisions: readDecisions(ref.path),
    planCount: readPlanCount(ref.path),
    ...(() => {
      const program = readProgram(ref.path);
      return program === undefined ? {} : { program };
    })(),
    ...(() => {
      const checkpoint = readCheckpoint(ref.path);
      return checkpoint === undefined ? {} : { checkpoint };
    })(),
  });
}
