// @test-resource subprocess
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createArtifactManifest, verifyConformanceArtifactForCheckout } from './conformance-artifact.mjs';
import * as conformanceProcess from './conformance-process.mjs';
import { PRODUCT_IDENTITY } from '../../hook-runner/src/identity.js';

describe('checkout trust without ambient HOME', () => {
  const root = mkdtempSync(join(tmpdir(), 'conformance-checkout-'));
  const sourceRoot = resolve(import.meta.dirname, '../../..');
  const checkout = join(root, 'checkout');
  const run = conformanceProcess.runConformanceProcess;
  // Git's own ownership regression mechanism; no chown or local/global configuration writes.
  const isolatedGit = {
    GIT_TEST_ASSUME_DIFFERENT_OWNER: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(root, 'empty-gitconfig'),
  };
  const tarball = join(root, 'consumer.tgz');
  let sourceSha = '';
  beforeAll(() => {
    writeFileSync(isolatedGit.GIT_CONFIG_GLOBAL, '');
    mkdirSync(checkout);
    writeFileSync(join(checkout, 'tracked.txt'), 'original');
    for (const args of [['init', checkout], ['-C', checkout, 'add', '.'],
      ['-C', checkout, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture']]) {
      const result = spawnSync('git', args, { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
    }
    const head = spawnSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    expect(head.status, head.stderr).toBe(0);
    sourceSha = head.stdout.trim();
    const bytes = Buffer.from('packed bytes');
    writeFileSync(tarball, bytes);
    writeFileSync(`${tarball}.json`, JSON.stringify(createArtifactManifest(bytes, {
      runIdentity: process.env.GITHUB_RUN_ID === undefined ? 'local' : `${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_RUN_ATTEMPT}`,
      packageName: PRODUCT_IDENTITY.packageName, packageVersion: JSON.parse(readFileSync(join(sourceRoot, 'packages/cli/package.json'), 'utf8')).version, sourceSha,
    })));
    const init = spawnSync('git', ['init', root], { encoding: 'utf8' });
    expect(init.status, init.stderr).toBe(0);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('reproduces Git ownership rejection with no trusted checkout', async () => {
    const rejected = await run({
      command: 'git', args: ['-C', checkout, 'rev-parse', 'HEAD'], cwd: checkout, env: isolatedGit,
    });
    expect(rejected.stderr).toContain('dubious ownership');
  });

  it.each(['clean', 'foreign', 'modified', 'untracked'])('limits verification trust to the exact checkout (%s)', async scenario => {
    if (scenario === 'modified') writeFileSync(join(checkout, 'tracked.txt'), 'edited');
    if (scenario === 'untracked') writeFileSync(join(checkout, 'new-source.ts'), 'export const added = true;');
    const probe = vi.spyOn(conformanceProcess, 'runConformanceProcess').mockImplementation(options => {
      expect(options.env ?? {}).not.toHaveProperty('HOME');
      // Execute against owned fixtures, independent of the caller's self-host outputs.
      // Foreign -C retains the trusted fixture path, proving trust does not spread.
      const args = options.args.map((arg: string, index: number) => {
        if (arg === `safe.directory=${sourceRoot}`) return `safe.directory=${checkout}`;
        if (options.args[index - 1] === '-C') return scenario === 'foreign' ? root : checkout;
        return arg;
      });
      return run({ ...options, args, env: { ...options.env, ...isolatedGit } });
    });
    try {
      const verification = verifyConformanceArtifactForCheckout(tarball);
      if (scenario === 'foreign') await expect(verification).rejects.toThrow('dubious ownership');
      else if (scenario !== 'clean') await expect(verification).rejects.toThrow('checkout changed before consuming');
      else await expect(verification).resolves.toMatchObject({ manifest: { sourceSha }, tarball });
    } finally {
      probe.mockRestore();
      writeFileSync(join(checkout, 'tracked.txt'), 'original');
      rmSync(join(checkout, 'new-source.ts'), { force: true });
    }
  });
});
