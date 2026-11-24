import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function fixture(failures: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'native-verify-'));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'bin'));
  cpSync(resolve('scripts/verify.mjs'), join(root, 'scripts/verify.mjs'));
  writeFileSync(join(root, 'bin/pnpm'), `#!/usr/bin/env node\nimport {appendFileSync} from 'node:fs';\nappendFileSync('calls', process.argv.slice(2).join(' ') + '\\n');\nprocess.exit(${JSON.stringify(failures)}.includes(process.argv[2]) ? 9 : 0);\n`, { mode: 0o755 });
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture']);
  const run = (args: string[] = []) => spawnSync(process.execPath, ['scripts/verify.mjs', ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, VOID_CONFORMANCE_TARBALL: 'already-prepared-by-owner' },
  });
  return { root, run, calls: () => readFileSync(join(root, 'calls'), 'utf8').trim().split('\n') };
}

describe('actual verification child failures', () => {
  it('collects independent cheap failures and never starts dependent preparation', () => {
    const f = fixture(['version:check', 'lint']);
    try {
      const result = f.run();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('version-lockstep, lint');
      expect(f.calls()).toEqual(['version:check', 'anti-bloat:check', 'skills:check-references', 'lint']);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
  it('stops build dependents after an actual red child process', () => {
    const f = fixture(['build']);
    try {
      const result = f.run();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('failed build');
      expect(f.calls().at(-1)).toBe('build');
      expect(f.calls()).not.toContain('typecheck');
      expect(f.calls()).not.toContain('test:local');
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
  it('keeps single-command failures nonzero and refuses a stale claimed SHA', () => {
    const f = fixture(['version:check']);
    try {
      expect(f.run(['--gate', 'version-lockstep']).status).toBe(1);
      const stale = f.run(['--gate', 'version-lockstep', '--sha', 'a'.repeat(40)]);
      expect(stale.status).toBe(2);
      expect(stale.stderr).toContain('checked-out HEAD');
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});
