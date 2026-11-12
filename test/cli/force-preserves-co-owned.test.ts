// @test-resource subprocess
/**
 * `--force` answers a conflict on a MANAGED asset -- a file the harness owns
 * alone and can prove it wrote. It was never an answer about a CO-OWNED file,
 * where the project owns every line outside the marked block.
 *
 * Conflating the two cost a monorepo its whole enforcement floor: `--force`,
 * suggested by the harness's own error message to unblock two hooks, rewrote
 * `paths.business` back to the single-app default. The config stayed valid, so
 * nothing went red -- it just pointed at a directory holding no code.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CO_OWNED_FILES } from '../../packages/cli/src/lib/co-owned.js';
import { init } from '../../packages/cli/src/commands/init.js';
import { update } from '../../packages/cli/src/commands/update.js';
import { evaluateRule } from '../../packages/hook-runner/src/enforcement/runner.js';

let dir: string;
let cwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'void-force-'));
  cwd = process.cwd();
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
});

function readConfig(): { paths?: Record<string, unknown>; packs?: Record<string, string> } {
  return JSON.parse(readFileSync(join(dir, '.void', 'config.json'), 'utf8'));
}

describe('--force never seizes a co-owned file', () => {
  it('keeps the multi-path business globs a monorepo tuned by hand', async () => {
    await init(['--runtime', 'claude', '--no-interactive']);
    const seeded = readConfig();
    writeFileSync(
      join(dir, '.void', 'config.json'),
      `${JSON.stringify(
        { ...seeded, paths: { ...seeded.paths, business: ['apps/*/src/**', 'packages/*/src/**'], tests: 'packages/*/src/**/*.test.ts' } },
        null,
        2,
      )}\n`,
    );

    await init(['--runtime', 'claude', '--no-interactive', '--force']);

    const after = readConfig();
    expect(after.paths?.business).toEqual(['apps/*/src/**', 'packages/*/src/**']);
    expect(after.paths?.tests).toBe('packages/*/src/**/*.test.ts');
  });

  it('keeps every other hand-tuned key, not just paths', async () => {
    await init(['--runtime', 'claude', '--no-interactive']);
    const seeded = readConfig();
    writeFileSync(
      join(dir, '.void', 'config.json'),
      `${JSON.stringify({ ...seeded, modes: { tdd: 'strict' } }, null, 2)}\n`,
    );

    await init(['--runtime', 'claude', '--no-interactive', '--force']);

    expect(readConfig().modes).toEqual({ tdd: 'strict' });
  });

  // The broad net. Each co-owned file gets a line only the project would write,
  // and --force must not cost a single one of them. Written against the list
  // itself rather than the two files that were reported, so a future path that
  // starts seizing a co-owned file fails here instead of in someone's repo.
  it('leaves the project lines in every co-owned file untouched', async () => {
    await init(['--runtime', 'claude', '--no-interactive']);
    const marks: Record<string, string> = {};
    for (const path of CO_OWNED_FILES) {
      if (path === '.void/config.json') continue; // asserted structurally above
      const target = join(dir, ...path.split('/'));
      if (!existsSync(target)) continue;
      // Marked in the file's own grammar. A text line appended to JSON makes it
      // unparseable, and replacing a config nothing can parse is legitimate --
      // the test would have been reading its own damage as the defect.
      const mark = `void-force-test-mark-for-${path}`;
      marks[path] = mark;
      const before = readFileSync(target, 'utf8');
      if (path.endsWith('.json')) {
        writeFileSync(target, `${JSON.stringify({ ...JSON.parse(before), [mark]: true }, null, 2)}\n`);
      } else {
        writeFileSync(target, `${before}\n${mark}\n`);
      }
    }
    expect(Object.keys(marks).length).toBeGreaterThan(0);

    await init(['--runtime', 'claude', '--no-interactive', '--force']);

    for (const [path, mark] of Object.entries(marks)) {
      expect(readFileSync(join(dir, ...path.split('/')), 'utf8'), `${path} lost its project line`)
        .toContain(mark);
    }
  });

  it('still overwrites a config it cannot parse, since nothing there can be merged', async () => {
    await init(['--runtime', 'claude', '--no-interactive']);
    writeFileSync(join(dir, '.void', 'config.json'), '{ this is not json\n');

    await init(['--runtime', 'claude', '--no-interactive', '--force']);

    expect(readConfig().paths).toBeDefined();
  });
});

describe('mono-app defaults and existing installations', () => {
  it('enforces TDD for fresh Bun root-src and apps sources after real init', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'bun@1.3.0' }));
    writeFileSync(join(dir, 'bun.lock'), '');
    await init(['--runtime', 'claude', '--no-interactive']);
    for (const path of ['src/feature.ts', 'apps/web/src/feature.ts']) {
      expect(evaluateRule('tdd-order', { tool_name: 'Write', tool_input: {
        file_path: path, content: 'export const feature = 1;',
      } }, { root: dir }).code).toBe('TDD_SIBLING_TEST_MISSING');
    }
  });

  it.each([{ business: 'apps/*/src/**' }, { business: 'services/**' }, { business: ['services/**', 'domain/**'] }])(
    'preserves existing business scope $business across init and update', async ({ business }) => {
      await init(['--runtime', 'claude', '--no-interactive']);
      const config = { ...readConfig(), paths: { business, spikes: ['services/spike-*'] } };
      writeFileSync(join(dir, '.void/config.json'), JSON.stringify(config));
      await init(['--runtime', 'claude', '--no-interactive']);
      expect(readConfig().paths).toEqual(config.paths);
      await update([]);
      expect(readConfig().paths).toEqual(config.paths);
      expect(evaluateRule('tdd-order', { tool_name: 'Write', tool_input: {
        file_path: 'src/feature.ts', content: 'export const feature = 1;',
      } }, { root: dir }).code).toBe('ALLOW');
    },
  );
});
