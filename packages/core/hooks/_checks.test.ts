import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// _checks.sh is a SOURCED library of pure detection functions shared by the
// PreToolUse hooks (Claude runtime) and the CI diff driver (enforce/ci-enforce.sh),
// so the floor is enforced by one body of logic, never two (DEV-393, zero
// duplication). Every function returns exit 1 + a payload on stdout when it
// detects a violation, exit 0 and nothing when the input is clean.
const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, '_checks.sh');
// PATH resolves the installed Bash even when the runner omits login-shell state.
const BASH = 'bash';

/** Call one function from _checks.sh with args + stdin; capture exit + stdout (never throws). */
function runCheck(fn: string, args: readonly string[] = [], input = ''): { code: number; stdout: string } {
  const res = spawnSync(BASH, ['-c', `source "${lib}"; ${fn} "$@"`, '_', ...args], { input, encoding: 'utf8' });
  return { code: res.status ?? 1, stdout: res.stdout ?? '' };
}

describe('checks_sensitive_path — never-edit files (path only)', () => {
  it.each([
    ['pnpm-lock.yaml', /lockfile/],
    ['bun.lock', /lockfile/],
    ['apps/web/BUN.LOCK', /lockfile/],
    ['bun.lockb', /lockfile/],
    ['package-lock.json', /lockfile/],
    ['a/b/yarn.lock', /lockfile/],
    ['.env', /environment file/],
    ['config/.env.production', /environment file/],
    ['deploy/id_rsa', /private key/],
    ['certs/server.pem', /private key/],
    ['app/credentials.json', /credential file/],
    ['config/secrets.yaml', /credential file/],
    ['.npmrc', /credential file/],
    ['.git/config', /git metadata/],
  ])('flags %s', (path, reason) => {
    const { code, stdout } = runCheck('checks_sensitive_path', [path]);
    expect(code).toBe(1);
    expect(stdout).toMatch(reason);
  });

  it.each([
    'src/index.ts',
    '.env.example',
    'config/.env.sample',
    'README.md',
    'packages/core/hooks/_checks.sh',
    // Markdown docs that merely mention secrets/credentials in the name are
    // documentation, not credential files (content scanning still applies).
    'docs/decisions-log/2026-06-26-secrets-via-env-byo-credentials.md',
    'notes/secret-handling.md',
  ])(
    'allows %s',
    (path) => {
      const { code, stdout } = runCheck('checks_sensitive_path', [path]);
      expect(code).toBe(0);
      expect(stdout).toBe('');
    },
  );
});

describe('checks_boundary_imports — @repo/* direction (path + content)', () => {
  const src = 'packages/foo/src/index.ts';

  it('flags a forbidden cross-package import', () => {
    const { code, stdout } = runCheck('checks_boundary_imports', [src], "import { a } from '@repo/bar';\n");
    expect(code).toBe(1);
    expect(stdout).toContain('@repo/bar');
  });

  it.each([
    ["import { x } from '@repo/core';\n", 'core is always allowed'],
    ["import { x } from '@repo/foo';\n", 'self-import is allowed'],
    ["import { a } from '@repo/bar'; // allow-boundary: vetted\n", 'tagged override'],
  ])('allows %s (%s)', (content) => {
    expect(runCheck('checks_boundary_imports', [src], content).code).toBe(0);
  });

  it('does not apply to apps/ or packages/core/ or test files', () => {
    const forbidden = "import { a } from '@repo/bar';\n";
    expect(runCheck('checks_boundary_imports', ['apps/web/x.ts'], forbidden).code).toBe(0);
    expect(runCheck('checks_boundary_imports', ['packages/core/src/x.ts'], forbidden).code).toBe(0);
    expect(runCheck('checks_boundary_imports', ['packages/foo/src/x.test.ts'], forbidden).code).toBe(0);
  });
});

describe('checks_secret_content — high-confidence secrets (path + content)', () => {
  it.each([
    ['AKIAIOSFODNN7EXAMPLE1'],
    ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH'],
    ['-----BEGIN RSA PRIVATE KEY-----'],
  ])('flags a vendor token: %s', (token) => {
    const { code, stdout } = runCheck('checks_secret_content', ['src/config.ts'], `const k = "${token}";\n`);
    expect(code).toBe(1);
    expect(stdout).not.toBe('');
  });

  it('flags a generic secret-named assignment with a long mixed literal', () => {
    const line = 'API_KEY = "abcd1234efgh5678ijkl9012mnop";\n';
    expect(runCheck('checks_secret_content', ['src/config.ts'], line).code).toBe(1);
  });

  it.each([
    ['const k = process.env.API_KEY;\n', 'env reference'],
    ['const id = "550e8400-e29b-41d4-a716-446655440000";\n', 'uuid value'],
    ['const k = "AKIAIOSFODNN7EXAMPLE1"; // allow-secret-pattern: fixture\n', 'tagged override'],
    ['export function run() { return 42; }\n', 'plain code'],
  ])('allows %s (%s)', (content) => {
    expect(runCheck('checks_secret_content', ['src/config.ts'], content).code).toBe(0);
  });

  it('exempts test-fixture paths (fake secrets are legitimate there)', () => {
    const secret = 'const k = "AKIAIOSFODNN7EXAMPLE1";\n';
    expect(runCheck('checks_secret_content', ['src/auth.test.ts'], secret).code).toBe(0);
    expect(runCheck('checks_secret_content', ['src/__fixtures__/keys.ts'], secret).code).toBe(0);
  });
});

describe('checks_dangerous_command — catastrophic shell patterns (stdin)', () => {
  it.each([
    ['rm -rf /', /root path/],
    ['rm -rf ~/', /root path/],
    ['git push --force origin main', /force/],
    [':(){ :|:& };:', /fork bomb/],
    ['psql -c "DROP TABLE users"', /SQL/],
  ])('flags %s', (cmd, label) => {
    const { code, stdout } = runCheck('checks_dangerous_command', [], cmd);
    expect(code).toBe(1);
    expect(stdout).toMatch(label);
  });

  it.each([
    'git push --force-with-lease origin main',
    'rm -rf ./build',
    'rm -rf node_modules',
    'ls -la /',
  ])('allows %s', (cmd) => {
    expect(runCheck('checks_dangerous_command', [], cmd).code).toBe(0);
  });
});
