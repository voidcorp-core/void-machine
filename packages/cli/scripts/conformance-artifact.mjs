#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_IDENTITY } from '../../../scripts/product-identity.mjs';
import {
  packageManagerCommand,
  requireConformanceExit,
  runConformanceProcess,
} from './conformance-process.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const CLI_MANIFEST = resolve(HERE, '..', 'package.json');
const SOURCE_SHA = /^[0-9a-f]{40}$/;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:[-+][0-9A-Za-z.-]+)?$/;
const MANIFEST_KEYS = [
  'packageName',
  'packageVersion',
  'schemaVersion',
  'sourceSha',
  'tarballSha256',
];

function fail(message) {
  throw new Error(`conformance artifact: ${message}`);
}

function artifactBytes(value) {
  if (!(value instanceof Uint8Array)) fail('tarball bytes are required');
  return Buffer.from(value);
}

function requireIdentity(identity) {
  if (identity?.packageName !== PRODUCT_IDENTITY.packageName) {
    fail(`package name must be ${PRODUCT_IDENTITY.packageName}`);
  }
  if (typeof identity.packageVersion !== 'string' || !VERSION.test(identity.packageVersion)) {
    fail('package version must be an explicit semantic version');
  }
  if (typeof identity.sourceSha !== 'string' || !SOURCE_SHA.test(identity.sourceSha)) {
    fail('source SHA must be a lowercase 40-character commit');
  }
}

export function createArtifactManifest(bytes, identity) {
  requireIdentity(identity);
  return Object.freeze({
    schemaVersion: 1,
    packageName: identity.packageName,
    packageVersion: identity.packageVersion,
    sourceSha: identity.sourceSha,
    tarballSha256: createHash('sha256').update(artifactBytes(bytes)).digest('hex'),
  });
}

function requireRegularFile(path, label) {
  let info;
  try {
    info = lstatSync(path);
  } catch {
    fail(`${label} is missing: ${path}`);
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    fail(`${label} must be a regular file: ${path}`);
  }
  return info;
}

function readManifest(path) {
  const info = requireRegularFile(path, 'artifact manifest');
  if (info.size > 64 * 1024) fail('artifact manifest exceeds 65536 bytes');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail('artifact manifest is not valid JSON');
  }
}

export function verifyConformanceArtifact(tarballPath, expectedSourceSha) {
  if (typeof tarballPath !== 'string' || tarballPath === '') {
    fail('tarball path is required');
  }
  requireRegularFile(tarballPath, 'tarball');
  const manifest = readManifest(`${tarballPath}.json`);
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('artifact manifest must be an object');
  }
  if (Object.keys(manifest).sort().join('\0') !== MANIFEST_KEYS.join('\0')) {
    fail('artifact manifest fields are not canonical');
  }
  if (manifest.schemaVersion !== 1) fail('artifact manifest schema is unsupported');
  if (manifest.sourceSha !== expectedSourceSha) {
    fail('artifact source SHA does not match the checked-out source');
  }
  const expected = createArtifactManifest(readFileSync(tarballPath), manifest);
  if (manifest.tarballSha256 !== expected.tarballSha256) {
    fail('tarball digest does not match its bytes');
  }
  return expected;
}

async function gitText(args) {
  const result = await runConformanceProcess({
    command: 'git',
    // Checkout's temporary HOME is not inherited by the isolated conformance process.
    // Trust only this source checkout, for this command; never write global Git config.
    args: ['-c', `safe.directory=${REPO_ROOT}`, '-C', REPO_ROOT, ...args],
    cwd: REPO_ROOT,
  });
  return requireConformanceExit(result, `git ${args[0]}`).stdout.trim();
}

export function requireCleanCheckoutStatus(status, phase) {
  if (status !== '') fail(`checkout changed ${phase} pack:\n${status}`);
}

async function requireCleanCheckout(phase) {
  const status = await gitText(['status', '--porcelain=v1', '--untracked-files=all']);
  requireCleanCheckoutStatus(status, phase);
}

export async function conformanceArtifactFromEnvironment() {
  const configured = process.env.VOID_CONFORMANCE_TARBALL;
  if (configured === undefined || configured === '') {
    fail('VOID_CONFORMANCE_TARBALL is required');
  }
  return await verifyConformanceArtifactForCheckout(configured);
}

export async function verifyConformanceArtifactForCheckout(configured) {
  if (typeof configured !== 'string' || configured === '') {
    fail('tarball path is required');
  }
  const tarball = resolve(configured);
  const sourceSha = await gitText(['rev-parse', '--verify', 'HEAD']);
  const manifest = verifyConformanceArtifact(tarball, sourceSha);
  return { manifest, tarball };
}

async function packageIdentity(sourceSha) {
  const manifest = JSON.parse(await readFile(CLI_MANIFEST, 'utf8'));
  return {
    packageName: manifest.name,
    packageVersion: manifest.version,
    sourceSha,
  };
}

export async function packConformanceArtifact(outputDirectory) {
  if (typeof outputDirectory !== 'string' || outputDirectory === '') {
    fail('output directory is required');
  }
  const destination = resolve(outputDirectory);
  if (existsSync(destination)) fail(`output already exists: ${destination}`);
  const tarball = join(destination, 'consumer.tgz');
  const manifestPath = `${tarball}.json`;
  await requireCleanCheckout('before');
  const sourceSha = await gitText(['rev-parse', '--verify', 'HEAD']);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = await mkdtemp(join(dirname(destination), '.harness-conformance-pack-'));
  try {
    const pnpm = packageManagerCommand('pnpm');
    const packed = await runConformanceProcess({
      command: pnpm.executable,
      args: [
        ...pnpm.prefixArguments,
        '--filter',
        './packages/cli',
        'pack',
        '--pack-destination',
        temporary,
      ],
      cwd: REPO_ROOT,
    });
    requireConformanceExit(packed, 'pack consumer artifact');
    await requireCleanCheckout('after');
    if (await gitText(['rev-parse', '--verify', 'HEAD']) !== sourceSha) {
      fail('checked-out source changed while the artifact was packed');
    }

    const names = (await readdir(temporary)).filter((name) => name.endsWith('.tgz'));
    if (names.length !== 1) fail('pack must produce exactly one tarball');
    const bytes = await readFile(join(temporary, names[0]));
    const manifest = createArtifactManifest(bytes, await packageIdentity(sourceSha));
    await writeFile(join(temporary, 'consumer.tgz.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx',
    });
    await rename(join(temporary, names[0]), join(temporary, 'consumer.tgz'));
    verifyConformanceArtifact(join(temporary, 'consumer.tgz'), sourceSha);
    await rename(temporary, destination);
    return { manifest, manifestPath, tarball };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const output = process.env.VOID_CONFORMANCE_ARTIFACT_DIR;
    const artifact = await packConformanceArtifact(output);
    process.stdout.write(
      `packed consumer artifact ${artifact.tarball} for ${artifact.manifest.sourceSha}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
