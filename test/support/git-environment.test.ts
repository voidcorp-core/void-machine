import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporary: string[] = [];

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the git environment every test runs in', () => {
  // A commit ends by starting `git maintenance run --auto --detach`, which
  // outlives the commit and still writes in `.git` while a test removes its
  // repository: `rmSync` then fails with ENOTEMPTY on a test whose assertions
  // all passed. The test home turns that writer off for every repository.
  it('starts no background maintenance after a commit', () => {
    const root = mkdtempSync(join(tmpdir(), 'git-environment-'));
    temporary.push(root);
    const trace = join(root, 'trace2.txt');
    const repository = join(root, 'repository');
    execFileSync('git', ['init', '-q', repository], { stdio: 'ignore' });
    writeFileSync(join(repository, 'file'), 'content\n');
    execFileSync('git', ['add', 'file'], { cwd: repository, stdio: 'ignore' });

    execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=c', 'commit', '-qm', 'in'], {
      cwd: repository,
      stdio: 'ignore',
      env: { ...process.env, GIT_TRACE2: trace },
    });

    expect(readFileSync(trace, 'utf8')).not.toMatch(/child_start.*\bmaintenance\b|\bgc --auto\b/);
  });
});
