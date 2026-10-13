// @test-resource subprocess
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const worker = fileURLToPath(new URL('../../../core/hooks/_syntax-worker.cjs', import.meta.url));
// `cwd` is the consumer root, exactly as the port (syntax-process.ts) spawns it.
function inspect(input: unknown, cwd?: string) {
  expect(existsSync(worker), 'the delivered worker must exist independently of the hook').toBe(true);
  const child = spawnSync(process.execPath, ['--max-old-space-size=128', worker], {
    input: JSON.stringify(input), encoding: 'utf8', env: {}, timeout: 5_000,
    killSignal: 'SIGKILL', maxBuffer: 65_536, ...(cwd === undefined ? {} : { cwd }),
  });
  expect(child.status).toBe(0);
  return JSON.parse(child.stdout);
}
describe('official TypeScript worker contract', () => {
  it.each([
    ['view.js', 'test.only("case", () => {});'],
    ['view.jsx', 'const view = <div>{test.only("case", () => {})}</div>;'],
  ])('inspects JavaScript syntax in %s through the same worker', (path, source) => {
    expect(inspect({ version: 1, path, source, purpose: 'focused-tests' }))
      .toEqual({ version: 1, kind: 'inspected', lines: [1] });
  });
  it('uses official syntactic diagnostics without imposing semantic errors', () => {
    expect(inspect({ version: 1, path: 'a.ts', source: 'export const value;', purpose: 'focused-tests' }))
      .toEqual({ version: 1, kind: 'inspected', lines: [] });
  });
  it('returns syntax facts without deciding whether an edit is allowed', () => {
    expect(inspect({ version: 1, path: 'view.test.ts', source: 'test.only("case", () => {});', purpose: 'focused-tests' }))
      .toEqual({ version: 1, kind: 'inspected', lines: [1] });
  });
  it('refuses invalid source instead of emitting partial syntax evidence', () => {
    expect(inspect({ version: 1, path: 'view.test.ts', source: 'const = ;', purpose: 'focused-tests' }))
      .toEqual({ version: 1, kind: 'invalid-source' });
  });
  it.each([
    { version: 2, path: 'a.ts', source: '', purpose: 'focused-tests' },
    { version: 1, path: 'a.ts', source: '', purpose: 'unknown' },
    { version: 1, path: 'a.ts', source: ' '.repeat(65_537), purpose: 'declarations' },
  ])('refuses an invalid or oversized request', (input) => {
    expect(inspect(input)).toEqual({ version: 1, kind: 'invalid-request' });
  });
  // A hostile compiler sits where a consumer installs TypeScript and records any
  // load in a marker. The worker must still finish its own parse, `inspected`, so
  // the path under test was really exercised, and never touch that compiler.
  it.each([
    'throw new Error("PRIVATE_COMPILER_ERROR");',
    'module.exports = { version: "6.0.0" };',
    'process.stdout.write(JSON.stringify({unavailable:"PRIVATE_COMPILER_ERROR"})); process.exit(0);',
    'process.on("SIGTERM", () => {}); while (true) {}',
  ])('never loads a consumer compiler, even if it throws, forges output or loops', (code) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'worker-hostile-compiler-')));
    const directory = join(root, 'node_modules/typescript');
    const marker = join(root, 'consumer-compiler-loaded');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'typescript', main: 'index.cjs' }));
    writeFileSync(join(directory, 'index.cjs'),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'loaded');\n${code}`);
    const result: unknown = inspect({ version: 1, path: 'view.test.ts', source: '// test.skip prose',
      purpose: 'focused-tests' }, root);
    expect(result).toEqual({ version: 1, kind: 'inspected', lines: [] });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_COMPILER_ERROR');
    expect(existsSync(marker)).toBe(false);
  });
});
