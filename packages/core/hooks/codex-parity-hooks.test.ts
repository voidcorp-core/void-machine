import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Runtime parity for the content-scanning PreToolUse hooks. Each hook must
// enforce IDENTICALLY whether the edit arrives as Claude's single-file
// Edit|Write payload or as Codex's multi-file `apply_patch` diff. Wiring a hook
// for Codex without this parity fires it against an empty payload — it passes
// everything, which reads green while enforcing nothing.
//
// The three properties every refactored hook must hold:
//   1. it still blocks on the Claude shape (no regression);
//   2. it blocks on a Codex apply_patch that ADDS the violation;
//   3. it blocks when the violation is in the SECOND file of a multi-file patch
//      (the hole a "first file only" shortcut would leave);
//   4. it does NOT block on a patch that merely REMOVES the offending line.
const here = dirname(fileURLToPath(import.meta.url));

/** Run a hook script with a tool-call JSON on stdin; capture the exit code. */
function runHook(hook: string, payload: unknown): { code: number; stderr: string } {
  const res = spawnSync(join(here, hook), [], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  return { code: res.status ?? 1, stderr: res.stderr ?? '' };
}

const claudeWrite = (path: string, content: string) => ({
  tool_name: 'Write',
  tool_input: { file_path: path, content },
});

const codexPatch = (body: readonly string[]) => ({
  tool_name: 'apply_patch',
  tool_input: { input: ['*** Begin Patch', ...body, '*** End Patch'].join('\n') },
});

describe('secret-in-content — Claude / Codex parity', () => {
  it('blocks a secret on the Claude Write shape', () => {
    const { code, stderr } = runHook('secret-in-content.sh', claudeWrite('src/a.ts', `token = 'ghp_${'a'.repeat(36)}'\n`));
    expect(code).toBe(2);
    expect(stderr).toMatch(/src\/a\.ts/);
  });

  it('allows clean content on the Claude Write shape', () => {
    expect(runHook('secret-in-content.sh', claudeWrite('src/a.ts', 'const x = 1\n')).code).toBe(0);
  });

  it('blocks a secret ADDED by a Codex apply_patch', () => {
    const { code, stderr } = runHook(
      'secret-in-content.sh',
      codexPatch(['*** Update File: src/b.ts', `+token = 'ghp_${'a'.repeat(36)}'`]),
    );
    expect(code).toBe(2);
    expect(stderr).toMatch(/src\/b\.ts/);
  });

  it('blocks when the violation is in the SECOND file of a multi-file patch', () => {
    const { code, stderr } = runHook(
      'secret-in-content.sh',
      codexPatch([
        '*** Update File: src/clean.ts',
        '+const ok = 1',
        '*** Update File: src/dirty.ts',
        `+token = 'ghp_${'a'.repeat(36)}'`,
      ]),
    );
    expect(code).toBe(2);
    expect(stderr).toMatch(/src\/dirty\.ts/);
  });

  it('allows a patch that only REMOVES a secret', () => {
    const { code } = runHook(
      'secret-in-content.sh',
      codexPatch(['*** Update File: src/c.ts', `-token = 'ghp_${'a'.repeat(36)}'`, '+const kept = 1']),
    );
    expect(code).toBe(0);
  });

  it('allows an untouched context line that contains secret', () => {
    const { code } = runHook(
      'secret-in-content.sh',
      codexPatch(['*** Update File: src/d.ts', ` token = 'ghp_${'a'.repeat(36)}'`, '+const added = 1']),
    );
    expect(code).toBe(0);
  });
});
