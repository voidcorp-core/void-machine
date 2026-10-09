import { syntaxWorkerHealth } from './syntax-worker-health.js';
// The runtime seam. The harness authors ONE doctrine and compiles it to each
// agent runtime through an adapter. Core commands (init / runtime add / doctor)
// iterate the adapters for detect / prerequisites / wire / doctorChecks rather
// than switching on a runtime name; adding a runtime (Codex exec, Hermes, a
// local agent, ...) is a new adapter object registered in ADAPTERS here, with
// zero edits to that iterated surface.
//
// One axis stays intentionally OUTSIDE the adapter contract: the Claude
// MARKETPLACE (pin resolution, marketplace reachability, plugin-cache + remote
// version health). No other runtime has a marketplace, so the commands gate it
// with an explicit `claude` check rather than pretending it is a generic adapter
// concern — the one honest exception to "iterate, don't branch", not a leak to
// fold away.
//
// This is the AGENT-RUNTIME axis only. The orthogonal MODEL-PROVIDER axis
// (Anthropic / OpenAI-compatible / Ollama / custom) is a separate seam and is
// deliberately NOT conflated here — see docs/specs/2026-07-21-...-multiruntime.
//
// Each adapter owns exactly its runtime-specific surface: how to detect it, its
// extra prerequisites, how to wire its active layer (including its own doctrine
// doc), the "how to start using it" steps, and its health checks. Everything
// runtime-agnostic (stack detection, .void/config.json, PHILOSOPHY /
// PROJECT-DOCTRINE, pack selection) stays in the commands.

import type { Dirent } from 'node:fs';
import { existsSync } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PRODUCT_COMMAND, PRODUCT_IDENTITY, voidReadPath } from '@voidcorp/hook-runner';
import type { SpecialistRuntimeCapability } from '@voidcorp/mission-engine';
import { parseEventLine } from '@voidcorp/mission-engine/events';
import { docFileFor, hasHarnessBlock, patchRuntimeDoc } from './claude-md.js';
import {
  CODEX_AGENTS_DIR,
  canonicalSpecialistContracts,
  codexSpecialistsHealth,
  describeSpecialistDrift,
  regularFileText,
  type SpecialistDrift,
  specialistDrift,
  wireCodexAgents,
} from './codex-agents.js';
import {
  CODEX_HOOKS_DIR,
  codexFloorHealth,
  wireCodexFloor,
} from './codex-floor.js';
import { CODEX_SKILLS_DIR, codexSkillsHealth, wireCodexSkills } from './codex-skills.js';
import { loadCanonicalEventBody } from './graph-io.js';
import { smokeInstalledHook } from './hook-smoke.js';
import { inspectHarnessLintExclusion } from './lint-exclusion.js';
import {
  CORE_PLUGIN_NAME,
  enabledPluginsKey,
  MARKETPLACE_NAME,
  type PackDescriptor,
  packDirForName,
} from './packs.js';
import { hookHealthIssues, locatePluginDir } from './plugin-cache.js';
import { type CheckResult, checkGh, checkMarketplaceAccess } from './prerequisites.js';
import { detectRuntimes, type Runtime } from './runtime.js';
import {
  type InstallSource,
  wireClaudeLocalAssets,
} from './runtime-assets.js';
import {
  type ClaudeSettings,
  mergeLocalSettings,
  mergeSettings,
  inspectSettings,
  readSettings,
  settingsWriteVerdict,
  settingsPathFor,
  writeSettings,
} from './settings.js';
import { CLAUDE_SPECIALIST_SAFETY } from './specialists/compile-claude.js';
import { CODEX_SPECIALIST_SAFETY } from './specialists/compile-codex.js';

/** Everything an adapter's `wire` may need. Runtime-agnostic inputs the command computed. */
export interface RuntimeWireContext {
  /**
   * Isolated directory receiving bytes before publication. Never the
   * installation: a transaction that rolls back byte-for-byte can only do so
   * on a directory it owns entirely.
   */
  readonly stageRoot: string;
  /** Where the harness is installed, as opposed to where this run stages it. */
  readonly installRoot: string;
  readonly sourceRoot: string;
  readonly enabledPlugins: readonly string[];
  readonly enabledPacks: readonly PackDescriptor[];
  readonly source: InstallSource;
  readonly marketplaceRepo: string;
  /** undefined when the Claude marketplace pin could not be resolved (offline). */
  readonly pinVersion: string | undefined;
  /**
   * Leave the doctrine doc exactly as the project has it. Set on the source
   * repo, where CLAUDE.md and AGENTS.md are the canonical originals and the
   * packaged block is necessarily behind them.
   */
  readonly preserveDoctrineDoc?: boolean;
  /**
   * The operator said to overwrite a co-owned file this install cannot read.
   * Absent means no: an unreadable file is left alone and reported.
   */
  readonly force?: boolean;
}

export interface RuntimeWireOutcome {
  /** Raw status messages; the command renders each as a `✓ <id> <message>` line. */
  readonly statusLines: readonly string[];
  /** "How to start using it" checklist items; a `FAILED:`-prefixed item is a blocker. */
  readonly nextSteps: readonly string[];
}

export interface RuntimeInspectionEvidence {
  readonly installed: boolean | null;
  readonly wired: boolean | null;
  readonly fired: boolean | null;
  readonly observed: boolean | null;
}

export interface RuntimeInspection {
  readonly runtime: Runtime;
  readonly evidence: RuntimeInspectionEvidence;
  readonly specialistCapability: SpecialistRuntimeCapability;
  readonly checks: readonly CheckResult[];
}

export interface RuntimeInspectOptions {
  readonly claudeCacheRoot?: string;
}

/**
 * One runtime's wiring and its health.
 *
 * `root` is the directory being read, which `init` and `runtime add` answer
 * with their stage: a transaction proves the runtime wired and fired there
 * before publishing a byte. It is never called `projectRoot`, which in this
 * package always means the directory a command was run in.
 */
export interface RuntimeAdapter {
  readonly id: Runtime;
  readonly label: string;
  /** Does this runtime already show a footprint in the project? */
  detect(root: string): boolean;
  /** Runtime-specific prerequisites (empty for local, self-contained adapters). */
  prerequisites(marketplaceRepo: string, source?: InstallSource): readonly CheckResult[];
  /** Materialize this runtime's active layer + its own doctrine doc. Idempotent. */
  wire(ctx: RuntimeWireContext): Promise<RuntimeWireOutcome>;
  /** Health checks for this runtime's wiring + doc, for `doctor`. Never throws. */
  doctorChecks(root: string): Promise<readonly CheckResult[]>;
  /** Executable lifecycle postconditions. Missing proof stays false/null, never green. */
  inspect(root: string, options?: RuntimeInspectOptions): Promise<RuntimeInspection>;
}

async function safeRegularFile(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isFile() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * True when at least one harness skill is materialized under `<root>`, proven by
 * a readable `SKILL.md` inside a `void-`prefixed directory.
 *
 * Deliberately NOT a named sentinel. This probed the `tdd` skill directory by
 * name until the `void-` prefix landed on every shipped skill, at which point it missed,
 * the local install read as absent, and `init` failed on a stage that was in fact
 * complete. The prefix is the durable invariant (CLAUDE.md rule 8, enforced by
 * `scripts/anti-bloat-check.sh`); a single skill name is not.
 */
async function anyStagedSkill(root: string): Promise<boolean> {
  let entries: Dirent[] = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('void-')) continue;
    if (await safeRegularFile(join(root, entry.name, 'SKILL.md'))) return true;
  }
  return false;
}

function effectiveSpecialistCapability(
  healthy: boolean,
  healthDetail: string,
  safety: typeof CLAUDE_SPECIALIST_SAFETY | typeof CODEX_SPECIALIST_SAFETY,
): SpecialistRuntimeCapability {
  if (!healthy) return { status: 'unavailable', limitations: [healthDetail] };
  return {
    status: safety.teamMode,
    limitations: [
      ...safety.limitations,
      'Conditional PDF and browser capabilities are not yet proven by a runtime probe.',
    ],
  };
}

function observedRuntime(root: string, runtime: Runtime): boolean | null {
  const body = loadCanonicalEventBody(root);
  if (body === '') return existsSync(voidReadPath(root, 'runs')) ? null : false;
  let malformed = false;
  for (const line of body.split(/\r?\n/)) {
    if (line === '') continue;
    const parsed = parseEventLine(line);
    if (!parsed.ok) {
      malformed = true;
      continue;
    }
    if (parsed.value.source === `runtime:${runtime}`) return true;
  }
  return malformed ? null : false;
}

function smokeCheck(runtime: Runtime, fired: boolean | null, detail: string): CheckResult {
  return {
    name: `${runtime} hook smoke`,
    ok: fired === true,
    ...(fired === null ? { status: 'unknown' as const } : {}),
    message: fired === null ? `unknown: ${detail}` : detail,
    ...(fired === true ? {} : { fix: `${PRODUCT_COMMAND} runtime add ${runtime}` }),
  };
}

async function docBlockCheck(root: string, runtime: Runtime): Promise<CheckResult> {
  const file = docFileFor(runtime);
  const path = join(root, file);
  if (!existsSync(path)) {
    return { name: file, ok: false, message: 'missing', fix: `${PRODUCT_COMMAND} runtime add ${runtime}` };
  }
  const text = await readFile(path, 'utf8');
  return hasHarnessBlock(text)
    ? { name: file, ok: true, message: `${PRODUCT_COMMAND} block present` }
    : { name: file, ok: false, message: `${PRODUCT_COMMAND} block missing`, fix: `${PRODUCT_COMMAND} runtime add ${runtime}` };
}

async function claudeSpecialistsCheck(agentsRoot: string | undefined): Promise<CheckResult> {
  let contracts: Awaited<ReturnType<typeof canonicalSpecialistContracts>>;
  try {
    contracts = await canonicalSpecialistContracts();
  } catch (error) {
    return {
      name: 'claude agents',
      ok: false,
      message: `canonical specialist catalog unavailable: ${(error as Error).message}`,
      fix: `reinstall ${PRODUCT_IDENTITY.packageName}`,
    };
  }
  const drifts = new Map<string, SpecialistDrift>();
  for (const contract of contracts) {
    const name = contract.name;
    const content = agentsRoot === undefined
      ? undefined
      : await regularFileText(join(agentsRoot, `${name}.md`));
    const drift = specialistDrift(contract, content, [`name: ${name}`]);
    if (drift !== undefined) drifts.set(name, drift);
  }
  if (drifts.size > 0) {
    return {
      name: 'claude agents',
      ok: false,
      message: describeSpecialistDrift(drifts, `${PRODUCT_COMMAND} runtime add claude`),
      fix: `${PRODUCT_COMMAND} runtime add claude`,
    };
  }
  // Plain pass, no advisory. This reported a degradation that does not exist:
  // the compiled specialists carry an explicit `tools` allowlist, and the
  // official documentation says that shape reaches no MCP tool at all. An
  // advisory nobody can act on is printed until it stops being read.
  return {
    name: 'claude agents',
    ok: true,
    message: `${contracts.length} version-matched native specialists discovered, isolated by their tools allowlist`,
  };
}

const claudeAdapter: RuntimeAdapter = {
  id: 'claude',
  label: 'Claude Code',
  detect: (root) => existsSync(join(root, '.claude')) || existsSync(join(root, 'CLAUDE.md')),
  prerequisites: (repo, source = 'local') =>
    source === 'marketplace' ? [checkGh(), checkMarketplaceAccess(repo)] : [],
  async wire(ctx) {
    const settingsPath = settingsPathFor(ctx.stageRoot);
    // Inspected rather than read: a settings file the project cannot parse is
    // not an empty one, and merging into `{}` is how its hooks and permissions
    // used to disappear.
    const read = await inspectSettings(settingsPath);
    const settingsVerdict = settingsWriteVerdict({ read: read.kind, force: ctx.force === true });
    const existing = read.kind === 'present' ? read.settings : {};
    let status: string;
    let nextSteps: string[];
    const packDirs = ctx.enabledPacks
      .map((pack) => packDirForName(pack.name))
      .filter((directory): directory is string => directory !== undefined);
    let merged: ClaudeSettings;
    if (ctx.source === 'local') {
      const assets = await wireClaudeLocalAssets(ctx.stageRoot, ctx.sourceRoot, packDirs);
      merged = mergeLocalSettings(existing, assets.hookConfiguration);
      status = `settings.json + ${assets.skills} skills + ${assets.agents} agents + ${assets.hooks} hooks wired locally`;
      nextSteps = ['restart Claude Code (project-local skills and agents load on session start)'];
    } else {
      merged = mergeSettings(existing, {
        enabledPlugins: ctx.enabledPlugins,
        marketplaceRepo: ctx.marketplaceRepo,
      });
      status = `settings.json: extraKnownMarketplaces.${MARKETPLACE_NAME} + enabledPlugins merged`;
      nextSteps = [
        'restart Claude Code (skills load on session start)',
        'accept the plugin trust prompt on first load',
      ];
      if (ctx.pinVersion === undefined) {
        nextSteps.push(
          `FAILED: core version could not be resolved from the marketplace — once it is reachable, run ${PRODUCT_COMMAND} update to pin it`,
        );
      }
    }
    // Refused rather than half-wired. Every hook this runtime loads is declared
    // in this file, so an install that skips it and reports success ships a
    // harness with no enforcement floor -- the failure the whole transaction
    // exists to avoid. The caller rolls back byte for byte, so the settings the
    // project cannot parse are still exactly the ones it wrote.
    if (settingsVerdict === 'keep-unreadable') {
      throw new Error(
        '.claude/settings.json could not be parsed, and every hook is declared in it.'
        + ' Repair the JSON and run this again, or pass --force to replace the file'
        + ' (its hooks, permissions and environment go with it).',
      );
    }
    if (settingsVerdict === 'overwrite-unreadable') {
      status = `${status} (unreadable settings.json replaced, as --force asked)`;
    }
    await writeSettings(settingsPath, merged);
    const docResult = ctx.preserveDoctrineDoc === true
      ? 'preserved' as const
      : await patchRuntimeDoc(ctx.stageRoot, 'claude', {
          enabledPlugins: ctx.enabledPlugins,
          enabledPacks: ctx.enabledPacks,
          channel: ctx.source,
        });
    // `.claude/` holds engine-format files this repo wrote. Left inside the
    // project's lint glob they fail on code the project does not own.
    //
    // Read against `installRoot`, never `stageRoot`: the latter is the
    // isolated stage this transaction writes into, which holds none of the
    // project's own files — looking for a linter config there finds nothing,
    // always.
    //
    // Reported, not written. The config belongs to the project, and a
    // transaction that rolls back byte-for-byte cannot roll back an edit to a
    // file it does not own. Telling the truth beats leaving a surprise behind.
    const lint = await inspectHarnessLintExclusion(ctx.installRoot);
    const lintLine =
      lint.kind === 'excluded'
        ? `${lint.file}: .claude excluded from lint`
        : lint.kind === 'no-linter'
          ? 'lint: no linter config found, nothing to exclude'
          : `lint: ${lint.file} lints .claude as project source`;
    if (lint.kind === 'missing' || lint.kind === 'manual') nextSteps.push(lint.instruction);
    return {
      statusLines: [
        status,
        `CLAUDE.md: ${docResult}`,
        lintLine,
      ],
      nextSteps,
    };
  },
  async doctorChecks(root) {
    return (await this.inspect(root)).checks;
  },
  async inspect(root, options) {
    const checks: CheckResult[] = [];
    const settingsPath = settingsPathFor(root);
    let localSettings = false;
    if (!existsSync(settingsPath)) {
      checks.push({ name: 'settings.json', ok: false, message: '.claude/settings.json missing', fix: `${PRODUCT_COMMAND} runtime add claude` });
    } else {
      const settings = await readSettings(settingsPath);
      const markets = settings.extraKnownMarketplaces ?? {};
      const enabledPlugins = settings.enabledPlugins ?? {};
      localSettings = JSON.stringify(settings.hooks ?? {}).includes('$CLAUDE_PROJECT_DIR/.void/hooks/');
      const hasMarketplace = markets[MARKETPLACE_NAME] !== undefined;
      const hasCore = enabledPlugins[enabledPluginsKey(CORE_PLUGIN_NAME)] === true;
      if (localSettings) {
        checks.push({ name: 'settings.json', ok: true, message: 'project-local hooks wired' });
      } else if (hasMarketplace && hasCore) {
        const active = Object.keys(enabledPlugins).filter((k) => enabledPlugins[k] === true).length;
        checks.push({ name: 'settings.json', ok: true, message: `marketplace registered, ${active} plugin(s) enabled` });
      } else {
        const missing = [
          !hasMarketplace && `extraKnownMarketplaces.${MARKETPLACE_NAME}`,
          !hasCore && `enabledPlugins["${enabledPluginsKey(CORE_PLUGIN_NAME)}"]`,
        ].filter(Boolean).join(', ');
        checks.push({ name: 'settings.json', ok: false, message: `missing: ${missing}`, fix: `${PRODUCT_COMMAND} runtime add claude` });
      }
    }
    checks.push(await docBlockCheck(root, 'claude'));

    let installed = false;
    let activationHook: string | undefined;
    let agentsRoot: string | undefined;
    const localRunner = join(root, '.void', 'hooks', '_void-hook.mjs');
    const localAgent = join(root, '.claude', 'agents', 'doctrine-critic.md');
    if (localSettings) {
      installed = await safeRegularFile(localRunner)
        && await safeRegularFile(join(root, '.void', 'hooks', '_syntax-worker.cjs'))
        && await anyStagedSkill(join(root, '.claude', 'skills'))
        && await safeRegularFile(localAgent);
      if (installed) {
        activationHook = localRunner;
        agentsRoot = join(root, '.claude', 'agents');
      }
      const syntaxIssue = syntaxWorkerHealth(join(root, '.void', 'hooks'));
      checks.push({ name: 'syntax worker', ok: syntaxIssue === undefined,
        message: syntaxIssue ?? 'worker matches the installed hook', fix: `${PRODUCT_COMMAND} update` });
      checks.push({
        name: 'local assets',
        ok: installed,
        message: installed ? 'installed skills, agents and executable hooks present'
          : 'configured project-local installation is incomplete',
        fix: `${PRODUCT_COMMAND} update`,
      });
    } else {
      const cacheRoot = options?.claudeCacheRoot
        ?? join(homedir(), '.claude', 'plugins', 'cache');
      const pluginDir = locatePluginDir(cacheRoot, CORE_PLUGIN_NAME);
      if (pluginDir === undefined) {
      checks.push({
        name: 'plugin cache',
        ok: false,
        message: 'not-installed: no harness plugin cache found',
        fix: 'restart Claude Code to materialize the enabled plugin',
      });
      } else {
        const manifestPath = join(pluginDir, '.claude-plugin', 'plugin.json');
        try {
          const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
          installed = true;
          const issues = hookHealthIssues(pluginDir, manifest);
          checks.push(issues.length === 0
            ? { name: 'plugin cache', ok: true, message: 'installed hooks present + executable' }
            : {
                name: 'plugin cache',
                ok: false,
                message: issues.join('; '),
                fix: 'restart Claude Code to refetch the plugin',
              });
          activationHook = join(pluginDir, 'hooks', '_void-hook.mjs');
          agentsRoot = join(pluginDir, 'agents');
        } catch (error) {
          checks.push({
            name: 'plugin cache',
            ok: false,
            message: `unreadable manifest: ${(error as Error).message}`,
            fix: 'restart Claude Code to refetch the plugin',
          });
        }
      }
    }
    const specialistCheck = await claudeSpecialistsCheck(agentsRoot);
    checks.push(specialistCheck);
    const wiringChecks = checks.filter((check) =>
      check.name === 'settings.json'
      || check.name === 'CLAUDE.md'
      || check.name === 'claude agents'
      || (localSettings && check.name === 'syntax worker')
      || check.name === (localSettings ? 'local assets' : 'plugin cache'),
    );
    const wired = installed && wiringChecks.length === (localSettings ? 5 : 4)
      && wiringChecks.every((check) => check.ok);
    const smoke = wired && activationHook !== undefined
      ? await smokeInstalledHook(activationHook, 'claude')
      : { fired: false as const, detail: 'hook smoke blocked by failed installation or wiring' };
    checks.push(smokeCheck('claude', smoke.fired, smoke.detail));
    return {
      runtime: 'claude',
      specialistCapability: effectiveSpecialistCapability(
        specialistCheck.ok,
        specialistCheck.message,
        CLAUDE_SPECIALIST_SAFETY,
      ),
      evidence: {
        installed,
        wired,
        fired: smoke.fired,
        observed: observedRuntime(root, 'claude'),
      },
      checks,
    };
  },
};

const codexAdapter: RuntimeAdapter = {
  id: 'codex',
  label: 'Codex',
  detect: (root) => existsSync(join(root, '.codex')) || existsSync(join(root, 'AGENTS.md')),
  prerequisites: () => [],
  async wire(ctx) {
    const staged = await wireCodexFloor(ctx.stageRoot, ctx.sourceRoot);
    // For Codex we materialize the skills into .agents/skills (its directory-
    // convention discovery) rather than a marketplace fetch — core skills plus the
    // skills of every activated pack (marketplace name harness-<x> maps to the
    // source dir pack-<x>). The native Codex plugin channel was evaluated and
    // declined (decision log, `codex-plugin-channel-declined`): one surface per
    // runtime, and no marketplace dependency to install.
    const packDirs = ctx.enabledPacks.map((p) => packDirForName(p.name)).filter((d): d is string => d !== undefined);
    const skills = await wireCodexSkills(ctx.stageRoot, ctx.sourceRoot, packDirs);
    // Both the five authored critics and the canonical v3 specialists compile
    // into native project-agent TOML. Skills remain a separate inline teaching
    // surface and never impersonate fresh-context agents.
    const agents = await wireCodexAgents(ctx.stageRoot, ctx.sourceRoot);
    const docResult = ctx.preserveDoctrineDoc === true
      ? 'preserved' as const
      : await patchRuntimeDoc(ctx.stageRoot, 'codex', {
          enabledPlugins: ctx.enabledPlugins,
          enabledPacks: ctx.enabledPacks,
          channel: ctx.source,
        });
    return {
      statusLines: [
        `.codex/hooks.json: ${staged} hook scripts wired → ${CODEX_HOOKS_DIR}/`,
        `${CODEX_SKILLS_DIR}/: ${skills} skills; ${CODEX_AGENTS_DIR}/: ${agents} native agents wired`,
        `AGENTS.md: ${docResult}`,
      ],
      nextSteps: ['trust the project .codex/ layer per your Codex config (the safety floor is wired)'],
    };
  },
  async doctorChecks(root) {
    return (await this.inspect(root)).checks;
  },
  async inspect(root) {
    const floor = await codexFloorHealth(root);
    const skills = await codexSkillsHealth(root);
    const specialists = await codexSpecialistsHealth(root);
    const doc = await docBlockCheck(root, 'codex');
    const checks: CheckResult[] = [
      {
        name: 'codex floor',
        ok: floor.ok,
        message: floor.detail,
        ...(floor.ok ? {} : { fix: `${PRODUCT_COMMAND} runtime add codex` }),
      },
      {
        name: 'codex skills',
        ok: skills.ok,
        message: skills.detail,
        ...(skills.ok ? {} : { fix: `${PRODUCT_COMMAND} runtime add codex` }),
      },
      {
        name: 'codex agents',
        ok: specialists.ok,
        ...(specialists.ok ? { status: 'advisory' as const } : {}),
        message: specialists.ok
          ? `${specialists.detail}; team degraded because parent sandbox overrides can weaken read-only`
          : specialists.detail,
        ...(specialists.ok ? {} : { fix: `${PRODUCT_COMMAND} runtime add codex` }),
      },
      doc,
    ];
    const runner = join(root, CODEX_HOOKS_DIR, '_void-hook.mjs');
    const installed = await safeRegularFile(runner);
    const wired = installed && floor.ok && skills.ok && specialists.ok && doc.ok;
    const smoke = wired
      ? await smokeInstalledHook(runner, 'codex')
      : { fired: false as const, detail: 'hook smoke blocked by failed installation or wiring' };
    checks.push(smokeCheck('codex', smoke.fired, smoke.detail));
    return {
      runtime: 'codex',
      specialistCapability: effectiveSpecialistCapability(
        specialists.ok,
        specialists.detail,
        CODEX_SPECIALIST_SAFETY,
      ),
      evidence: {
        installed,
        wired,
        fired: smoke.fired,
        observed: observedRuntime(root, 'codex'),
      },
      checks,
    };
  },
};

/** The registry. Adding a runtime = one more adapter here. */
export const ADAPTERS: readonly RuntimeAdapter[] = [claudeAdapter, codexAdapter];

/** Lightweight specialist readiness for mission dispatch. Unlike a full runtime
 * inspection this does not execute a hook smoke test on every controller step. */
export async function specialistCapabilityFor(
  root: string,
  runtime: Runtime,
  options: RuntimeInspectOptions = {},
): Promise<SpecialistRuntimeCapability> {
  if (runtime === 'codex') {
    const specialists = await codexSpecialistsHealth(root);
    return effectiveSpecialistCapability(
      specialists.ok,
      specialists.detail,
      CODEX_SPECIALIST_SAFETY,
    );
  }
  const localAgents = join(root, '.claude', 'agents');
  const localSpecialist = join(localAgents, 'security-engineer.md');
  const agentsRoot = await safeRegularFile(localSpecialist)
    ? localAgents
    : (() => {
        const cacheRoot = options.claudeCacheRoot
          ?? join(homedir(), '.claude', 'plugins', 'cache');
        const pluginDir = locatePluginDir(cacheRoot, CORE_PLUGIN_NAME);
        return pluginDir === undefined ? undefined : join(pluginDir, 'agents');
      })();
  const specialists = await claudeSpecialistsCheck(agentsRoot);
  return effectiveSpecialistCapability(
    specialists.ok,
    specialists.message,
    CLAUDE_SPECIALIST_SAFETY,
  );
}

export function adapterFor(runtime: Runtime): RuntimeAdapter {
  const found = ADAPTERS.find((a) => a.id === runtime);
  if (!found) throw new Error(`no adapter for runtime '${runtime}'`);
  return found;
}

/** Adapters for a selected set, in registry order. */
export function adaptersFor(runtimes: readonly Runtime[]): readonly RuntimeAdapter[] {
  return ADAPTERS.filter((a) => runtimes.includes(a.id));
}

/** Adapters whose runtime shows a footprint in the project, in registry order. */
export function detectedAdapters(root: string): readonly RuntimeAdapter[] {
  const detected = detectRuntimes(root);
  return ADAPTERS.filter((a) => detected.has(a.id));
}
