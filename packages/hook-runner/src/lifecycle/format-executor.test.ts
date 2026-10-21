// @test-resource subprocess -- the executor spawns the formatter it finds.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeFormat } from './format-executor.js';

vi.mock(import('node:child_process'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

/** A project whose local formatter always fails, so the result reports the timeout it ran under. */
function projectWithFailingFormatter(): { root: string; input: unknown } {
  const root = mkdtempSync(join(tmpdir(), 'void-format-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'card.ts'), 'export const card = 1;\n');
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
  const biome = join(root, 'node_modules', '.bin', 'biome');
  writeFileSync(biome, '#!/bin/sh\nexit 3\n');
  chmodSync(biome, 0o755);
  const input = {
    tool_name: 'Write',
    tool_input: { file_path: join(root, 'src', 'card.ts'), content: 'export const card = 1;\n' },
  };
  return { root, input };
}

describe.skipIf(process.platform === 'win32')('executeFormat timeout setting', () => {
  afterEach(() => vi.mocked(spawnSync).mockReset());
  it('reads the timeout under the current prefix', () => {
    const { root, input } = projectWithFailingFormatter();
    // Reproduce the boundary result when OS scheduling consumes the 250 ms budget.
    vi.mocked(spawnSync).mockReturnValueOnce({
      pid: 1, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0),
      status: null, signal: 'SIGTERM',
      error: Object.assign(new Error('spawnSync biome ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    });
    const result = executeFormat(input, root, { VOID_MACHINE_FORMAT_TIMEOUT_MS: '250' });
    expect(result).toMatchObject({ status: 'degraded', details: { reason: 'formatter-error', timeoutMs: 250 } });
  });

  it('still reads the deprecated prefix, and lets the current one win when both are set', () => {
    const { root, input } = projectWithFailingFormatter();
    expect(executeFormat(input, root, { VOID_HARNESS_FORMAT_TIMEOUT_MS: '300' }).details)
      .toMatchObject({ timeoutMs: 300 });
    expect(executeFormat(input, root, {
      VOID_HARNESS_FORMAT_TIMEOUT_MS: '300',
      VOID_MACHINE_FORMAT_TIMEOUT_MS: '400',
    }).details).toMatchObject({ timeoutMs: 400 });
  });
});
