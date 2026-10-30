import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PRODUCT_IDENTITY } from '../../packages/hook-runner/src/identity.js';

const { repositorySlug, repository } = PRODUCT_IDENTITY;

const workflow = readFileSync(new URL('../../.github/workflows/promotion.yml', import.meta.url), 'utf8');
const scripts = [...workflow.matchAll(/ {8}run: \|\n((?: {10}.*\n|\n)+)/g)]
  .map(match => match[1]?.replace(/^ {10}/gm, '') ?? '');
const roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

const identity = {
  baseRefName: 'main', headRefName: 'develop', isCrossRepository: false, state: 'OPEN',
  headRepository: { nameWithOwner: repositorySlug },
  headRepositoryOwner: { login: repository.owner },
};

function run(options: {
  diff?: number; pulls?: object[]; identity?: object; fail?: string;
  repository?: string; ref?: string;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'promotion-'));
  roots.push(root);
  writeFileSync(join(root, 'git'), '#!/bin/sh\nexit "$DIFF_STATUS"\n', { mode: 0o755 });
  writeFileSync(join(root, 'gh'), `#!/bin/sh
printf '%s\\n' "$*" >> "$FIXTURE/calls"
if [ "$2" = "$FAIL_COMMAND" ]; then echo 'GitHub API unavailable' >&2; exit 1; fi
case "$2" in
  list) cat "$FIXTURE/pulls.json";;
  view) cat "$FIXTURE/identity.json";;
  create|edit) printf 'https://github.com/${repositorySlug}/pull/7\\n';;
  *) echo 'Unexpected API operation' >&2; exit 1;;
esac
`, { mode: 0o755 });
  writeFileSync(join(root, 'calls'), '');
  writeFileSync(join(root, 'pulls.json'), JSON.stringify(options.pulls ?? []));
  writeFileSync(join(root, 'identity.json'), JSON.stringify(options.identity ?? identity));
  const result = spawnSync('bash', ['-c', scripts.join('\n')], {
    cwd: root, encoding: 'utf8', timeout: 5_000,
    env: { ...process.env, PATH: `${root}:${process.env.PATH}`, FIXTURE: root,
      DIFF_STATUS: String(options.diff ?? 1), FAIL_COMMAND: options.fail ?? '',
      EXPECTED_REPOSITORY: repositorySlug, EXPECTED_OWNER: repository.owner,
      EXPECTED_NAME: repository.name, EXPECTED_HEAD: 'develop', EXPECTED_BASE: 'main',
      EXPECTED_REF: 'refs/heads/develop',
      OBSERVED_REPOSITORY: options.repository ?? repositorySlug,
      OBSERVED_REF: options.ref ?? 'refs/heads/develop' },
  });
  return { ...result, calls: readFileSync(join(root, 'calls'), 'utf8') };
}

describe('human promotion maintenance', () => {
  it('leaves identical trees alone, including release back-merges', () => {
    const result = run({ diff: 0 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).toBe('');
  });
  it('creates the promotion without inspecting historical review checks', () => {
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).toContain(`pr create --repo ${repositorySlug} --base main --head develop`);
    expect(result.calls).not.toMatch(/graphql|merge/);
  });
  it('updates the unique same-repository promotion', () => {
    const result = run({ pulls: [{ number: 7 }] });
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).toContain(`pr edit 7 --repo ${repositorySlug}`);
    expect(result.calls).not.toContain('pr create');
  });
  it('refuses duplicate promotions without a write', () => {
    const result = run({ pulls: [{ number: 7 }, { number: 8 }] });
    expect(result.status).not.toBe(0);
    expect(result.calls).not.toMatch(/pr (edit|create)/);
  });
  it.each([
    { baseRefName: 'develop' }, { headRefName: 'foreign' }, { isCrossRepository: true },
    { headRepository: { nameWithOwner: 'other/void-machine' } },
    { headRepositoryOwner: { login: 'other' } }, { state: 'CLOSED' },
  ])('refuses foreign or stale PR identity %j', patch => {
    const result = run({ pulls: [{ number: 7 }], identity: { ...identity, ...patch } });
    expect(result.status).not.toBe(0);
    expect(result.calls).not.toMatch(/pr (edit|create)/);
  });
  it.each([{ repository: 'other/repo' }, { ref: 'refs/heads/main' }])(
    'refuses a foreign event before any API access %j', options => {
      const result = run(options);
      expect(result.status).not.toBe(0);
      expect(result.calls).toBe('');
    },
  );
  it.each(['list', 'view', 'create', 'edit'])('keeps a %s API failure visible', fail => {
    const result = run({ fail, pulls: ['view', 'edit'].includes(fail) ? [{ number: 7 }] : [] });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('GitHub API unavailable');
    if (['list', 'view'].includes(fail)) expect(result.calls).not.toMatch(/pr (edit|create)/);
  });
  it('fails on unreadable Git trees without writing a PR', () => {
    const result = run({ diff: 128 });
    expect(result.status).not.toBe(0);
    expect(result.calls).toBe('');
  });
});
