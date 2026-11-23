import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Characterization tests for the floor compatibility adapters. Critical rules
// execute in the shared Node bundle; these prove stdin, overrides and exit-code
// mapping stay stable for existing shell integrations.
const here = dirname(fileURLToPath(import.meta.url));
// PATH resolves the installed Bash even when the runner omits login-shell state.
const BASH = 'bash';

function runHook(
  name: string,
  payload: Record<string, unknown>,
  env: Record<string, string> = {},
): { code: number; stderr: string } {
  const res = spawnSync(BASH, [join(here, name)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: res.status ?? 0, stderr: res.stderr ?? '' };
}

const edit = (file: string, content: string): Record<string, unknown> => ({
  tool_name: 'Edit',
  tool_input: { file_path: file, new_string: content },
});
const bash = (command: string): Record<string, unknown> => ({
  tool_name: 'Bash',
  tool_input: { command },
});

describe('floor shell adapters', () => {
  it.each([
    {
      name: 'protected file',
      hook: 'protect-sensitive-files.sh',
      payload: edit('pnpm-lock.yaml', 'x'),
      message: /lockfile/,
    },
    {
      name: 'boundary direction',
      hook: 'boundary-direction-check.sh',
      payload: edit('apps/web/index.ts', "import { a } from '@repo/bar';"),
      message: /does not declare/,
    },
    {
      name: 'secret content',
      hook: 'secret-in-content.sh',
      payload: edit('src/config.ts', 'const k = "AKIAIOSFODNN7EXAMPLE1";'),
      message: /secret|credential/i,
    },
    {
      name: 'dangerous command',
      hook: 'block-dangerous-bash.sh',
      payload: bash('rm -rf /'),
      message: /destructive/,
    },
  ])('maps a $name refusal to exit 2 and an actionable message', ({ hook, payload, message }) => {
    const result = runHook(hook, payload);

    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(message);
  });

  it.each([
    ['protect-sensitive-files.sh', edit('src/index.ts', 'x')],
    [
      'boundary-direction-check.sh',
      edit(
        'packages/foo/src/index.ts',
        "import { a } from '@repo/bar'; // allow-boundary: bootstrap",
      ),
    ],
    ['secret-in-content.sh', edit('src/config.ts', 'const k = process.env.API_KEY;')],
    ['block-dangerous-bash.sh', bash('ls -la')],
  ])('maps an allowed %s call to exit 0', (hook, payload) => {
    expect(runHook(hook, payload).code).toBe(0);
  });

  it.each([
    [
      'protect-sensitive-files.sh',
      edit('.env', 'x'),
      { VOID_HARNESS_ALLOW_SECRET_EDIT: '1' },
    ],
    [
      'block-dangerous-bash.sh',
      bash('git push --force'),
      { VOID_HARNESS_ALLOW_DANGEROUS: '1' },
    ],
  ])('keeps the documented %s override at the adapter boundary', (hook, payload, env) => {
    expect(runHook(hook, payload, env).code).toBe(0);
  });
});
