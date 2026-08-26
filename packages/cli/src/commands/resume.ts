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
import { readDecisions, readGitSignals, readProgram } from '../lib/projects/read.js';
import { banner, blank, c, footer, glyph, heading, line, meta } from '../lib/render.js';
import { type Checkpoint, parseCheckpoint } from '../lib/session/checkpoint.js';
import { composeResume, type ResumeReport } from '../lib/session/resume.js';

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

function renderReport(report: ResumeReport): void {
  const checkpoint = report.checkpoint;

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
  if (report.recentDecisions.length > 0) {
    heading('Recent decisions');
    for (const decision of report.recentDecisions) {
      line(`${decision.date === undefined ? '' : `${c.dim(decision.date)}  `}${decision.title}`);
    }
  }
  // Gaps last and plainly: they are what the reader must NOT assume was covered.
  if (report.gaps.length > 0) {
    heading('Not answered here');
    for (const gap of report.gaps) line(c.yellow(`${glyph.to} ${gap.detail}`));
  }
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
  const report = composeResume({
    name: root.split('/').pop() ?? root,
    path: root,
    now: Date.now(),
    git: readGitSignals(root),
    decisions: readDecisions(root),
    ...(found === undefined
      ? {}
      : { checkpoint: found.checkpoint, checkpointWrittenAt: found.writtenAt }),
    ...(() => {
      const program = readProgram(root);
      return program === undefined ? {} : { program };
    })(),
  });

  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`);
    return;
  }

  banner('resume');
  meta('project', report.name);
  meta('branch', report.branch ?? 'no git');
  if (report.dirtyFiles > 0) meta('tree', `${String(report.dirtyFiles)} file(s) uncommitted`);
  if (report.program !== undefined) {
    meta(
      'program',
      `${report.program.program} (${String(report.program.unitCount)} units)`,
    );
  }
  if (report.checkpointAgeDays !== undefined) {
    meta(
      'checkpoint',
      report.checkpointAgeDays === 0
        ? 'written today'
        : `written ${String(report.checkpointAgeDays)} day(s) ago`,
    );
  }

  renderReport(report);
  blank();
  footer(report.gaps.length === 0 ? 'complete' : `${String(report.gaps.length)} gap(s)`);
}
