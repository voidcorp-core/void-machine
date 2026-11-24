// `void-machine doctor` — health-check the project's harness setup.
//
// Verifies:
//   1. .void/config.json valid JSON
//   2. .void/PHILOSOPHY.md + .void/PROJECT-DOCTRINE.md present
//   3. .claude/settings.json has extraKnownMarketplaces.void-machine + at
//      least harness@voidcorp in enabledPlugins
//   4. CLAUDE.md contains the void-machine block
// Remote version comparisons belong to `check`; doctor only inspects local state.

import { execFileSync } from 'node:child_process';
import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isMachineEntry,
  pendingMigrations,
  PRODUCT_COMMAND,
  VOID_MACHINE_DIR,
} from '@voidcorp/hook-runner';
import { autopilotPreflight } from '../lib/autopilot/preflight.js';
import { readAutopilotAuthority } from '../lib/autopilot/authority.js';
import { packsCoherenceIssues, validateConfig } from '../lib/config-schema.js';
import { checkGlyph, checkShowsFix } from '../lib/doctor-render.js';
import { INSTALL_MANIFEST_PATH, parseInstallManifest, verifyInstallManifest } from '../lib/install-manifest.js';
import { inspectHarnessLintExclusion } from '../lib/lint-exclusion.js';
import { observeKeptTracked } from '../lib/git-exclude.js';
import { type ObservedPathObservation, observedWriteCandidates } from '../lib/observed-write-paths.js';
import { type DiscoveredAsset, looksHarnessAuthored, orphanedAssets } from '../lib/orphaned-assets.js';
import { CORE_PLUGIN_NAME, packDirForName } from '../lib/packs.js';
import { cliVersion, findCoreSource } from '../lib/paths.js';
import { remedyPrefix, resolveProjectRoots } from '../lib/project-roots.js';
import { type CheckResult, checkEnforceWorkflow } from '../lib/prerequisites.js';
import { readInstallReceipt } from '../lib/receipts.js';
import { banner, blank, c, footer, glyph, line, meta } from '../lib/render.js';
import {
  judgeRunnerStaleness,
  runnerStalenessCheck,
  suspendedStructureNote,
  suspendsStructureChecks,
} from '../lib/runner-staleness.js';
import { detectedAdapters } from '../lib/runtime-adapters.js';
import { localPackAssetIssues } from '../lib/runtime-assets.js';
import { readSettings, settingsPathFor } from '../lib/settings.js';
import { judgeLayout, judgeProjectSkills, type LayoutObservation, type ManifestObservation, type ReceiptObservation } from '../lib/void-hygiene.js';
import { ownedDerivedPaths } from '../lib/void-migration.js';

/** Plain pack names (no @voidcorp/ prefix, core excluded) pinned in config.packs. */
function configPackNames(config: { packs?: Record<string, string> }): string[] {
  return Object.keys(config.packs ?? {})
    .map((k) => k.replace(/^@voidcorp\//, ''))
    .filter((name) => name !== CORE_PLUGIN_NAME);
}

/** Plain pack names enabled (=== true) in settings.enabledPlugins, core excluded. */
function enabledPackNames(plugins: Record<string, unknown>): string[] {
  return Object.keys(plugins)
    .filter((k) => plugins[k] === true)
    .map((k) => k.split('@')[0] ?? '')
    .filter((name) => name.length > 0 && name !== CORE_PLUGIN_NAME);
}

function declaresAutopilot(root: string): boolean {
  try {
    return readAutopilotAuthority(root) !== undefined;
  } catch {
    // Ambiguity is still a declaration. The parser owns the actionable error.
    return true;
  }
}

/**
 * The version the project records for its installed harness. Anchored on
 * `.void/install-manifest.json` because that path is committed and has survived
 * every layout change: reading it from a directory a stale CLI does not know
 * about would reproduce the very blindness this guards against.
 */
function readManifestVersion(root: string): string | undefined {
  const path = join(root, INSTALL_MANIFEST_PATH);
  if (!existsSync(path)) return undefined;
  try {
    return parseInstallManifest(readFileSync(path, 'utf8'))?.version;
  } catch {
    return undefined;
  }
}

export async function doctor(args: readonly string[]): Promise<void> {
  const removed = args.find((arg) => arg === '--fix' || arg === '--dry-run');
  if (removed !== undefined) {
    process.stderr.write(`doctor ${removed} was removed; doctor only reports local installation health\n`);
    process.exitCode = 2;
    return;
  }
  // --no-remote remains a compatible no-op: every doctor run is local.
  const checks: CheckResult[] = [];
  // What doctor judges is the installation, and the installation belongs to
  // the repository: from a linked worktree that is the main checkout, where
  // `init` put the assets git was told not to carry. Judged against the tree
  // it ran in, doctor read a healthy repository as an absent install (DEV-732).
  const roots = resolveProjectRoots();
  const root = roots.installRoot;
  // Every remedy names the installation when it differs from the working tree.
  const where = remedyPrefix(roots);

  // A CLI older than the installed layout must suspend structural diagnostics:
  // it could otherwise report correct files missing and recommend a harmful repair.
  const staleness = judgeRunnerStaleness({
    running: cliVersion(),
    recorded: readManifestVersion(root),
  });
  const stale = runnerStalenessCheck(staleness);
  if (stale !== undefined && suspendsStructureChecks(staleness)) {
    const suspended = suspendedStructureNote(staleness);
    banner('doctor');
    blank();
    line(`${c.red('x')}  ${c.dim(stale.name.padEnd(18))} ${stale.message}`);
    if (stale.fix !== undefined) line(c.dim(`     ${glyph.to} ${where}${stale.fix}`));
    line(`${c.dim('-')}  ${c.dim(suspended.name.padEnd(18))} ${suspended.message}`);
    footer(c.red('1 check failed, this project\'s structure was not judged'));
    process.exit(1);
  }

  // Parsed config is reused by the schema check AND the settings<->config
  // coherence check further down, so capture it once here.
  let parsedConfig: { packs?: Record<string, string> } & Record<string, unknown> = {};
  let configReadable = false;

  const configPath = join(root, '.void', 'config.json');
  if (!existsSync(configPath)) {
    checks.push({ name: 'project config', ok: false, message: '.void/config.json missing', fix: `${PRODUCT_COMMAND} init` });
  } else {
    try {
      parsedConfig = JSON.parse(await readFile(configPath, 'utf8'));
      configReadable = true;
      // Shape validation, not just parseability: a mistyped path / non-semver
      // pin passes JSON.parse but breaks a hook later, so report it with its
      // JSON path (#68).
      const validation = validateConfig(parsedConfig);
      if (validation.ok) {
        checks.push({
          name: 'project config',
          ok: true,
          message: validation.warnings.length === 0
            ? 'valid JSON + schema'
            : `valid with migration warning: ${validation.warnings.join('; ')}`,
        });
      } else {
        checks.push({
          name: 'project config',
          ok: false,
          message: `schema errors: ${validation.issues.join('; ')}`,
          fix: 'fix the fields above in .void/config.json',
        });
      }
    } catch (err) {
      checks.push({ name: 'project config', ok: false, message: `invalid JSON: ${(err as Error).message}` });
    }
  }

  // New home first, previous one until the project runs `update`: a doctrine
  // reported missing while it sits one directory away is a false alarm that
  // sends someone reinstalling for nothing.
  const havePhilo =
    existsSync(join(root, '.void', 'PHILOSOPHY.md'))
    || existsSync(join(root, '.void', 'installed', 'PHILOSOPHY.md'));
  const doctrinePath = join(root, '.void', 'PROJECT-DOCTRINE.md');
  const haveDoctrine = existsSync(doctrinePath);
  if (havePhilo && haveDoctrine) {
    checks.push({ name: 'doctrine files', ok: true, message: 'PHILOSOPHY.md + PROJECT-DOCTRINE.md present' });
  } else {
    const missing = [!havePhilo && 'PHILOSOPHY.md', !haveDoctrine && 'PROJECT-DOCTRINE.md'].filter(Boolean).join(', ');
    checks.push({ name: 'doctrine files', ok: false, message: `missing: ${missing}`, fix: `${PRODUCT_COMMAND} init` });
  }

  // Runtime-specific health: each DETECTED runtime's adapter verifies its own
  // wiring + doctrine doc. Docs are per-runtime now, so a Codex-only project is
  // never dinged for a missing CLAUDE.md, and vice versa. The command never
  // branches on a runtime name — it iterates the detected adapters.
  const detected = detectedAdapters(root);
  const claudeDetected = detected.some((a) => a.id === 'claude');
  const receipt = await readInstallReceipt(root);
  if (detected.length === 0) {
    // No footprint at all ⇒ nothing is wired. Without this, a project that has
    // .void/config.json but no CLAUDE.md/.claude or AGENTS.md/.codex would run
    // zero wiring checks and falsely report "all checks passed".
    checks.push({
      name: 'runtimes',
      ok: false,
      message: 'no agent runtime wired (no CLAUDE.md/.claude or AGENTS.md/.codex)',
      fix: `${PRODUCT_COMMAND} init, or ${PRODUCT_COMMAND} runtime add <claude|codex>`,
    });
  }
  for (const adapter of detected) {
    const inspection = await adapter.inspect(root);
    checks.push(...inspection.checks);
    const show = (value: boolean | null): string =>
      value === null ? 'unknown' : value ? 'yes' : 'no';
    const lifecycleUnknown = Object.values(inspection.evidence)
      .some((value) => value === null);
    checks.push({
      name: `${adapter.id} lifecycle`,
      ok: inspection.evidence.fired === true,
      ...(lifecycleUnknown ? { status: 'unknown' as const } : {}),
      message: [
        `installed=${show(inspection.evidence.installed)}`,
        `wired=${show(inspection.evidence.wired)}`,
        `fired=${show(inspection.evidence.fired)}`,
        `observed=${show(inspection.evidence.observed)}`,
      ].join(' '),
      ...(inspection.evidence.fired === true
        ? {}
        : { fix: `${PRODUCT_COMMAND} runtime add ${adapter.id}` }),
    });
  }

  // Coherence: a pack enabled in settings.json but not pinned in config (or the
  // reverse). Claude-marketplace concern — only when Claude is wired and both
  // files are readable (#68).
  if (configReadable && receipt?.source === 'local') {
    const packNames = configPackNames(parsedConfig);
    const packDirectories = packNames
      .map(packDirForName)
      .filter((directory): directory is string => directory !== undefined);
    let issues: string[];
    try {
      issues = await localPackAssetIssues(
        root,
        await findCoreSource(),
        packDirectories,
        detected.map((adapter) => adapter.id),
      );
    } catch (error) {
      issues = [`could not inspect bundled pack assets: ${(error as Error).message}`];
    }
    checks.push(issues.length === 0
      ? { name: 'packs coherence', ok: true, message: 'local pack assets match .void/config.json' }
      : {
          name: 'packs coherence',
          ok: false,
          message: issues.join('; '),
          fix: `${PRODUCT_COMMAND} init to reconcile local pack assets`,
        });
  } else if (claudeDetected && configReadable && existsSync(settingsPathFor(root))) {
    const settings = await readSettings(settingsPathFor(root));
    const issues = packsCoherenceIssues(enabledPackNames(settings.enabledPlugins ?? {}), configPackNames(parsedConfig));
    if (issues.length === 0) {
      checks.push({ name: 'packs coherence', ok: true, message: 'settings.json ⇄ .void/config.json in sync' });
    } else {
      checks.push({
        name: 'packs coherence',
        ok: false,
        message: issues.join('; '),
        fix: `${PRODUCT_COMMAND} add/remove <pack> to realign, or edit .void/config.json`,
      });
    }
  }

  // Runtime-independent, ownership-scoped advice; diagnostics never edit project config.
  checks.push(...await inspectHarnessLintExclusion(root));

  // Advisory: is the same floor also enforced server-side (void-enforce
  // Action)? Never a blocker (ok stays true).
  checks.push(checkEnforceWorkflow(root));

  // Layout hygiene: does this project actually keep observed state out of its
  // history? Proven with git, not inferred from the ignore file being present.
  checks.push(...judgeLayout(await observeLayout(root)));

  // The one thing the collapsed ignore block can swallow: a skill this project
  // wrote by hand, beside the ones the harness generates.
  checks.push(judgeProjectSkills(observeIgnoredProjectSkills(root)));

  // Autopilot's preconditions, but only for a project that declares a program:
  // adding seven checks to every other project would be noise about a feature
  // they do not use. Non-mutating throughout — doctor must stay safe to run
  // while a cluster is in flight, so nothing here touches a tracker, a remote
  // or a git ref, and what it cannot read reports as unknown rather than false.
  if (declaresAutopilot(root)) {
    checks.push(...autopilotPreflight(observeAutopilot(root)));
  } else {
    // Naming the path, because silence is the one answer a reader cannot tell
    // from not having looked. A project whose programme sat at another name got
    // eight autopilot lines at one path and none at the other, and the empty
    // report read as "no active programme" rather than "I looked over there".
    checks.push({
      name: 'autopilot authority',
      ok: true,
      status: 'pass',
      message: 'no config.autopilot declaration; historical programmes grant no authority; migrate explicitly to schemaVersion: 3 for autonomous work',
    });
  }

  banner('doctor');
  blank();
  if (roots.workRoot !== roots.installRoot) {
    // Named only when they differ: in the main checkout there is one root and
    // nothing to explain. From a worktree, the reader must know which install
    // the checks below describe.
    meta('work tree', roots.workRoot);
    meta('installed', roots.installRoot);
    blank();
  }
  for (const check of checks) {
    const marks: Record<ReturnType<typeof checkGlyph>, string> = {
      unknown: c.yellow('?'),
      // Dim and distinct from `?`: nothing here asks anything of the reader.
      unprobed: c.dim('-'),
      advisory: c.yellow('!'),
      pass: c.green(glyph.check),
      fail: c.red('x'),
    };
    // A separator of its own: padding alone collapses for any name at or over
    // the width, which is how `autopilot worktrees` printed as
    // `worktreesworktrees usable`.
    line(`${marks[checkGlyph(check)]}  ${c.dim(check.name.padEnd(18))} ${check.message}`);
    if (checkShowsFix(check) && check.fix) line(c.dim(`     ${glyph.to} ${where}${check.fix}`));
  }

  // Unknown is not failure. A check that could not reach a tracker has not
  // found a defect, and counting it as one made `doctor` report `4 checks
  // failed` where two things were broken and two were unmeasured — the same
  // conflation this repo refuses everywhere else.
  const unknown = checks.filter((check) => check.status === 'unknown').length;
  const unprobed = checks.filter((check) => check.status === 'unprobed').length;
  const advisory = checks.filter((check) => check.status === 'advisory').length;
  const blockers = checks.filter(
    (check) => !check.ok && check.status !== 'unknown' && check.status !== 'unprobed',
  ).length;
  const notes = [
    unknown > 0 ? `${unknown} unknown` : undefined,
    // Named apart in the summary too, so "2 not probed" never reads as two
    // things left to investigate (#193).
    unprobed > 0 ? `${unprobed} not probed (proven by autopilot at preflight)` : undefined,
    advisory > 0 ? `${advisory} advisory` : undefined,
  ].filter((note): note is string => note !== undefined);
  if (blockers === 0) {
    // Never "all checks passed" while a line above says otherwise: a summary
    // that contradicts its own body teaches people to skip the summary.
    footer(notes.length === 0
      ? c.dim('all checks passed')
      : c.yellow(`no blocker; ${notes.join(', ')}`));
  } else {
    footer(c.red([`${blockers} check${blockers > 1 ? 's' : ''} failed`, ...notes].join(', ')));
    process.exit(1);
  }
}

/** Read the committed manifest and check the assets against it. Never throws. */
function observeManifest(root: string): ManifestObservation {
  const path = join(root, ...INSTALL_MANIFEST_PATH.split('/'));
  if (!existsSync(path)) return { kind: 'absent' };
  let manifest: ReturnType<typeof parseInstallManifest>;
  try {
    manifest = parseInstallManifest(readFileSync(path, 'utf8'));
  } catch {
    return { kind: 'unreadable' };
  }
  if (manifest === undefined) return { kind: 'unreadable' };
  const report = verifyInstallManifest(root, manifest);
  return {
    kind: 'present',
    version: manifest.version,
    drifted: report.missingTotal + report.mismatchedTotal,
    // Both halves, already capped by the verification. Naming them is the whole
    // difference between "something moved" and a path to open.
    driftedPaths: [...report.missing, ...report.mismatched],
    coEdited: report.coEditedTotal,
  };
}

/**
 * Compare the local install receipt against the disk.
 *
 * The receipt records what this machine actually wrote. Unlike the manifest it
 * is not tracked, so a `git checkout` cannot revert it alongside the working
 * tree -- which makes it the only record that still names the assets when they
 * have been removed underneath the harness.
 *
 * Only the first few missing paths are carried: the message names a count and
 * an example, and a hundred paths in a terminal check is noise, not evidence.
 */
async function observeReceipt(root: string): Promise<ReceiptObservation> {
  let receipt: Awaited<ReturnType<typeof readInstallReceipt>>;
  try {
    receipt = await readInstallReceipt(root);
  } catch {
    return { kind: 'unreadable' };
  }
  if (receipt === undefined) return { kind: 'absent' };
  const missing = receipt.files
    .map((file) => file.path)
    .filter((path) => !existsSync(join(root, ...path.split('/'))));
  return {
    kind: 'present',
    version: receipt.version,
    missing: missing.slice(0, 3),
    missingTotal: missing.length,
  };
}

/**
 * Ask git what it actually does with observed state, rather than trusting that
 * the ignore block is present: a rule can be absent, overridden by a later rule,
 * or powerless because the path was tracked before the rule existed.
 *
 * Read-only — `check-ignore` and `ls-files` mutate nothing — and every failure to
 * ask resolves to "could not determine", never to a false clean bill.
 */
async function observeLayout(root: string): Promise<LayoutObservation> {
  const owned = await ownedDerivedPaths(root);
  const git = (args: readonly string[]): string | null => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return null;
    }
  };

  const insideRepo = git(['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';
  const observedPaths = observeObservedPaths(root, insideRepo);
  if (!insideRepo) {
    return {
      pending: pendingMigrations(root),
      localIgnored: null,
      observedPaths,
      keptTracked: observeKeptTracked(root),
      trackedObserved: [],
      trackedDerivedCount: 0,
      orphanedAssets: observeOrphanedAssets(root),
      manifest: observeManifest(root),
      receipt: await observeReceipt(root),
    };
  }

  // `check-ignore` exits non-zero when the path is NOT ignored, which the helper
  // turns into null; here that is a real answer, not an unknown.
  const probe = join('.void', 'local', '.probe');
  const localIgnored = git(['check-ignore', '-q', probe]) !== null;

  // Both halves: the migrated location and anything observed still tracked at the
  // old one. A project mid-migration leaks through the second.
  const listed = git(['ls-files', '-z', '--', '.void']) ?? '';
  const tracked = listed.split('\0').filter((path) => path !== '');
  const trackedObserved = tracked.filter((path) => {
    const relative = path.startsWith('.void/') ? path.slice('.void/'.length) : path;
    if (relative.startsWith(`${VOID_MACHINE_DIR}/`)) return true;
    return isMachineEntry(relative.split('/')[0] ?? '');
  });

  // Regenerated content still in the index — counted from what the MANIFEST
  // claims, never from the directory. `.claude/skills/` also holds skills the
  // project wrote itself, and telling someone to untrack their own work would be
  // the worst advice this command could give.
  const materialized = git(['ls-files', '-z', '--', '.void', '.claude', '.agents', '.codex']) ?? '';
  const trackedDerivedCount = owned === undefined
    ? 0
    : materialized.split('\0').filter((path) => path !== '' && owned.has(path.split('\\').join('/'))).length;

  return {
    pending: pendingMigrations(root),
    localIgnored,
    observedPaths,
    keptTracked: observeKeptTracked(root),
    trackedObserved,
    trackedDerivedCount,
    orphanedAssets: observeOrphanedAssets(root),
    manifest: observeManifest(root),
    receipt: await observeReceipt(root),
  };
}

/**
 * Ask git whether it ignores one path.
 *
 * `undefined` is reserved for "the question went unanswered". git exits 1 for a
 * path it does not ignore, and that is a measured fact, not a failure to
 * measure: collapsing the two would let a missing git report every project as
 * leaking.
 */
function gitIgnores(root: string, probe: string): boolean | undefined {
  try {
    execFileSync('git', ['check-ignore', '-q', probe], { cwd: root, stdio: 'ignore' });
    return true;
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    return status === 1 ? false : undefined;
  }
}

/**
 * Where observed state can land in THIS project, proven path by path.
 *
 * Only what exists on disk is probed. An absent path is never reported, so
 * spending a process to ask about it would buy an answer nobody reads, and the
 * candidate list is a frozen constant, so the loop is bounded by construction.
 */
/**
 * Assets on disk that carry the harness's own frontmatter and that the manifest
 * does not own. Only the runtime asset directories are walked: those are the
 * only places the harness has ever written a SKILL.md, and walking a whole
 * project to answer a question about our own output would cost far more than the
 * answer is worth.
 */
function observeOrphanedAssets(root: string): readonly string[] {
  const manifestPath = join(root, INSTALL_MANIFEST_PATH);
  if (!existsSync(manifestPath)) return [];
  let owned: ReadonlySet<string>;
  try {
    const manifest = parseInstallManifest(readFileSync(manifestPath, 'utf8'));
    if (manifest === undefined) return [];
    owned = new Set(manifest.files.map((file) => file.path));
  } catch {
    return [];
  }

  const discovered: DiscoveredAsset[] = [];
  const walk = (relative: string): void => {
    let entries: readonly string[];
    try {
      entries = readdirSync(join(root, relative));
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = `${relative}/${entry}`;
      const absolute = join(root, child);
      let isDirectory = false;
      try {
        isDirectory = statSync(absolute).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) {
        walk(child);
        continue;
      }
      if (!entry.endsWith('.md')) continue;
      try {
        discovered.push({
          path: child,
          harnessAuthored: looksHarnessAuthored(readFileSync(absolute, 'utf8')),
        });
      } catch {
        // Unreadable is not evidence of anything; say nothing about it.
      }
    }
  };
  for (const dir of ['.claude/skills', '.claude/agents', '.claude/commands', '.agents/skills']) {
    walk(dir);
  }
  return orphanedAssets(discovered, owned);
}

function observeObservedPaths(root: string, insideRepo: boolean): readonly ObservedPathObservation[] {
  return observedWriteCandidates().map((candidate) => {
    const present = existsSync(join(root, ...candidate.path.split('/')));
    return {
      path: candidate.path,
      present,
      ignored: present && insideRepo ? gitIgnores(root, candidate.probe) : undefined,
    };
  });
}

/**
 * Observe autopilot's preconditions without touching anything.
 *
 * The two remote-backed facts — is the tracker reachable, is the base protected
 * — are deliberately left unprobed. Probing them here would make `doctor` depend
 * on a network and a token, and `--no-remote` promises a fully offline run.
 * Autopilot itself proves both at preflight, before it claims; this reports what
 * can be read from disk.
 *
 * They report as `unprobed`, not `unknown`, so the reason reaches the reader:
 * `unknown` earned a "reconfigure and run it again" fix that no configuration
 * could ever satisfy here, and operators paid for the detour (#193).
 */
function observeAutopilot(root: string): Parameters<typeof autopilotPreflight>[0] {
  let program: ReturnType<typeof readAutopilotAuthority>;
  let malformed: { problem: string; fix: string } | undefined;
  try {
    program = readAutopilotAuthority(root);
  } catch (error) {
    // A malformed program is reported by the check below as a failure of the
    // program, not as a crash of doctor — and as malformed, not as absent.
    // Collapsing both into absence printed "no program" in front of a file
    // that was right there, and threw away the parser's own verdict, which is
    // exactly the thing the reader needs (#193).
    const failure = (error as { failure?: { problem?: unknown; fix?: unknown } }).failure;
    malformed = {
      problem: typeof failure?.problem === 'string' ? failure.problem : 'config.autopilot is not readable',
      fix:
        typeof failure?.fix === 'string'
          ? failure.fix
          : 'fix the config.autopilot declaration, then run doctor again',
    };
  }

  return {
    authority:
      malformed !== undefined
        ? { malformed }
        : program === undefined
          ? undefined
          : {
              status: program.status,
              source: program.source,
              autopilotConsentWithheld: program.autopilotConsentWithheld,
              // Absent means the program opted out, which preflight reports as
              // such. Reporting an empty block instead would read as consent.
              ...(program.autopilot === undefined ? {} : {
                autopilot: {
                  clusterSize: program.autopilot.clusterSize,
                  schemaVersion: program.autopilot.schemaVersion,
                  // Carried so the merge check can name where the loop never
                  // merges; absent, that is the repository default branch.
                  // Spread rather than set: under exactOptionalPropertyTypes an
                  // explicit `undefined` is not the same as an absent key, and
                  // absent is what "the program did not say" means here.
                  ...(program.autopilot.deployBranch === undefined
                    ? {}
                    : { deployBranch: program.autopilot.deployBranch }),
                  base: program.autopilot.base,
                  verifyCommands: program.autopilot.verifyCommands,
                },
              }),
            },
    adapters: detectedAdapters(root).map((adapter) => adapter.id),
    trackerConnector: 'unprobed',
    worktreesUsable: existsSync(join(root, '.git')) ? true : null,
    baseProtected: 'unprobed',
  };
}
/**
 * Hand-written skills that git no longer sees.
 *
 * A skill is the project's when the install manifest does not claim it. Asked of
 * git rather than inferred, because whether a path is ignored depends on every
 * rule in every `.gitignore` above it, and only git knows the answer.
 *
 * Returns nothing when there is no manifest to compare against: without it every
 * skill would look hand-written, and a check that cries on all 41 is a check that
 * gets ignored.
 */
function observeIgnoredProjectSkills(root: string): string[] {
  let owned: ReadonlySet<string>;
  try {
    const manifest = parseInstallManifest(readFileSync(join(root, INSTALL_MANIFEST_PATH), 'utf8'));
    if (manifest === undefined) return [];
    owned = new Set(manifest.files.map((file) => file.path));
  } catch {
    return [];
  }
  const ignored: string[] = [];
  for (const home of ['.claude/skills', '.agents/skills']) {
    let entries: Dirent[];
    try {
      entries = readdirSync(join(root, ...home.split('/')), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const relative = `${home}/${entry.name}`;
      if ([...owned].some((path) => path.startsWith(`${relative}/`))) continue;
      // `check-ignore` exits 0 when the path IS ignored and non-zero when it is
      // not, which the sync helper turns into a throw. The throw is the answer
      // "git can see it", not a failure.
      try {
        execFileSync('git', ['check-ignore', '-q', `${relative}/`], {
          cwd: root,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        ignored.push(relative);
      } catch {
        // Visible to git: nothing to report.
      }
    }
  }
  return ignored;
}
