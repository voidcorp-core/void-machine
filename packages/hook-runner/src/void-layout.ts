// Who owns each path the harness materializes, and therefore what git does with it.
//
// The problem this solves is not cosmetic. `.void/` held two things with
// opposite lifecycles — what the project DECLARES (config.json,
// PROJECT-DOCTRINE.md: authored, reviewed, pushed) and what the harness OBSERVES
// (telemetry, run journals, caches: machine-local, never shipped) — and nothing
// separated them, so every project improvised its own ignore rule over a vacuum.
// The one that prompted this read:
//
//     .void/*
//     !.void/PROJECT-DOCTRINE.md
//
// It rescued the doctrine and silently ignored `config.json` with it — the file
// carrying the pack pins and `paths.business`, the glob the enforcement runner
// reads to decide what the TDD guard covers. A teammate cloning that repo got the
// doctrine and no enforcement configuration, with nothing reporting it.
//
// The fix is a classification, not a longer exception list:
//
//   project   the project authors it, the harness never overwrites it, it ships
//   derived   re-materialized by `init` from the harness assets
//   observed  machine-local history, meaningless in another checkout
//
// Observed state moves under `.void/local/`, so its ignore rule is one line with
// no `!` and — the property that actually matters — stops needing maintenance: a
// new runtime artifact is born inside `local/` and no ignore file learns about it.
//
// `derived` is ignored too, EXCEPT what a fresh clone needs to work: the runner
// `.claude/settings.json` names, and the Codex safety floor. And it is ignored
// PER RECEIPT, never per directory — `.claude/skills/` also holds skills the
// project wrote by hand, and inferring ownership from the folder would ignore
// them and let `--untrack-derived` drop them from the index.
//
// Pure except for the three functions documented as touching the filesystem.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const VOID_DIR = '.void';
/** The observed half. Named for WHOSE it is, because that decides deletability. */
export const VOID_MACHINE_DIR = 'machine';
/** The restorable half. `void-harness install` rebuilds every byte of it. */
export const VOID_INSTALLED_DIR = 'installed';
/** The name the observed half carried before, still read as a fallback. */
export const VOID_PREVIOUS_MACHINE_DIR = 'local';

/** What a materialized path is, which is what decides whether git keeps it. */
export type Ownership = 'project' | 'derived' | 'observed';

/**
 * Ownership of every direct child of `.void/`, and the single source of truth the
 * ignore rule, the migration and `doctor` all read. A second copy of this
 * anywhere would let `update` move a file the ignore rule does not cover, and the
 * next commit would ship telemetry.
 */
export const VOID_OWNERSHIP: Readonly<Record<string, Ownership>> = Object.freeze({
  // Declared: authored or hand-edited, never regenerable from a pin. These are
  // the ONLY things at the top of `.void/`, which is what makes "everything at
  // the top is committed" a rule you can see rather than one you must look up.
  'config.json': 'project',
  'PROJECT-DOCTRINE.md': 'project',
  'program.md': 'project',
  knowledge: 'project',
  // Plans, despite the name. Measured on sesame: eight committed `.plan.md`
  // files carrying frozen model decisions that still govern its schema. Read as
  // `observed`, doctor told the project to untrack its own architecture
  // decisions — and nothing writes this directory anyway. It is a leftover of
  // the `backlog-autopilot` engine deleted at the 2026-07-30 cutover; the
  // current autopilot writes to `machine/autopilot/`. So there is no writer to
  // redirect, only a classification that was wrong.
  'autonomous-runs': 'project',

  // Derived: `void-harness install` re-materializes these, byte for byte from a
  // pin. Not committed — 1.2 MB of vendored prose rewritten on every bump — but
  // their absence degrades the agent rather than breaking the project.
  'PHILOSOPHY.md': 'derived',
  // Derived AND committed, which is why it stays at the top rather than moving
  // into `installed/`. `.claude/settings.json` names this path and is itself
  // committed, so ignoring the runner would give a fresh clone a settings file
  // pointing at a missing file and every tool call would fail on it. See
  // `DERIVED_LOAD_BEARING`: its absence is an error, not a degradation.
  hooks: 'derived',

  // Observed: this machine's history. Never meaningful in another checkout, and
  // losing it costs nothing.
  runs: 'observed',
  cache: 'observed',
  outputs: 'observed',
  generated: 'observed',
  archives: 'observed',
  autopilot: 'observed',
  receipts: 'observed',
  history: 'observed',
  worktrees: 'observed',
  // Renamed from `state.json`, which named two different things: this snapshot
  // and an autopilot run's cursor. The cursor keeps its name inside its own run
  // directory, where nothing else competes for it.
  'status.json': 'observed',
  // The session checkpoint. Observed on purpose: it is what THIS machine was
  // doing, so committing it would guarantee a conflict on a file rewritten every
  // evening while serving nobody else.
  'checkpoint.md': 'observed',

  // Nothing WRITES these any more — the current telemetry is `runs/*/events.jsonl`
  // — but they still exist on disk in the park (424 KB in one project), and
  // "no longer read" is not "no longer there". Dropping them from this table
  // would let them fall through to the `project` default, and doctor would start
  // telling those projects to commit their own telemetry.
  'activations.jsonl': 'observed',
  'outcomes.jsonl': 'observed',
  'usage.log': 'observed',
  // The pre-rename name of `status.json`. Classified for the same reason: it is
  // on disk in the park, and forgetting it here would make doctor ask projects
  // to commit it. `LEGACY_RENAMES` sends it to its new name on migration.
  'state.json': 'observed',
});

/**
 * Observed entries whose NAME changes on migration, not just their directory.
 *
 * `state.json` named two different things — the snapshot `status` writes and an
 * autopilot run's cursor — and one name for two things is one name too few. The
 * cursor keeps its name inside its own run directory, where nothing competes.
 */
export const LEGACY_RENAMES: Readonly<Record<string, string>> = Object.freeze({
  'state.json': 'status.json',
});

/**
 * Observed entries nothing reads or writes any more.
 *
 * They still migrate — deleting someone's data is not a migration's job — but
 * into a subdirectory of their own, so `machine/` holds only live state and
 * removing them is one obvious command rather than a judgement call about eight
 * similar-looking files. Measured across the park: 3.2 MB of unreadable history.
 */
export const RETIRED_ENTRIES: readonly string[] = Object.freeze([
  'activations.jsonl',
  'outcomes.jsonl',
  'usage.log',
]);

/** The subdirectory of `machine/` that holds what nothing reads any more. */
export const RETIRED_DIR = 'retired';

/** Where an entry belongs after migration, name and subdirectory included. */
export function migratedName(entry: string): string {
  const renamed = LEGACY_RENAMES[entry] ?? entry;
  return RETIRED_ENTRIES.includes(entry) ? `${RETIRED_DIR}/${renamed}` : renamed;
}

export const MATERIALIZED_OWNERSHIP: Readonly<Record<string, Ownership>> = Object.freeze({
  // The project's own wiring: hand-editable, merged rather than regenerated.
  '.claude/settings.json': 'project',

  // Regenerated by `init` from the harness assets.
  '.claude/skills/': 'derived',
  '.claude/agents/': 'derived',
  '.claude/commands/': 'derived',
  '.agents/skills/': 'derived',
  '.codex/agents/': 'derived',
  '.void/hooks/': 'derived',
  '.void/installed/PHILOSOPHY.md': 'derived',
  '.codex/hooks.json': 'derived',
});

/**
 * Derived paths that stay TRACKED regardless, because their absence is an error
 * rather than a degradation:
 *
 * - `.void/hooks/` is referenced by name from `.claude/settings.json`, which is
 *   project state and therefore committed. Ignoring the runner while keeping the
 *   reference gives a fresh clone a settings file pointing at a missing file, and
 *   every tool call fails on it.
 * - `.codex/hooks.json` IS the Codex safety floor. Absent, the floor is simply
 *   not there — a silently weaker clone, which is the worst of the three states.
 *
 * Everything else in the derived class degrades gracefully: without them the
 * agent has fewer capabilities until the next `init`, and nothing errors.
 */
export const DERIVED_LOAD_BEARING: readonly string[] = Object.freeze([
  '.void/hooks/',
  '.codex/hooks.json',
]);

/**
 * Roots whose direct children are self-contained units — one skill, one agent,
 * one command. Used only to keep the generated ignore block readable: a unit the
 * receipt owns collapses to `<root>/<unit>/` instead of listing its every file.
 */
const UNIT_ROOTS: readonly string[] = Object.freeze([
  '.claude/skills',
  '.claude/agents',
  '.claude/commands',
  '.agents/skills',
  '.codex/agents',
]);

function normalize(path: string): string {
  return path.split('\\').join('/');
}

/**
 * Classify a materialized path by prefix.
 *
 * **Only ever apply this to paths the install receipt claims.** These directories
 * are SHARED with the project — `.claude/skills/` is where Claude Code reads a
 * project's own skills, and the harness merely also writes there. Classifying by
 * directory alone would call a hand-written `.claude/skills/custom/` "derived",
 * silently ignore it, and let `--untrack-derived` drop it from the index. The
 * receipt is the ownership truth; this only says what KIND of harness file it is.
 */
export function classifyMaterialized(path: string): Ownership | undefined {
  const target = normalize(path);
  for (const [prefix, ownership] of Object.entries(MATERIALIZED_OWNERSHIP)) {
    if (prefix.endsWith('/') ? target.startsWith(prefix) : target === prefix) return ownership;
  }
  return undefined;
}

/** True when this receipt-owned path is derived AND safe to leave out of a clone. */
export function isOwnedDerived(path: string): boolean {
  const target = normalize(path);
  if (classifyMaterialized(target) !== 'derived') return false;
  return !DERIVED_LOAD_BEARING.some((kept) =>
    kept.endsWith('/') ? target.startsWith(kept) : target === kept,
  );
}

/**
 * The ignore entries for the derived files the RECEIPT says the harness owns —
 * never a whole runtime directory. A unit the receipt owns collapses to its
 * directory so the block stays readable; anything else is listed exactly.
 *
 * A path the receipt does not claim can never appear here, which is the entire
 * safety property: the project's own skills and agents stay visible to git.
 */
export function derivedIgnoreEntries(ownedPaths: readonly string[]): string[] {
  const entries = new Set<string>();
  for (const raw of ownedPaths) {
    const path = normalize(raw);
    if (!isOwnedDerived(path)) continue;
    const root = UNIT_ROOTS.find((candidate) => path.startsWith(`${candidate}/`));
    if (root === undefined) {
      entries.add(path);
      continue;
    }
    // Collapse only when the unit is a DIRECTORY, i.e. there is another segment
    // below it. `.claude/agents/` holds files directly, and emitting
    // `.claude/agents/doctrine-critic.md/` with a trailing slash matches a
    // directory that does not exist — so git ignored none of them.
    const rest = path.slice(root.length + 1).split('/');
    const unit = rest[0] ?? '';
    entries.add(unit === '' || rest.length < 2 ? path : `${root}/${unit}/`);
  }
  return [...entries].sort();
}

/** The observed entries, sorted — what moves under `local/` and what git ignores. */
export const MACHINE_ENTRIES: readonly string[] = Object.freeze(
  Object.keys(VOID_OWNERSHIP)
    .filter((entry) => VOID_OWNERSHIP[entry] === 'observed')
    .sort(),
);

/**
 * What `installed/` holds: derived entries MINUS the load-bearing ones.
 *
 * A derived path that must survive a fresh clone stays at the top of `.void/`,
 * because the top is what git keeps. Moving it under an ignored directory would
 * un-track the very file `.claude/settings.json` resolves by name.
 */
export const INSTALLED_ENTRIES: readonly string[] = Object.freeze(
  Object.keys(VOID_OWNERSHIP)
    .filter((entry) => VOID_OWNERSHIP[entry] === 'derived')
    .filter((entry) => !DERIVED_LOAD_BEARING.includes(`${VOID_DIR}/${entry}/`))
    .sort(),
);

const BEGIN_MARKER = '# void-harness:begin';
const END_MARKER = '# void-harness:end';

/**
 * Ownership of a direct child of `.void/`. An entry this version has never heard
 * of answers `project`, and that is the safe answer rather than the lax one:
 * `local/` is a CLOSED set — every observed writer in the harness now writes
 * inside it — so a stranger at the top of `.void/` cannot be our telemetry. It is
 * someone's file, and the failure of guessing wrong is "doctor tells a project to
 * untrack its own data", which is worse than tracking one unknown path.
 *
 * The legacy names left over from before the split are enumerated above, so they
 * are recognised as observed rather than falling through to this default.
 */
export function ownershipOf(entry: string): Ownership {
  return VOID_OWNERSHIP[entry] ?? 'project';
}

/** True when this direct child of `.void/` is observed state rather than declared. */
export function isMachineEntry(entry: string): boolean {
  return ownershipOf(entry) === 'observed';
}

/** `<root>/.void` — holds the declared half, tracked by git in full. */
export function voidDir(root: string): string {
  return join(root, VOID_DIR);
}

/** `<root>/.void/machine` — the observed half, covered by one ignore rule. */
export function voidMachineDir(root: string): string {
  return join(root, VOID_DIR, VOID_MACHINE_DIR);
}

/** `<root>/.void/installed` — what `install` restores, covered by one ignore rule. */
export function voidInstalledDir(root: string): string {
  return join(root, VOID_DIR, VOID_INSTALLED_DIR);
}

/** Path to a restorable artifact. Writers of derived content use this. */
export function voidInstalledPath(root: string, ...segments: readonly string[]): string {
  return join(voidInstalledDir(root), ...segments);
}

/** `<root>/.void/local` — where the observed half lived before. Readers only. */
export function previousMachinePath(root: string, ...segments: readonly string[]): string {
  return join(root, VOID_DIR, VOID_PREVIOUS_MACHINE_DIR, ...segments);
}

/** Path to an observed artifact at its post-split location. Writers use this. */
export function voidMachinePath(root: string, ...segments: readonly string[]): string {
  return join(voidMachineDir(root), ...segments);
}

/** Path to an artifact at its pre-split location. Readers use this only as a fallback. */
export function legacyVoidPath(root: string, ...segments: readonly string[]): string {
  return join(voidDir(root), ...segments);
}

/**
 * Where to READ an observed artifact: the migrated path when it exists, the
 * pre-split one while it still holds the data, and the migrated path when neither
 * does (so a writer handed this creates the right one).
 *
 * Touches the filesystem. The fallback is what stops a project that has not run
 * `update` yet from reporting months of telemetry as none.
 */
export function voidReadPath(root: string, ...segments: readonly string[]): string {
  // Newest layout first, then each older one in turn. A project migrates on
  // `update`, so until it does a reader that only knew the current path would
  // report months of telemetry as none — which is how a dashboard ends up
  // confidently describing an empty project.
  const candidates = [
    voidMachinePath(root, ...segments),
    previousMachinePath(root, ...segments),
    legacyVoidPath(root, ...segments),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? (candidates[0] as string);
}

/**
 * The observed artifacts still sitting at the pre-split location, for `update` to
 * move. Sorted, and empty for a project already migrated or never installed.
 *
 * Touches the filesystem.
 */
export function pendingMigrations(root: string): string[] {
  // Both older layouts, because a project can sit on either: never migrated at
  // all (flat), or migrated once to `local/` and not since.
  const found = new Set<string>();
  for (const entry of MACHINE_ENTRIES) {
    if (existsSync(legacyVoidPath(root, entry))) found.add(entry);
    if (existsSync(previousMachinePath(root, entry))) found.add(entry);
  }
  for (const entry of INSTALLED_ENTRIES) {
    if (existsSync(legacyVoidPath(root, entry))) found.add(entry);
  }
  return [...found].sort();
}

/**
 * The managed `.gitignore` block. `derivedEntries` comes from
 * `derivedIgnoreEntries(receipt.files)` — pass an empty list and the block covers
 * observed state only, which is what a project with no readable receipt gets.
 */
/**
 * The managed block, whole.
 *
 * It used to name every generated file one by one, from the install receipt:
 * 148 lines in this repository to keep exactly TWO files tracked. The reason
 * was real -- `.claude/skills/` is shared, and a skill the project wrote by hand
 * lives there too -- but the price was a wall nobody reads, regenerated on every
 * install.
 *
 * The directories are collapsed instead, with the two exceptions named. The form
 * matters more than it looks: `.claude/` would exclude the directory itself, and
 * git then refuses to re-include anything below it, so `!.claude/settings.json`
 * would be silently dead. `.claude/*` descends into it and the exception holds.
 * `void-layout.test.ts` asserts that against real git rather than against the
 * text of this block.
 *
 * What the project writes itself stays visible with one explicit line, e.g.
 * `!.claude/skills/my-skill/`, and `doctor` reports a skill that is ignored
 * without one -- the silent loss this collapse would otherwise cause.
 */
export function gitignoreBlock(): string {
  return [
    BEGIN_MARKER,
    '# .void/ has three levels, named by what deleting them costs. Everything the',
    '# harness OBSERVES (telemetry, run journals, caches, install receipts) lives',
    '# under machine/ and is disposable. Everything it DERIVES (the doctrine) lives',
    '# under installed/ and is restored byte-for-byte by install. Everything the',
    '# project DECLARES stays tracked at the top of .void/: config.json in',
    '# particular carries the pack pins and paths.business, which the enforcement',
    '# runner needs on a fresh clone.',
    `${VOID_DIR}/${VOID_MACHINE_DIR}/`,
    `${VOID_DIR}/${VOID_INSTALLED_DIR}/`,
    // The previous name stays covered on purpose. A migration that cannot finish
    // leaves `local/` on disk, and an ignore block that had already forgotten it
    // would make the next `git add .` commit the telemetry it was written to
    // keep out.
    `${VOID_DIR}/${VOID_PREVIOUS_MACHINE_DIR}/`,
    '',
    '# Runtime directories are regenerated by `void-harness init`. Absent, the',
    '# agent has fewer capabilities until the next init: it degrades, it does not',
    '# break. The two exceptions below are the opposite -- their absence is an',
    '# error, because .claude/settings.json names the hooks and .codex/hooks.json',
    '# IS the safety floor.',
    '# A skill this project wrote itself stays visible with one line of its own:',
    '#   !.claude/skills/my-skill/',
    '# `void-harness doctor` reports one that is ignored without it.',
    '.claude/*',
    '!.claude/settings.json',
    '!.claude/skills/',
    '.claude/skills/*',
    '.agents/*',
    '!.agents/skills/',
    '.agents/skills/*',
    '.codex/*',
    '!.codex/hooks.json',
    END_MARKER,
  ].join('\n');
}

/**
 * Add or refresh the managed block in a `.gitignore`, leaving every rule the
 * project wrote itself untouched. Idempotent: patching an already-patched file
 * with the same entries returns it unchanged.
 */
export function patchGitignore(original: string): string {
  const block = gitignoreBlock();
  const begin = original.indexOf(BEGIN_MARKER);
  const end = original.indexOf(END_MARKER);
  if (begin !== -1 && end !== -1) {
    const replaced = `${original.slice(0, begin)}${block}${original.slice(end + END_MARKER.length)}`;
    return replaced.endsWith('\n') ? replaced : `${replaced}\n`;
  }
  const base = original === '' || original.endsWith('\n') ? original : `${original}\n`;
  return `${base}${base === '' ? '' : '\n'}${block}\n`;
}
