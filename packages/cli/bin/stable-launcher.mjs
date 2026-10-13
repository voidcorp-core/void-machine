#!/usr/bin/env node
// tdd-cover: e2e packages/cli/src/lib/cli-installation.test.ts
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const safePath = path => typeof path === 'string' && path.length <= 1024
  && !path.includes('\\') && !path.includes(':')
  && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');

async function regularBytes(path, limit) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('Invalid bounded stable CLI file');
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new Error('Stable CLI file exceeds byte limit');
  return bytes;
}

/** Kept dependency-free so a copied launcher can verify a release before importing it. */
export async function verifyInstalledRelease(store, version) {
  if (typeof version !== 'string' || !versionPattern.test(version)) throw new Error('Invalid active CLI version');
  const releaseRoot = join(store, 'releases', version);
  if (await realpath(releaseRoot) !== resolve(releaseRoot)) throw new Error('Stable CLI store crosses a symbolic link');
  const seal = JSON.parse((await regularBytes(join(releaseRoot, 'release.json'), 4 * 1024 * 1024)).toString('utf8'));
  if (seal.schemaVersion !== 1 || seal.version !== version || !Array.isArray(seal.files)
    || seal.files.length === 0 || seal.files.length > 20_000
    || typeof seal.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(seal.integrity)) {
    throw new Error('Invalid stable CLI release seal');
  }
  const root = join(releaseRoot, 'node_modules', 'voidmachine');
  const expected = new Map();
  for (const file of seal.files) {
    if (!safePath(file.path) || expected.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)
      || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) throw new Error('Invalid stable CLI integrity record');
    expected.set(file.path, file);
  }
  let count = 0;
  let total = 0;
  async function visit(relative, depth) {
    if (++count > 20_000 || depth > 32) throw new Error('Stable CLI tree exceeds limit');
    const path = join(root, relative);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('Stable CLI integrity: symbolic link');
    if (info.isDirectory()) {
      for (const name of await readdir(path)) await visit(relative ? `${relative}/${name}` : name, depth + 1);
      return;
    }
    const bytes = await regularBytes(path, 128 * 1024 * 1024);
    total += bytes.length;
    const file = expected.get(relative);
    if (total > 512 * 1024 * 1024 || !file || file.sha256 !== hash(bytes) || file.mode !== (info.mode & 0o777)) {
      throw new Error(`Stable CLI integrity mismatch: ${relative}`);
    }
    expected.delete(relative);
  }
  await visit('', 0);
  if (expected.size !== 0) throw new Error('Stable CLI integrity: missing release files');
  const pkg = JSON.parse((await regularBytes(join(root, 'package.json'), 1024 * 1024)).toString('utf8'));
  if (pkg.name !== 'voidmachine' || pkg.version !== version || pkg.voidUpdate?.protocol !== 1) throw new Error('Stable CLI package identity mismatch');
  const minimum = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(pkg.engines?.node ?? '');
  if (!minimum) throw new Error('Unsupported stable CLI Node engine');
  const current = process.versions.node.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    const required = Number(minimum[index + 1]);
    if (current[index] > required) break;
    if (current[index] < required) throw new Error(`Stable CLI requires Node ${pkg.engines.node}`);
  }
  return root;
}

// Imports expose verification only; direct invocation delegates in this same process.
if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const store = join(process.env.VOID_GLOBAL_DIR ?? join(homedir(), '.void'), 'cli');
    if (await realpath(store) !== resolve(store)) throw new Error('Stable CLI store crosses a symbolic link');
    const active = JSON.parse((await regularBytes(join(store, 'active.json'), 8192)).toString('utf8'));
    if (active.schemaVersion !== 1 || (active.previous !== undefined && !versionPattern.test(active.previous))) throw new Error('Invalid active CLI selection');
    const root = await verifyInstalledRelease(store, active.version);
    const { run } = await import(pathToFileURL(join(root, 'dist/main.js')).href);
    await run(basename(process.argv[1], '.mjs'), process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Stable CLI failed'}\n`);
    process.exitCode = 1;
  }
}
