// `void-machine runtime <list|add>` — inspect and grow the set of agent runtimes
// a project targets, a posteriori and without friction.
//
// The archetype: you `init` with Claude, work for weeks, then decide to add
// Codex. `void-machine runtime add codex` wires exactly Codex's layer (its safety
// floor + AGENTS.md) and touches nothing Claude. Idempotent, adapter-driven —
// the command never branches on a runtime name.

import * as p from '@clack/prompts';
import { existsSync } from 'node:fs';
import { assertProjectCompatibility } from '../lib/update-compatibility.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliVersion, findCoreSource } from '../lib/paths.js';
import { CORE_PLUGIN_NAME, findPack, MARKETPLACE_REPO, type PackDescriptor } from '../lib/packs.js';
import { marketplaceRepoFrom, readSettings, settingsPathFor } from '../lib/settings.js';
import { ADAPTERS, adaptersFor } from '../lib/runtime-adapters.js';
import { detectRuntimes, parseRuntimeArg, type Runtime } from '../lib/runtime.js';
import { banner, blank, c, footer, glyph, line, meta } from '../lib/render.js';
import { prepareInstallCommit, seedInstallStage } from '../lib/local-install.js';
import { commitFileTransaction } from '../lib/transaction.js';
import { PRODUCT_COMMAND } from '@voidcorp/hook-runner';

export async function runtime(args: readonly string[]): Promise<void> {
  const [sub, ...rest] = args;
  if (sub === undefined || sub === 'list' || sub === 'ls') return runtimeList();
  if (sub === 'add') return runtimeAdd(rest);
  p.log.error(`Unknown subcommand '${sub}'. Usage: ${PRODUCT_COMMAND} runtime <list | add <claude|codex>>`);
  process.exit(2);
}

function runtimeList(): void {
  const projectRoot = process.cwd();
  const detected = detectRuntimes(projectRoot);
  banner('runtime');
  meta('project', projectRoot);
  blank();
  for (const adapter of ADAPTERS) {
    const on = detected.has(adapter.id);
    const mark = on ? c.green(glyph.check) : c.dim(glyph.dot);
    const state = on ? 'wired' : c.dim('not wired');
    line(`${mark}  ${c.dim(adapter.id.padEnd(10))}${adapter.label.padEnd(16)}${state}`);
  }
  blank();
  footer(`add one with ${c.bold(`${PRODUCT_COMMAND} runtime add <claude|codex>`)}`);
}

async function runtimeAdd(rest: readonly string[]): Promise<void> {
  const projectRoot = process.cwd();
  await assertProjectCompatibility(projectRoot);

  // Parse the requested runtimes; a typo must fail loudly, never silently no-op.
  const requested: Runtime[] = [];
  const invalid: string[] = [];
  for (const token of rest) {
    const parsed = parseRuntimeArg(token);
    if (parsed.length === 0) invalid.push(token);
    else requested.push(...parsed);
  }
  if (invalid.length > 0) {
    p.log.error(`Unknown runtime(s): ${invalid.join(', ')}. Use: claude, codex.`);
    process.exit(2);
  }
  if (requested.length === 0) {
    p.log.error(`Usage: ${PRODUCT_COMMAND} runtime add <claude|codex>`);
    process.exit(2);
  }

  if (!existsSync(join(projectRoot, '.void', 'config.json'))) {
    p.log.error(`No .void/config.json — run \`${PRODUCT_COMMAND} init\` first, then add runtimes.`);
    process.exit(2);
  }

  const adapters = adaptersFor(requested);
  const sourceRoot = await findCoreSource();
  const settings = await readSettings(settingsPathFor(projectRoot));
  const marketplaceRepo = marketplaceRepoFrom(settings, MARKETPLACE_REPO);
  const enabledPacks = await readEnabledPacks(projectRoot);
  const enabledPlugins = [CORE_PLUGIN_NAME, ...enabledPacks.map((pk) => pk.name)];
  const pinVersion = cliVersion();

  banner('runtime add');
  meta('project', projectRoot);
  meta('adding', adapters.map((a) => a.label).join(' + '));
  blank();

  const nextSteps: string[] = [];
  const alreadyDetected = detectRuntimes(projectRoot);
  const resultingRuntimes = [...new Set([...alreadyDetected, ...requested])];
  const stageRoot = await mkdtemp(join(tmpdir(), 'void-runtime-stage-'));
  try {
    await seedInstallStage(projectRoot, stageRoot);
    const ctx = {
      stageRoot,
      installRoot: projectRoot,
      sourceRoot,
      enabledPlugins,
      enabledPacks,
      source: 'local' as const,
      marketplaceRepo,
      pinVersion,
    };
    for (const adapter of adapters) {
      const already = adapter.detect(projectRoot);
      const outcome = await adapter.wire(ctx);
      for (const status of outcome.statusLines) {
        line(`${c.green(glyph.check)}  ${c.dim(adapter.id.padEnd(18))}${status}`);
      }
      nextSteps.push(...outcome.nextSteps);
      if (already) line(c.dim(`     ${glyph.dot} ${adapter.id} was already wired — refreshed in place`));
      const inspection = await adapter.inspect(stageRoot);
      if (
        inspection.evidence.installed !== true
        || inspection.evidence.wired !== true
        || inspection.evidence.fired === false
      ) {
        throw new Error(`${adapter.label} staged doctor failed`);
      }
    }
    const prepared = await prepareInstallCommit({
      projectRoot,
      stageRoot,
      version: cliVersion(),
      source: 'local',
      runtimes: resultingRuntimes,
      force: false,
      retainPreviousOwned: true,
    });
    await commitFileTransaction(projectRoot, prepared.mutations);
    for (const path of prepared.restored) {
      line(`${c.yellow('!')}  restored ${path} from the delivered harness`);
    }
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }

  blank();
  line(c.bold('Next steps:'));
  nextSteps.forEach((item, i) => {
    const failed = item.startsWith('FAILED:');
    const label = `${i + 1}. ${item}`;
    line(`  ${failed ? c.red(label) : c.dim(label)}`);
  });
  footer(`${c.bold(`${PRODUCT_COMMAND} doctor`)} to verify`);
}

/** The packs already active in the project, read from .void/config.json. */
async function readEnabledPacks(projectRoot: string): Promise<PackDescriptor[]> {
  const configPath = join(projectRoot, '.void', 'config.json');
  let config: { packs?: Record<string, string> } = {};
  try {
    config = JSON.parse(await readFile(configPath, 'utf8'));
  } catch {
    return [];
  }
  const packs: PackDescriptor[] = [];
  for (const key of Object.keys(config.packs ?? {})) {
    const found = findPack(key.replace(/^@voidcorp\//, ''));
    if (found) packs.push(found);
  }
  return packs;
}
