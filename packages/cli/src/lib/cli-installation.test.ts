// @test-resource subprocess

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, mkdtemp, readFile, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PRODUCT_IDENTITY } from '@voidcorp/hook-runner';
import { afterEach, expect, it } from 'vitest';
import npmWindowsBins from './fixtures/npm11-windows-bins.json';
import { bundledLauncher } from './fixtures/stable-launcher.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'void-cli-store-')));
  roots.push(root);
  await mkdir(join(root, 'bin'));
  const pkg = join(root, `lib/node_modules/${PRODUCT_IDENTITY.packageName}`);
  await mkdir(join(pkg, 'bin'), { recursive: true });
  await mkdir(join(pkg, 'dist'));
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: PRODUCT_IDENTITY.packageName, version: '5.1.0',
    engines: { node: '>=24.15.0' }, bin: { 'void-machine': './bin/void-machine.mjs', [PRODUCT_IDENTITY.packageName]: './bin/void-machine.mjs', vm: './bin/void-machine.mjs' },
    voidUpdate: { protocol: 1, configSchemas: [1], receiptSchemas: [1], manifestSchemas: [1], programSchemas: [1], runtimeAdapters: ['codex', 'claude'] },
  }));
  await writeFile(join(pkg, 'bin/void-machine.mjs'), '');
  await writeFile(join(pkg, 'bin/prepare-update.mjs'), '');
  await writeFile(join(pkg, 'dist/main.js'), 'export async function run(name,args) { process.stdout.write(JSON.stringify({name,args,cwd:process.cwd()})); process.exitCode = 23; }');
  return { root, pkg, store: join(root, '.void/cli') };
}
const release = { version: '5.1.0', tarball: `https://registry.npmjs.org/${PRODUCT_IDENTITY.packageName}/-/${PRODUCT_IDENTITY.packageName}-5.1.0.tgz`,
  integrity: `sha512-${createHash('sha512').update('archive').digest('base64')}` };

async function interruptedBootstrap() {
  const { completeRelease } = await import('./cli-installation.js');
  const state = await fixture();
  const installed = await completeRelease(state.pkg, state.store, release);
  const operation = join(state.store, 'operation');
  await mkdir(operation);
  const record = { schemaVersion: 1, operationId: 'first-adoption', target: release.version,
    selectionKey: 'fixture', participants: [{ kind: 'active', root: state.store }] };
  await writeFile(join(operation, 'operation.json'), JSON.stringify(record));
  const launcher = fileURLToPath(new URL('./stable-launcher.mjs', import.meta.url));
  const invoke = (args: string[]) => promisify(execFile)(process.execPath, [launcher, ...args], {
    cwd: state.root, env: { PATH: process.env.PATH, VOID_GLOBAL_DIR: join(state.root, '.void') }, timeout: 10_000,
  });
  return { ...state, installed, operation, record, invoke };
}

it('dispatches update to the sealed pending release when first adoption has no active selection', async () => {
  const state = await interruptedBootstrap();
  await expect(state.invoke(['update', '--all'])).rejects.toMatchObject({ code: 23,
    stdout: JSON.stringify({ name: 'stable-launcher', args: ['update', '--all'], cwd: state.root }) });
  await expect(readFile(join(state.store, 'active.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each([
  ['missing-operation', /ENOENT/], ['invalid-json', /JSON/], ['schema', /recovery/],
  ['target', /recovery/], ['operation-id', /recovery/], ['oversized', /bounded/],
  ['linked-operation', /symbolic/], ['linked-record', /bounded/],
  ['corrupt-active', /JSON/], ['tampered-release', /integrity/], ['missing-release', /ENOENT/],
  ['non-update', /ENOENT/],
] as const)('refuses %s bootstrap recovery before executing a release', async (kind, diagnostic) => {
  const state = await interruptedBootstrap();
  const recordPath = join(state.operation, 'operation.json');
  if (kind === 'missing-operation') await rm(recordPath);
  if (kind === 'invalid-json') await writeFile(recordPath, 'not JSON');
  if (kind === 'schema') await writeFile(recordPath, JSON.stringify({ ...state.record, schemaVersion: 99 }));
  if (kind === 'target') await writeFile(recordPath, JSON.stringify({ ...state.record, target: '../outside' }));
  if (kind === 'operation-id') await writeFile(recordPath, JSON.stringify({ ...state.record, operationId: '' }));
  if (kind === 'oversized') await writeFile(recordPath, ' '.repeat(65_537));
  if (kind === 'linked-operation') {
    await rename(state.operation, join(state.root, 'foreign-operation'));
    await symlink(join(state.root, 'foreign-operation'), state.operation, 'dir');
  }
  if (kind === 'linked-record') {
    await rename(recordPath, join(state.root, 'foreign-record'));
    await symlink(join(state.root, 'foreign-record'), recordPath);
  }
  if (kind === 'corrupt-active') await writeFile(join(state.store, 'active.json'), 'not JSON');
  if (kind === 'tampered-release') await writeFile(join(state.installed, 'dist/main.js'), 'process.stdout.write("unverified");');
  if (kind === 'missing-release') await rename(join(state.store, 'releases'), join(state.root, 'unavailable'));
  await expect(state.invoke([kind === 'non-update' ? '--version' : 'update']))
    .rejects.toMatchObject({ code: 1, stdout: '', stderr: expect.stringMatching(diagnostic) });
});

it('qualifies npm bins through package identity and the declared alias mapping', async () => {
  const { planLauncherBootstrap } = await import('./cli-installation.js');
  const { root } = await fixture();
  for (const alias of ['void-machine', PRODUCT_IDENTITY.packageName]) await symlink(`../lib/node_modules/${PRODUCT_IDENTITY.packageName}/bin/void-machine.mjs`, join(root, 'bin', alias));
  const plan = await planLauncherBootstrap(join(root, 'bin'), Buffer.from('stable launcher'));
  expect(plan.mutations.map(mutation => mutation.path)).toEqual(['void-machine', PRODUCT_IDENTITY.packageName]);
  expect(plan.mutations[0]).toMatchObject({ replaceLink: `../lib/node_modules/${PRODUCT_IDENTITY.packageName}/bin/void-machine.mjs`, mode: 0o755 });
  expect(await readlink(join(root, 'bin/void-machine'))).toBe(`../lib/node_modules/${PRODUCT_IDENTITY.packageName}/bin/void-machine.mjs`);
});

it.each(['unknown-link', 'wrong-package', 'wrong-bin', 'unknown-file'])(
  'preserves and refuses %s canonical launchers', async kind => {
    const { planLauncherBootstrap } = await import('./cli-installation.js');
    const { root, pkg } = await fixture();
    if (kind === 'unknown-file') await writeFile(join(root, 'bin/void-machine'), 'user launcher');
    else await symlink(kind === 'unknown-link' ? '../unknown' : `../lib/node_modules/${PRODUCT_IDENTITY.packageName}/bin/void-machine.mjs`, join(root, 'bin/void-machine'));
    const metadata = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'));
    if (kind === 'wrong-package') metadata.name = 'other';
    if (kind === 'wrong-bin') metadata.bin['void-machine'] = './bin/other.mjs';
    await writeFile(join(pkg, 'package.json'), JSON.stringify(metadata));
    await expect(planLauncherBootstrap(join(root, 'bin'), Buffer.from('new'))).rejects.toThrow(/unowned.*void-machine/i);
  },
);

it('preserves unknown aliases while planning canonical bootstrap', async () => {
  const { planLauncherBootstrap } = await import('./cli-installation.js');
  const { root } = await fixture();
  await writeFile(join(root, `bin/${PRODUCT_IDENTITY.packageName}`), 'user alias');
  const plan = await planLauncherBootstrap(join(root, 'bin'), Buffer.from('new'));
  expect(plan.mutations.map(mutation => mutation.path)).toEqual(['void-machine']);
  expect(plan.conflicts).toEqual([PRODUCT_IDENTITY.packageName]);
});

it('qualifies a literal source wrapper only after checking its referenced package bin', async () => {
  const { planLauncherBootstrap } = await import('./cli-installation.js');
  const { root, pkg } = await fixture();
  await writeFile(join(root, 'bin/void-machine'), `#!/bin/sh\nexec "${process.execPath}" "${pkg}/bin/void-machine.mjs" "$@"\n`);
  const plan = await planLauncherBootstrap(join(root, 'bin'), Buffer.from('new'));
  expect(plan.mutations[0]).toMatchObject({ path: 'void-machine', content: Buffer.from('new') });
});

it('runs the sealed installed release offline without its source directory and preserves argv, cwd and exit', async () => {
  const { completeRelease } = await import('./cli-installation.js');
  const { root, pkg, store } = await fixture();
  await completeRelease(pkg, store, release);
  await writeFile(join(store, 'active.json'), JSON.stringify({ schemaVersion: 1, version: release.version }));
  const launcher = join(root, 'bin/void-machine');
  await writeFile(launcher, await bundledLauncher());
  await chmod(launcher, 0o755);
  await expect(readFile(join(pkg, 'package.json'))).rejects.toThrow();
  await expect(promisify(execFile)(launcher, ['one', 'space value'], {
    cwd: root, env: { PATH: process.env.PATH, VOID_GLOBAL_DIR: join(root, '.void') }, timeout: 10_000,
  })).rejects.toMatchObject({ code: 23, stdout: JSON.stringify({ name: 'void-machine', args: ['one', 'space value'], cwd: root }) });
});

it('refuses modified release bytes and does not execute them', async () => {
  const { completeRelease } = await import('./cli-installation.js');
  const { root, pkg, store } = await fixture();
  const installed = await completeRelease(pkg, store, release);
  await writeFile(join(store, 'active.json'), JSON.stringify({ schemaVersion: 1, version: release.version }));
  await writeFile(join(installed, 'dist/main.js'), 'process.stdout.write("tampered execution");');
  const launcher = fileURLToPath(new URL('./stable-launcher.mjs', import.meta.url));
  await expect(promisify(execFile)(process.execPath, [launcher], {
    cwd: root, env: { PATH: process.env.PATH, VOID_GLOBAL_DIR: join(root, '.void') }, timeout: 10_000,
  })).rejects.toMatchObject({ stdout: '', stderr: expect.stringContaining('integrity') });
});

it('prepares Windows command and PowerShell adapters from verified npm wrappers', async () => {
  const { planLauncherBootstrap } = await import('./cli-installation.js');
  const { root, pkg } = await fixture();
  const bin = join(root, 'bin');
  await mkdir(join(bin, 'node_modules'));
  await cp(pkg, join(bin, `node_modules/${PRODUCT_IDENTITY.packageName}`), { recursive: true });
  for (const alias of ['void-machine', PRODUCT_IDENTITY.packageName]) {
    for (const [extension, bytes] of Object.entries(npmWindowsBins)) await writeFile(join(bin, alias + extension), bytes);
  }
  const plan = await planLauncherBootstrap(bin, Buffer.from('stable launcher'), undefined, 'win32');
  expect(plan.mutations.map(mutation => mutation.path)).toEqual(expect.arrayContaining(['void-machine.mjs', 'void-machine.cmd', 'void-machine.ps1', `${PRODUCT_IDENTITY.packageName}.cmd`, `${PRODUCT_IDENTITY.packageName}.ps1`]));
  const command = plan.mutations.find(mutation => mutation.path === 'void-machine.cmd');
  expect(Buffer.from(command?.content ?? []).toString()).toContain('%*');
  expect(Buffer.from(command?.content ?? []).toString()).toContain('void-machine.mjs');
  expect(plan.conflicts).toEqual([]);
  // The input is qualification evidence, never overwritten during planning.
  expect(await readFile(join(bin, 'void-machine.cmd'), 'utf8')).toBe(npmWindowsBins['.cmd']);
});

it('refuses a custom Windows shim even beside a valid package identity', async () => {
  const { planLauncherBootstrap } = await import('./cli-installation.js');
  const { root } = await fixture();
  await writeFile(join(root, 'bin/void-machine.ps1'), 'user-owned shell command');
  await expect(planLauncherBootstrap(join(root, 'bin'), Buffer.from('launcher'), undefined, 'win32')).rejects.toThrow(/unowned/i);
  expect(await readFile(join(root, 'bin/void-machine.ps1'), 'utf8')).toBe('user-owned shell command');
});

it('refuses a release whose node_modules ancestor has been redirected after sealing', async () => {
  const { completeRelease } = await import('./cli-installation.js');
  const { verifyInstalledRelease } = await import('./stable-launcher.mjs');
  const { root, pkg, store } = await fixture();
  await completeRelease(pkg, store, release);
  const modules = join(store, 'releases', release.version, 'node_modules');
  await rename(modules, join(root, 'redirected'));
  await symlink(join(root, 'redirected'), modules);
  await expect(verifyInstalledRelease(store, release.version)).rejects.toThrow(/symbolic|physical|canonical/i);
});
