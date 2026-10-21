// @test-resource subprocess -- the integration case runs the local formatter.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { executeFormat } from './format-executor.js';

vi.mock(import('node:child_process'), { spy: true });

/** Keep executable discovery and file validation real, independently of process scheduling. */
function projectWithFailingFormatter(): { root: string; input: unknown } {
  const root = mkdtempSync(join(tmpdir(), 'void-format-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'card.ts'), 'export const card = 1;\n');
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
  const biome = join(root, 'node_modules', '.bin', 'biome');
  writeFileSync(biome, '#!/bin/sh\nprintf ran > .formatter-ran\nexit 3\n');
  chmodSync(biome, 0o755);
  const input = {
    tool_name: 'Write',
    tool_input: { file_path: join(root, 'src', 'card.ts'), content: 'export const card = 1;\n' },
  };
  return { root, input };
}

afterEach(() => vi.mocked(spawnSync).mockReset());

describe('executeFormat timeout setting', () => {
  it.each([
    { setting: 'current prefix', env: { VOID_MACHINE_FORMAT_TIMEOUT_MS: '250' }, timeout: 250 },
    { setting: 'deprecated prefix', env: { VOID_HARNESS_FORMAT_TIMEOUT_MS: '300' }, timeout: 300 },
    {
      setting: 'current prefix when both are set',
      env: { VOID_HARNESS_FORMAT_TIMEOUT_MS: '300', VOID_MACHINE_FORMAT_TIMEOUT_MS: '400' },
      timeout: 400,
    },
    { setting: 'default when both prefixes are absent', env: {}, timeout: 10_000 },
  ])('forwards the timeout from $setting', ({ env, timeout }) => {
    const { root, input } = projectWithFailingFormatter();
    vi.mocked(spawnSync).mockReturnValueOnce({
      pid: 1, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), status: 3, signal: null,
    });

    expect(executeFormat(input, root, env)).toEqual({
      status: 'degraded', details: { reason: 'formatter-error', formatted: 0, timeoutMs: timeout },
    });
    expect(spawnSync).toHaveBeenCalledExactlyOnceWith(
      join(root, 'node_modules', '.bin', 'biome'),
      ['format', '--write', join(root, 'src', 'card.ts')],
      { cwd: root, env: { ...process.env, ...env }, shell: false, stdio: 'ignore', timeout },
    );
  });

  it('reports successful formatter completion', () => {
    const { root, input } = projectWithFailingFormatter();
    vi.mocked(spawnSync).mockReturnValueOnce({
      pid: 1, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), status: 0, signal: null,
    });
    expect(executeFormat(input, root, {})).toEqual({ status: 'ok', details: { formatted: 1 } });
  });

  it('reports a formatter that exceeds its deadline as a timeout', () => {
    const { root, input } = projectWithFailingFormatter();
    vi.mocked(spawnSync).mockReturnValueOnce({
      pid: 1, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0),
      status: null, signal: 'SIGTERM',
      error: Object.assign(new Error('spawnSync biome ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    });
    expect(executeFormat(input, root, { VOID_MACHINE_FORMAT_TIMEOUT_MS: '250' })).toEqual({
      status: 'degraded', details: { reason: 'timeout', formatted: 0, timeoutMs: 250 },
    });
    expect(spawnSync).toHaveBeenCalledExactlyOnceWith(
      join(root, 'node_modules', '.bin', 'biome'),
      ['format', '--write', join(root, 'src', 'card.ts')],
      expect.objectContaining({ timeout: 250 }),
    );
  });
});

describe.skipIf(process.platform === 'win32')('executeFormat process integration', () => {
  it('runs the real formatter after controlled process results are reset', () => {
    const { root, input } = projectWithFailingFormatter();
    expect(executeFormat(input, root, {})).toEqual({
      status: 'degraded', details: { reason: 'formatter-error', formatted: 0, timeoutMs: 10_000 },
    });
    expect(readFileSync(join(root, '.formatter-ran'), 'utf8')).toBe('ran');
  });
});
