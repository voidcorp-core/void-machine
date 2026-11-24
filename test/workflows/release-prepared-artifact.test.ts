// @test-resource subprocess
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { PRODUCT_IDENTITY } from '../../packages/hook-runner/src/identity.js';
import { createArtifactManifest } from '../../packages/cli/scripts/conformance-artifact.mjs';

it.each([false, true])('binds only the verified consumer bytes to the canonical release filename (wrong SHA=%s)', wrong => {
  const root = mkdtempSync(join(tmpdir(), 'release-prepared-'));
  try {
    const tree = join(root, 'tree');
    const artifact = join(root, 'artifact');
    mkdirSync(join(tree, 'package'), { recursive: true });
    mkdirSync(artifact);
    const pkg = { name: PRODUCT_IDENTITY.packageName, version: '7.0.2' };
    writeFileSync(join(tree, 'package/package.json'), JSON.stringify(pkg));
    writeFileSync(join(tree, 'release-please-config.json'), JSON.stringify({ packages: { '.': {
      'extra-files': [{ type: 'json', path: 'package/package.json', jsonpath: '$.version' }],
    } } }));
    writeFileSync(join(tree, '.release-please-manifest.json'), '{".":"7.0.2"}');
    execFileSync('git', ['init', '-q', tree]);
    execFileSync('git', ['-C', tree, 'add', '.']);
    execFileSync('git', ['-C', tree, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture']);
    const sha = execFileSync('git', ['-C', tree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const tarball = join(artifact, 'consumer.tgz');
    execFileSync('tar', ['-czf', tarball, '-C', tree, 'package']);
    const bytes = readFileSync(tarball);
    writeFileSync(`${tarball}.json`, JSON.stringify(createArtifactManifest(bytes, {
      packageName: pkg.name, packageVersion: pkg.version, sourceSha: wrong ? 'f'.repeat(40) : sha,
      runIdentity: '123:1',
    })));
    const result = spawnSync(process.execPath, [resolve('scripts/prepare-release-artifact.mjs'), 'prepare'], {
      encoding: 'utf8', env: { ...process.env, RELEASE_TAG: 'v7.0.2', RELEASE_COMMIT: sha,
        RELEASE_TREE: tree, ARTIFACT_DIR: artifact, GITHUB_OUTPUT: join(root, 'output'),
        GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' },
    });
    if (wrong) {
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('source SHA');
    } else {
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(join(artifact, `${PRODUCT_IDENTITY.packageName}-7.0.2.tgz`))).toEqual(bytes);
      expect(JSON.parse(readFileSync(join(artifact, 'release-artifact.json'), 'utf8')).releaseCommit).toBe(sha);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
