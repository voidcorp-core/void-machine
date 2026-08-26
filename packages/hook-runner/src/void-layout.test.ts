import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyMaterialized,
  derivedIgnoreEntries,
  isOwnedDerived,
  MACHINE_ENTRIES,
  VOID_DIR,
  VOID_MACHINE_DIR,
  VOID_OWNERSHIP,
  migratedName,
  voidInstalledPath,
  gitignoreBlock,
  isMachineEntry,
  legacyVoidPath,
  ownershipOf,
  patchGitignore,
  pendingMigrations,
  voidMachinePath,
  voidReadPath,
} from './void-layout.js';

const temporary: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'void-layout-'));
  temporary.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('ownership decides what git keeps', () => {
  it('classes what the project authors as project state', () => {
    for (const entry of ['config.json', 'PROJECT-DOCTRINE.md', 'policies', 'profiles']) {
      expect(ownershipOf(entry), entry).toBe('project');
    }
  });

  it('classes what install reproduces from the pin as derived', () => {
    for (const entry of ['PHILOSOPHY.md', 'hooks']) expect(ownershipOf(entry), entry).toBe('derived');
  });

  it('treats a stranger at the top of .void as the project\'s own', () => {
    // `local/` is a closed set: every observed writer now writes inside it, so an
    // unrecognised path at the top cannot be our telemetry. Guessing "observed"
    // here would have doctor tell a project to untrack its own data — which is
    // exactly what it did for this repo's own `.void/harness-feedback/`.
    expect(ownershipOf('harness-feedback')).toBe('project');
    expect(isMachineEntry('harness-feedback')).toBe(false);
  });

  it('never moves derived state under local/, whatever git does with it', () => {
    // Derived state is regenerated in place by `install`; only its git treatment
    // is in question, never its location. Moving it would break the paths
    // `.claude/settings.json` and the runtimes resolve by name.
    expect(isMachineEntry('hooks')).toBe(false);
    expect(pendingMigrations('/nonexistent')).not.toContain('hooks');
  });
});

describe('the three natures of .void', () => {
  it('writes observed state under .void/machine, never beside what the project declares', () => {
    expect(voidMachinePath('/p', 'runs', 'mis_1')).toBe(join('/p', '.void', 'machine', 'runs', 'mis_1'));
  });

  /**
   * The rule the whole layout exists to make true: everything at the top of
   * `.void/` is committed, and the two subdirectories are not. It was false
   * before — PHILOSOPHY.md and hooks/ sat at the top while being ignored, so
   * "is this committed" had no answer you could see.
   */
  it('files what install restores under .void/installed', () => {
    expect(voidInstalledPath('/p', 'hooks')).toBe(join('/p', '.void', 'installed', 'hooks'));
    expect(ownershipOf('PHILOSOPHY.md')).toBe('derived');
    expect(ownershipOf('hooks')).toBe('derived');
  });

  it('leaves nothing derived at the top of .void', () => {
    const atTop = Object.keys(VOID_OWNERSHIP).filter((entry) => ownershipOf(entry) === 'project');
    for (const entry of atTop) expect(isMachineEntry(entry), entry).toBe(false);
    expect(atTop).toContain('config.json');
    expect(atTop).toContain('program.md');
    expect(atTop).not.toContain('active.md');
  });

  // Dropped: three policy layers referenced by code but present in none of the
  // park's projects. Removing them is safe precisely because they do not exist.
  it.each(['policies', 'profiles', 'organization'])('no longer knows %s', (entry) => {
    expect(Object.keys(VOID_OWNERSHIP)).not.toContain(entry);
  });

  /**
   * The three legacy telemetry streams stay CLASSIFIED even though nothing reads
   * or writes them any more. They still exist on disk across the park — 424 KB in
   * one project — and dropping them here would let them fall through to the
   * `project` default, at which point doctor tells those projects to commit their
   * own telemetry. "No longer read" is not "no longer there".
   */
  it.each(['activations.jsonl', 'outcomes.jsonl', 'usage.log'])(
    'still classifies the retired stream %s as observed',
    (entry) => {
      expect(ownershipOf(entry)).toBe('observed');
    },
  );

  it('keeps declared state at the top of .void, where git can see it', () => {
    // config.json and PROJECT-DOCTRINE.md are the two the project owns and ships.
    expect(isMachineEntry('config.json')).toBe(false);
    expect(isMachineEntry('PROJECT-DOCTRINE.md')).toBe(false);
  });

  /**
   * `autonomous-runs` holds PLANS, not run journals — measured on sesame, eight
   * committed `.plan.md` files carrying frozen model decisions that still govern
   * its schema. Classified as observed, doctor told the project to untrack its
   * own architecture decisions.
   *
   * Nothing writes it: it is a leftover of the `backlog-autopilot` engine deleted
   * at the 2026-07-30 cutover, and the current autopilot writes to
   * `machine/autopilot/`. So there is no writer to redirect — only a
   * classification to correct, and the fix is to leave those files where their
   * project committed them.
   */
  it('treats autonomous-runs as the project\'s own, not as machine state', () => {
    expect(ownershipOf('autonomous-runs')).toBe('project');
    expect(isMachineEntry('autonomous-runs')).toBe(false);
  });

  it('classifies every observed artifact as machine-owned', () => {
    for (const entry of ['runs', 'cache', 'outputs', 'generated', 'archives', 'autopilot', 'receipts', 'history', 'status.json', 'checkpoint.md']) {
      expect(isMachineEntry(entry), entry).toBe(true);
    }
  });

  /**
   * `state.json` named two different things: the snapshot `status` writes, and
   * an autopilot run's cursor. Only the first is renamed; the cursor keeps its
   * name inside its own run directory, where it is unambiguous.
   */
  it('renames only the status snapshot, never the autopilot cursor', () => {
    expect(isMachineEntry('status.json')).toBe(true);
    // The old name stays CLASSIFIED — it is still on disk in the park, and
    // forgetting it would have doctor ask those projects to commit it — while
    // the rename map sends it to its new name on migration.
    expect(ownershipOf('state.json')).toBe('observed');
    expect(migratedName('state.json')).toBe('status.json');
    // The autopilot cursor lives inside its own run directory and keeps its name.
    expect(migratedName('autopilot')).toBe('autopilot');
  });
});

describe('reading across the split', () => {
  it('prefers the migrated path', () => {
    const root = scratch();
    mkdirSync(join(root, VOID_DIR, VOID_MACHINE_DIR), { recursive: true });
    writeFileSync(join(root, VOID_DIR, VOID_MACHINE_DIR, 'runs'), '');

    expect(voidReadPath(root, 'runs')).toBe(voidMachinePath(root, 'runs'));
  });

  it('falls back through the previous machine directory before the flat root', () => {
    // A project migrated once already (local/) but not yet to machine/.
    const root = scratch();
    mkdirSync(join(root, VOID_DIR, 'local'), { recursive: true });
    writeFileSync(join(root, VOID_DIR, 'local', 'runs'), '');

    expect(voidReadPath(root, 'runs')).toBe(join(root, VOID_DIR, 'local', 'runs'));
  });

  it('falls back to the pre-split path so an unmigrated project keeps its history', () => {
    // The migration runs on `update`. Until it does, a reader that only knew the
    // new path would report a project with months of telemetry as having none.
    const root = scratch();
    mkdirSync(join(root, VOID_DIR), { recursive: true });
    writeFileSync(join(root, VOID_DIR, 'runs'), '');

    expect(voidReadPath(root, 'runs')).toBe(legacyVoidPath(root, 'runs'));
  });

  it('returns the migrated path when neither exists, so writers create the right one', () => {
    const root = scratch();

    expect(voidReadPath(root, 'runs')).toBe(voidMachinePath(root, 'runs'));
  });
});

describe('what update has to move', () => {
  it('reports nothing for a project already on the new layout', () => {
    const root = scratch();
    mkdirSync(join(root, VOID_DIR, VOID_MACHINE_DIR, 'runs'), { recursive: true });

    expect(pendingMigrations(root)).toEqual([]);
  });

  it('reports nothing for a project that never ran the harness', () => {
    expect(pendingMigrations(scratch())).toEqual([]);
  });

  it('lists only the observed artifacts left at the old location', () => {
    const root = scratch();
    mkdirSync(join(root, VOID_DIR, 'runs'), { recursive: true });
    writeFileSync(join(root, VOID_DIR, 'activations.jsonl'), '');
    writeFileSync(join(root, VOID_DIR, 'config.json'), '{}');
    writeFileSync(join(root, VOID_DIR, 'PROJECT-DOCTRINE.md'), '#');

    // config.json and the doctrine stay put: they are the reason the split exists.
    expect(pendingMigrations(root).sort()).toEqual(['activations.jsonl', 'runs']);
  });
});

describe('ownership comes from the receipt, never from the directory', () => {
  const RECEIPT = [
    '.claude/skills/tdd/SKILL.md',
    '.claude/skills/tdd/references/cycle.md',
    '.agents/skills/tdd/SKILL.md',
    '.claude/agents/doctrine-critic.md',
    '.void/installed/PHILOSOPHY.md',
    '.void/hooks/_void-hook.mjs',
    '.codex/hooks.json',
    '.claude/settings.json',
  ];

  it("never covers a skill the project wrote itself", () => {
    // THE regression this exists for. `.claude/skills/` is shared: Claude Code
    // reads a project's own skills from it and the harness merely also writes
    // there. Classifying the directory would ignore hand-written content and let
    // `--untrack-derived` drop it from the index.
    const entries = derivedIgnoreEntries(RECEIPT);

    expect(entries).not.toContain('.claude/skills/');
    expect(entries.some((entry) => entry.includes('custom'))).toBe(false);
    expect(isOwnedDerived('.claude/skills/custom/SKILL.md')).toBe(true);
    // ...but it is not in the receipt, so it never reaches an ignore entry:
    expect(derivedIgnoreEntries(['.claude/skills/custom/SKILL.md'])).toEqual(['.claude/skills/custom/']);
    expect(entries.filter((entry) => entry.startsWith('.claude/skills/'))).toEqual(['.claude/skills/tdd/']);
  });

  it('collapses an owned unit to its directory, so the block stays readable', () => {
    // Two receipt files under the same skill produce one entry, not two.
    expect(derivedIgnoreEntries(RECEIPT)).toContain('.claude/skills/tdd/');
  });

  it('lists a standalone owned file exactly', () => {
    expect(derivedIgnoreEntries(RECEIPT)).toContain('.void/installed/PHILOSOPHY.md');
  });

  it('does not collapse a flat unit root, where the unit IS the file', () => {
    // `.claude/agents/` holds files directly. Emitting
    // `.claude/agents/doctrine-critic.md/` with a trailing slash matches a
    // directory that does not exist, so git ignored none of them — caught by
    // dogfooding, not by the unit tests that preceded it.
    const entries = derivedIgnoreEntries(['.claude/agents/doctrine-critic.md']);

    expect(entries).toEqual(['.claude/agents/doctrine-critic.md']);
    expect(entries[0]?.endsWith('/')).toBe(false);
  });

  it('never lists what a fresh clone needs to work', () => {
    const entries = derivedIgnoreEntries(RECEIPT);

    expect(entries).not.toContain('.void/hooks/_void-hook.mjs');
    expect(entries).not.toContain('.codex/hooks.json');
    expect(isOwnedDerived('.void/hooks/_void-hook.mjs')).toBe(false);
    expect(isOwnedDerived('.codex/hooks.json')).toBe(false);
  });

  it('never lists project state, even when the receipt owns it', () => {
    expect(derivedIgnoreEntries(RECEIPT)).not.toContain('.claude/settings.json');
    expect(isOwnedDerived('.claude/settings.json')).toBe(false);
  });

  it('leaves anything outside the materialized surface alone', () => {
    expect(classifyMaterialized('src/index.ts')).toBeUndefined();
    expect(isOwnedDerived('src/index.ts')).toBe(false);
    expect(derivedIgnoreEntries(['src/index.ts'])).toEqual([]);
  });

  it('reads a Windows-style path the same way', () => {
    expect(derivedIgnoreEntries(['.claude\\skills\\tdd\\SKILL.md'])).toEqual(['.claude/skills/tdd/']);
  });

  it('covers the observed half of .void/, and never what the project declares', () => {
    const rules = gitignoreBlock().split('\n').filter((l) => l !== '' && !l.startsWith('#'));

    expect(rules).toContain('.void/machine/');
    expect(rules).toContain('.void/installed/');
    expect(rules).toContain('.void/local/');
    // config.json, PROJECT-DOCTRINE.md and hooks/ live at the top of .void/ and
    // are never named: the block ignores two subdirectories, not the directory.
    expect(rules).not.toContain('.void/');
    expect(rules.some((rule) => rule.startsWith('.void/hooks'))).toBe(false);
  });
});

describe('the ignore rule', () => {
  it('carries exactly the exceptions whose absence is an error, and no others', () => {
    // `.void/` needed no exception rule and still has none: a rescue rule there
    // is what once left config.json ignored. The runtime directories are the
    // opposite case, since collapsing them is only possible WITH an exception,
    // so the two are named -- and the git-backed suite above proves they rescue
    // anything at all, which the text of a block cannot show.
    const rules = gitignoreBlock().split('\n').filter((l) => l !== '' && !l.startsWith('#'));
    const rescues = rules.filter((rule) => rule.startsWith('!'));

    expect(rules).toContain('.void/machine/');
    expect(rules).toContain('.void/installed/');
    expect(rules).toContain('.void/local/');
    expect(rescues).toContain('!.claude/settings.json');
    expect(rescues).toContain('!.codex/hooks.json');
    expect(rules.filter((rule) => rule.startsWith('!.void'))).toEqual([]);
  });

  it('never names a load-bearing path, whatever the project holds', () => {
    const rules = gitignoreBlock().split('\n').filter((l) => l !== '' && !l.startsWith('#'));

    // Named from the tracked .claude/settings.json, so its absence breaks the
    // install rather than degrading it.
    expect(rules.some((rule) => rule.includes('.void/hooks'))).toBe(false);
    expect(rules).not.toContain('.void/config.json');
  });

  it('adds the block to a gitignore that has none', () => {
    const patched = patchGitignore('node_modules\n');

    expect(patched).toContain('node_modules');
    expect(patched).toContain('.void/local/');
  });

  it('is idempotent — patching twice changes nothing the second time', () => {
    const once = patchGitignore('node_modules\n');

    expect(patchGitignore(once)).toBe(once);
  });

  it('replaces its own block in place rather than appending a second one', () => {
    const stale = patchGitignore('node_modules\n').replace('.void/local/', '.void/OLD/');
    const patched = patchGitignore(stale);

    expect(patched).toContain('.void/local/');
    expect(patched).not.toContain('.void/OLD/');
    expect(patched.match(/void-harness:begin/g)).toHaveLength(1);
  });

  it('never touches rules the project wrote itself', () => {
    const patched = patchGitignore('node_modules\ndist/\n.env\n');

    for (const rule of ['node_modules', 'dist/', '.env']) expect(patched).toContain(rule);
  });

  it('ends with a newline, so the next appended rule is not glued to ours', () => {
    expect(patchGitignore('node_modules\n').endsWith('\n')).toBe(true);
  });
});

describe('MACHINE_ENTRIES', () => {
  it('is the single list both the ignore rule and the migration read', () => {
    // If these ever diverge, `update` moves a file the ignore rule does not
    // cover, and the next commit ships telemetry.
    for (const entry of MACHINE_ENTRIES) expect(isMachineEntry(entry)).toBe(true);
  });
});

// The managed block used to name every generated file one by one -- 148 lines to
// keep exactly two files tracked. Collapsing it to the directories is only safe
// if git actually behaves as intended, and it does not always: `.claude/`
// excludes the directory itself, and git then refuses to re-include anything
// under it, so `!.claude/settings.json` is silently dead. `.claude/*` descends
// into the directory and the exception works. That difference is invisible in
// the text of the block, so it is asserted against real git.
describe('the managed ignore block, as git reads it', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function repoWithBlock(): string {
    const root = mkdtempSync(join(tmpdir(), 'void-ignore-'));
    roots.push(root);
    spawnSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(join(root, '.gitignore'), `${gitignoreBlock()}\n`);
    return root;
  }

  const ignored = (root: string, path: string): boolean =>
    spawnSync('git', ['check-ignore', '-q', path], { cwd: root }).status === 0;

  function touch(root: string, path: string): void {
    const target = join(root, ...path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'x');
  }

  it('keeps the two files whose absence is an error, not a degradation', () => {
    const root = repoWithBlock();
    touch(root, '.claude/settings.json');
    touch(root, '.codex/hooks.json');
    expect(ignored(root, '.claude/settings.json')).toBe(false);
    expect(ignored(root, '.codex/hooks.json')).toBe(false);
  });

  it('ignores what the harness regenerates, whatever its name', () => {
    const root = repoWithBlock();
    touch(root, '.claude/skills/tdd/SKILL.md');
    touch(root, '.claude/agents/doctrine-critic.md');
    touch(root, '.agents/skills/verify/SKILL.md');
    touch(root, '.codex/agents/solution-architect.md');
    expect(ignored(root, '.claude/skills/tdd/SKILL.md')).toBe(true);
    expect(ignored(root, '.claude/agents/doctrine-critic.md')).toBe(true);
    expect(ignored(root, '.agents/skills/verify/SKILL.md')).toBe(true);
    expect(ignored(root, '.codex/agents/solution-architect.md')).toBe(true);
  });

  it('lets a project re-include a skill it wrote itself, which is the whole risk of collapsing', () => {
    const root = repoWithBlock();
    touch(root, '.claude/skills/ma-skill/SKILL.md');
    expect(ignored(root, '.claude/skills/ma-skill/SKILL.md')).toBe(true);
    const current = readFileSync(join(root, '.gitignore'), 'utf8');
    writeFileSync(join(root, '.gitignore'), `${current}\n!.claude/skills/ma-skill/\n`);
    expect(ignored(root, '.claude/skills/ma-skill/SKILL.md')).toBe(false);
  });

  it('stays short, because 148 lines to protect two files is what this replaces', () => {
    expect(gitignoreBlock().split('\n').filter((line) => !line.startsWith('#')).length).toBeLessThan(20);
  });
});
