import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, parse, resolve, sep } from 'node:path';
import { z } from 'zod';
import { verifyInstalledRelease } from '../../bin/stable-launcher.mjs';
import type { FileWriteMutation } from './transaction.js';
import { type PinnedRelease, STABLE_VERSION, validateReleasePackage } from './update-release.js';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function optionalInfo(path: string): Promise<Stats | undefined> {
  try { return await lstat(path); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function ensureStoreDirectory(path: string): Promise<void> {
  const absolute = resolve(path);
  let cursor = parse(absolute).root;
  for (const segment of absolute.slice(cursor.length).split(sep)) {
    cursor = join(cursor, segment);
    const info = await optionalInfo(cursor);
    if (!info) await mkdir(cursor, { mode: 0o700 });
    else if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Store directory is not a physical directory: ${cursor}`);
  }
}

async function declaredBin(entry: string, alias: string): Promise<boolean> {
  try {
    if (await realpath(entry) !== resolve(entry) || !(await lstat(entry)).isFile()) return false;
    const root = dirname(dirname(entry));
    const metadata = join(root, 'package.json');
    const info = await lstat(metadata);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) return false;
    const pkg = z.object({ name: z.literal('voidmachine'), version: z.string().regex(STABLE_VERSION),
      bin: z.record(z.string(), z.string()) }).parse(JSON.parse(await readFile(metadata, 'utf8')));
    const target = pkg.bin[alias];
    return target !== undefined && target === './bin/void-machine.mjs' && resolve(root, target) === entry;
  } catch { return false; }
}

/** Qualification produces a finite transaction plan; it never replaces a launcher itself. */
export async function planLauncherBootstrap(binRoot: string, launcher: Uint8Array, previousLauncher?: Uint8Array, platform: string = process.platform) {
  if (platform === 'win32') return planWindowsBootstrap(binRoot, launcher, previousLauncher);
  const mutations: FileWriteMutation[] = [];
  const conflicts: string[] = [];
  for (const alias of ['void-machine', 'voidmachine', 'vm']) {
    const path = join(binRoot, alias);
    const info = await optionalInfo(path);
    if (!info) {
      if (alias !== 'vm') mutations.push({ path: alias, content: launcher, mode: 0o755, expected: { exists: false } });
      continue;
    }
    let mutation: FileWriteMutation | undefined;
    if (info.isSymbolicLink()) {
      const link = await readlink(path);
      const target = resolve(binRoot, link);
      if (basename(dirname(dirname(dirname(target)))) === 'node_modules' && await declaredBin(target, alias)) {
        mutation = { path: alias, content: launcher, mode: 0o755, replaceLink: link };
      }
    } else if (info.isFile() && info.size <= 4 * 1024 * 1024) {
      const bytes = await readFile(path);
      const wrapper = /^#!\/bin\/(?:sh|bash)\nexec "(\/[^"\n$`]+)" "(\/[^"\n$`]+)" "\$@"\n?$/.exec(bytes.toString('utf8'));
      const known = bytes.equals(launcher) || (previousLauncher !== undefined && bytes.equals(previousLauncher))
        || (wrapper?.[2] !== undefined && await declaredBin(wrapper[2], alias));
      if (known) mutation = { path: alias, content: launcher, mode: 0o755,
        expected: { exists: true, sha256: hash(bytes), mode: info.mode & 0o777 } };
    }
    if (mutation) mutations.push(mutation);
    else if (alias === 'void-machine') throw new Error(`Unowned launcher void-machine at ${path}; preserve it and choose a supported launcher location`);
    else conflicts.push(alias);
  }
  return { mutations, conflicts };
}

// npm 11 cmd-shim output for its canonical node_modules/voidmachine bin, qualified
// against the package declaration below. Unknown wrapper revisions stay user-owned.
const npmWindowsHashes: Readonly<Record<string, string>> = {
  '': 'e9ff11472326366df74c397d89f59264d9da684b352b4ef98035198314940da3',
  '.cmd': '010aaa2929865a75d3708a56d39755bc1ddbb996393661f086918b238af91292',
  '.ps1': 'e110ea1df178778173a04a43b4531c3a4a64657919572e160ccdf2daf72994cd',
};
async function planWindowsBootstrap(binRoot: string, launcher: Uint8Array, previousLauncher?: Uint8Array) {
  const command = Buffer.from('@echo off\r\nnode "%~dp0void-machine.mjs" %*\r\nexit /b %errorlevel%\r\n');
  const powershell = Buffer.from('if ($MyInvocation.ExpectingInput) {\n  $input | & node "$PSScriptRoot/void-machine.mjs" @args\n} else {\n  & node "$PSScriptRoot/void-machine.mjs" @args\n}\nexit $LASTEXITCODE\n');
  const mutations: FileWriteMutation[] = [];
  const conflicts: string[] = [];
  for (const alias of ['void-machine.mjs', 'void-machine', 'voidmachine', 'vm']) {
    const variants = alias.endsWith('.mjs') ? [['', launcher] as const]
      : [['', launcher], ['.cmd', command], ['.ps1', powershell]] as const;
    const pending: FileWriteMutation[] = [];
    let conflict = false;
    let existing = false;
    for (const [extension, content] of variants) {
      const path = alias + extension;
      const info = await optionalInfo(join(binRoot, path));
      if (!info) { pending.push({ path, content, mode: 0o755, expected: { exists: false } }); continue; }
      existing = true;
      if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 * 1024) { conflict = true; continue; }
      const bytes = await readFile(join(binRoot, path));
      const known = bytes.equals(content) || (extension === '' && previousLauncher !== undefined && bytes.equals(previousLauncher))
        || (!alias.endsWith('.mjs') && hash(bytes) === npmWindowsHashes[extension]
          && await declaredBin(join(binRoot, 'node_modules/voidmachine/bin/void-machine.mjs'), alias));
      if (!known) { conflict = true; continue; }
      pending.push({ path, content, mode: 0o755, expected: { exists: true, sha256: hash(bytes), mode: info.mode & 0o777 } });
    }
    if (conflict && alias.startsWith('void-machine')) throw new Error(`Unowned Windows launcher ${alias} at ${binRoot}; preserve it before choosing a supported location`);
    if (conflict) conflicts.push(alias);
    else if (alias !== 'vm' || existing) mutations.push(...pending);
  }
  return { mutations, conflicts };
}

/** Promote a verified cache package once; completed releases are never overwritten. */
export async function completeRelease(packageRoot: string, store: string, release: PinnedRelease): Promise<string> {
  await validateReleasePackage(packageRoot, release.version);
  await ensureStoreDirectory(join(store, 'releases'));
  const destination = join(store, 'releases', release.version);
  if (await optionalInfo(destination)) {
    const installed = await verifyInstalledRelease(store, release.version);
    const seal = JSON.parse(await readFile(join(destination, 'release.json'), 'utf8'));
    if (seal.integrity !== release.integrity) throw new Error('Published release integrity changed; retained installation is untouched');
    return installed;
  }
  const stage = await mkdtemp(join(store, 'releases', '.release-'));
  try {
    await mkdir(join(stage, 'node_modules'));
    const installed = join(stage, 'node_modules', 'voidmachine');
    await rename(packageRoot, installed);
    const files: { path: string; sha256: string; mode: number }[] = [];
    async function sealFiles(relative: string): Promise<void> {
      const path = join(installed, relative);
      const info = await lstat(path);
      if (info.isDirectory()) {
        for (const name of await readdir(path)) await sealFiles(relative ? `${relative}/${name}` : name);
      } else {
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('Release changed during promotion');
        files.push({ path: relative, sha256: hash(await readFile(path)), mode: info.mode & 0o777 });
      }
    }
    await sealFiles('');
    await writeFile(join(stage, 'release.json'), JSON.stringify({ schemaVersion: 1, version: release.version, integrity: release.integrity, files }), { flag: 'wx', mode: 0o600 });
    await rename(stage, destination);
    return await verifyInstalledRelease(store, release.version);
  } finally { await rm(stage, { recursive: true, force: true }); }
}
