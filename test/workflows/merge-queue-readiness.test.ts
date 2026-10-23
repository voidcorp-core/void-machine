import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A merge queue only merges once every required check reports on the
// `merge_group` event. A required check whose workflow ignores that event
// blocks the queue forever; one that runs but reads pull_request-only context
// can pass on an empty base. These assertions pin both sides.
// Ref: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

function triggers(source: string): string {
  return source.split(/^jobs:/m)[0] ?? '';
}

function job(source: string, name: string): string {
  const start = source.indexOf(`\n  ${name}:\n`);
  if (start < 0) return '';
  const rest = source.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

// A GitHub Actions expression, spelled out so the source holds no `${` literal.
function expression(inner: string): string {
  return ['$', '{{ ', inner, ' }}'].join('');
}

const MERGE_GROUP =
  /^ {2}merge_group:\n {4}types: \[checks_requested\]\n {4}branches: \[develop\]$/m;

describe('merge queue readiness on develop', () => {
  // `validate` and the three `install conformance` jobs live in ci.yml and
  // `enforce` in void-enforce.yml retain the queue checks.
  it.each(['ci.yml', 'void-enforce.yml'])('%s answers merge groups on develop', (name) => {
    expect(triggers(read(`.github/workflows/${name}`))).toMatch(MERGE_GROUP);
  });

  it('proves decision immutability against the merge group base', () => {
    const decisions = job(read('.github/workflows/ci.yml'), 'validate');
    expect(decisions).toContain(
      `DECISIONS_BASE: ${expression(
        'github.event.pull_request.base.sha || github.event.merge_group.base_sha',
      )}`,
    );
  });

  it('diffs enforce against the merge group base instead of failing on no base', () => {
    const action = read('.github/actions/void-enforce/action.yml');
    expect(action).toContain(
      `MERGE_GROUP_BASE_SHA: ${expression('github.event.merge_group.base_sha')}`,
    );
    expect(action).toMatch(/base="\$\{MERGE_GROUP_BASE_SHA:-\}"/);
  });
});

describe('one local review authority', () => {
  it('retires the duplicate model review, App publisher and queue relay together', () => {
    for (const path of [
      '.github/workflows/independent-review.yml',
      '.github/workflows/independent-review-queue.yml',
      'scripts/independent-review-run.mjs',
      'scripts/independent-review-check.mjs',
      'scripts/promotion-authority.mjs',
    ]) expect(existsSync(join(ROOT, path)), path).toBe(false);
  });
});
