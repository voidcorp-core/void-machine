// `void-machine init` — wire the current project to the void-machine Claude
// Code marketplace and activate the requested plugins.
//
// What this command does (idempotent):
//   1. Create .void/config.json (paths, commands, modes)
//   2. Copy PHILOSOPHY.md into .void/installed/ (managed, restorable)
//   3. Seed .void/PROJECT-DOCTRINE.md from the template, or refresh it while
//      the project has still never written into it
//   4. Merge `.claude/settings.json` with `extraKnownMarketplaces.void-machine`
//      pointing to the GitHub repo, and `enabledPlugins` for the chosen packs
//   5. Patch CLAUDE.md (and its Codex sister AGENTS.md) with the void-machine
//      block (doctrine imports + skill summary)
//
// This command does NOT copy skills/agents/hooks — Claude Code fetches the
// plugin from the marketplace on session start. Skills appear as
// /harness:void-tdd, /harness-nextjs:..., etc.

import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRODUCT_COMMAND, stripManagedBlock } from '@voidcorp/hook-runner';
import { PROJECT_DOCTRINE_PATH } from '../lib/co-owned.js';
import { observeKeptTracked, writeExcludeBlock } from '../lib/git-exclude.js';
import { isUntouchedSinceInstall, readInstallManifest, sha256Of } from '../lib/install-manifest.js';
import * as p from '@clack/prompts';
import {
  prepareInstallCommit,
  seedInstallStage,
  stageInstallManifest,
  withholdProjectOwned,
} from '../lib/local-install.js';
import { type PackConfig, resolveEffectivePin } from '../lib/pack-config.js';
import { configSchema } from '../lib/config-schema.js';
import {
  CORE_PLUGIN_NAME,
  findPack,
  MARKETPLACE_REPO,
  PACKS,
  type PackDescriptor,
} from '../lib/packs.js';
import { cliVersion, findCoreSource } from '../lib/paths.js';
import type { CheckResult } from '../lib/prerequisites.js';
import { resolveCorePin } from '../lib/remote.js';
import { banner, blank, c, footer, glyph, line, meta } from '../lib/render.js';
import {
  detectRuntimes,
  parseRuntimeArg,
  type Runtime,
  resolveRuntimes,
} from '../lib/runtime.js';
import { adaptersFor } from '../lib/runtime-adapters.js';
import type { InstallSource } from '../lib/runtime-assets.js';
import { isHarnessSourceRepo } from '../lib/self-repo.js';
import { commandsFor, detectStack, type Stack } from '../lib/stack.js';
import { commitFileTransaction } from '../lib/transaction.js';
import { assertProjectCompatibility } from '../lib/update-compatibility.js';
import { inspectInstallProjection, type InstallPreparation } from '../lib/install-plan.js';

interface InitOptions {
  readonly explicitPacks: readonly string[];
  readonly allPacks: boolean;
  readonly interactive: boolean;
  readonly force: boolean;
  /**
   * Internal: keep the doctrine this installation already carries instead of
   * writing the packaged copy over it. `update` sets it on the source repo,
   * where the doctrine is the original rather than a copy of it.
   */
  readonly preserveDoctrine: boolean;
  /** Internal pack lifecycle mode: config.packs becomes exactly explicitPacks. */
  readonly replacePacks: boolean;
  readonly marketplaceRepo: string;
  readonly source: InstallSource;
  readonly explicitRuntimes: readonly Runtime[];
  /** Raw `--runtime` values that parsed to no known runtime (e.g. a typo), for a loud warning. */
  readonly invalidRuntimeArgs: readonly string[];
}

function parseArgs(args: readonly string[]): InitOptions {
  const explicitPacks: string[] = [];
  const explicitRuntimes: Runtime[] = [];
  const invalidRuntimeArgs: string[] = [];
  let allPacks = false;
  let interactive = true;
  let force = false;
  let preserveDoctrine = false;
  let replacePacks = false;
  let marketplaceRepo = MARKETPLACE_REPO;
  const source = resolveInstallSource(args);

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] ?? '';
    if (a === '--pack' && i + 1 < args.length) {
      const next = args[i + 1];
      if (next !== undefined) explicitPacks.push(next);
      i += 1;
    } else if (a === '--all-packs') {
      allPacks = true;
    } else if (a === '--no-interactive') {
      interactive = false;
    } else if (a === '--force') {
      force = true;
    } else if (a === '--preserve-doctrine') {
      preserveDoctrine = true;
    } else if (a === '--replace-packs') {
      replacePacks = true;
    } else if (a === '--marketplace-repo' && i + 1 < args.length) {
      const next = args[i + 1];
      if (next !== undefined) marketplaceRepo = next;
      i += 1;
    } else if (a === '--runtime' && i + 1 < args.length) {
      const next = args[i + 1];
      if (next !== undefined) {
        const parsed = parseRuntimeArg(next);
        // A --runtime value that yields nothing (typo like "claud") must not
        // silently fall back to "both" — record it so init can warn and stop.
        if (parsed.length === 0) invalidRuntimeArgs.push(next);
        else explicitRuntimes.push(...parsed);
      }
      i += 1;
    }
  }

  // If --pack flags are present, default to non-interactive (script-friendly).
  if (explicitPacks.length > 0 || allPacks) interactive = false;

  return { explicitPacks, allPacks, interactive, force, preserveDoctrine, replacePacks, marketplaceRepo, source, explicitRuntimes, invalidRuntimeArgs };
}

export function resolveInstallSource(args: readonly string[]): InstallSource {
  if (args.includes('--marketplace')) return 'marketplace';
  const index = args.indexOf('--source');
  return index >= 0 && args[index + 1] === 'marketplace' ? 'marketplace' : 'local';
}

interface ConfigSeed {
  /** undefined when the marketplace was unreachable: never write a stale pin (#67). */
  readonly pinVersion: string | undefined;
  readonly stack: Stack;
}

export function buildDefaultConfig(seed: ConfigSeed): Record<string, unknown> & { packs: Record<string, string> } {
  const config: Record<string, unknown> & { packs: Record<string, string> } = {
    packs: {} as Record<string, string>,
    stack: { ...seed.stack },
    paths: {
      business: 'apps/*/src/**',
      tests: 'apps/*/src/**/*.test.{ts,tsx}',
      spikes: 'apps/*/scripts/spike-*',
      serverActions: 'apps/*/src/app/(api|actions)/**',
      contracts: 'apps/*/src/lib/contracts/**',
      e2e: 'apps/*/tests/e2e/**',
    },
    commands: commandsFor(seed.stack),
    modes: { tdd: 'auto', codeReview: 'auto' },
  };
  // Only pin `core` when a real version was resolved. An unresolved pin is left
  // absent (surfaced in the final checklist) rather than defaulted to a stale
  // literal, which would silently freeze the install at a wrong version (#67).
  if (seed.pinVersion !== undefined) config.core = `^${seed.pinVersion}`;
  return config;
}

/**
 * The numbered "what's left" checklist printed at the end of init. Pure so it is
 * unit-tested: every unmet prerequisite becomes an impossible-to-miss FAILED
 * line with its remediation, on top of the always-present restart + trust steps.
 */
export function buildFinalChecklist(
  checks: readonly CheckResult[],
  runtimeNextSteps: readonly string[],
): readonly string[] {
  // Each adapter supplies its own "how to start using it" steps (including a
  // FAILED line for an unresolved pin, which only the Claude adapter emits).
  const items: string[] = [...runtimeNextSteps];
  for (const check of checks) {
    if (!check.ok) items.push(`FAILED: ${check.message}${check.fix ? ` — ${check.fix}` : ''}`);
  }
  return items;
}

/** Message of an unknown thrown value without an `as` cast. */
const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * What running `init` against this root should do.
 *
 * The source repo is the only place where the doctrine docs are the source
 * rather than a copy of it, so a bare `init` there would replace a canonical
 * file with the packaged one. That is worth refusing. What is not worth refusing
 * is the rest of the work: `update` asks to preserve the doctrine and recompile
 * everything else, because a command that dies after half a job teaches its user
 * that updating is dangerous, and they stop updating.
 */
export type SourceRepoVerdict = 'proceed' | 'refuse' | 'preserve-doctrine';

export function sourceRepoVerdict(input: {
  readonly isSourceRepo: boolean;
  readonly force: boolean;
  readonly preserveDoctrine: boolean;
}): SourceRepoVerdict {
  if (!input.isSourceRepo) return 'proceed';
  // Ordered ahead of `force` on purpose. The two flags answer different people:
  // `preserveDoctrine` is what `update` declares about the repo it runs in,
  // `--force` is what an operator types to get past a conflict on some managed
  // asset. Reading force first let unblocking two hook files rewrite the
  // canonical CLAUDE.md as a side effect, which nothing had asked for.
  if (input.preserveDoctrine) return 'preserve-doctrine';
  return input.force ? 'proceed' : 'refuse';
}

/**
 * What `init` does with a `.void/config.json` that is already there.
 *
 * `--force` seizes ownership of a *managed* asset: one the harness owns alone
 * and can prove it wrote. The config is *co-owned* -- the project tunes paths,
 * modes and commands, the harness only records pack pins -- so the flag has
 * nothing to say about it, and treating it as licence to overwrite cost a
 * monorepo its whole enforcement floor: `paths.business` fell back to the
 * single-app default, the config stayed valid, and nothing went red.
 *
 * It keeps exactly one job here, the case where merging is not possible at all:
 * a config too broken to parse.
 */
export type ConfigWriteVerdict = 'scaffold' | 'merge' | 'overwrite-unreadable' | 'keep-unreadable';

export function configWriteVerdict(input: {
  readonly exists: boolean;
  readonly readable: boolean;
  readonly force: boolean;
}): ConfigWriteVerdict {
  if (!input.exists) return 'scaffold';
  if (input.readable) return 'merge';
  return input.force ? 'overwrite-unreadable' : 'keep-unreadable';
}

export async function init(
  args: readonly string[], preparation?: InstallPreparation,
): Promise<void> {
  const opts = parseArgs(args);
  const projectRoot = preparation?.projectRoot ?? process.cwd();
  await assertProjectCompatibility(projectRoot, { replaceUnparseableConfig: opts.force });

  banner('init');
  meta('project', projectRoot);

  // Guard: never wire the void-machine source repo as if it were a consumer.
  // init overwrites the canonical CLAUDE.md / AGENTS.md and drops doctrine files
  // at the repo root — corrupting the source of truth. Refuse by default; --force
  // is the deliberate "I know, I'm dogfooding the installer here" escape hatch.
  const verdict = sourceRepoVerdict({
    isSourceRepo: isHarnessSourceRepo(projectRoot),
    force: opts.force,
    preserveDoctrine: opts.preserveDoctrine,
  });
  if (verdict === 'refuse') {
    blank();
    p.log.error(`This is the ${PRODUCT_COMMAND} source repo — init would overwrite the canonical CLAUDE.md and doctrine files.`);
    p.log.message('To install/test the harness, run init in a consumer project. To do it here anyway, pass --force.');
    process.exit(2);
  }
  const preserveDoctrine = verdict === 'preserve-doctrine';

  // A --runtime typo must fail loudly, never silently fall back to "both".
  if (opts.invalidRuntimeArgs.length > 0) {
    p.log.error(`Unknown --runtime value(s): ${opts.invalidRuntimeArgs.join(', ')}. Use: claude, codex, both.`);
    process.exit(2);
  }

  // Resolve which runtimes to wire, then work through their adapters. The
  // command never branches on a runtime name — each adapter owns its
  // prerequisites, active wiring, doctrine doc, and next-steps.
  const runtimes = resolveRuntimes(opts.explicitRuntimes, detectRuntimes(projectRoot));
  const adapters = adaptersFor(runtimes);
  const wireClaude = runtimes.includes('claude');
  meta('runtimes', adapters.map((a) => a.label).join(' + '));
  meta('source', opts.source === 'local' ? 'bundled local package' : `marketplace ${opts.marketplaceRepo}`);

  // Resolve seed config: detect consumer's stack + fetch marketplace HEAD
  // version. Both have fallbacks so init never fails for env reasons.
  const stack = detectStack(projectRoot);
  meta('stack', `${stack.packageManager} + ${stack.testRunner}${stack.e2eRunner !== 'none' ? ` + ${stack.e2eRunner}` : ''}`);

  // Prerequisite checks up front. Each adapter owns its optional external
  // dependencies (marketplace Claude: gh; local Claude and Codex: none).
  // but every unmet one is loud here and reappears in the closing checklist so a
  // broken install can't hide behind a "succeeded for env reasons" exit (#67).
  const prereqs: CheckResult[] = adapters.flatMap((adapter) =>
    adapter.prerequisites(opts.marketplaceRepo, opts.source)
  );
  for (const check of prereqs) {
    const mark = check.ok ? c.green(glyph.check) : c.red('x');
    line(`${mark}  ${c.dim(check.name.padEnd(18))}${check.message}`);
    if (!check.ok && check.fix) line(c.dim(`     ${glyph.to} ${check.fix}`));
  }

  // PREFLIGHT — transactional gate. Refuse to write ANYTHING if a prerequisite
  // is unmet: a partially-wired project that exits 0 while its marketplace is
  // unreachable is a false success (audit #2). Nothing has been
  // written yet at this point. `--force` is the deliberate "install anyway" escape.
  const failedPreflight = prereqs.filter((pre) => !pre.ok);
  if (failedPreflight.length > 0 && !opts.force) {
    blank();
    p.log.error(`Preflight failed — nothing was written. ${failedPreflight.length} prerequisite(s) unmet:`);
    for (const f of failedPreflight) {
      p.log.message(`  ${c.red('x')} ${f.name}: ${f.message}${f.fix ? `  ${glyph.to} ${f.fix}` : ''}`);
    }
    p.log.message('Fix the above and re-run, or pass --force to install anyway.');
    process.exit(2);
  }

  // The core pin is a Claude-marketplace concern; only resolve/report it there.
  const pinVersion = opts.source === 'local'
    ? cliVersion()
    : wireClaude ? resolveCorePin(opts.marketplaceRepo) : undefined;
  if (wireClaude && opts.source === 'marketplace') {
    meta('pin', pinVersion !== undefined ? `^${pinVersion}` : c.red('unresolved (could not derive from marketplace, not pinned)'));
  }
  blank();

  // Locate the harness source — a preflight too: no source means nothing to
  // install, so fail before writing rather than half-way through.
  let sourceRoot: string;
  try {
    sourceRoot = await findCoreSource();
  } catch (err) {
    p.log.error(`Preflight failed — cannot locate the harness source; nothing written. ${errorMessage(err)}`);
    process.exit(2);
  }

  // Choose packs (runtime-agnostic) — selection only, no writes yet.
  const packs = await effectivePacks(projectRoot, opts);
  const enabledPlugins = [CORE_PLUGIN_NAME, ...packs.map((pk) => pk.name)];

  // COMPILE IN ISOLATION. Only the finite mutation set is published after each
  // selected runtime proves installed + wired + fired in this stage.
  const stageRoot = await mkdtemp(join(tmpdir(), 'void-init-stage-'));
  const nextSteps: string[] = [];
  let installFailed = false;
  try {
    await seedInstallStage(projectRoot, stageRoot);
    // 1. Write .void/config.json (runtime-agnostic)
    await writeConfig(stageRoot, packs, opts, { pinVersion, stack });
    // 2. Copy PHILOSOPHY.md + seed or refresh PROJECT-DOCTRINE.md
    await installDoctrineFiles(stageRoot, sourceRoot, {
      installRoot: projectRoot,
      preserveFrom: preserveDoctrine ? projectRoot : undefined,
    });
    // 3. Wire each selected runtime through its adapter.
    const wireCtx = {
      stageRoot,
      installRoot: projectRoot,
      sourceRoot,
      enabledPlugins,
      enabledPacks: packs,
      source: opts.source,
      marketplaceRepo: opts.marketplaceRepo,
      pinVersion,
      preserveDoctrineDoc: preserveDoctrine,
      force: opts.force,
    };
    for (const adapter of adapters) {
      const outcome = await adapter.wire(wireCtx);
      for (const status of outcome.statusLines) {
        line(`${c.green(glyph.check)}  ${c.dim(`${adapter.id}`.padEnd(18))}${status}`);
      }
      nextSteps.push(...outcome.nextSteps);
    }
    // Declare which half git keeps, AFTER wiring: the ignore block is scoped to
    // the files this install actually stages, never to a whole runtime directory
    // the project also writes its own skills into.
    // Before the manifest, the ignore block and the transaction: what the project
    // already owns leaves the stage, so nothing downstream claims it.
    const keptByProject = await withholdProjectOwned(projectRoot, stageRoot);
    // Without the agent names, which only the receipt can justify. The block
    // has to exist before the transaction -- a `git clean` during an install
    // would otherwise carry off what it just wrote -- and its patterns are true
    // whatever happens next. The names are not: a rollback would leave the
    // repository ignoring agents that were never written, and an agent the
    // project later writes under one of those names disappears at the first
    // clone. So they wait for the commit that makes them true.
    if (preparation === undefined) await ensureIgnoreRules(projectRoot, stageRoot);

    // The committed record of exactly what this install materialized, so any
    // other checkout can restore the same bytes and PROVE it did. Written last,
    // so it also hashes the .gitignore this install just wrote.
    const doctrineTemplate = join(sourceRoot, 'PROJECT-DOCTRINE.template.md');
    const templateSha256 = existsSync(doctrineTemplate) ? sha256Of(await readFile(doctrineTemplate)) : undefined;
    await stageInstallManifest(stageRoot, cliVersion(), templateSha256);

    const prepared = await prepareInstallCommit({
      projectRoot,
      stageRoot,
      version: cliVersion(),
      source: opts.source,
      runtimes,
      force: opts.force,
      recoverManifestOwnership: preparation?.recoverManifestOwnership === true,
    });
    if (opts.source === 'local') {
      await inspectInstallProjection(
        projectRoot, stageRoot, [...keptByProject, ...prepared.preserved], adapters,
      );
    }
    if (preparation !== undefined) {
      preparation.onPrepared(prepared);
      return;
    }
    await commitFileTransaction(projectRoot, prepared.mutations);
    for (const path of prepared.restored) {
      line(`${c.yellow('!')}  restored ${path} from the delivered harness`);
    }
    line(`${c.green(glyph.check)}  ${c.dim('transaction'.padEnd(18))}${prepared.receipt.files.length} owned files committed + receipt written`);
    // Now that the receipt exists, the block may name what it owns. Read from
    // the receipt rather than the stage: the stage is what we meant to write,
    // the receipt is what is on disk.
    claimOwnedPaths(projectRoot, prepared.receipt.files.map((file) => file.path));
    reportHiddenByProject(projectRoot);
    // A preserved asset is one the previous install owned and this one refuses
    // to delete, because it was edited by hand. Saying nothing here is how a
    // renamed skill keeps loading beside its replacement under a clean success.
    // `--force` does not cover this case: it governs an unowned conflict on a
    // file we are writing, not our refusal to delete someone's edit. Offering it
    // as the remedy would send people to run the same command twice.
    if (keptByProject.length > 0) {
      // Named, never silent: a skill that simply fails to appear leaves the user
      // hunting for a bug, where a reported one is a decision they can act on.
      line(`${c.yellow('!')}  ${c.dim('kept'.padEnd(18))}${keptByProject.length} skill(s) the project already had, left untouched`);
      for (const path of keptByProject.slice(0, 5)) line(c.dim(`     ${path}`));
      if (keptByProject.length > 5) {
        line(c.dim(`     ... ${String(keptByProject.length - 5)} more`));
      }
      line(c.dim('     ours was not installed there; delete yours and re-run to take it'));
    }
    if (prepared.preserved.length > 0) {
      line(`${c.yellow('!')}  ${c.dim('preserved'.padEnd(18))}${prepared.preserved.length} stale asset(s) kept because they were edited locally`);
      for (const path of prepared.preserved.slice(0, 5)) line(c.dim(`     ${path}`));
      if (prepared.preserved.length > 5) line(c.dim(`     ... ${String(prepared.preserved.length - 5)} more`));
      line(c.dim('     They still load, beside their replacements. Delete them to finish the update.'));
    }
  } catch (err) {
    if (preparation !== undefined) throw err;
    blank();
    p.log.error(`init failed. Prior layout repairs remain applied: they are outside the install transaction. ${errorMessage(err)}`);
    installFailed = true;
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
  // A real process.exit skips finally; release the owned stage before exiting.
  if (installFailed) process.exit(1);

  blank();
  // "plugins" is what the marketplace channel calls them. On the default path
  // nothing is installed as a plugin, and reporting one invites the reader to
  // go looking for something this project does not have.
  meta(opts.source === 'marketplace' ? 'plugins' : 'doctrine', enabledPlugins.join(', '));

  // Numbered "what's left" checklist: each adapter's start-steps, then every
  // unmet prerequisite as an unmissable FAILED line.
  const checklist = buildFinalChecklist(prereqs, nextSteps);
  blank();
  line(c.bold('Next steps:'));
  checklist.forEach((item, i) => {
    const failed = item.startsWith('FAILED:');
    const label = `${i + 1}. ${item}`;
    line(`  ${failed ? c.red(label) : c.dim(label)}`);
  });
  footer(opts.source === 'local'
    ? `project-local skills are discoverable by name in each selected runtime`
    : `skills appear as ${c.bold('/harness:<name>')}, ${c.bold('/harness-<stack>:<name>')}`);
}

async function readPackConfig(configPath: string): Promise<PackConfig | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8'));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || !parsed || Array.isArray(parsed)) return undefined;
  const packs = configSchema.shape.packs.safeParse('packs' in parsed ? parsed.packs : undefined);
  if (!packs.success) {
    const issues = packs.error.issues.map(issue =>
      `${['packs', ...issue.path].join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Cannot reconcile .void/config.json: ${issues}. Repair the pack declarations.`);
  }
  // Validate only the pack boundary; preserve every co-owned project field.
  return packs.data === undefined ? { ...parsed } : { ...parsed, packs: packs.data };
}

async function effectivePacks(
  projectRoot: string, opts: InitOptions,
): Promise<readonly PackDescriptor[]> {
  const configPath = join(projectRoot, '.void', 'config.json');
  const config = await readPackConfig(configPath);
  const verdict = configWriteVerdict({
    exists: existsSync(configPath), readable: config !== undefined, force: opts.force,
  });
  if (verdict === 'keep-unreadable') {
    throw new Error('Cannot reconcile .void/config.json: unreadable configuration, left untouched. '
      + 'Restore a JSON object or use --force to overwrite it.');
  }
  const retained = opts.replacePacks ? [] : Object.keys(config?.packs ?? {}).map(key => {
    const pack = findPack(key.replace(/^@voidcorp\//, ''));
    if (pack === undefined) {
      throw new Error(`Cannot reconcile .void/config.json: unknown retained pack '${key}'. `
        + 'Repair the declaration or use --replace-packs to select the exact supported set.');
    }
    return pack;
  });
  const selected = await choosePacks(projectRoot, opts);
  return [...new Map([...retained, ...selected].map(pack => [pack.name, pack])).values()];
}

async function choosePacks(projectRoot: string, opts: InitOptions): Promise<readonly PackDescriptor[]> {
  if (opts.allPacks) return PACKS;

  if (opts.explicitPacks.length > 0) {
    const resolved: PackDescriptor[] = [];
    for (const name of opts.explicitPacks) {
      const found = findPack(name);
      if (!found) {
        p.log.warn(`Unknown pack '${name}', skipping. Available: ${PACKS.map((pk) => pk.name).join(', ')}`);
        continue;
      }
      resolved.push(found);
    }
    return resolved;
  }

  if (!opts.interactive) return [];

  // Auto-detect + interactive prompt.
  const detected = new Set(PACKS.filter((pack) => pack.detect(projectRoot)).map((pk) => pk.name));
  const detectionLines = PACKS.map((pack) => {
    const sym = detected.has(pack.name) ? '✓' : '✗';
    return `  ${sym} ${pack.name} — ${pack.description}`;
  });
  p.log.message(['Detected project signals:', ...detectionLines].join('\n'));

  const selected = await p.multiselect({
    message: 'Activate packs (core is always active):',
    options: PACKS.map((pack) => {
      const base: { value: string; label: string; hint?: string } = {
        value: pack.name,
        label: pack.label,
      };
      if (detected.has(pack.name)) base.hint = 'detected';
      return base;
    }),
    initialValues: PACKS.filter((pack) => detected.has(pack.name)).map((pk) => pk.name),
    required: false,
  });

  if (p.isCancel(selected)) {
    p.cancel('Aborted.');
    process.exit(0);
  }

  return PACKS.filter((pack) => (selected as string[]).includes(pack.name));
}

async function writeConfig(
  projectRoot: string,
  packs: readonly PackDescriptor[],
  opts: InitOptions,
  seed: ConfigSeed,
): Promise<void> {
  const voidDir = join(projectRoot, '.void');
  const configPath = join(voidDir, 'config.json');
  await mkdir(voidDir, { recursive: true });

  // undefined pin (core version not resolved): activate packs in settings.json but
  // do NOT stamp a stale version pin into config; the checklist flags it (#67).
  const pin = seed.pinVersion !== undefined ? `^${seed.pinVersion}` : undefined;
  const tag = (status: string) =>
    line(`${c.green(glyph.check)}  ${c.dim('.void/config.json'.padEnd(18))}${status}`);

  // Pack pin: a resolved marketplace pin, else this CLI's version — the packs are
  // materialized from THIS CLI (the Codex path has no marketplace), so config
  // must record every activated pack, never leave it absent (the fake-pack bug).
  const packPin = pin ?? `^${cliVersion()}`;

  // Read before deciding: whether the config can be merged into is the fact the
  // verdict turns on, and it is only knowable after parsing it.
  const exists = existsSync(configPath);
  const parsed = await readPackConfig(configPath);
  const verdict = configWriteVerdict({ exists, readable: parsed !== undefined, force: opts.force });

  if (verdict === 'keep-unreadable') {
    line(`${c.yellow(glyph.up)}  ${c.dim('.void/config.json'.padEnd(18))}unreadable, leaving untouched (use --force to overwrite)`);
    return;
  }

  if (verdict === 'scaffold' || verdict === 'overwrite-unreadable') {
    // Named before the write, never after. This is the one path where --force
    // replaces a file the project co-owns, and whatever paths or modes it had
    // tuned are not recoverable from a config nothing could parse.
    if (verdict === 'overwrite-unreadable') {
      line(`${c.yellow(glyph.up)}  ${c.dim('.void/config.json'.padEnd(18))}overwriting unparseable config (--force); hand-tuned keys are lost`);
    }
    const config = buildDefaultConfig(seed);
    for (const pack of packs) config.packs[`@voidcorp/${pack.name}`] = packPin;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    tag(pin !== undefined ? 'written' : 'written (core unpinned; packs pinned to CLI version)');
    return;
  }

  // Merge in any newly-selected packs without touching the user's hand-tuned
  // paths/commands/modes or existing pack pins.
  const existing: PackConfig = parsed ?? {};
  const currentPacks = { ...(existing.packs ?? {}) };
  // A fresh remote pin wins; else the config's canonical pin; else this CLI's
  // version — an activated pack is always recorded with a valid version, never
  // added-in-message-only (the fake-pack bug).
  const effectivePin = pin ?? resolveEffectivePin(existing) ?? `^${cliVersion()}`;
  if (opts.replacePacks) {
    const exactPacks: Record<string, string> = {};
    for (const pack of packs) {
      const key = `@voidcorp/${pack.name}`;
      exactPacks[key] = currentPacks[key] ?? effectivePin;
    }
    const merged = { ...existing, packs: exactPacks };
    await writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`);
    tag(`reconciled (${packs.length} selected pack${packs.length === 1 ? '' : 's'})`);
    return;
  }
  const added: string[] = [];
  for (const pack of packs) {
    const key = `@voidcorp/${pack.name}`;
    if (currentPacks[key] === undefined) {
      currentPacks[key] = effectivePin;
      added.push(pack.name);
    }
  }
  if (added.length === 0) {
    tag(c.dim('already has selected packs, unchanged'));
    return;
  }
  const merged = { ...existing, packs: currentPacks };
  await writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`);
  tag(`merged (added ${c.bold(added.join(', '))} at ${effectivePin})`);
}

/**
 * Declare what git should not see, and take the old declaration back out.
 *
 * The rules go to the repository's exclude file, which no commit contains and no
 * checkout can therefore revert. They used to live in a marked block inside the
 * project's `.gitignore`; that file is tracked, so the protection was
 * branch-dependent while the assets it protects are not, and switching to a
 * branch cut before the install left the whole harness exposed to the next
 * `git clean`.
 *
 * The exclude is written against the PROJECT root, not the stage: it is git
 * metadata living outside the mirror the transaction publishes, it is per-clone,
 * and it is therefore recorded in no manifest -- there is nothing for another
 * checkout to restore, since each one writes its own.
 *
 * The `.gitignore` is edited in the STAGE, so removing the old block travels
 * through the same transaction as everything else and rolls back with it.
 */
async function ensureIgnoreRules(
  projectRoot: string,
  stageRoot: string,
): Promise<void> {
  const outcome = writeExcludeBlock(projectRoot);
  const label = outcome === 'skipped'
    ? c.dim('not a git repository, nothing to hide from it')
    : outcome === 'unchanged'
      ? c.dim('rules already current')
      : 'rules written (.void/machine/ and .void/installed/ ignored, the rest of .void/ tracked)';
  const mark = outcome === 'written' ? c.green(glyph.check) : c.dim(glyph.dot);
  line(`${mark}  ${c.dim('git exclude'.padEnd(18))}${label}`);

  // Only when the project has one. Creating an empty `.gitignore` to hold
  // nothing of ours would be a file the project never asked for.
  const path = join(stageRoot, '.gitignore');
  if (!existsSync(path)) return;
  const original = await readFile(path, 'utf8');
  const stripped = stripManagedBlock(original);
  if (stripped === original) return;
  await writeFile(path, stripped);
  line(`${c.green(glyph.check)}  ${c.dim('.gitignore'.padEnd(18))}managed block removed — the file is the project's again`);
}

/**
 * Name the units the receipt owns, once the receipt is a fact.
 *
 * Silent: the block was already reported when it was written, and a second
 * `git exclude` line for the same file would read as two different rules.
 */
function claimOwnedPaths(projectRoot: string, ownedPaths: readonly string[]): void {
  writeExcludeBlock(projectRoot, ownedPaths);
}

/**
 * Say when a project rule wins over what this install just wrote.
 *
 * Reported, not refused: `.gitignore` beating `info/exclude` is the right
 * precedence, and a rule the project wrote years before the harness is not an
 * error to fail an install on. What was an error is doing it silently -- the
 * project this comes from cloned without `config.json`, without
 * `install-manifest.json` and without the hook runner, while its committed
 * `.claude/settings.json` named seven hooks resolving to nothing.
 *
 * Asked of git, after the transaction, because only then are the paths on disk
 * for `check-ignore` to answer about.
 */
function reportHiddenByProject(projectRoot: string): void {
  const hidden = observeKeptTracked(projectRoot).filter((path) => path.ignored === true);
  if (hidden.length === 0) return;
  line(`${c.yellow('!')}  ${c.dim('hidden'.padEnd(18))}${hidden.length} installed path(s) hidden from git by a project rule`);
  for (const entry of hidden.slice(0, 5)) {
    line(c.dim(`     ${entry.path} — ${entry.rule ?? 'rule unknown'}`));
  }
  if (hidden.length > 5) line(c.dim(`     ... ${String(hidden.length - 5)} more`));
  line(c.dim('     a fresh clone would not get them; narrow that rule, then git add them'));
}

export interface DoctrineInstallRoots {
  /**
   * The installation being written to, whose committed manifest attests what a
   * previous install wrote. Absent means no attestation, which preserves.
   */
  readonly installRoot?: string | undefined;
  /**
   * An installation whose philosophy is canonical rather than derived — the
   * source repo, where `docs/PHILOSOPHY.md` is the original and the packaged
   * copy is necessarily behind it.
   */
  readonly preserveFrom?: string | undefined;
}

/**
 * Is the staged project doctrine still the untouched file we wrote last time?
 *
 * The project owns every line of it, so the answer is normally no and the file
 * is preserved. Refresh requires both unchanged observed bytes and equality with
 * the explicitly recorded delivered template digest. Observed hashes can belong
 * to preserved user content; absent template provenance is not authority.
 */
function isUntouchedProjectDoctrine(installRoot: string | undefined, staged: string): boolean {
  if (installRoot === undefined) return false;
  const manifest = readInstallManifest(installRoot);
  if (manifest?.projectDoctrineTemplateSha256 === undefined) return false;
  try {
    const content = readFileSync(staged);
    return sha256Of(content) === manifest.projectDoctrineTemplateSha256
      && isUntouchedSinceInstall(manifest, PROJECT_DOCTRINE_PATH, content);
  } catch {
    return false;
  }
}

/**
 * Write the managed doctrine into the staged install.
 *
 * The philosophy is ours and is rewritten every time. The project doctrine is
 * the project's and is preserved every time but one: a file still byte-for-byte
 * the template an install wrote has never been used, and leaving it there makes
 * every consumer who never filled it in carry an obsolete template into every
 * session forever. See the decision on refreshing an untouched project doctrine.
 */
export async function installDoctrineFiles(
  stageRoot: string,
  sourceRoot: string,
  roots: DoctrineInstallRoots = {},
): Promise<void> {
  const { installRoot, preserveFrom } = roots;
  const voidDir = join(stageRoot, '.void');
  await mkdir(voidDir, { recursive: true });
  const philosophySrc = join(sourceRoot, 'PHILOSOPHY.md');
  // Under `installed/`: it is regenerated from a pin and not committed, and the
  // top of `.void/` is what git keeps. A file that is ignored has no business
  // sitting where "everything here is committed" is supposed to be readable at
  // a glance.
  const philosophyDst = join(voidDir, 'installed', 'PHILOSOPHY.md');
  await mkdir(join(voidDir, 'installed'), { recursive: true });
  const canonical = preserveFrom === undefined
    ? undefined
    : join(preserveFrom, '.void', 'installed', 'PHILOSOPHY.md');
  if (canonical !== undefined && existsSync(canonical)) {
    await cp(canonical, philosophyDst);
    line(`${c.dim(glyph.dot)}  ${c.dim('PHILOSOPHY.md'.padEnd(18))}${c.dim('preserved (canonical here)')}`);
  } else if (existsSync(philosophySrc)) {
    await cp(philosophySrc, philosophyDst);
    line(`${c.green(glyph.check)}  ${c.dim('PHILOSOPHY.md'.padEnd(18))}written (managed)`);
  }
  const templateSrc = join(sourceRoot, 'PROJECT-DOCTRINE.template.md');
  const doctrineDst = join(voidDir, 'PROJECT-DOCTRINE.md');
  const label = c.dim('PROJECT-DOCTRINE'.padEnd(18));
  const hasTemplate = existsSync(templateSrc);
  if (!existsSync(doctrineDst)) {
    if (!hasTemplate) return;
    await cp(templateSrc, doctrineDst);
    line(`${c.green(glyph.check)}  ${label}created from template`);
  } else if (hasTemplate && isUntouchedProjectDoctrine(installRoot, doctrineDst)) {
    await cp(templateSrc, doctrineDst);
    line(`${c.green(glyph.check)}  ${label}refreshed (never filled in)`);
  } else {
    line(`${c.dim(glyph.dot)}  ${label}${c.dim('exists (preserved)')}`);
  }
}
