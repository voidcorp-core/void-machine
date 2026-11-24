// @test-resource subprocess
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { PRODUCT_IDENTITY } from '../../packages/hook-runner/src/identity.js';

// A real committed stale delivery: prepack would repair it before the old late check.
function fixture(stale: boolean, failed: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'artifact-preparation-'));
  for (const name of ['packages/cli/scripts/conformance-artifact.mjs',
    'packages/cli/scripts/conformance-process.mjs', 'scripts/verify.mjs', 'scripts/product-identity.mjs', 'packages/core/src/data/identity.json']) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    cpSync(resolve(name), join(root, name));
  }
  writeFileSync(join(root, 'packages/cli/package.json'), JSON.stringify({ name: PRODUCT_IDENTITY.packageName, version: '7.0.2' }));
  writeFileSync(join(root, 'delivery'), stale ? 'stale' : 'fresh');
  writeFileSync(join(root, '.gitignore'), 'output/\npack-invoked\n');
  writeFileSync(join(root, 'scripts/derive.mjs'), `import { readFileSync } from 'node:fs';\nif (readFileSync('delivery', 'utf8') !== 'fresh') { process.stderr.write('stale delivery'); process.exit(1); }\n`);
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin/pnpm'), `#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs';\nif (process.argv.includes('version:check')) process.exit(0);\nwriteFileSync('pack-invoked', 'yes');\nwriteFileSync('delivery', 'fresh');\n${failed ? 'process.exit(1);' : "writeFileSync(process.argv.at(-1) + '/packed.tgz', 'bytes');"}\n`, { mode: 0o755 });
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture']);
  return root;
}

it('rejects committed stale bytes before a pack lifecycle can repair them', () => {
  const root = fixture(true, false);
  try {
    const result = spawnSync(process.execPath, ['packages/cli/scripts/conformance-artifact.mjs'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        VOID_CONFORMANCE_ARTIFACT_DIR: join(root, 'output') },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('stale delivery');
    expect(existsSync(join(root, 'pack-invoked'))).toBe(false);
    expect(readFileSync(join(root, 'delivery'), 'utf8')).toBe('stale');
    expect(existsSync(join(root, 'output'))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('never promotes output after a failed pack', () => {
  const root = fixture(false, true);
  try {
    const result = spawnSync(process.execPath, ['packages/cli/scripts/conformance-artifact.mjs'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        VOID_CONFORMANCE_ARTIFACT_DIR: join(root, 'output') },
    });
    expect(result.status).not.toBe(0);
    expect(existsSync(join(root, 'pack-invoked'))).toBe(true);
    expect(existsSync(join(root, 'output'))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it.each([false, true])('shares one clean preparation without attesting edited sources (dirty=%s)', (dirty) => {
  const root = fixture(false, false);
  try {
    if (dirty) writeFileSync(join(root, 'edited'), 'new source');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { withVerificationArtifact } from './scripts/verify.mjs';
      import { existsSync } from 'node:fs';
      await withVerificationArtifact([{id:'publish-safety'}, {id:'package-size'}], env => {
        process.stdout.write(String(Boolean(env.VOID_CONFORMANCE_TARBALL && existsSync(env.VOID_CONFORMANCE_TARBALL))));
      });
    `], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}` } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(String(!dirty));
    expect(existsSync(join(root, 'pack-invoked'))).toBe(!dirty);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

