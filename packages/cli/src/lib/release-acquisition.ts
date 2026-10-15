import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PRODUCT_IDENTITY } from '@voidcorp/hook-runner';
import { packageManagerCommand } from './package-manager.js';
import { type PinnedRelease, pinRelease, STABLE_VERSION, validateReleasePackage, verifyReleaseArchive } from './update-release.js';

async function download(url: string, limit: number, fetcher: typeof fetch): Promise<Buffer> {
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) throw new Error(`Release download failed with HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) throw new Error('Release download exceeds byte limit');
      chunks.push(result.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function resolveRelease(currentVersion: string, exactVersion?: string, fetcher: typeof fetch = fetch): Promise<PinnedRelease> {
  if (exactVersion !== undefined && !STABLE_VERSION.test(exactVersion)) throw new Error('An exact stable release version is required');
  const bytes = await download(`https://registry.npmjs.org/${PRODUCT_IDENTITY.packageName}/${exactVersion ?? 'latest'}`, 1024 * 1024, fetcher);
  return pinRelease(JSON.parse(bytes.toString('utf8')), currentVersion, exactVersion);
}

export interface NpmInvocation {
  readonly cwd: string;
  readonly args: string[];
  readonly env: NodeJS.ProcessEnv;
}

async function runNpm(invocation: NpmInvocation): Promise<void> {
  const command = packageManagerCommand('npm', { environment: invocation.env });
  try {
    await promisify(execFile)(command.executable, [...command.prefixArguments, ...invocation.args], {
      cwd: invocation.cwd, env: invocation.env, timeout: 120_000, maxBuffer: 1024 * 1024,
      killSignal: 'SIGKILL', windowsHide: true, shell: false,
    });
  } catch {
    // npm diagnostics may contain machine configuration; do not echo arbitrary output.
    throw new Error('Release npm installation failed, timed out, or exceeded its output limit');
  }
}

function isolatedEnvironment(stage: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'LANG', 'LC_ALL']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, HOME: join(stage, 'home'), USERPROFILE: join(stage, 'home'),
    APPDATA: join(stage, 'home'), LOCALAPPDATA: join(stage, 'home'),
    TMPDIR: join(stage, 'tmp'), TEMP: join(stage, 'tmp'), TMP: join(stage, 'tmp'),
    npm_config_userconfig: join(stage, 'user.npmrc'), npm_config_globalconfig: join(stage, 'global.npmrc'),
    npm_config_cache: join(stage, 'npm-cache'), npm_config_update_notifier: 'false',
  };
}

/** Owns only its unique stage; the caller promotes a validated release after candidate smoke. */
export async function acquireRelease(release: PinnedRelease, stagingRoot: string, ports: {
  readonly fetcher?: typeof fetch;
  readonly runNpm?: (invocation: NpmInvocation) => Promise<void>;
} = {}): Promise<string> {
  const stage = await mkdtemp(join(stagingRoot, 'release-'));
  try {
    const bytes = await download(release.tarball, 128 * 1024 * 1024, ports.fetcher ?? fetch);
    verifyReleaseArchive(release, bytes);
    const archivePath = join(stage, 'release.tgz');
    await writeFile(archivePath, bytes, { flag: 'wx', mode: 0o600 });
    await mkdir(join(stage, 'home'));
    await mkdir(join(stage, 'tmp'));
    await writeFile(join(stage, 'user.npmrc'), '', { flag: 'wx' });
    await writeFile(join(stage, 'global.npmrc'), '', { flag: 'wx' });
    await (ports.runNpm ?? runNpm)({ cwd: stage, env: isolatedEnvironment(stage), args: [
      'install', archivePath, '--prefix', stage, '--ignore-scripts', '--offline', '--no-save',
      '--audit=false', '--fund=false', '--engine-strict', '--bin-links=false', '--workspaces=false',
      '--registry=https://registry.npmjs.org',
    ] });
    const packageRoot = join(stage, 'node_modules', PRODUCT_IDENTITY.packageName);
    await validateReleasePackage(packageRoot, release.version);
    return packageRoot;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}
