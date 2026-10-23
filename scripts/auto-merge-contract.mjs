// Auto-merge contract, replayed by `void-enforce` on every pull request event
// that can arm or disarm it.
//
// Auto-merge is how a pull request lands on develop: native auto-merge waits
// for branch protection and every required deterministic check. Autopilot
// additionally requires its local review verdict. The one refusal is a pull
// request into the forbidden base, main: promoting develop to main and merging
// the release pull request are the two release actions a person takes
// (docs/RELEASING.md), so no machine ever arms either.

function fail(message) {
  throw new Error(`auto-merge is not allowed: ${message}`);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function assertAutoMergeAllowed(pr, expected) {
  if (!isObject(pr) || !isObject(expected)) fail('input is missing');
  if (
    typeof expected.repository !== 'string' ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\/[A-Za-z0-9_.-]+$/.test(expected.repository)
  ) {
    fail('expected repository is invalid');
  }
  if (typeof expected.forbiddenBase !== 'string' || expected.forbiddenBase === '') {
    fail('the forbidden base is invalid');
  }
  if (typeof pr.baseRefName !== 'string' || pr.baseRefName === '') fail('the base is unreadable');
  if (pr.autoMergeRequest === null) return 'unarmed';
  if (!isObject(pr.autoMergeRequest)) fail('auto-merge state is malformed');
  if (pr.baseRefName === expected.forbiddenBase) {
    fail(`a pull request into ${expected.forbiddenBase} is merged by a person`);
  }
  return 'allowed';
}
