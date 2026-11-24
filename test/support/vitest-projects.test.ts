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
    { path: 'packages/hook-runner/src/cli.test.ts', project: 'local' },
    { path: 'test/cli/force-preserves-co-owned.test.ts', project: 'local' },
    { path: 'test/cli/add-remove-parity.test.ts', project: 'local' },
    { path: 'packages/void-machine/test/cli-note-contract.test.ts', project: 'network' },
    { path: 'packages/void-machine/test/process-signal.test.ts', project: 'network' },
  ];
  try {
    const result = spawnSync(process.execPath, [
      join(root, 'node_modules/vitest/vitest.mjs'), 'list', '--no-static-parse',
      '--project=local', '--project=network', '--maxWorkers=1', `--json=${report}`,
      ...paths.map(({ path }) => path),
    ], { cwd: root, encoding: 'utf8', timeout: 8_000, killSignal: 'SIGKILL' });
    expect(result.status, result.stderr).toBe(0);
    const tests: { file: string; name: string; projectName: string }[] =
      JSON.parse(readFileSync(report, 'utf8'));
    for (const { path, project } of paths) {
      const collected = tests.filter(test => test.file === join(root, path));
      expect(collected.length, path).toBeGreaterThan(0);
      expect(collected.every(test => test.projectName === project), path).toBe(true);
    }
    expect(new Set(tests.map(test => `${test.file}:${test.name}`)).size).toBe(tests.length);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
