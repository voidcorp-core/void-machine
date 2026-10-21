#!/usr/bin/env node
// tdd-cover: e2e packages/cli/src/lib/ci-feedback.test.ts
// An admission refusal is not test evidence. Keep this step inside the required
// quality job: a skipped required job reports success in GitHub Actions.
import { readFileSync } from 'node:fs';

try {
  const name = process.env.GITHUB_EVENT_NAME;
  if (!['pull_request', 'merge_group', 'push', 'workflow_dispatch'].includes(name)) {
    throw new Error('CI_INVALID_EVENT: unsupported or missing GitHub event.');
  }
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (name === 'pull_request') {
    if (typeof event?.pull_request?.draft !== 'boolean') {
      throw new Error('CI_INVALID_EVENT: pull request draft state is missing or malformed.');
    }
    if (event.pull_request.draft) {
      throw new Error('CI_DEFERRED_DRAFT: preparation only; run focused tests locally, then mark ready for review to start integration validation. No tests were run.');
    }
  }
  process.stdout.write('CI_ADMITTED: run the complete integration checks for this revision.\n');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'CI_INVALID_EVENT: unreadable event.'}\n`);
  process.exitCode = 1;
}
