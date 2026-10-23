import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRODUCT_IDENTITY } from '../../packages/hook-runner/src/identity.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');
const RELEASING = readFileSync(join(ROOT, 'docs', 'RELEASING.md'), 'utf8');

function workflow(name: string): string {
  return readFileSync(join(WORKFLOWS, name), 'utf8');
}

describe('release automation authority', () => {
  const backMerge = workflow('back-merge.yml');
  const promotion = workflow('promotion.yml');
  const voidEnforce = workflow('void-enforce.yml');
  const allWorkflows = readdirSync(WORKFLOWS)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => ({ name, source: workflow(name) }));

  it('contains exactly one native auto-merge command in the canonical workflow', () => {
    const commands = allWorkflows.flatMap(({ name, source }) =>
      [...source.matchAll(/^\s*gh pr merge\b(?=[^\n]*--auto\b)[^\n]*/gm)].map((match) => ({
        name,
        command: match[0].trim(),
      })),
    );
    const graphqlMutations = allWorkflows.flatMap(({ name, source }) =>
      [...source.matchAll(/enablePullRequestAutoMerge\s*\(/g)].map(() => name),
    );
    const autoMergeActions = allWorkflows.flatMap(({ name, source }) =>
      [...source.matchAll(/^\s*(?:-\s*)?uses:\s*\S*auto.?merge\S*/gim)].map(() => name),
    );

    expect(commands).toEqual([
      {
        name: 'back-merge.yml',
        command: 'gh pr merge "$existing" --repo "$EXPECTED_REPOSITORY" --auto --merge',
      },
    ]);
    expect(graphqlMutations).toEqual([]);
    expect(autoMergeActions).toEqual([]);
  });

  it('rechecks live auto-merge state on every pull request transition and refuses it into main', () => {
    expect(voidEnforce).toMatch(
      /types:\s*\[[^\]]*auto_merge_enabled[^\]]*auto_merge_disabled[^\]]*\]/,
    );
    expect(voidEnforce).toContain('pull-requests: read');
    expect(voidEnforce).toContain('gh pr view "$PR_NUMBER"');
    expect(voidEnforce).toContain('autoMergeRequest');
    expect(voidEnforce).toContain(`EXPECTED_REPOSITORY: ${PRODUCT_IDENTITY.repositorySlug}`);
    expect(voidEnforce).toContain('FORBIDDEN_BASE: main');
    expect(voidEnforce).toContain('assertAutoMergeAllowed');
  });

  it('maintains the human promotion without retrospective review certification', () => {
    expect(promotion).toContain('git diff --quiet origin/main origin/develop');
    expect(promotion).toContain('gh pr create');
    expect(promotion).toContain('gh pr edit');
    expect(promotion).not.toMatch(/gh pr merge|--auto|graphql|REVIEW_APP|promotion-authority/);
  });

  it.each([
    ['promotion.yml', promotion, 'release-promotion-develop-main', 'read'],
    ['back-merge.yml', backMerge, 'release-back-merge-main-develop', 'write'],
  ])('%s is single-flight and scopes its App token to this repository', (_name, source, group, contents) => {
    expect(source).toContain(`group: ${group}`);
    expect(source).toContain('cancel-in-progress: true');
    expect(source).toMatch(/owner: \$\{\{ github\.repository_owner \}\}/);
    expect(source).toMatch(/repositories: \$\{\{ github\.event\.repository\.name \}\}/);
    expect(source).toContain(`permission-contents: ${contents}`);
    expect(source).toContain('permission-pull-requests: write');
    expect(source).not.toMatch(/permission-(?:actions|administration|environments|secrets):/);
  });

  it.each([
    ['promotion.yml', promotion, "EXPECTED_REF: refs/heads/develop"],
    ['back-merge.yml', backMerge, "EXPECTED_REF: refs/heads/main"],
  ])('%s rejects the wrong repository, ref, head, base or fork', (_name, source, expectedRef) => {
    expect(source).toContain(`EXPECTED_REPOSITORY: ${PRODUCT_IDENTITY.repositorySlug}`);
    expect(source).toContain(expectedRef);
    expect(source).toContain('headRepository');
    expect(source).toContain('headRepositoryOwner');
    expect(source).toContain('isCrossRepository');
  });
});

describe('release operator contract', () => {
  it('documents exactly two routine actions and no Actions approval', () => {
    expect(RELEASING).toMatch(/Release\s+action 1:/);
    expect(RELEASING).toMatch(/Release\s+action 2:/);
    expect(RELEASING).toContain('There is no normal-path workflow dispatch, deployment approval');
    expect(RELEASING).toContain('back-merge');
    expect(RELEASING).toContain('refuses an armed auto-merge');
  });

  it('documents local review and human promotion without historical certification', () => {
    expect(RELEASING).toContain('local independent review');
    expect(RELEASING).toContain('does not recertify historical commits');
    expect(RELEASING).not.toContain('scripts/promotion-authority.mjs');
  });

  it('documents tag-bound recovery and every external authority boundary', () => {
    expect(RELEASING).toContain('release_tag');
    expect(RELEASING).toContain('existing closed form `vX.Y.Z`');
    for (const control of [
      'sha_pinning_required: true',
      'selected-repository mode',
      'Immutable releases',
      'npm-publish',
      `npm trust list ${PRODUCT_IDENTITY.packageName} --json`,
    ]) {
      expect(RELEASING).toContain(control);
    }
  });
});

