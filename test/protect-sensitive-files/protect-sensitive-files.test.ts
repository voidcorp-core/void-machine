/**
 * Tests for packages/core/hooks/protect-sensitive-files.sh
 *
 * PreToolUse hook (https://code.claude.com/docs/en/hooks): reads the tool-call
 * JSON from stdin and blocks Edit/Write to files that must never be hand-edited
 * by the agent (private keys, credential files, lockfiles, .git/ internals,
 * .env with secrets). Exit 0 allow, exit 2 block. Tests run it as a subprocess.
 */

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const HOOK = resolve(process.cwd(), 'packages/core/hooks/protect-sensitive-files.sh');

interface Call {
  readonly tool: string;
  readonly file: string;
  readonly env?: Record<string, string>;
}

function runHook(call: Call): { code: number; stderr: string } {
  const input = JSON.stringify({
    tool_name: call.tool,
    tool_input: { file_path: call.file, content: 'x' },
  });
  const proc = spawnSync('bash', [HOOK], {
    input,
    encoding: 'utf8',
    env: { ...process.env, ...(call.env ?? {}) },
  });
  return { code: proc.status ?? 1, stderr: proc.stderr ?? '' };
}

describe('protect-sensitive-files.sh', () => {
  it('BLOCKS editing a .env file (exit 2)', () => {
    const r = runHook({ tool: 'Write', file: 'apps/web/.env' });
    expect(r.code).toBe(2);
  });

  it('BLOCKS editing .env.local (exit 2)', () => {
    expect(runHook({ tool: 'Edit', file: '.env.local' }).code).toBe(2);
  });

  it('allows editing .env.example (exit 0)', () => {
    expect(runHook({ tool: 'Write', file: '.env.example' }).code).toBe(0);
  });

  it('BLOCKS editing a private key (exit 2)', () => {
    expect(runHook({ tool: 'Write', file: 'certs/server.pem' }).code).toBe(2);
  });

  it('BLOCKS editing id_rsa (exit 2)', () => {
    expect(runHook({ tool: 'Write', file: '/home/u/.ssh/id_rsa' }).code).toBe(2);
  });

  it('BLOCKS editing a lockfile (exit 2)', () => {
    expect(runHook({ tool: 'Edit', file: 'pnpm-lock.yaml' }).code).toBe(2);
  });

  it('BLOCKS editing files under .git/ (exit 2)', () => {
    expect(runHook({ tool: 'Write', file: '.git/config' }).code).toBe(2);
  });

  it('BLOCKS a credentials-named file (exit 2)', () => {
    expect(runHook({ tool: 'Write', file: 'config/credentials.json' }).code).toBe(2);
  });

  it('allows a normal source file (exit 0)', () => {
    expect(runHook({ tool: 'Edit', file: 'src/feature.ts' }).code).toBe(0);
  });

  it('honours the VOID_HARNESS_ALLOW_SECRET_EDIT=1 override (exit 0)', () => {
    const r = runHook({ tool: 'Write', file: '.env', env: { VOID_HARNESS_ALLOW_SECRET_EDIT: '1' } });
    expect(r.code).toBe(0);
  });

  it('ignores non-edit tools (exit 0)', () => {
    expect(runHook({ tool: 'Read', file: '.env' }).code).toBe(0);
  });

  // Codex parity: edits arrive via apply_patch, the path is in the patch
  // envelope, not file_path.
  function runPatch(patch: string): number {
    const input = JSON.stringify({ tool_name: 'apply_patch', tool_input: { content: patch } });
    return spawnSync('bash', [HOOK], { input, encoding: 'utf8' }).status ?? 1;
  }

  it('BLOCKS a Codex apply_patch touching .env (exit 2)', () => {
    const patch = '*** Begin Patch\n*** Update File: apps/web/.env\n+SECRET=1\n*** End Patch';
    expect(runPatch(patch)).toBe(2);
  });

  it('allows a Codex apply_patch on a normal file (exit 0)', () => {
    const patch = '*** Begin Patch\n*** Add File: src/feature.ts\n+export const x = 1;\n*** End Patch';
    expect(runPatch(patch)).toBe(0);
  });

  // Codex's shell tool passes the command as an argv ARRAY, not a string.
  it('BLOCKS a Codex shell argv-array apply_patch touching .env (exit 2)', () => {
    const input = JSON.stringify({
      tool_name: 'shell',
      tool_input: { command: ['apply_patch', '*** Begin Patch\n*** Update File: apps/web/.env\n+S=1\n*** End Patch'] },
    });
    expect(spawnSync('bash', [HOOK], { input, encoding: 'utf8' }).status ?? 1).toBe(2);
  });

  // Case-insensitive: uppercase secret/key names must not slip through.
  it('BLOCKS an uppercase .ENV file (exit 2)', () => {
    expect(runHook({ tool: 'Write', file: 'config/.ENV' }).code).toBe(2);
  });
  it('allows a credential-named source module regardless of case (exit 0)', () => {
    expect(runHook({ tool: 'Write', file: 'src/Credentials.ts' }).code).toBe(0);
  });
});
