// `void-harness projects` — the park, and where attention is owed.
//
// A projection and nothing else: it reads what already exists in each project
// and never writes, never regenerates, never caches. The moment a view keeps its
// own copy of a summary to stay fast, it becomes a second source of truth and
// starts disagreeing with the repositories it describes.
//
// Offline by construction. No tracker call, no registry fetch, no network: the
// signals are files and git plumbing, so the answer is the same on a plane.

import type { ProgramSignal, ProjectSummary } from '../lib/projects/summary.js';
import { banner, blank, c, footer, glyph, line, meta } from '../lib/render.js';
import { discoveryConfigPath, readProjectsPayload } from '../lib/ui/payload.js';

function ageLabel(summary: ProjectSummary): string {
  if (summary.idleDays === undefined) return 'no git history';
  if (summary.commitsToday > 0) return `${String(summary.commitsToday)} commit(s) today`;
  if (summary.idleDays === 0) return 'active today';
  return `idle ${String(summary.idleDays)}d`;
}

function decisionsLabel(summary: ProjectSummary): string {
  const { count, format } = summary.decisions;
  if (count === 0) return 'no decisions recorded';
  const suffix = format === 'live-monolith' ? ' (legacy format)' : '';
  return `${String(count)} decision(s)${suffix}`;
}

export function programLabel(program: ProgramSignal): string {
  return `program ${program.program} (${String(program.unitCount)} units)`;
}

/**
 * Columns are padded on the VISIBLE text, and long values are cut rather than
 * allowed to push the next column. A real branch name — `autopilot/vague-e-
 * veille-vivier` — ran straight into the column beside it, and a table whose
 * columns move is a table nobody scans.
 */
function column(text: string, width: number): string {
  const cut = text.length > width - 1 ? `${text.slice(0, width - 2)}…` : text;
  return cut.padEnd(width);
}

function renderProject(summary: ProjectSummary): void {
  const mark = summary.attention.length === 0 ? c.green(glyph.check) : c.yellow('!');
  const branch = summary.branch ?? 'detached';
  line(
    `${mark}  ${c.bold(column(summary.name, 16))}${c.dim(column(branch, 26))}${ageLabel(summary)}`,
  );

  const facts: string[] = [decisionsLabel(summary)];
  if (summary.planCount > 0) facts.push(`${String(summary.planCount)} plan(s)`);
  if (summary.program !== undefined) facts.push(programLabel(summary.program));
  line(c.dim(`     ${facts.join('  ·  ')}`));

  if (summary.resumeLine !== undefined) {
    line(`     ${c.dim('resume')} ${summary.resumeLine}`);
  }
  for (const item of summary.attention) {
    line(`     ${c.yellow(glyph.to)} ${item.detail}`);
  }
  // Shown but visually quieter than attention: drift is real and not urgent,
  // and giving it the same weight is what made every project look alarming.
  for (const item of summary.conformance) {
    line(c.dim(`     ${glyph.dot} ${item.detail}`));
  }
}

export async function projects(args: readonly string[]): Promise<void> {
  // The SAME composition the served route calls, so the two cannot drift.
  const payload = readProjectsPayload();
  const summaries = payload.projects;

  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(payload, undefined, 2)}\n`);
    return;
  }

  banner('projects');
  meta('roots', `${payload.roots.join(', ')} (${payload.rootsSource})`);
  blank();

  if (summaries.length === 0) {
    line(c.dim('No project found. A project is any directory carrying .void/config.json.'));
    line(c.dim(`Declare where to look in ${discoveryConfigPath()}: { "roots": ["~/Code"] }`));
    blank();
    footer('nothing to show');
    return;
  }

  for (const summary of summaries) renderProject(summary);

  // Unreadable paths are reported, never fatal: eight projects are read at once
  // and one permission error must not cost the whole answer.
  if (payload.unreadable.length > 0) {
    blank();
    for (const item of payload.unreadable) {
      line(c.dim(`     ${c.yellow('?')} ${item.path}: ${item.reason}`));
    }
  }

  const needing = summaries.filter((summary) => summary.attention.length > 0).length;
  blank();
  footer(
    needing === 0
      ? `${String(summaries.length)} project(s), nothing needs attention`
      : `${String(summaries.length)} project(s), ${String(needing)} needing attention`,
  );
}
