// @test-resource subprocess
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import type { NpmInvocation } from '../lib/release-acquisition.js';
import { createHash } from 'node:crypto';
import { update } from './update.js';

const roots: string[] = [];
const originalCwd = process.cwd();
afterEach(async () => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'void-public-update-')));
  roots.push(root);
  const globalDir = join(root, 'home', '.void');
  const bin = join(root, 'home', '.local', 'bin');
  const projects = join(root, 'projects');
  await mkdir(globalDir, { recursive: true });
  await mkdir(bin, { recursive: true });
  await mkdir(projects);
  vi.stubEnv('HOME', join(root, 'home'));
  vi.stubEnv('USERPROFILE', join(root, 'home'));
  vi.stubEnv('VOID_GLOBAL_DIR', globalDir);
  vi.stubEnv('PATH', bin + ':' + process.env.PATH);
  process.chdir(root);
  const printed: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { printed.push(String(chunk)); return true; });
  const archive = Buffer.from('transport fixture, npm extraction boundary is injected');
  const integrity = 'sha512-' + createHash('sha512').update(archive).digest('base64');
  const fetched: string[] = [];
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    fetched.push(url);
    return new Response(url.endsWith('.tgz') ? archive : JSON.stringify({ name: 'voidmachine', version: '5.1.0',
      dist: { tarball: 'https://registry.npmjs.org/voidmachine/-/voidmachine-5.1.0.tgz', integrity } }));
  };
  const runNpm = async ({ cwd }: NpmInvocation) => {
    const pkg = join(cwd, 'node_modules/voidmachine');
    await mkdir(join(pkg, 'bin'), { recursive: true });
    await mkdir(join(pkg, 'dist'));
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'voidmachine', version: '5.1.0', type: 'module',
      engines: { node: '>=24.15.0' }, bin: { 'void-machine': './bin/void-machine.mjs', voidmachine: './bin/void-machine.mjs' },
      voidUpdate: { protocol: 1, configSchemas: [1], receiptSchemas: [1], manifestSchemas: [1], programSchemas: [1], runtimeAdapters: ['codex', 'claude'] } }));
    await writeFile(join(pkg, 'dist/main.js'), "export async function run() { process.stdout.write('5.1.0\\n'); }");
    await writeFile(join(pkg, 'bin/void-machine.mjs'), "import {run} from '../dist/main.js'; await run();");
    await cp(fileURLToPath(new URL('../../bin/stable-launcher.mjs', import.meta.url)), join(pkg, 'bin/stable-launcher.mjs'));
    await writeFile(join(pkg, 'bin/prepare-update.mjs'), `
      import { readFile, writeFile, lstat } from 'node:fs/promises';
      import { join } from 'node:path';
      import { createHash } from 'node:crypto';
      const request = JSON.parse(await readFile(process.argv[2], 'utf8'));
      const inputs = [];
      for (const path of ['.void/config.json', '.void/install-manifest.json']) {
        const bytes = await readFile(join(request.root, path));
        inputs.push({ path, sha256: createHash('sha256').update(bytes).digest('hex'), mode: (await lstat(join(request.root, path))).mode & 511 });
      }
      const config = JSON.parse(await readFile(join(request.root, '.void/config.json'), 'utf8'));
      if (config.fail) throw new Error('fixture incompatible project');
      const manifest = JSON.stringify({ schemaVersion: 1, version: request.version, files: [] });
      await writeFile(process.argv[3], JSON.stringify({ ...request, inputs, runtimes: ['codex'], restored: [], preserved: [],
        mutations: [{ path: '.void/install-manifest.json', content: Buffer.from(manifest).toString('base64'), mode: 420 }] }));
    `);
  };
  async function project(name: string, fail = false) {
    const directory = join(projects, name);
    await mkdir(join(directory, '.void'), { recursive: true });
    await writeFile(join(directory, '.void/config.json'), JSON.stringify({ packs: {}, authored: name, fail }));
    await writeFile(join(directory, '.void/install-manifest.json'), JSON.stringify({ schemaVersion: 1, version: '5.0.1', files: [] }));
    return directory;
  }
  return { root, globalDir, bin, projects, project, ports: { fetcher, runNpm }, fetched, printed };
}
async function version(root: string) {
  return JSON.parse(await readFile(join(root, '.void/install-manifest.json'), 'utf8')).version;
}

it.each(['--local', '--cache-only', '--pins-only', '--untrack-derived', '--force', '--version', '--version=5.1.0-beta.1'])(
  'refuses unsupported option %s before global or project effects', async argument => {
    const f = await fixture();
    await expect(update([argument], f.ports)).rejects.toThrow(/unsupported|exact stable|requires/i);
    await expect(readFile(join(f.globalDir, 'cli/active.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(f.fetched).toEqual([]);
  });

it('updates only the current project and activates the same exact offline release', async () => {
  const f = await fixture();
  const selected = await f.project('selected');
  const other = await f.project('other');
  process.chdir(selected);
  await update([], f.ports);
  expect(await version(selected)).toBe('5.1.0');
  expect(await version(other)).toBe('5.0.1');
  expect(JSON.parse(await readFile(join(f.globalDir, 'cli/active.json'), 'utf8')).version).toBe('5.1.0');
  expect(await readFile(join(f.bin, 'void-machine'), 'utf8')).toContain('verifyInstalledRelease');
  expect(f.fetched).toEqual(['https://registry.npmjs.org/voidmachine/latest', 'https://registry.npmjs.org/voidmachine/-/voidmachine-5.1.0.tgz']);
  expect(f.printed.join('')).toContain(selected);
  expect(f.printed.join('')).toContain('5.0.1');
});

it.each([false, true])('plans all selected projects, with dry run %s leaving targets untouched', async dryRun => {
  const f = await fixture();
  const first = await f.project('one');
  const second = await f.project('two');
  await writeFile(join(f.globalDir, 'discovery.json'), JSON.stringify({ roots: [f.projects] }));
  await update(['--all', '--version', '5.1.0', ...(dryRun ? ['--dry-run'] : [])], f.ports);
  expect(await version(first)).toBe(dryRun ? '5.0.1' : '5.1.0');
  expect(await version(second)).toBe(dryRun ? '5.0.1' : '5.1.0');
  if (dryRun) {
    await expect(readFile(join(f.globalDir, 'cli/active.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(f.bin, 'void-machine'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(f.printed.join('')).toMatch(/cache|staging/i);
  }
  expect(f.fetched[0]).toBe('https://registry.npmjs.org/voidmachine/5.1.0');
});

it('a later incompatible project prevents every publication', async () => {
  const f = await fixture();
  const first = await f.project('one');
  const second = await f.project('two', true);
  await writeFile(join(f.globalDir, 'discovery.json'), JSON.stringify({ roots: [f.projects] }));
  await expect(update(['--all'], f.ports)).rejects.toThrow(/incompatible project/);
  expect(await version(first)).toBe('5.0.1');
  expect(await version(second)).toBe('5.0.1');
  await expect(readFile(join(f.bin, 'void-machine'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('reports CLI-only explicitly outside any installed project', async () => {
  const f = await fixture();
  await update([], f.ports);
  expect(f.printed.join('')).toMatch(/no project selected/i);
  expect(JSON.parse(await readFile(join(f.globalDir, 'cli/active.json'), 'utf8')).version).toBe('5.1.0');
});

it.each(['marketplace', 'legacy'])('classifies %s before acquisition and preserves its records', async kind => {
  const f = await fixture();
  const project = await f.project('selected');
  process.chdir(project);
  const path = kind === 'legacy' ? '.void/state.json' : '.void/machine/receipts/install-v1.json';
  await mkdir(join(project, '.void/machine/receipts'), { recursive: true });
  const bytes = kind === 'legacy' ? '{}' : JSON.stringify({ schemaVersion: 1, version: '5.0.1', source: 'marketplace', runtimes: ['codex'], files: [] });
  await writeFile(join(project, path), bytes);
  await expect(update([], f.ports)).rejects.toThrow(/legacy|marketplace/i);
  expect(await readFile(join(project, path), 'utf8')).toBe(bytes);
  expect(f.fetched).toEqual([]);
});
