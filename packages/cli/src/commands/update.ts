import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pendingMigrations } from '@voidcorp/hook-runner';
import { z } from 'zod';
import { verifyInstalledRelease } from '../../bin/stable-launcher.mjs';
import { assertCandidateInputs } from '../lib/candidate-plan.js';
import { prepareWithCandidate } from '../lib/candidate-process.js';
import { completeRelease, ensureStoreDirectory, planLauncherBootstrap } from '../lib/cli-installation.js';
import { readInstallManifest } from '../lib/install-manifest.js';
import { cliVersion } from '../lib/paths.js';
import { voidGlobalDir } from '../lib/projects/catalog.js';
import { readInstallReceipt } from '../lib/receipts.js';
import { acquireRelease, type NpmInvocation, resolveRelease } from '../lib/release-acquisition.js';
import { line } from '../lib/render.js';
import { assertProjectCompatibility } from '../lib/update-compatibility.js';
import { withUpdateLock } from '../lib/update-lock.js';
import { executeUpdateOperation, recoverPendingUpdate, type UpdateParticipant } from '../lib/update-operation.js';
import { STABLE_VERSION, validateReleasePackage } from '../lib/update-release.js';
import { selectUpdateProjects } from '../lib/update-selection.js';
import { compareVersions } from '../lib/version.js';
import { prepareFileTransaction } from '../lib/transaction.js';

interface Options { readonly all: boolean; readonly dryRun: boolean; readonly version?: string }
function parseArgs(args: readonly string[]): Options {
  let all = false;
  let dryRun = false;
  let version: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--all') all = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--version' || arg?.startsWith('--version=')) {
      const value = arg === '--version' ? args[++index] : arg.slice('--version='.length);
      if (version !== undefined || !value || !STABLE_VERSION.test(value)) throw new Error('--version requires one exact stable version (for example 5.1.0)');
      version = value;
    } else throw new Error(`Unsupported update option ${arg}; use update [--all] [--dry-run] [--version X.Y.Z]. Offline materialization belongs to hydrate.`);
  }
  return { all, dryRun, ...(version === undefined ? {} : { version }) };
}
async function present(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}
async function launcherDirectory(): Promise<string> {
  const paths = (process.env.PATH ?? process.env.Path ?? '').split(delimiter).filter(Boolean).map(path => resolve(path));
  for (const path of paths) {
    if (await present(join(path, 'void-machine'))) return await realpath(path);
  }
  const fallback = join(homedir(), '.local', 'bin');
  if (!paths.includes(fallback)) line(`PATH does not include ${fallback}; add it explicitly after update and refresh your shell command cache.`);
  return fallback;
}
const activeSchema = z.strictObject({ schemaVersion: z.literal(1), version: z.string().regex(STABLE_VERSION),
  previous: z.string().regex(STABLE_VERSION).optional() });
async function activeSelection(store: string) {
  const path = join(store, 'active.json');
  if (!await present(path)) return { expected: { exists: false as const } };
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) throw new Error('Invalid active CLI selection');
  const bytes = await readFile(path);
  const active = activeSchema.parse(JSON.parse(bytes.toString('utf8')));
  await verifyInstalledRelease(store, active.version);
  return { version: active.version, expected: { exists: true as const,
    sha256: createHash('sha256').update(bytes).digest('hex'), mode: info.mode & 0o777 } };
}
async function classifyProject(root: string): Promise<string> {
  const legacy = pendingMigrations(root);
  for (const path of ['.void/active.md', 'plans/ACTIVE.md']) if (await present(join(root, path))) legacy.push(path);
  if (legacy.length > 0) throw new Error(`Legacy layout at ${root}: ${legacy.join(', ')}. Restore or explicitly migrate this layout before stable update; no repairs were applied.`);
  await assertProjectCompatibility(root, { acquiringCandidate: true });
  const receipt = await readInstallReceipt(root);
  if (receipt?.source === 'marketplace') throw new Error(`Marketplace installation at ${root} is unsupported by stable local update; retain its marketplace updater.`);
  return receipt?.version ?? readInstallManifest(root)?.version ?? 'unknown';
}
async function smokeRelease(packageRoot: string, version: string, workspace: string): Promise<void> {
  const env: NodeJS.ProcessEnv = { HOME: workspace, USERPROFILE: workspace, VOID_GLOBAL_DIR: join(workspace, '.void') };
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const result = await promisify(execFile)(process.execPath, [join(packageRoot, 'bin/void-machine.mjs'), '--version'], {
    cwd: workspace, env, timeout: 30_000, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL', shell: false, windowsHide: true,
  });
  if (result.stdout.trim() !== version) throw new Error('Candidate executable version differs from pinned release');
}

/** Public update acquires once; the candidate compiles, and the transaction alone publishes. */
export async function update(args: readonly string[], ports: {
  readonly fetcher?: typeof fetch; readonly runNpm?: (invocation: NpmInvocation) => Promise<void>;
} = {}): Promise<void> {
  const options = parseArgs(args);
  const globalDir = resolve(voidGlobalDir());
  const projectRoots = selectUpdateProjects({ cwd: process.cwd(), globalDir, all: options.all });
  const binRoot = await launcherDirectory();
  const selection = { key: JSON.stringify({ all: options.all, roots: projectRoots, binRoot }), projectRoots, binRoot };
  const store = join(globalDir, 'cli');
  await withUpdateLock(store, async lease => {
    if (options.dryRun && await present(join(store, 'operation'))) throw new Error('Pending update requires recovery; repeat its original update command without --dry-run');
    await recoverPendingUpdate(lease, selection);
    const versions = new Map<string, string>();
    for (const root of projectRoots) versions.set(root, await classifyProject(root));
    line(`Executing CLI: ${cliVersion()}`);
    if (projectRoots.length === 0) line('No project selected; CLI-only update.');
    else for (const root of projectRoots) line(`Selected project: ${root} (installed ${versions.get(root)})`);
    const active = await activeSelection(store);
    line(`Active default CLI: ${active.version ?? 'not managed'}`);
    const current = active.version && compareVersions(active.version, cliVersion()) > 0 ? active.version : cliVersion();
    const release = await resolveRelease(current, options.version, ports.fetcher);
    line(`Target release: ${release.version}`);
    const workspace = join(store, 'staging');
    await ensureStoreDirectory(workspace);
    line(`Acquisition staging/cache: ${workspace}`);
    const packageRoot = await acquireRelease(release, workspace, ports);
    await validateReleasePackage(packageRoot, release.version);
    await smokeRelease(packageRoot, release.version, workspace);
    const operationId = randomUUID();
    const plans = [];
    for (const root of projectRoots) {
      plans.push(await prepareWithCandidate(packageRoot, { protocol: 1, operationId, version: release.version, root }, workspace));
    }
    const previousPackage = active.version ? await verifyInstalledRelease(store, active.version) : undefined;
    const previousLauncher = previousPackage ? await readFile(join(previousPackage, 'bin/stable-launcher.mjs')) : undefined;
    const bootstrap = await planLauncherBootstrap(binRoot, await readFile(join(packageRoot, 'bin/stable-launcher.mjs')), previousLauncher);
    for (const alias of bootstrap.conflicts) line(`Preserved unowned alias: ${join(binRoot, alias)}`);
    for (const plan of plans) {
      await assertCandidateInputs(plan.root, plan.inputs);
      for (const path of plan.restored) line(`Restore managed file: ${plan.root}/${path}`);
      for (const path of plan.preserved) line(`Preserve authored file: ${plan.root}/${path}`);
      for (const mutation of plan.mutations) {
        if (mutation.path === '.void/program.md' || mutation.path.endsWith('/merge-hold.json')) line(`Policy migration: ${plan.root}/${mutation.path}`);
      }
    }
    if (options.dryRun) { line('Dry run passed; active CLI, launchers and projects are unchanged. Staging/cache retained.'); return; }
    await completeRelease(packageRoot, store, release);
    await ensureStoreDirectory(binRoot);
    const bootstrapBackup = join(store, 'bootstrap');
    if (!await present(bootstrapBackup)) {
      await prepareFileTransaction(binRoot, bootstrap.mutations, bootstrapBackup, operationId);
      line(`Original launcher backup: ${bootstrapBackup}`);
    }
    const participants: UpdateParticipant[] = plans.map(plan => ({ kind: 'project', root: plan.root, mutations: plan.mutations }));
    participants.push({ kind: 'launcher', root: binRoot, mutations: bootstrap.mutations });
    participants.push({ kind: 'active', root: store, mutations: [{ path: 'active.json', mode: 0o600, expected: active.expected,
      content: Buffer.from(JSON.stringify({ schemaVersion: 1, version: release.version,
        ...(active.version ? { previous: active.version } : {}) }) + '\n') }] });
    await executeUpdateOperation(lease, { selection, operationId, target: release.version, participants });
    for (const root of projectRoots) line(`Updated project: ${root} -> ${release.version}`);
    line(`Active default CLI: ${release.version}. Reload existing runtime sessions as needed; native trust remains yours.`);
  });
}
