// @test-resource subprocess
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createArtifactManifest, verifyConformanceArtifactForCheckout } from './conformance-artifact.mjs';
import * as conformanceProcess from './conformance-process.mjs';
import { PRODUCT_IDENTITY } from '../../hook-runner/src/identity.js';

describe('checkout trust without ambient HOME', () => {
  const root = mkdtempSync(join(tmpdir(), 'conformance-checkout-'));
  const checkout = resolve(import.meta.dirname, '../../..');
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
    const head = spawnSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    expect(head.status, head.stderr).toBe(0);
    sourceSha = head.stdout.trim();
    const bytes = Buffer.from('packed bytes');
    writeFileSync(tarball, bytes);
    writeFileSync(`${tarball}.json`, JSON.stringify(createArtifactManifest(bytes, {
      packageName: PRODUCT_IDENTITY.packageName, packageVersion: '3.6.0', sourceSha,
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

  it.each([false, true])('limits verification trust to the exact checkout (foreign=%s)', async foreign => {
    const probe = vi.spyOn(conformanceProcess, 'runConformanceProcess').mockImplementation(options => {
      expect(options.env ?? {}).not.toHaveProperty('HOME');
      // Retarget only -C to prove the same trust cannot authorize a sibling repository.
      const args = foreign
        ? options.args.map((arg: string, index: number) => options.args[index - 1] === '-C' ? root : arg)
        : options.args;
      return run({ ...options, args, env: { ...options.env, ...isolatedGit } });
    });
    try {
      const verification = verifyConformanceArtifactForCheckout(tarball);
      if (foreign) await expect(verification).rejects.toThrow('dubious ownership');
      else await expect(verification).resolves.toMatchObject({ manifest: { sourceSha }, tarball });
    } finally {
      probe.mockRestore();
    }
  });
});
