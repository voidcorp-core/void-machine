import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

it('collects hook and indirect subprocess tests once in native projects', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'native-project-collection-'));
  const report = join(temporary, 'tests.json');
  const paths = [
    'packages/hook-runner/src/cli.test.ts',
    'test/cli/force-preserves-co-owned.test.ts',
    'test/cli/add-remove-parity.test.ts',
  ];
  try {
    const result = spawnSync(process.execPath, [
      join(root, 'node_modules/vitest/vitest.mjs'), 'list', '--no-static-parse',
      '--project=local', '--maxWorkers=1', `--json=${report}`, ...paths,
    ], { cwd: root, encoding: 'utf8', timeout: 8_000, killSignal: 'SIGKILL' });
    expect(result.status, result.stderr).toBe(0);
    const tests: { file: string; name: string; projectName: string }[] =
      JSON.parse(readFileSync(report, 'utf8'));
    for (const path of paths) {
      expect(tests.some(test => test.file === join(root, path)), path).toBe(true);
    }
    expect(tests.every(test => test.projectName === 'local')).toBe(true);
    expect(new Set(tests.map(test => `${test.file}:${test.name}`)).size).toBe(tests.length);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
