/**
 * Tests for packages/core/dist/hooks/secret-in-content.sh
 *
 * Blocks writing a high-confidence secret into ANY file (companion to
 * protect-sensitive-files, which only guards secret FILENAMES). Reads the Claude
 * Code tool-call JSON from stdin; exit 0 allows, exit 2 blocks.
 *
 * The fake secrets are assembled at RUNTIME from fragments so no committed line
 * is itself a plausible secret (doctrine 2026-06-01: never commit a real-looking
 * key, even in a fixture).
 */

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const HOOK = resolve(process.cwd(), 'packages/core/dist/hooks/secret-in-content.sh');

function runHook(file: string, content: string): { code: number; stderr: string } {
  const input = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file, content } });
  const proc = spawnSync('bash', [HOOK], { input, encoding: 'utf8' });
  return { code: proc.status ?? 1, stderr: proc.stderr ?? '' };
}

// Runtime-assembled fakes (no committed line is a plausible key).
const AWS = `AKIA${'ABCDEFGHIJKLMNOP'}`;
const OPENAI = `sk-${'a'.repeat(48)}`;
const GH = `ghp_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}`;
const STRIPE = `sk_live_${'0123456789abcdefABCDEF'}`;
const PEM = '-----BEGIN RSA PRIVATE KEY-----';

describe('secret-in-content.sh — high-confidence vendor tokens', () => {
  it.each([
    ['AWS access key', AWS],
    ['OpenAI key', OPENAI],
    ['GitHub token', GH],
    ['Stripe live key', STRIPE],
    ['PEM private key header', PEM],
  ])('BLOCKS a %s pasted into a .ts file (exit 2)', (_label, token) => {
    const r = runHook('apps/web/src/config.ts', `const k = '${token}';\n`);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('in-content');
  });
});

describe('secret-in-content.sh — false positives stay allowed', () => {
  it('allows a UUID assigned to an _KEY var (exit 0)', () => {
    expect(runHook('apps/web/src/a.ts', `const API_KEY = '550e8400-e29b-41d4-a716-446655440000';\n`).code).toBe(0);
  });

  it('allows a pure-hex git sha assigned to a _TOKEN var (exit 0)', () => {
    expect(runHook('apps/web/src/a.ts', `const GIT_TOKEN = '${'a1b2c3d4'.repeat(5)}';\n`).code).toBe(0);
  });

  it('allows an env-indirection assignment (exit 0)', () => {
    expect(runHook('apps/web/src/a.ts', `const SECRET_KEY = process.env.SECRET_KEY;\n`).code).toBe(0);
  });

  it('allows clean code (exit 0)', () => {
    expect(runHook('apps/web/src/a.ts', `export const add = (a: number, b: number) => a + b;\n`).code).toBe(0);
  });
});

describe('secret-in-content.sh — escape hatches', () => {
  it.each(['apps/web/src/a.test.ts', 'fixtures/data.ts', '__generated__/data.ts'])(
    'blocks high-confidence keys in %s', (path) => {
      const result = runHook(path, `const k = '${AWS}';\n`);
      expect(result.code).toBe(2);
      expect(result.stderr).not.toContain(AWS);
    },
  );

  it('honors the allow-secret-pattern tag (exit 0)', () => {
    expect(runHook('apps/web/src/a.ts', `const k = '${AWS}'; // allow-secret-pattern: docs example\n`).code).toBe(0);
  });

  it('ignores non-Edit/Write tools (exit 0)', () => {
    const input = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'a.ts' } });
    const proc = spawnSync('bash', [HOOK], { input, encoding: 'utf8' });
    expect(proc.status ?? 1).toBe(0);
  });
});
