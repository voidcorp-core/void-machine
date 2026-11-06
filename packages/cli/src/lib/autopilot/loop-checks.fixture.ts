import { readFileSync } from 'node:fs';

type Raw = Record<string, unknown>;
const captured = JSON.parse(readFileSync(
  new URL('./__fixtures__/gh/pr-current-checks.json', import.meta.url), 'utf8',
)) as { data: { repository: { pullRequest: { commits: { nodes: {
  commit: { statusCheckRollup: { contexts: { nodes: Raw[] } } };
}[] } } } } };
const capturedCheck = captured.data.repository.pullRequest.commits.nodes[0]?.commit.statusCheckRollup.contexts.nodes[0];
if (capturedCheck === undefined) throw new Error('captured check context is missing');
const real: Raw = capturedCheck;

/** Existing view variants on the real GraphQL envelope, with independent check identities. */
export function currentChecksFixture(viewText: string): string {
  const view = JSON.parse(viewText) as { headRefOid: string; statusCheckRollup: Raw[] };
  const nodes = view.statusCheckRollup.map((entry, index) => ({
    ...real, ...entry, id: `fixture-context-${index}`,
    checkSuite: {
      ...(real.checkSuite as Raw),
      workflowRun: null, // allow-null: a non-Actions check preserves each existing test's outcome
    },
  }));
  return JSON.stringify({ data: { repository: { pullRequest: {
    headRefOid: view.headRefOid, commits: { nodes: [{ commit: {
      oid: view.headRefOid, statusCheckRollup: { contexts: {
        nodes, totalCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: 'last' },
      } },
    } }] },
  } } } });
}
export const noWorkflowRuns = '{"total_count":0,"workflow_runs":[]}';
