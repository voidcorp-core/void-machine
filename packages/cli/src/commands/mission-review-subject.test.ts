import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { captureMissionReviewSubject } from './mission.js';

function git(root: string, args: readonly string[]) {
  return execFileSync('git', [...args], { cwd: root, encoding: 'utf8' }).trim();
}
it('reviews an exact committed HEAD and refuses mutable code as its subject', async () => {
  const root = await mkdtemp(join(tmpdir(), 'void-bounded-subject-'));
  git(root, ['init', '--quiet']);
  await writeFile(join(root, 'auth.ts'), 'export const authorized = false;\n');
  git(root, ['add', 'auth.ts']);
  const commit = () => git(root, ['-c', 'user.name=Void Test', '-c', 'user.email=test@example.test',
    'commit', '--quiet', '-m', 'test: seed subject']);
  commit();
  const base = git(root, ['rev-parse', 'HEAD']);
  await writeFile(join(root, 'auth.ts'), 'export const authorized = true;\n');
  git(root, ['add', 'auth.ts']);
  await expect(captureMissionReviewSubject(root, base, true)).rejects.toThrow('MISSION_REVIEW_UNCOMMITTED');
  commit();
  const first = await captureMissionReviewSubject(root, base, true);
  expect(first.reviewedCommit).toBe(git(root, ['rev-parse', 'HEAD']));
  git(root, ['-c', 'user.name=Void Test', '-c', 'user.email=test@example.test',
    'commit', '--allow-empty', '--quiet', '-m', 'test: distinct committed subject']);
  const second = await captureMissionReviewSubject(root, base, true);
  expect(first.diff).toBe(second.diff);
  expect(first.hash).not.toBe(second.hash);
});

async function generatedPatchFixture(bytes: number) {
  const root = await mkdtemp(join(tmpdir(), 'void-generated-subject-'));
  git(root, ['init', '--quiet']);
  const path = join(root, 'generated.js');
  await writeFile(path, '// baseline\n');
  git(root, ['add', 'generated.js']);
  const commit = () => git(root, ['-c', 'user.name=Void Test', '-c', 'user.email=test@example.test',
    'commit', '--quiet', '-m', 'test: generated subject']);
  commit();
  const base = git(root, ['rev-parse', 'HEAD']);
  const body = `// ${'x'.repeat(bytes)}\n// review tail: first\n`;
  await writeFile(path, body);
  git(root, ['add', 'generated.js']);
  return { root, path, base, body, commit };
}

it.each([false, true])('captures a complete generated patch above 4 MB (committed: %s)', async (committed) => {
  const { root, base, commit } = await generatedPatchFixture(4_400_000);
  if (committed) commit();
  const expected = execFileSync('git', ['diff', '--no-ext-diff', '--no-textconv', '--binary',
    '--full-index', '--no-renames', '--relative', base, ...(committed ? ['HEAD'] : []),
    '--', '.', ':(exclude).void/machine/**'], { cwd: root, encoding: 'utf8', maxBuffer: 20_000_000 });
  expect(Buffer.byteLength(expected)).toBeGreaterThan(4_000_000);
  const subject = await captureMissionReviewSubject(root, base, committed);
  expect(subject.diff).toBe(expected);
  expect(subject.files.files).toEqual(['generated.js']);
  expect(subject.diff).toContain('+// review tail: first\n');
});

it('binds the review hash to changes after the old patch capture limit', async () => {
  const { root, path, base, body } = await generatedPatchFixture(4_400_000);
  const first = await captureMissionReviewSubject(root, base);
  await writeFile(path, body.replace('tail: first', 'tail: second'));
  const second = await captureMissionReviewSubject(root, base);
  expect(second.diff).toContain('+// review tail: second\n');
  expect(second.hash).not.toBe(first.hash);
});

it('refuses a patch above the dedicated 16 MB bound with an explicit limit', async () => {
  const { root, base } = await generatedPatchFixture(16_000_001);
  await expect(captureMissionReviewSubject(root, base)).rejects.toThrow(
    'MISSION_REVIEW_PATCH_TOO_LARGE: Git review patch exceeds 16000000 bytes',
  );
});
