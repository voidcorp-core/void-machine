// `void-harness resume` — pick a project back up without rebuilding the context
// in your head.
//
// Reads the canonical checkpoint; it does NOT reconstruct one from git history
// or from a conversation. A resume that guessed would be confidently wrong at
// the exact moment it is trusted most, so what is missing is printed as missing
// and the command still succeeds — a partial answer beats a refusal when the
// question is "where was I".
//
// Never writes. Same discipline as the projects view.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readProgramDescriptor } from '../lib/autopilot/program.js';
import { readGitSignals } from '../lib/projects/read.js';
import { banner, blank, c, footer, glyph, heading, line, meta } from '../lib/render.js';
import { type Checkpoint, parseCheckpoint } from '../lib/session/checkpoint.js';
import {
  composeResumeBundle,
  type ResumeBundle,
  type ResumeBundleInput,
  renderResumeContext,
} from '../lib/session/resume-bundle.js';

/** Newest location first; the previous one is read until a project migrates. */
const CHECKPOINT_PATHS = [
  join('.void', 'machine', 'checkpoint.md'),
  join('.void', 'local', 'checkpoint.md'),
  join('.void', 'session', 'current.md'),
];

/** The nearest ancestor carrying the project marker, so it works from anywhere. */
function enclosingProject(from: string): string | undefined {
  let current = resolve(from);
  for (;;) {
    if (existsSync(join(current, '.void', 'config.json'))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function readCheckpointFile(
  root: string,
): { checkpoint: Checkpoint; writtenAt: number } | undefined {
  for (const relative of CHECKPOINT_PATHS) {
    const path = join(root, relative);
    try {
      if (!existsSync(path)) continue;
      return {
        checkpoint: parseCheckpoint(readFileSync(path, 'utf8')),
        writtenAt: statSync(path).mtimeMs,
      };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function renderHuman(bundle: ResumeBundle): void {
  const checkpoint = bundle.checkpoint;

  // Every line of a prose section, not just the first: `line` indents what it is
  // given, so a paragraph handed over whole loses its shape from the second row.
  const paragraph = (text: string): void => {
    for (const row of text.split('\n')) line(row.trim());
  };

  if (checkpoint?.objective !== undefined) {
    heading('Objective');
    paragraph(checkpoint.objective);
  }
  if (checkpoint?.position !== undefined) {
    heading('Position');
    paragraph(checkpoint.position);
  }
  if (checkpoint?.state !== undefined) {
    heading('State');
    paragraph(checkpoint.state);
  }
  if (checkpoint?.nextAction !== undefined) {
    heading('Next action');
    line(c.bold(checkpoint.nextAction));
  }
  if (checkpoint !== undefined && checkpoint.openLoops.length > 0) {
    heading('Open loops');
    for (const item of checkpoint.openLoops) line(`${glyph.dot} ${item}`);
  }
  if (checkpoint !== undefined && checkpoint.deadEnds.length > 0) {
    heading('Already tried');
    for (const item of checkpoint.deadEnds) line(`${glyph.dot} ${item}`);
  }
  if (checkpoint !== undefined && checkpoint.assumptions.length > 0) {
    heading('Assumed, not verified');
    for (const item of checkpoint.assumptions) line(`${glyph.dot} ${item}`);
  }
  if (checkpoint !== undefined && checkpoint.workingSet.length > 0) {
    heading('Working set');
    for (const item of checkpoint.workingSet) line(c.dim(item));
  }
  // Gaps last and plainly: they are what the reader must NOT assume was covered.
  if (bundle.gaps.length > 0) {
    heading('Not answered here');
    for (const gap of bundle.gaps) line(c.yellow(`${glyph.to} ${gap.detail}`));
  }
}

function observeProgram(root: string): Pick<ResumeBundleInput, 'program' | 'programError'> {
  try {
    return { program: readProgramDescriptor(root) };
  } catch (error) {
    return {
      program: undefined,
      programError: error instanceof Error ? error.message : String(error),
    };
  }
}

function selectedFormat(args: readonly string[]): 'human' | 'json' | 'context' {
  if (args.includes('--json') || args.includes('--format=json')) return 'json';
  if (args.includes('--context') || args.includes('--format=context')) return 'context';
  return 'human';
}

export async function resume(args: readonly string[]): Promise<void> {
  const root = enclosingProject(process.cwd());
  if (root === undefined) {
    process.stderr.write(
      'not a Void project: no .void/config.json here or above. Run `void-harness init` first.\n',
    );
    process.exitCode = 2;
    return;
  }

  const found = readCheckpointFile(root);
  const git = readGitSignals(root);
  const bundle = composeResumeBundle({
    project: { name: root.split('/').pop() ?? root, path: root },
    now: Date.now(),
    git: { branch: git.branch, head: git.head, dirtyFiles: git.dirtyFiles },
    ...observeProgram(root),
    checkpoint: found?.checkpoint,
    ...(found === undefined ? {} : { checkpointWrittenAt: found.writtenAt }),
  });

  const format = selectedFormat(args);
  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(bundle, undefined, 2)}\n`);
    return;
  }
  if (format === 'context') {
    process.stdout.write(renderResumeContext(bundle));
    return;
  }

  banner('resume');
  meta('project', bundle.project.name);
  meta('branch', bundle.git.branch ?? 'no git');
  if (bundle.git.dirtyFiles > 0) {
    meta('tree', `${String(bundle.git.dirtyFiles)} file(s) uncommitted`);
  }
  if (bundle.program !== undefined) meta('program', bundle.program.program);
  if (bundle.checkpoint?.date !== undefined) meta('checkpoint', bundle.checkpoint.date);

  renderHuman(bundle);
  blank();
  footer(bundle.gaps.length === 0 ? 'complete' : `${String(bundle.gaps.length)} gap(s)`);
}
