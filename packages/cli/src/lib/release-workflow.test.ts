/**
 * The release pull request has to receive its own required checks.
 *
 * For several releases it did not, and the reason is a platform rule rather than
 * a setting: a pull request opened with `GITHUB_TOKEN` triggers no workflows, so
 * GitHub cannot recurse into itself. The workflow answered that with ~90 lines
 * which resolved the release PR, dispatched every required workflow at its head,
 * then approved the runs sitting at `action_required`. It worked, and it broke
 * twice on races — once because `prs_created` precedes the PR being searchable,
 * once because a branch-scoped query met its approval quota with runs from
 * previous cycles while the current head still waited.
 *
 * A GitHub App token is not `GITHUB_TOKEN`, so the pull request it opens
 * triggers workflows like any other, and all of that is gone. What these tests
 * pin now is that the App token is actually used and that the machinery has not
 * crept back — a single `GITHUB_TOKEN` fallback would restore the whole failure
 * silently, and it would only be noticed at the next release.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const releaseWorkflow = readFileSync(
  new URL('../../../../.github/workflows/release.yml', import.meta.url),
  'utf8',
);

/**
 * The workflow with its comments stripped.
 *
 * Assertions about what the workflow must NOT do run against this. The comments
 * explain the removed machinery by name — `action_required`, the dispatch, why
 * `registry-url:` is poison — and a raw substring scan would fail the very prose
 * that documents the rule while passing a workflow that quietly reinstated it.
 */
const effective = releaseWorkflow
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

/** The release-please job alone, so assertions cannot pass on the publish job. */
const releasePleaseJob =
  releaseWorkflow.split('\n  release-please:\n')[1]?.split(/\n {2}[\w-]+:\n/)[0] ?? '';

/** The same job, comment-free, for the assertions about absences. */
const effectiveJob = releasePleaseJob
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

function job(name: string): string {
  return releaseWorkflow.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[\w-]+:\n/)[0] ?? '';
}

function withoutComments(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

describe('the release pull request is opened by the App', () => {
  it('mints an App token from the repository secrets', () => {
    // Matched without its version: the action is pinned by commit SHA since the
    // publication lockdown, and asserting a tag here would fail the day the pin
    // is refreshed — which is a maintenance step, not a regression. That every
    // action IS pinned is asserted in test/workflows/, where it belongs.
    expect(releasePleaseJob).toMatch(/actions\/create-github-app-token@\S+/);
    expect(releasePleaseJob).toMatch(/app-id: \$\{\{ secrets\.RELEASE_APP_ID \}\}/);
    expect(releasePleaseJob).toMatch(
      /private-key: \$\{\{ secrets\.RELEASE_APP_PRIVATE_KEY \}\}/,
    );
    expect(releasePleaseJob).toMatch(/owner: \$\{\{ github\.repository_owner \}\}/);
    expect(releasePleaseJob).toMatch(
      /repositories: \$\{\{ github\.event\.repository\.name \}\}/,
    );
    expect(releasePleaseJob).toContain('permission-contents: write');
    expect(releasePleaseJob).toContain('permission-pull-requests: write');
    expect(releasePleaseJob).not.toMatch(
      /permission-(?:actions|administration|environments|secrets):/,
    );
  });

  it('hands that token to release-please rather than letting it default', () => {
    // Without this line release-please falls back to GITHUB_TOKEN, the pull
    // request opens with no checks, and nothing fails until someone tries to
    // merge a release.
    expect(releasePleaseJob).toMatch(/token: \$\{\{ steps\.app-token\.outputs\.token \}\}/);
  });

  it('never falls back to GITHUB_TOKEN for the pull request', () => {
    expect(effectiveJob).not.toMatch(/token:\s*\$\{\{\s*(secrets\.)?GITHUB_TOKEN/);
    expect(effectiveJob).not.toMatch(/GH_TOKEN:\s*\$\{\{\s*github\.token/);
  });
});

describe('the machinery it replaced does not creep back', () => {
  it('dispatches no workflow', () => {
    expect(effective).not.toContain('gh workflow run');
  });

  it('approves no waiting run', () => {
    expect(effective).not.toContain('action_required');
    expect(effective).not.toMatch(/actions\/runs\/[^\s]*\/approve/);
  });

  it('polls for no release pull request', () => {
    expect(effective).not.toContain("--label 'autorelease: pending'");
  });

  it('drops the Actions permission that only the dispatch needed', () => {
    const permissions = releaseWorkflow.split('\npermissions:')[1]?.split('\n\njobs:')[0];

    expect(permissions).toBeDefined();
    expect(permissions).not.toContain('actions: write');
    // What release-please genuinely writes with, and nothing more.
    expect(permissions).toContain('contents: write');
    expect(permissions).toContain('pull-requests: write');
  });
});

describe('the human gate and the publish path are untouched', () => {
  it('publishes only when a release was cut or a human dispatched it', () => {
    expect(releaseWorkflow).toContain("needs.release-please.outputs.release_created == 'true'");
    expect(releaseWorkflow).toContain("github.event_name == 'workflow_dispatch'");
  });

  it('keeps publishing tokenless through OIDC, with no npm credential anywhere', () => {
    expect(releaseWorkflow).toContain('id-token: write');
    expect(effective).not.toContain('NODE_AUTH_TOKEN');
    expect(effective).not.toContain('registry-url:');
  });

  it('validates the tagged tree before publishing it', () => {
    expect(releaseWorkflow).toContain('pnpm version:check');
    expect(releaseWorkflow).toContain('pnpm check:publish');
  });
});

describe('the release tree is validated and packed without OIDC', () => {
  const validateReleaseJob =
    releaseWorkflow.split('\n  validate-release:\n')[1]?.split(/\n {2}[\w-]+:\n/)[0] ?? '';

  it('requires an explicit immutable tag for exceptional recovery', () => {
    expect(releaseWorkflow).toMatch(/workflow_dispatch:\s*\n\s+inputs:\s*\n\s+release_tag:/);
    expect(releaseWorkflow).toMatch(/release_tag:[\s\S]*required:\s*true/);
    expect(releasePleaseJob).toContain("github.event_name == 'push'");
  });

  it('gives validation only contents read and never OIDC', () => {
    expect(validateReleaseJob).toContain('permissions:');
    expect(validateReleaseJob).toContain('contents: read');
    expect(validateReleaseJob).not.toMatch(/^\s+id-token:\s*write/m);
  });

  it('resolves and checks out the exact release commit', () => {
    expect(validateReleaseJob).toContain('RELEASE_TAG:');
    expect(validateReleaseJob).toContain('release_commit');
    expect(validateReleaseJob).toMatch(
      /ref: \$\{\{ steps\.resolve\.outputs\.release_commit \}\}/,
    );
    expect(validateReleaseJob).toContain('path: release-tree');
  });

  it('validates before packing the final tarball exactly once', () => {
    expect(validateReleaseJob).toContain('package_json_file: release-tree/package.json');
    expect(validateReleaseJob).toContain('pnpm version:check');
    expect(validateReleaseJob).toContain('pnpm build');
    expect(validateReleaseJob).toContain('pnpm typecheck');
    expect(validateReleaseJob).toContain('pnpm test');
    expect(validateReleaseJob).toContain('pnpm check:publish');
    expect(validateReleaseJob.match(/pnpm --filter \.\/packages\/cli pack/g)).toHaveLength(1);
  });

  it('uploads one short-lived integrity-bound artifact and exposes its identity', () => {
    expect(validateReleaseJob).toContain(
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    );
    expect(validateReleaseJob).toContain('retention-days: 1');
    expect(validateReleaseJob).toContain('artifact-id');
    expect(validateReleaseJob).toContain('artifact-digest');
    expect(validateReleaseJob).toContain('steps.prepare.outputs.manifest_path');
  });
});

describe('minimal OIDC publication and independent provenance verification', () => {
  const publishJob = job('publish');
  const effectivePublishJob = withoutComments(publishJob);
  const verifyPublicationJob = job('verify-publication');
  const effectiveVerifyPublicationJob = withoutComments(verifyPublicationJob);

  it('gives OIDC to the serialized publish job only', () => {
    expect(releaseWorkflow.match(/^\s+id-token:\s*write$/gm)).toHaveLength(1);
    expect(publishJob).toContain('environment: npm-publish');
    expect(publishJob).toContain('contents: read');
    expect(publishJob).toContain('actions: read');
    expect(publishJob).toContain('id-token: write');
    expect(publishJob).toContain('group: npm-release-publish');
    expect(publishJob).toContain('cancel-in-progress: false');
  });

  it('downloads only the exact validated artifact after checking service metadata', () => {
    expect(publishJob).toContain(
      'repos/$EXPECTED_REPOSITORY/actions/artifacts/$ARTIFACT_ID',
    );
    for (const field of ['artifact-id', 'artifact-digest', 'workflow_run', 'head_sha', 'expired']) {
      expect(publishJob).toContain(field);
    }
    expect(publishJob).toContain(
      'actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131',
    );
    expect(publishJob).toContain(
      'artifact-ids: $' + '{{ needs.validate-release.outputs.artifact_id }}',
    );
    expect(publishJob).toContain('merge-multiple: true');
  });

  it('executes no repository or package lifecycle code while OIDC is available', () => {
    expect(effectivePublishJob).not.toContain('actions/checkout@');
    expect(effectivePublishJob).not.toContain('pnpm');
    expect(effectivePublishJob).not.toMatch(/\bnpm[ \t]+(?:ci|install|run|test|pack)\b/);
    expect(effectivePublishJob).not.toMatch(/\b(?:prepack|prepare|postinstall)\b/);
    expect(effectivePublishJob).toContain('MINIMUM_NPM_VERSION: 11.5.1');
    expect(effectivePublishJob).not.toContain('MINIMUM_NPM_MAJOR');
    expect(effectivePublishJob).toContain(
      'npm publish "$TARBALL_PATH" --access public --ignore-scripts',
    );
  });

  it('fails closed on artifact corruption and bounds registry retries', () => {
    expect(publishJob).toContain('verify-release-artifact');
    expect(publishJob).toContain('MAX_CLASSIFICATION_ATTEMPTS: 3');
    expect(publishJob).toContain('MAX_PUBLICATION_ATTEMPTS: 73');
    expect(publishJob).toContain('E404');
    expect(publishJob).toContain('dist.integrity');
    expect(publishJob).toContain('dist.attestations?.url');
  });

  it('distinguishes a new publish from an existing version producer', () => {
    expect(publishJob).toContain(
      'publication_mode: $' + '{{ steps.registry.outputs.state }}',
    );
    expect(publishJob).toContain('publication_mode=new');
    expect(publishJob).toContain('publication_mode=existing');
    expect(publishJob).toContain('if [[ "$state" == existing || "$state" == absent ]]');
    expect(verifyPublicationJob).toContain(
      'PUBLICATION_MODE: $' + '{{ needs.publish.outputs.publication_mode }}',
    );
    expect(verifyPublicationJob).toContain('id: provenance');
    expect(verifyPublicationJob).toContain(
      '--source-digest "$' + '{{ steps.provenance.outputs.workflow_head_sha }}"',
    );
    expect(verifyPublicationJob).toContain(
      'PRODUCER_RUN_ID: $' + '{{ steps.provenance.outputs.run_id }}',
    );
  });

  it('verifies registry signatures and exact workflow provenance without OIDC', () => {
    expect(verifyPublicationJob).toContain('needs: [release-please, validate-release, publish]');
    expect(verifyPublicationJob).toContain('contents: read');
    expect(verifyPublicationJob).not.toContain('id-token: write');
    expect(verifyPublicationJob).not.toContain('environment: npm-publish');
    expect(effectiveVerifyPublicationJob).not.toContain('RELEASE_APP_PRIVATE_KEY');
    expect(effectiveVerifyPublicationJob).not.toContain('NODE_AUTH_TOKEN');
    expect(verifyPublicationJob).toContain('VERIFIED_NPM_VERSION: 11.12.1');
    expect(verifyPublicationJob).toContain('MINIMUM_GH_VERSION: 2.97.0');
    expect(verifyPublicationJob).toContain('npm audit signatures --json --include-attestations');
    expect(verifyPublicationJob).toContain('--ignore-scripts');
    expect(verifyPublicationJob).toContain('--digest-alg sha512');
    expect(verifyPublicationJob).toContain('--deny-self-hosted-runners');
    expect(verifyPublicationJob).toContain('--source-ref refs/heads/main');
    expect(verifyPublicationJob).toContain(
      'CURRENT_WORKFLOW_HEAD_SHA: $' + '{{ github.sha }}',
    );
    expect(verifyPublicationJob).toContain(
      '--source-digest "$' + '{{ steps.provenance.outputs.workflow_head_sha }}"',
    );
    expect(verifyPublicationJob).toContain(
      '--signer-digest "$' + '{{ steps.provenance.outputs.workflow_head_sha }}"',
    );
    expect(verifyPublicationJob).toContain('--predicate-type https://slsa.dev/provenance/v1');
  });

  it('keeps every npm authentication mechanism absent', () => {
    expect(effective).not.toContain('NODE_AUTH_TOKEN');
    expect(effective).not.toContain('registry-url:');
    expect(effective).not.toMatch(/_authToken|NPM_CONFIG_USERCONFIG/);
  });
});
