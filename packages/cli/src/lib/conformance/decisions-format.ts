// The first conformance rule: decisions must live one per file.
//
// Measured across the real park on 2026-08-17: 294 of 426 decisions sit in a
// monolithic `docs/DECISIONS.md`, the format this repo itself abandoned. A
// 1824-line file holding 134 decisions is write-only memory — you cannot find
// one, you cannot see what supersedes what, and nothing stops a past decision
// being quietly rewritten.
//
// DETECTION KEYS ON THE FROZEN MARKER, never on a count. This repo carries 96
// monolith entries against 132 per-file records: counting would say drift where
// there is none, while the header settles it in one line. A monolith that
// declares itself frozen and points at the directory is conformant.
//
// The repair MOVES content, it never rewrites it. An 80-file diff can then be
// checked by comparison instead of by reading, which is the only way a migration
// that size is reviewable at all.
//
// Pure. The caller reads the files and supplies the dates.

import { observeDecisions } from '../projects/decisions-source.js';
import type { ConformanceFinding, Mutation } from './rule.js';

export interface DecisionsInput {
  /** Raw `docs/DECISIONS.md`, or undefined when absent. */
  readonly monolith: string | undefined;
  /** Filenames already in `docs/decisions-log/`. */
  readonly existingRecords: readonly string[];
}

export interface MigrationInput extends DecisionsInput {
  /**
   * The date a section was written, recovered from `git blame`. Undefined when
   * history cannot answer — the entry is then reported, never dated by guess.
   */
  readonly dateFor: (title: string) => string | undefined;
}

export interface MigrationPlan {
  readonly mutations: readonly Mutation[];
  /** Entries left behind because no date could be recovered. */
  readonly undated: readonly string[];
  /** Records that already existed and were not touched. */
  readonly skipped: readonly string[];
}

const RECORDS_DIR = 'docs/decisions-log';
const MONOLITH = 'docs/DECISIONS.md';
const FROZEN_MARKER = /frozen legacy (?:snapshot|landing page)/i;
/** Matches the entry headings of all three formats found in the park. */
const ENTRY = /^(#{2,3}) (?:\d+\.|(?:\d{4}-\d{2}-\d{2})[:.]|[A-Z]+-\d+[ \t]*[-–—])\s*(.+?)\s*$/;

/** Is this project still writing decisions into a live monolith? */
export function detectDecisionsDrift(input: DecisionsInput): ConformanceFinding {
  const observed = observeDecisions({ monolith: input.monolith, perFile: [] });
  if (observed.format !== 'live-monolith') return { drifted: false };
  return {
    drifted: true,
    detail:
      `${String(observed.count)} decision(s) live in ${MONOLITH}, which the harness does not read. `
      + `Migrating writes one immutable record per decision under ${RECORDS_DIR}/.`,
  };
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  // A title of pure punctuation slugs to nothing; a record still needs a name.
  return slug === '' ? 'decision' : slug;
}

interface Entry {
  readonly title: string;
  readonly heading: string;
  readonly body: string;
  /**
   * A date the heading carried itself. The `## ADR-001 - Title (2026-06-01)`
   * format used by one project in the park puts it there, and it is a better
   * source than blame: it is what the author wrote, not when the file moved.
   */
  readonly ownDate?: string;
}

/** `Title (2026-06-01)` -> the title without its trailing date, and the date. */
function splitTrailingDate(title: string): { title: string; date?: string } {
  const match = /^(.*?)[ \t]*\((\d{4}-\d{2}-\d{2})\)$/.exec(title) ?? undefined;
  if (match === undefined) return { title };
  const stripped = (match[1] ?? '').trim();
  return stripped === '' ? { title } : { title: stripped, date: match[2] as string };
}

function entriesOf(monolith: string): readonly Entry[] {
  const lines = monolith.split(/\r?\n/);
  const entries: { title: string; heading: string; body: string[] }[] = [];
  for (const line of lines) {
    const match = ENTRY.exec(line) ?? undefined;
    if (match !== undefined) {
      entries.push({ title: (match[2] ?? '').trim(), heading: line, body: [] });
      continue;
    }
    entries[entries.length - 1]?.body.push(line);
  }
  return entries
    .filter((entry) => entry.title !== '')
    .map((entry) => {
      const split = splitTrailingDate(entry.title);
      return {
        title: split.title,
        heading: entry.heading,
        body: entry.body.join('\n').trim(),
        ...(split.date === undefined ? {} : { ownDate: split.date }),
      };
    });
}

/**
 * The frozen monolith. The historical text stays exactly where people already
 * look for it; only the header changes, and it now says the file is no longer
 * the source. That header is the same string detection reads, so applying the
 * repair twice is a no-op.
 */
function freeze(monolith: string): string {
  return `# Decisions log

Each current decision is a Markdown file under \`${RECORDS_DIR}/\` with light YAML
frontmatter. Follow the \`void-decide\` skill to write a short record and link any
material replacement to its predecessor.

> **Frozen legacy snapshot.** The entries below are preserved as written. They were migrated
> into ${RECORDS_DIR}/ and are no longer the source; edit the records, not this file.

---

${monolith.trimStart()}
`;
}

/** Plan the migration. Nothing is written here. */
export function planDecisionsMigration(input: MigrationInput): MigrationPlan {
  const monolith = input.monolith ?? '';
  const entries = entriesOf(monolith);
  const existing = new Set(input.existingRecords);
  const mutations: Mutation[] = [];
  const undated: string[] = [];
  const skipped: string[] = [];
  const used = new Set<string>();

  for (const entry of entries) {
    // The heading's own date wins: it is what the author wrote, where blame only
    // knows when the text last moved through the file.
    const date = entry.ownDate ?? input.dateFor(entry.title);
    if (date === undefined) {
      undated.push(entry.title);
      continue;
    }

    // Two entries may legitimately share a title; the record name must still be
    // unique, so a counter disambiguates rather than one silently overwriting
    // the other.
    let name = `${date}-${slugify(entry.title)}.md`;
    let attempt = 2;
    while (used.has(name)) {
      name = `${date}-${slugify(entry.title)}-${String(attempt)}.md`;
      attempt += 1;
    }
    used.add(name);

    if (existing.has(name)) {
      skipped.push(name);
      continue;
    }

    const escapedTitle = entry.title.replace(/"/g, '\\"');
    mutations.push({
      path: `${RECORDS_DIR}/${name}`,
      contents: `---
date: ${date}
title: "${escapedTitle}"
status: accepted
migratedFrom: ${MONOLITH}
---

## ${date}: ${entry.title}

${entry.body}
`,
    });
  }

  // The monolith is rewritten only when something actually moved, so a run that
  // could date nothing leaves the project untouched.
  if (mutations.length > 0 && !FROZEN_MARKER.test(monolith)) {
    mutations.push({ path: MONOLITH, contents: freeze(monolith) });
  }

  return { mutations, undated, skipped };
}
