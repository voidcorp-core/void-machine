// @test-resource subprocess
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { PRODUCT_IDENTITY } from '../../packages/hook-runner/src/identity.js';

// The producer fixture is the exact implementation from c8f1ba2, before DEV-1143.
// Its v1 manifest has no runIdentity, and it never checks freshness before pack.
function historicalTree(stale = false) {
  const root = mkdtempSync(join(tmpdir(), 'historical-release-'));
  const tree = join(root, 'release-tree');
  for (const path of ['packages/cli/scripts/conformance-process.mjs', 'scripts/product-identity.mjs',
    'packages/core/src/data/identity.json']) {
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    cpSync(resolve(path), join(tree, path));
  }
  cpSync(resolve('test/workflows/fixtures/pre-dev1143-conformance-artifact.mjs'),
    join(tree, 'packages/cli/scripts/conformance-artifact.mjs'));
  const cli = { name: PRODUCT_IDENTITY.packageName, version: '1.2.3', files: ['dist'],
    scripts: { prepack: 'node ../../prepack.mjs' } };
  writeFileSync(join(tree, 'packages/cli/package.json'), JSON.stringify(cli));
  mkdirSync(join(tree, 'packages/cli/dist'));
  writeFileSync(join(tree, 'packages/cli/dist/main.js'), 'export const historical = true;');
  writeFileSync(join(tree, 'package.json'), JSON.stringify({ name: 'recovery-fixture', private: true,
    scripts: { 'conformance:pack': 'node historical-producer.mjs',
      'check:publish': 'node historical-reader.mjs', 'check:size': 'node historical-reader.mjs' } }));
  writeFileSync(join(tree, 'pnpm-workspace.yaml'), 'packages:\n  - packages/cli\n');
  writeFileSync(join(tree, 'delivery'), stale ? 'stale' : 'fresh');
  writeFileSync(join(tree, 'scripts/derive.mjs'), `import {readFileSync} from 'node:fs';
    if (readFileSync('delivery','utf8') !== 'fresh') { process.stderr.write('stale original delivery'); process.exit(1); }`);
  writeFileSync(join(tree, 'prepack.mjs'), `import {appendFileSync,writeFileSync} from 'node:fs';
    appendFileSync(new URL('../packs.log', import.meta.url), 'pack\\n');
    writeFileSync(new URL('delivery', import.meta.url), 'fresh');`);
  // Observe the old command without altering its retained implementation or metadata.
  writeFileSync(join(tree, 'historical-producer.mjs'), `import {writeFileSync} from 'node:fs';
    import {packConformanceArtifact} from './packages/cli/scripts/conformance-artifact.mjs';
    writeFileSync(new URL('../historical-producer-called', import.meta.url), 'called');
    await packConformanceArtifact(process.env.VOID_CONFORMANCE_ARTIFACT_DIR);`);
  // Historical readers would repack; invocation is an explicit regression failure.
  writeFileSync(join(tree, 'historical-reader.mjs'), `import {writeFileSync} from 'node:fs';
    writeFileSync(new URL('../historical-reader-called', import.meta.url), 'called'); process.exit(87);`);
  writeFileSync(join(tree, 'release-please-config.json'), JSON.stringify({ packages: { '.': {
    'extra-files': [{ type: 'json', path: 'packages/cli/package.json', jsonpath: '$.version' }],
  } } }));
  writeFileSync(join(tree, '.release-please-manifest.json'), '{".":"1.2.3"}');
  execFileSync('git', ['init', '-q', tree]);
  execFileSync('git', ['-C', tree, 'add', '.']);
  execFileSync('git', ['-C', tree, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'historical fixture']);
  const sha = execFileSync('git', ['-C', tree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const artifact = join(root, 'artifact');
  const env = { ...process.env, RELEASE_TREE: tree, RELEASE_TAG: 'v1.2.3', RELEASE_COMMIT: sha,
    ARTIFACT_DIR: artifact, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_OUTPUT: join(root, 'output') };
  const run = (command: string, extra = {}) => spawnSync(process.execPath,
    [resolve('scripts/prepare-release-artifact.mjs'), command], { encoding: 'utf8', env: { ...env, ...extra } });
  return { root, tree, artifact, sha, env, run };
}

it('reproduces the historical producer schema rejected by current release control', () => {
  const fixture = historicalTree();
  try {
    const legacy = spawnSync(process.execPath, ['historical-producer.mjs'], {
      cwd: fixture.tree, encoding: 'utf8', env: { ...fixture.env, VOID_CONFORMANCE_ARTIFACT_DIR: fixture.artifact },
    });
    expect(legacy.status, legacy.stderr).toBe(0);
    expect(existsSync(join(fixture.root, 'historical-producer-called'))).toBe(true);
    expect(JSON.parse(readFileSync(join(fixture.artifact, 'consumer.tgz.json'), 'utf8'))).not.toHaveProperty('runIdentity');
    expect(fixture.run('prepare').stderr).toContain('fields are not canonical');
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

it('current control prepares and validates the historical tree with one real lifecycle pack', () => {
  const fixture = historicalTree();
  try {
    const prepared = fixture.run('pack');
    expect(prepared.status, prepared.stderr).toBe(0);
    const tarball = join(fixture.artifact, 'consumer.tgz');
    const bytes = readFileSync(tarball);
    const manifest = JSON.parse(readFileSync(`${tarball}.json`, 'utf8'));
    expect(manifest).toMatchObject({ sourceSha: fixture.sha, packageName: PRODUCT_IDENTITY.packageName,
      packageVersion: '1.2.3', runIdentity: '123:1' });
    const checked = fixture.run('check');
    expect(checked.status, checked.stderr).toBe(0);
    expect(fixture.run('check', { GITHUB_RUN_ATTEMPT: '2' }).stderr).toContain('run');
    expect(fixture.run('check', { RELEASE_COMMIT: 'f'.repeat(40) }).stderr).toContain('release commit');
    expect(fixture.run('check', { RELEASE_TAG: 'v9.9.9' }).stderr).toContain('version');
    writeFileSync(tarball, Buffer.concat([bytes, Buffer.from('changed')]));
    expect(fixture.run('check').stderr).toContain('digest');
    writeFileSync(tarball, bytes);
    const bound = fixture.run('prepare');
    expect(bound.status, bound.stderr).toBe(0);
    expect(readFileSync(join(fixture.artifact, `${PRODUCT_IDENTITY.packageName}-1.2.3.tgz`))).toEqual(bytes);
    expect(readFileSync(join(fixture.root, 'packs.log'), 'utf8')).toBe('pack\n');
    expect(existsSync(join(fixture.root, 'historical-reader-called'))).toBe(false);
    expect(existsSync(join(fixture.root, 'historical-producer-called'))).toBe(false);
    expect(execFileSync('git', ['-C', fixture.tree, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('');
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

it('current control rejects stale historical bytes before the old lifecycle can repair them', () => {
  const fixture = historicalTree(true);
  try {
    const prepared = fixture.run('pack');
    expect(prepared.status).not.toBe(0);
    expect(prepared.stderr).toContain('stale original delivery');
    expect(readFileSync(join(fixture.tree, 'delivery'), 'utf8')).toBe('stale');
    expect(existsSync(join(fixture.root, 'packs.log'))).toBe(false);
    expect(existsSync(fixture.artifact)).toBe(false);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});
