// Current checks are an adapter concern: a rollup includes historical suites.
// GitHub run_number orders new workflow invocations, unlike nullable startedAt.
// See docs/CI-CHAIN.md for the intentionally conservative supersession boundary.
import { z } from 'zod';
import { autopilotFailure } from './errors.js';
import type { GhRunner } from './loop-observe.js';

const id = z.string().min(1);
const sha = z.string().regex(/^[0-9a-f]{40}$/);
const checkSchema = z.object({
  __typename: z.literal('CheckRun'), id, name: id, status: id,
  conclusion: z.string().nullable(), // allow-null: unfinished GitHub checks have no conclusion
  checkSuite: z.object({
    id,
    app: z.object({ id }).nullable(), // allow-null: GitHub may omit a deleted app
    workflowRun: z.object({ event: id, workflow: z.object({ id }) }).nullable(), // allow-null: third-party check
  }),
});
const contextSchema = z.discriminatedUnion('__typename', [
  checkSchema,
  z.object({ __typename: z.literal('StatusContext'), id, context: id,
    state: z.enum(['SUCCESS', 'PENDING', 'EXPECTED', 'FAILURE', 'ERROR']) }),
]);
const contextsSchema = z.object({
  nodes: z.array(contextSchema).max(100), totalCount: z.int().nonnegative(),
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: id.nullable() }), // allow-null: empty connection
});
const pageSchema = z.object({
  data: z.object({ repository: z.object({ pullRequest: z.object({
    headRefOid: sha,
    commits: z.object({ nodes: z.array(z.object({ commit: z.object({
      oid: sha,
      statusCheckRollup: z.object({ contexts: contextsSchema }).nullable(), // allow-null: no checks
    }) })).length(1) }),
  }) }) }),
  errors: z.array(z.object({ message: z.string() })).optional(),
});
const refSchema = z.object({ ref: id, sha, repo: z.object({ id: z.int().positive() }) });
const workflowSchema = z.object({
  id: z.int().positive(), workflow_id: z.int().positive(), run_number: z.int().positive(),
  check_suite_node_id: id, event: id, head_branch: id, head_sha: sha,
  status: id, conclusion: z.string().nullable(), // allow-null: unfinished workflow
  pull_requests: z.array(z.object({ number: z.int().positive(), head: refSchema, base: refSchema })),
});
const runsSchema = z.object({ total_count: z.int().nonnegative(), workflow_runs: z.array(workflowSchema).max(100) });
type Context = z.infer<typeof contextSchema>;
type Workflow = z.infer<typeof workflowSchema>;
type CheckState = 'passing' | 'pending' | 'failing';
export type CurrentChecks = CheckState | 'none';
export interface CheckSubject {
  readonly number: number;
  readonly headSha: string;
  readonly headRef: string;
  readonly baseRef: string;
}
const PAGES_MAX = 10;
const PASSING = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const QUERY = `query CurrentPullRequestChecks(
  $owner: String!, $name: String!, $number: Int!, $cursor: String
) { repository(owner: $owner, name: $name) { pullRequest(number: $number) {
  headRefOid commits(last: 1) { nodes { commit { oid statusCheckRollup {
    contexts(first: 100, after: $cursor) { totalCount pageInfo { hasNextPage endCursor }
      nodes { __typename
        ... on CheckRun { id name status conclusion
          checkSuite { id app { id } workflowRun { event workflow { id } } } }
        ... on StatusContext { id context state }
      }
    }
  } } } }
} } }`;

function refuse(cause: string): never {
  throw autopilotFailure('AUTOPILOT_INPUT', 'the current checks reported by gh are unreadable',
    cause, 'observe the complete current head again after fixing gh access or incomplete data');
}
function parse<T>(schema: z.ZodType<T>, text: string): T {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return refuse('not JSON'); }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : refuse(parsed.error.message);
}
function readContexts(run: GhRunner, subject: CheckSubject): Context[] {
  const entries: Context[] = [];
  const seen = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let total: number | undefined;
  for (let page = 0; page < PAGES_MAX; page += 1) {
    const args = ['api', 'graphql', '-F', 'owner={owner}', '-F', 'name={repo}',
      '-F', `number=${subject.number}`, '-f', `query=${QUERY}`];
    if (cursor !== undefined) args.push('-f', `cursor=${cursor}`);
    const answer = parse(pageSchema, run(args));
    if (answer.errors !== undefined) return refuse('GraphQL returned errors');
    const pull = answer.data.repository.pullRequest;
    const commit = pull.commits.nodes[0]?.commit;
    if (pull.headRefOid !== subject.headSha || commit?.oid !== subject.headSha) {
      return refuse('the pull request head changed during check observation');
    }
    const contexts = commit.statusCheckRollup?.contexts;
    if (contexts === undefined) {
      if (page !== 0) return refuse('the check rollup disappeared during pagination');
      return [];
    }
    if (total !== undefined && total !== contexts.totalCount) return refuse('check count changed');
    total = contexts.totalCount;
    for (const entry of contexts.nodes) {
      if (seen.has(entry.id)) return refuse('duplicate check context during pagination');
      seen.add(entry.id); entries.push(entry);
    }
    if (!contexts.pageInfo.hasNextPage) {
      if (entries.length !== total) return refuse('incomplete check contexts');
      return entries;
    }
    const next = contexts.pageInfo.endCursor;
    if (!next || cursors.has(next) || contexts.nodes.length === 0) return refuse('invalid check cursor');
    cursors.add(next); cursor = next;
  }
  return refuse('check contexts exceed the bounded pagination window');
}
function readWorkflows(run: GhRunner, subject: CheckSubject): Workflow[] {
  const entries: Workflow[] = [];
  const seen = new Set<number>();
  let total: number | undefined;
  for (let page = 1; page <= PAGES_MAX; page += 1) {
    const query = `head_sha=${subject.headSha}&event=pull_request&per_page=100&page=${page}`;
    const result = parse(runsSchema, run(['api', `repos/{owner}/{repo}/actions/runs?${query}`]));
    if (total !== undefined && total !== result.total_count) return refuse('workflow count changed');
    total = result.total_count;
    for (const entry of result.workflow_runs) {
      if (seen.has(entry.id)) return refuse('duplicate workflow during pagination');
      seen.add(entry.id); entries.push(entry);
    }
    if (entries.length === total) return entries;
    if (entries.length > total || result.workflow_runs.length < 100) return refuse('incomplete workflows');
  }
  return refuse('workflow runs exceed the bounded pagination window');
}

/** Only a single, exact PR association proves invocation equivalence. */
function workflowKey(run: Workflow, subject: CheckSubject): string | undefined {
  const [pull] = run.pull_requests;
  if (run.event !== 'pull_request' || run.head_sha !== subject.headSha ||
      run.head_branch !== subject.headRef || run.pull_requests.length !== 1 ||
      pull?.number !== subject.number || pull.head.sha !== subject.headSha ||
      pull.head.ref !== subject.headRef || pull.base.ref !== subject.baseRef) return undefined;
  return JSON.stringify([run.workflow_id, run.event, pull.number,
    pull.head.repo.id, pull.head.ref, pull.head.sha,
    pull.base.repo.id, pull.base.ref, pull.base.sha]);
}
function stateOf(status: string, conclusion: string | undefined): CheckState {
  if (status !== 'COMPLETED') return 'pending';
  return conclusion !== undefined && PASSING.has(conclusion) ? 'passing' : 'failing';
}
function contextState(entry: Context): CheckState {
  if (entry.__typename === 'CheckRun') return stateOf(entry.status, entry.conclusion ?? undefined);
  if (entry.state === 'SUCCESS') return 'passing';
  return entry.state === 'PENDING' || entry.state === 'EXPECTED' ? 'pending' : 'failing';
}

/** Never infer rerun order within a suite or supersession for other event types. */
function selectContexts(entries: readonly Context[], runs: readonly Workflow[], subject: CheckSubject) {
  const keyed = entries.map((entry) => {
    if (entry.__typename !== 'CheckRun') return { entry, key: undefined, order: 0 };
    const matches = runs.filter((run) => run.check_suite_node_id === entry.checkSuite.id);
    const run = matches.length === 1 ? matches[0] : undefined;
    const workflow = entry.checkSuite.workflowRun;
    const scope = run === undefined ? undefined : workflowKey(run, subject);
    const key = scope === undefined || !entry.checkSuite.app || workflow?.event !== 'pull_request'
      ? undefined : JSON.stringify([entry.checkSuite.app.id, workflow.workflow.id, scope, entry.name]);
    return { entry, key, order: run?.run_number ?? 0 };
  });
  return keyed.filter((item) => item.key === undefined || !keyed.some((other) =>
    other.key === item.key && other.order > item.order)).map(({ entry }) => entry);
}

/** Read-only, bounded, and pinned to the metadata head used by every admission path. */
export function readCurrentChecks(run: GhRunner, subject: CheckSubject): CurrentChecks {
  const contexts = readContexts(run, subject);
  const workflows = readWorkflows(run, subject);
  const states = selectContexts(contexts, workflows, subject).map(contextState);
  // A newer workflow may still be queued before it has registered any jobs.
  for (const current of workflows) {
    const key = workflowKey(current, subject);
    if (key === undefined || workflows.some((other) =>
      workflowKey(other, subject) === key && other.run_number > current.run_number)) continue;
    states.push(stateOf(current.status.toUpperCase(), current.conclusion?.toUpperCase()));
  }
  if (states.includes('failing')) return 'failing';
  if (states.includes('pending')) return 'pending';
  return states.length === 0 ? 'none' : 'passing';
}
