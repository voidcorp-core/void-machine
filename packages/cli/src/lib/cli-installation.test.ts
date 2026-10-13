// @test-resource subprocess
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, mkdtemp, readFile, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import npmWindowsBins from './fixtures/npm11-windows-bins.json';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'void-cli-store-')));
  roots.push(root);
  await mkdir(join(root, 'bin'));
  const pkg = join(root, 'lib/node_modules/voidmachine');
  await mkdir(join(pkg, 'bin'), { recursive: true });
  await mkdir(join(pkg, 'dist'));
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'voidmachine', version: '5.1.0',
    engines: { node: '>=24.15.0' }, bin: { 'void-machine': './bin/void-machine.mjs', voidmachine: './bin/void-machine.mjs', vm: './bin/void-machine.mjs' },
    voidUpdate: { protocol: 1, configSchemas: [1], receiptSchemas: [1], manifestSchemas: [1], programSchemas: [1], runtimeAdapters: ['codex', 'claude'] },
  }));
  await writeFile(join(pkg, 'bin/void-machine.mjs'), '');
  await writeFile(join(pkg, 'bin/prepare-update.mjs'), '');
  await writeFile(join(pkg, 'dist/main.js'), 'export async function run(name,args) { process.stdout.write(JSON.stringify({name,args,cwd:process.cwd()})); process.exitCode = 23; }');
  return { root, pkg, store: join(root, '.void/cli') };
}
const release = { version: '5.1.0', tarball: 'https://registry.npmjs.org/voidmachine/-/voidmachine-5.1.0.tgz',
  integrity: `sha512-${createHash('sha512').update('archive').digest('base64')}` };

it('qualifies npm bins through package identity and the declared alias mapping', async () => {
  const { planLauncherBootstrap } = await import('./cli-installation.js');
  const { root } = await fixture();
  for (const alias of ['void-machine', 'voidmachine']) await symlink('../lib/node_modules/voidmachine/bin/void-machine.mjs', join(root, 'bin', alias));
  const plan = await planLauncherBootstrap(join(root, 'bin'), Buffer.from('stable launcher'));
  expect(plan.mutations.map(mutation => mutation.path)).toEqual(['void-machine', 'voidmachine']);
  expect(plan.mutations[0]).toMatchObject({ replaceLink: '../lib/node_modules/voidmachine/bin/void-machine.mjs', mode: 0o755 });
  expect(await readlink(join(root, 'bin/void-machine'))).toBe('../lib/node_modules/voidmachine/bin/void-machine.mjs');
});

it.each(['unknown-link', 'wrong-package', 'wrong-bin', 'unknown-file'])(
  'preserves and refuses %s canonical launchers', async kind => {
    const { planLauncherBootstrap } = await import('./cli-installation.js');
    const { root, pkg } = await fixture();
    if (kind === 'unknown-file') await writeFile(join(root, 'bin/void-machine'), 'user launcher');
    else await symlink(kind === 'unknown-link' ? '../unknown' : '../lib/node_modules/voidmachine/bin/void-machine.mjs', join(root, 'bin/void-machine'));
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
  await writeFile(join(root, 'bin/voidmachine'), 'user alias');
  const plan = await planLauncherBootstrap(join(root, 'bin'), Buffer.from('new'));
  expect(plan.mutations.map(mutation => mutation.path)).toEqual(['void-machine']);
  expect(plan.conflicts).toEqual(['voidmachine']);
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
  await writeFile(launcher, await readFile(fileURLToPath(new URL('../../bin/stable-launcher.mjs', import.meta.url))));
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
  const launcher = fileURLToPath(new URL('../../bin/stable-launcher.mjs', import.meta.url));
  await expect(promisify(execFile)(process.execPath, [launcher], {
    cwd: root, env: { PATH: process.env.PATH, VOID_GLOBAL_DIR: join(root, '.void') }, timeout: 10_000,
  })).rejects.toMatchObject({ stdout: '', stderr: expect.stringContaining('integrity') });
});

it('prepares Windows command and PowerShell adapters from verified npm wrappers', async () => {
  const { planLauncherBootstrap } = await import('./cli-installation.js');
  const { root, pkg } = await fixture();
  const bin = join(root, 'bin');
  await mkdir(join(bin, 'node_modules'));
  await cp(pkg, join(bin, 'node_modules/voidmachine'), { recursive: true });
  for (const alias of ['void-machine', 'voidmachine']) {
    for (const [extension, bytes] of Object.entries(npmWindowsBins)) await writeFile(join(bin, alias + extension), bytes);
  }
  const plan = await planLauncherBootstrap(bin, Buffer.from('stable launcher'), undefined, 'win32');
  expect(plan.mutations.map(mutation => mutation.path)).toEqual(expect.arrayContaining(['void-machine.mjs', 'void-machine.cmd', 'void-machine.ps1', 'voidmachine.cmd', 'voidmachine.ps1']));
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
  const { verifyInstalledRelease } = await import('../../bin/stable-launcher.mjs');
  const { root, pkg, store } = await fixture();
  await completeRelease(pkg, store, release);
  const modules = join(store, 'releases', release.version, 'node_modules');
  await rename(modules, join(root, 'redirected'));
  await symlink(join(root, 'redirected'), modules);
  await expect(verifyInstalledRelease(store, release.version)).rejects.toThrow(/symbolic|physical|canonical/i);
});
