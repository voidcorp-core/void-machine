import { createHash, timingSafeEqual } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { compareVersions } from './version.js';

export const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const stableVersion = z.string().max(64).regex(STABLE_VERSION);
const metadataSchema = z.object({
  name: z.literal('voidmachine'), version: stableVersion,
  dist: z.object({ tarball: z.string().max(2048), integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/) }),
});
export interface PinnedRelease {
  readonly version: string;
  readonly tarball: string;
  readonly integrity: string;
}

export function pinRelease(input: unknown, currentVersion: string, exactVersion?: string): PinnedRelease {
  const record = metadataSchema.parse(input);
  stableVersion.parse(currentVersion);
  if (exactVersion !== undefined && record.version !== stableVersion.parse(exactVersion)) {
    throw new Error('Registry returned a different exact release version');
  }
  if (compareVersions(record.version, currentVersion) < 0) throw new Error('Release downgrade refused');
  const expected = `https://registry.npmjs.org/voidmachine/-/voidmachine-${record.version}.tgz`;
  if (record.dist.tarball !== expected) throw new Error('Release tarball is not the pinned npm registry artifact');
  const digest = record.dist.integrity.slice('sha512-'.length);
  if (Buffer.from(digest, 'base64').toString('base64') !== digest) throw new Error('Invalid release integrity');
  return Object.freeze({ version: record.version, tarball: expected, integrity: record.dist.integrity });
}

export function verifyReleaseArchive(release: PinnedRelease, bytes: Buffer): void {
  if (bytes.length === 0 || bytes.length > 128 * 1024 * 1024) throw new Error('Release archive size is invalid');
  const expected = Buffer.from(release.integrity.slice('sha512-'.length), 'base64');
  const actual = createHash('sha512').update(bytes).digest();
  if (expected.length !== actual.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Release archive integrity mismatch');
  }
}

export const releaseContractSchema = z.object({
  protocol: z.literal(1),
  configSchemas: z.tuple([z.literal(1)]),
  receiptSchemas: z.tuple([z.literal(1)]),
  manifestSchemas: z.tuple([z.literal(1)]),
  programSchemas: z.tuple([z.literal(1)]),
  runtimeAdapters: z.array(z.enum(['claude', 'codex'])).min(1).max(2),
}).strict();
const emptyDependencies = z.record(z.string(), z.string()).refine(value => Object.keys(value).length === 0,
  'Update protocol 1 requires a self-contained package without external dependencies');
const packageSchema = z.object({
  name: z.literal('voidmachine'), version: stableVersion,
  engines: z.object({ node: z.string().regex(/^>=(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
    'Unsupported Node engine range; update protocol 1 requires an explicit minimum') }),
  bin: z.object({ 'void-machine': z.literal('./bin/void-machine.mjs'), voidmachine: z.literal('./bin/void-machine.mjs') }),
  voidUpdate: releaseContractSchema,
  dependencies: emptyDependencies.optional(), optionalDependencies: emptyDependencies.optional(),
});

async function validatePackageTree(root: string): Promise<Set<string>> {
  const files = new Set<string>();
  let count = 0;
  let bytes = 0;
  async function visit(relative: string, depth: number): Promise<void> {
    if (++count > 20_000 || depth > 32) throw new Error('Release package tree exceeds validation limits');
    const path = join(root, relative);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Release package contains a symbolic link: ${relative}`);
    if (info.isDirectory()) {
      for (const entry of await readdir(path)) await visit(relative ? `${relative}/${entry}` : entry, depth + 1);
    } else if (info.isFile()) {
      bytes += info.size;
      if (bytes > 512 * 1024 * 1024 || info.size > 128 * 1024 * 1024) throw new Error('Release package exceeds byte limits');
      files.add(relative);
    } else throw new Error(`Release package contains a nonregular entry: ${relative}`);
  }
  await visit('', 0);
  return files;
}

export async function validateReleasePackage(root: string, expectedVersion: string, nodeVersion = process.versions.node) {
  stableVersion.parse(expectedVersion);
  stableVersion.parse(nodeVersion);
  const files = await validatePackageTree(root);
  for (const required of ['package.json', 'bin/void-machine.mjs', 'bin/prepare-update.mjs', 'dist/main.js']) {
    if (!files.has(required)) throw new Error(`Release package is missing ${required}`);
  }
  const metadataPath = join(root, 'package.json');
  if ((await lstat(metadataPath)).size > 1024 * 1024) throw new Error('Release package metadata exceeds limit');
  const pkg = packageSchema.parse(JSON.parse(await readFile(metadataPath, 'utf8')));
  if (pkg.version !== expectedVersion) throw new Error('Installed release version differs from pinned target');
  if (compareVersions(nodeVersion, pkg.engines.node.slice(2)) < 0) {
    throw new Error(`Release ${pkg.version} requires Node ${pkg.engines.node}; executing ${nodeVersion}`);
  }
  return pkg;
}
