// @test-resource subprocess
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { execByPackageName, installPackage } from './conformance-install.mjs';
import { conformanceFixtureEnvironment, packageManagerCommand, requireConformanceExit,
  runConformanceProcess } from './conformance-process.mjs';

async function fixture(namedBin: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'conformance-npm-exec-'));
  const source = join(root, 'source');
  mkdirSync(join(source, 'tmp'), { recursive: true });
  writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'conformance-command', version: '1.2.3',
    bin: { [namedBin ? 'conformance-command' : 'other-command']: 'correct.cjs', alternate: 'wrong.cjs' } }));
  // Different destinations force npm to resolve the package-named bin from its manifest.
  writeFileSync(join(source, 'correct.cjs'), '#!/usr/bin/env node\nprocess.stdout.write("1.2.3\\n");\n');
  writeFileSync(join(source, 'wrong.cjs'), '#!/usr/bin/env node\nprocess.exit(9);\n');
  const npm = packageManagerCommand('npm');
  requireConformanceExit(await runConformanceProcess({ command: npm.executable,
    args: [...npm.prefixArguments, 'pack', '--offline', '--ignore-scripts'], cwd: source,
    env: conformanceFixtureEnvironment(source) }), 'pack npm fixture');
  const tarball = join(source, 'conformance-command-1.2.3.tgz');
  await installPackage(root, tarball);
  return { root, tarball };
}

it('resolves the tarball manifest with the existing cache instead of a second cold fixture', async () => {
  const { root, tarball } = await fixture(true);
  try {
    const installed = join(root, 'package', 'node_modules', 'conformance-command');
    const before = readFileSync(join(installed, 'package.json'));
    const content = join(root, 'package', 'npm-cache', '_cacache', 'content-v2');
    const cachedBytes = () => readdirSync(content, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile()).map(entry => ({
        path: join(entry.parentPath, entry.name).slice(content.length),
        sha256: createHash('sha256').update(readFileSync(join(entry.parentPath, entry.name))).digest('hex'),
      })).sort((left, right) => left.path.localeCompare(right.path));
    const cacheBefore = cachedBytes();
    expect(cacheBefore.length).toBeGreaterThan(0);
    await execByPackageName(root, tarball);
    expect(readFileSync(join(installed, 'package.json'))).toEqual(before);
    expect(existsSync(join(root, 'exec'))).toBe(false);
    // npm may still materialize an _npx tree; this proves reuse of cached content only.
    expect(cachedBytes()).toEqual(cacheBefore);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('still refuses a multi-bin tarball without the package-named bin', async () => {
  const { root, tarball } = await fixture(false);
  try {
    await expect(execByPackageName(root, tarball)).rejects.toThrow('could not determine executable to run');
    expect(existsSync(join(root, 'exec'))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
