import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRODUCT_IDENTITY } from '@voidcorp/hook-runner';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'void-acquisition-'));
  roots.push(root);
  return root;
}
const archive = Buffer.from('published archive');
const release = Object.freeze({ version: '5.1.0',
  tarball: `https://registry.npmjs.org/${PRODUCT_IDENTITY.packageName}/-/${PRODUCT_IDENTITY.packageName}-5.1.0.tgz`,
  integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}` });

it('resolves stable once using fixed registry metadata and refuses redirects', async () => {
  const { resolveRelease } = await import('./release-acquisition.js');
  const requests: string[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    requests.push(String(url));
    expect(options?.redirect).toBe('error');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    return new Response(JSON.stringify({ name: PRODUCT_IDENTITY.packageName, version: '5.1.0', dist: release }));
  };
  expect(await resolveRelease('5.0.1', undefined, fetcher)).toEqual(release);
  expect(requests).toEqual([`https://registry.npmjs.org/${PRODUCT_IDENTITY.packageName}/latest`]);
});

it.each(['404', 'oversized', 'network'])('refuses %s registry failure', async failure => {
  const { resolveRelease } = await import('./release-acquisition.js');
  const fetcher: typeof fetch = async () => {
    if (failure === 'network') throw new Error('offline');
    if (failure === '404') return new Response('missing', { status: 404 });
    return new Response('x'.repeat(1024 * 1024 + 1));
  };
  await expect(resolveRelease('5.0.1', undefined, fetcher)).rejects.toThrow();
});

it('installs only verified local bytes with isolated npm configuration', async () => {
  const { acquireRelease } = await import('./release-acquisition.js');
  const root = await fixture();
  const result = await acquireRelease(release, root, {
    fetcher: async () => new Response(archive),
    runNpm: async invocation => {
      expect(invocation.cwd.startsWith(root)).toBe(true);
      expect(invocation.args).toContain('--ignore-scripts');
      expect(invocation.args).toContain('--offline');
      expect(invocation.args).toContain('--audit=false');
      expect(invocation.args).toContain('--fund=false');
      expect(invocation.args).toContain('--engine-strict');
      expect(invocation.args).toContain('--registry=https://registry.npmjs.org');
      const archivePath = invocation.args[1];
      expect(archivePath).toBeDefined();
      expect(await readFile(archivePath ?? '')).toEqual(archive);
      expect(invocation.env.NODE_OPTIONS).toBeUndefined();
      expect(invocation.env.npm_config_userconfig).toBe(join(invocation.cwd, 'user.npmrc'));
      expect(invocation.env.npm_config_globalconfig).toBe(join(invocation.cwd, 'global.npmrc'));
      expect(await readFile(invocation.env.npm_config_userconfig ?? '', 'utf8')).toBe('');
      const pkgRoot = join(invocation.cwd, `node_modules/${PRODUCT_IDENTITY.packageName}`);
      await mkdir(join(pkgRoot, 'bin'), { recursive: true });
      await mkdir(join(pkgRoot, 'dist'));
      for (const path of ['bin/void-machine.mjs', 'bin/prepare-update.mjs', 'dist/main.js']) {
        await writeFile(join(pkgRoot, path), 'throw new Error("must not execute");');
      }
      await writeFile(join(pkgRoot, 'package.json'), JSON.stringify({
        name: PRODUCT_IDENTITY.packageName, version: release.version, engines: { node: '>=24.15.0' },
        bin: { 'void-machine': './bin/void-machine.mjs', [PRODUCT_IDENTITY.packageName]: './bin/void-machine.mjs' },
        voidUpdate: { protocol: 1, configSchemas: [1], receiptSchemas: [1], manifestSchemas: [1], programSchemas: [1], runtimeAdapters: ['codex', 'claude'] },
      }));
    },
  });
  expect(result.startsWith(root)).toBe(true);
  expect(JSON.parse(await readFile(join(result, 'package.json'), 'utf8')).version).toBe(release.version);
});

it('never invokes npm after an archive integrity failure and removes its owned stage', async () => {
  const { acquireRelease } = await import('./release-acquisition.js');
  const root = await fixture();
  let installed = false;
  await expect(acquireRelease(release, root, {
    fetcher: async () => new Response('changed'),
    runNpm: async () => { installed = true; },
  })).rejects.toThrow(/integrity/i);
  expect(installed).toBe(false);
  expect(await readdir(root)).toEqual([]);
});

it('preserves unrelated cache files when npm fails', async () => {
  const { acquireRelease } = await import('./release-acquisition.js');
  const root = await fixture();
  await writeFile(join(root, 'unrelated'), 'keep');
  await expect(acquireRelease(release, root, {
    fetcher: async () => new Response(archive), runNpm: async () => { throw new Error('npm failed'); },
  })).rejects.toThrow('npm failed');
  expect(await readdir(root)).toEqual(['unrelated']);
});
