import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const bytes = Buffer.from('pinned published archive');
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
function metadata() {
  return { name: 'voidmachine', version: '5.1.0', dist: {
    tarball: 'https://registry.npmjs.org/voidmachine/-/voidmachine-5.1.0.tgz', integrity,
  } };
}

it('pins one immutable stable release independently of later metadata changes', async () => {
  const { pinRelease } = await import('./update-release.js');
  const input = metadata();
  const pinned = pinRelease(input, '5.0.1');
  input.version = '5.2.0';
  input.dist.integrity = 'changed';
  expect(pinned).toEqual({ version: '5.1.0', tarball: metadata().dist.tarball, integrity });
  expect(Object.isFrozen(pinned)).toBe(true);
});

it.each(['identity', 'prerelease', 'downgrade', 'missing-integrity', 'bad-integrity', 'host', 'credentials', 'version-path', 'exact-mismatch'])(
  'refuses %s release metadata before acquisition', async attack => {
    const { pinRelease } = await import('./update-release.js');
    const input = metadata();
    if (attack === 'identity') input.name = 'other';
    if (attack === 'prerelease') input.version = '5.1.0-beta.1';
    if (attack === 'downgrade') input.version = '4.9.0';
    if (attack === 'missing-integrity') input.dist.integrity = '';
    if (attack === 'bad-integrity') input.dist.integrity = 'sha512-YWJj';
    if (attack === 'host') input.dist.tarball = 'https://example.org/package.tgz';
    if (attack === 'credentials') input.dist.tarball = input.dist.tarball.replace('https://', 'https://user@');
    if (attack === 'version-path') input.dist.tarball = input.dist.tarball.replace('5.1.0', '5.2.0');
    expect(() => pinRelease(input, '5.0.1', attack === 'exact-mismatch' ? '5.2.0' : undefined)).toThrow();
  },
);

it('checks the pinned archive bytes before they can reach npm', async () => {
  const { pinRelease, verifyReleaseArchive } = await import('./update-release.js');
  const pinned = pinRelease(metadata(), '5.0.1');
  expect(() => verifyReleaseArchive(pinned, bytes)).not.toThrow();
  expect(() => verifyReleaseArchive(pinned, Buffer.from('changed archive'))).toThrow(/integrity/i);
  expect(() => verifyReleaseArchive(pinned, Buffer.alloc(0))).toThrow();
});

async function packageFixture() {
  const root = await mkdtemp(join(tmpdir(), 'void-release-'));
  roots.push(root);
  await mkdir(join(root, 'bin'));
  await mkdir(join(root, 'dist'));
  await mkdir(join(root, 'core-assets'));
  await writeFile(join(root, 'bin/void-machine.mjs'), 'throw new Error("must not execute during validation");');
  await writeFile(join(root, 'bin/prepare-update.mjs'), 'throw new Error("must not execute during validation");');
  await writeFile(join(root, 'dist/main.js'), 'export const unused = true;');
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'voidmachine', version: '5.1.0', engines: { node: '>=24.15.0' },
    bin: { 'void-machine': './bin/void-machine.mjs', voidmachine: './bin/void-machine.mjs' },
    voidUpdate: { protocol: 1, configSchemas: [1], receiptSchemas: [1], manifestSchemas: [1], programSchemas: [1], runtimeAdapters: ['claude', 'codex'] },
  }));
  return root;
}

it('validates a self-contained package without executing its entrypoints', async () => {
  const { validateReleasePackage } = await import('./update-release.js');
  const root = await packageFixture();
  await expect(validateReleasePackage(root, '5.1.0', '24.15.0')).resolves.toMatchObject({ version: '5.1.0' });
});

it('declares the updater protocol in the actual published package metadata', async () => {
  const { releaseContractSchema } = await import('./update-release.js');
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  expect(releaseContractSchema.parse(pkg.voidUpdate).protocol).toBe(1);
});

it.each(['identity', 'version', 'engine', 'unknown-engine', 'protocol', 'missing-contract', 'bin', 'dependency', 'linked-entry', 'linked-asset'])(
  'refuses %s installed package before candidate execution', async attack => {
    const { validateReleasePackage } = await import('./update-release.js');
    const root = await packageFixture();
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (attack === 'identity') pkg.name = 'other';
    if (attack === 'version') pkg.version = '5.2.0';
    if (attack === 'engine') pkg.engines.node = '>=99.0.0';
    if (attack === 'unknown-engine') pkg.engines.node = 'anything';
    if (attack === 'protocol') pkg.voidUpdate.protocol = 99;
    if (attack === 'missing-contract') delete pkg.voidUpdate;
    if (attack === 'bin') pkg.bin['void-machine'] = '../other.mjs';
    if (attack === 'dependency') pkg.dependencies = { other: '*' };
    await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
    if (attack === 'linked-entry') {
      await rm(join(root, 'bin/prepare-update.mjs'));
      await symlink(join(root, 'bin/void-machine.mjs'), join(root, 'bin/prepare-update.mjs'));
    }
    if (attack === 'linked-asset') await symlink(join(root, 'package.json'), join(root, 'core-assets/linked'));
    await expect(validateReleasePackage(root, '5.1.0', '24.15.0')).rejects.toThrow();
  },
);
