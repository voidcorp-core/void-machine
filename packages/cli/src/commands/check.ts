// `check` compares the installed channel: bundled receipt/manifest against npm,
// marketplace pins against their remote. --doctrine explicitly reads marketplace doctrine.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CORE_PLUGIN_NAME, MARKETPLACE_NAME, MARKETPLACE_REPO, PACKS } from '../lib/packs.js';
import { remedyPrefix, resolveProjectRoots } from '../lib/project-roots.js';
import { readSettings, settingsPathFor } from '../lib/settings.js';
import {
  fetchRemoteMarketplace,
  fetchPinnedPluginVersion,
  fetchRemotePhilosophy,
  type RemoteMarketplace,
} from '../lib/remote.js';
import { compareVersions, normalizeVersion } from '../lib/version.js';
import { banner, blank, c, footer, glyph, line, meta, row, status } from '../lib/render.js';
import { PRODUCT_COMMAND, resolveFreshness } from '@voidcorp/hook-runner';
import { readInstallReceipt } from '../lib/receipts.js';
import { INSTALL_MANIFEST_PATH, readInstallManifest } from '../lib/install-manifest.js';
import { publishedVersionCheck } from '../lib/freshness-check.js';
import { updateRouteFor } from './update.js';


interface LocalConfig {
  readonly core?: string;
  readonly packs?: Record<string, string>;
}

/** The three reads `check` makes of the marketplace, `gh` by default. */
export interface CheckRemote {
  readonly fetchRemoteMarketplace: typeof fetchRemoteMarketplace;
  readonly fetchPinnedPluginVersion: typeof fetchPinnedPluginVersion;
  readonly fetchRemotePhilosophy: typeof fetchRemotePhilosophy;
}

export interface CheckOptions {
  /** The directory the command ran in. The installation is resolved from it. */
  readonly cwd?: string;
  /** What the marketplace answers. A test hands in a remote that needs no network. */
  readonly remote?: CheckRemote;
  readonly resolveFreshness?: typeof resolveFreshness;
}

const GH_REMOTE: CheckRemote = {
  fetchRemoteMarketplace,
  fetchPinnedPluginVersion,
  fetchRemotePhilosophy,
};

export async function check(args: readonly string[], options: CheckOptions = {}): Promise<void> {
  const doctrine = args.includes('--doctrine');
  const remote = options.remote ?? GH_REMOTE;
  // The pins, the settings and the installed doctrine belong to the
  // installation, which from a linked worktree is the main checkout.
  const roots = resolveProjectRoots(options.cwd);
  const installRoot = roots.installRoot;
  // `update` and `init` act on the directory they are typed in. A remedy
  // followed from a worktree as printed would install a second copy there,
  // bumping none of the pins this check measures, so it names the installation.
  const where = remedyPrefix(roots);

  const receipt = await readInstallReceipt(installRoot);
  const route = updateRouteFor(receipt, existsSync(join(installRoot, INSTALL_MANIFEST_PATH)));
  banner('check');
  if (route !== 'marketplace') {
    const installed = receipt?.version ?? readInstallManifest(installRoot)?.version ?? 'unknown';
    const freshness = await (options.resolveFreshness ?? resolveFreshness)({
      installed, env: process.env, now: Date.now(), cwd: installRoot,
    });
    const published = publishedVersionCheck(freshness, 'local');
    meta('source', 'bundled local package');
    blank();
    status(published.message, published.status === 'pass' ? 'ok' : 'warn');
    if (published.fix !== undefined) line(c.dim(`${where}${published.fix}`));
    if (!doctrine) return;
    blank();
  }
  const repo = await resolveMarketplaceRepo(installRoot);
  const local = await readLocalConfig(installRoot);
  meta('marketplace', repo);
  blank();

  const marketplace = remote.fetchRemoteMarketplace(repo);
  if (!marketplace.ok) {
    status(`could not fetch remote marketplace: ${marketplace.error}`, 'err');
    line(c.dim('verify `gh auth status` and that you have access to the repo.'));
    process.exit(1);
  }

  const drift = route === 'marketplace'
    ? reportVersionDrift(local, marketplace.value, repo, remote)
    : 0;

  if (doctrine) {
    blank();
    await reportDoctrineDrift(installRoot, where, marketplace.value, repo, remote);
  }

  if (route !== 'marketplace') return;

  if (drift > 0) {
    footer(
      `${c.yellow(`${drift} plugin${drift > 1 ? 's' : ''} behind`)} ${glyph.emdash} run ${where}${c.bold(
        `${PRODUCT_COMMAND} update`,
      )} ${c.dim('(refreshes the plugin cache + bumps the pins this check measures), then restart Claude Code')}`,
    );
  } else {
    footer(c.dim('all up to date'));
  }
}

async function resolveMarketplaceRepo(installRoot: string): Promise<string> {
  const settings = await readSettings(settingsPathFor(installRoot));
  const entry = (settings.extraKnownMarketplaces as Record<string, unknown> | undefined)?.[MARKETPLACE_NAME];
  if (entry && typeof entry === 'object') {
    const source = (entry as { source?: { repo?: string } }).source;
    if (source?.repo) return source.repo;
  }
  return MARKETPLACE_REPO;
}

async function readLocalConfig(installRoot: string): Promise<LocalConfig> {
  const configPath = join(installRoot, '.void', 'config.json');
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(await readFile(configPath, 'utf8')) as LocalConfig;
  } catch {
    return {};
  }
}

function reportVersionDrift(
  local: LocalConfig,
  marketplace: RemoteMarketplace,
  marketplaceRepo: string,
  remote: CheckRemote,
): number {
  const localVersions: Record<string, string | undefined> = {
    [CORE_PLUGIN_NAME]: local.core,
  };
  for (const pack of PACKS) {
    localVersions[pack.name] = local.packs?.[`@voidcorp/${pack.name}`];
  }

  let drift = 0;

  for (const plugin of marketplace.plugins) {
    const declaredRaw = localVersions[plugin.name];
    const localStr = declaredRaw ? normalizeVersion(declaredRaw) : glyph.emdash;
    const remoteFetch = remote.fetchPinnedPluginVersion(plugin, marketplaceRepo);
    if (!remoteFetch.ok) {
      row({ mark: 'info', label: plugin.name, versions: [localStr, glyph.emdash], suffix: c.dim(remoteFetch.error) });
      continue;
    }
    const remoteStr = remoteFetch.value;

    if (!declaredRaw) {
      row({
        mark: 'info',
        label: plugin.name,
        versions: [localStr, remoteStr],
        suffix: c.dim('not installed'),
      });
    } else if (compareVersions(localStr, remoteStr) < 0) {
      drift += 1;
      row({
        mark: 'warn',
        label: plugin.name,
        versions: [localStr, remoteStr],
        suffix: c.yellow('update available'),
      });
    } else {
      row({
        mark: 'ok',
        label: plugin.name,
        versions: [localStr, remoteStr],
        suffix: c.dim('up to date'),
      });
    }
  }

  return drift;
}

async function reportDoctrineDrift(
  installRoot: string,
  where: string,
  marketplace: RemoteMarketplace,
  marketplaceRepo: string,
  remote: CheckRemote,
): Promise<void> {
  // New home first, previous one until the project runs `update`.
  const migrated = join(installRoot, '.void', 'installed', 'PHILOSOPHY.md');
  const localPath = existsSync(migrated)
    ? migrated
    : join(installRoot, '.void', 'PHILOSOPHY.md');
  if (!existsSync(localPath)) {
    status(`PHILOSOPHY.md missing locally — run ${where}\`${PRODUCT_COMMAND} init\` to install.`, 'warn');
    return;
  }
  const localText = await readFile(localPath, 'utf8');
  const fetched = remote.fetchRemotePhilosophy(marketplace, CORE_PLUGIN_NAME, marketplaceRepo);
  if (!fetched.ok) {
    status(`could not fetch remote PHILOSOPHY.md: ${fetched.error}`, 'warn');
    return;
  }
  if (normalizeNewlines(localText) === normalizeNewlines(fetched.value)) {
    status(`PHILOSOPHY.md ${c.dim('in sync')}`);
    return;
  }
  const localLines = localText.split('\n').length;
  const remoteLines = fetched.value.split('\n').length;
  status(
    `PHILOSOPHY.md drift (local ${localLines}L, remote ${remoteLines}L) — run ${where}\`${PRODUCT_COMMAND} init\` to overwrite`,
    'warn',
  );
}

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n/g, '\n').trimEnd();
}
