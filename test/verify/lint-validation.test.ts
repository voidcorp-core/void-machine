// @test-resource subprocess
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const BIOME = resolve('node_modules/@biomejs/biome/bin/biome');
const CONFIG = JSON.parse(readFileSync(resolve('biome.json'), 'utf8'));

function lint(path: string, source: string, packageManifest?: object): { status: number | null; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'void-lint-validation-'));
  try {
    writeFileSync(join(root, 'biome.json'), JSON.stringify({ ...CONFIG, vcs: { enabled: false } }));
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'lint-proof', dependencies: { declared: '*', vitest: '*' },
    }));
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
    if (packageManifest) writeFileSync(join(root, 'packages/example/package.json'), JSON.stringify(packageManifest));
    const result = spawnSync(process.execPath, [BIOME, 'lint', '--config-path', root, target], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    return { status: result.status, output: result.stdout + result.stderr };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

it.each([
  ['packages/example/src/value.ts', 'export type Value = any;', 'noExplicitAny'],
  ['apps/example/src/main.ts', 'console.error("failed");', 'noConsole'],
  ['packages/example/test/case.test.ts', 'test.only("case", () => {});', 'noFocusedTests'],
  ['packages/core/hooks/case.test.ts', 'test.skip("case", () => {});', 'noSkippedTests'],
  ['test/browser/case.spec.mjs', 'test.only("case", () => {});', 'noFocusedTests'],
  ['packages/example/src/dependency.ts', 'export { value } from "undeclared";', 'noUndeclaredDependencies'],
])('rejects violations at %s', (path, source, rule) => {
  const result = lint(path, source);
  expect(result.output).toContain(rule);
  expect(result.status).toBe(1);
});

it.each([
  ['packages/example/src/value.ts', 'export const note = "any console.log test.only";'],
  ['packages/example/src/value.ts', 'export const state = { kind: "ready" } as const;'],
  ['packages/example/src/dependency.ts', 'export { value } from "declared";'],
  ['packages/example/src/dependency.ts', 'export { value } from "@/local";'],
  ['packages/example/src/dependency.ts', 'export { value } from "#local";'],
  ['packages/cli/src/commands/install.ts', 'console.log("installation complete");'],
  ['packages/example/test/case.test.ts', 'test("case", () => {});'],
])('accepts legitimate validation input at %s', (path, source) => {
  const result = lint(path, source);
  expect(result.status, result.output).toBe(0);
});


it('resolves declarations from the nearest package rather than the repository root', () => {
  const source = 'export { value } from "declared";';
  const path = 'packages/example/src/dependency.ts';
  expect(lint(path, source, { name: 'nested' }).output).toContain('noUndeclaredDependencies');
  for (const kind of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const result = lint(path, source, { name: 'nested', [kind]: { declared: '*' } });
    expect(result.status, result.output).toBe(0);
  }
});
