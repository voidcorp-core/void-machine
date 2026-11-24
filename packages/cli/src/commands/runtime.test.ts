import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `runtime` writes into the project through a staged transaction and exits the
// process on refusal, so it is exercised as a binary, the way a user meets it.
// What is pinned here is the entry surface: what it says about a project it has
// not been installed into, and what it reports about the runtimes it finds.
const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'bin', 'void-machine.mjs');

function run(root: string, ...args: readonly string[]): { code: number; out: string } {
  const result = spawnSync(process.execPath, [CLI, 'runtime', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return { code: result.status ?? 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('runtime', () => {
  it('lists every adapter and marks the ones this project has not wired', () => {
    const { code, out } = run(mkdtempSync(join(tmpdir(), 'void-runtime-')));

    expect(code).toBe(0);
    expect(out).toMatch(/claude/);
    expect(out).toMatch(/codex/);
    expect(out).toMatch(/not wired/);
  });

  // `add` seeds its stage from the project and publishes a transaction over it.
  // Without a config there is no install to grow, and the useful answer is the
  // command that creates one, not a half-wired tree.
  it('refuses to add a runtime to a project that was never installed into', () => {
    const { code, out } = run(mkdtempSync(join(tmpdir(), 'void-runtime-')), 'add', 'codex');

    expect(code).toBe(2);
    expect(out).toMatch(/void-machine init/);
  });
});
