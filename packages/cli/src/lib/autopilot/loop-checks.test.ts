import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readCurrentChecks } from './loop-checks.js';

type Raw = Record<string, unknown>;
type Check = Raw & {
  id: string; name: string; status: string; conclusion: string | null;
  checkSuite: { id: string; app: { id: string }; workflowRun: { event: string; workflow: { id: string } } };
};
type Contexts = { nodes: Check[]; totalCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
type Capture = { data: { repository: { pullRequest: { headRefOid: string; commits: { nodes: { commit: { oid: string; statusCheckRollup: { contexts: Contexts } | null } }[] } } } } };
type Workflow = Raw & {
  id: number; workflow_id: number; run_number: number; check_suite_node_id: string;
  status: string; conclusion: string | null; event: string; head_branch: string;
  pull_requests: { number: number; head: Raw; base: Raw }[];
};
// allow-null: fixtures deliberately exercise GitHub's nullable wire fields.
function present<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('captured fixture value is missing');
  return value;
}
const fixture = (name: string): string => readFileSync(new URL(`./__fixtures__/gh/${name}`, import.meta.url), 'utf8');
const capture = (): Capture => JSON.parse(fixture('pr-current-checks.json')) as Capture;
const workflows = (): { total_count: number; workflow_runs: Workflow[] } => JSON.parse(fixture('pr-workflow-runs.json'));
const contextsOf = (data: Capture): Contexts => present(present(data.data.repository.pullRequest.commits.nodes[0]).commit.statusCheckRollup).contexts;
const subject = { number: 533, headSha: '337641aff1fda56b427254d39741230d153e86c8', headRef: 'fix/dev-1141-certification', baseRef: 'develop' };
function read(data = capture(), runs = workflows()) {
  return readCurrentChecks((args) => JSON.stringify(args.includes('graphql') ? data : runs), subject);
}
const latestValidate = (data: Capture): Check => present(contextsOf(data).nodes.find((node) => node.name === 'validate' && node.conclusion === 'SUCCESS'));

describe('readCurrentChecks', () => {
  it('replaces real draft failures by ready successes on the same PR head', () => {
    expect(read()).toBe('passing');
  });
  it.each(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'])('keeps current %s blocking', (conclusion) => {
    const data = capture(); latestValidate(data).conclusion = conclusion;
    expect(read(data)).toBe('failing');
  });
  it('keeps a newer queued check pending even without a start time', () => {
    const data = capture(); const current = latestValidate(data);
    current.status = 'QUEUED'; current.conclusion = null; current.startedAt = null;
    expect(read(data)).toBe('pending');
  });
  it('keeps a current workflow pending before it creates replacement jobs', () => {
    const data = capture(); const runs = workflows();
    const current = present(runs.workflow_runs.find((run) => run.run_number === 1618));
    current.status = 'queued'; current.conclusion = null;
    const contexts = contextsOf(data);
    contexts.nodes = contexts.nodes.filter((node) => node.checkSuite.id !== current.check_suite_node_id);
    contexts.totalCount = contexts.nodes.length;
    expect(read(data, runs)).not.toBe('passing');
  });
  it.each(['app', 'workflow', 'event', 'branch', 'pr', 'base'])('keeps independent %s identities', (field) => {
    const data = capture(); const runs = workflows(); const check = latestValidate(data);
    const run = present(runs.workflow_runs.find((run) => run.check_suite_node_id === check.checkSuite.id));
    if (field === 'app') check.checkSuite.app.id = 'another-app';
    if (field === 'workflow') { check.checkSuite.workflowRun.workflow.id = 'another-workflow'; run.workflow_id += 1; }
    if (field === 'event') { check.checkSuite.workflowRun.event = 'workflow_dispatch'; run.event = 'workflow_dispatch'; }
    if (field === 'branch') run.head_branch = 'another-branch';
    if (field === 'pr') present(run.pull_requests[0]).number = 534;
    if (field === 'base') present(run.pull_requests[0]).base.ref = 'another-base';
    expect(read(data, runs)).not.toBe('passing');
  });
  it('never lets a later finish or start override run order', () => {
    const data = capture();
    const old = present(contextsOf(data).nodes.find((node) => node.name === 'validate' && node.conclusion === 'FAILURE'));
    old.startedAt = '2099-01-01T00:00:00Z'; old.completedAt = '2099-01-02T00:00:00Z';
    expect(read(data)).toBe('passing');
  });
  it('retains ambiguous jobs within one workflow run', () => {
    const data = capture(); const current = latestValidate(data); const contexts = contextsOf(data);
    contexts.nodes.push({ ...current, id: 'same-suite-other-check', conclusion: 'FAILURE' });
    contexts.totalCount += 1;
    expect(read(data)).toBe('failing');
  });
  it('retains checks when a workflow association is absent', () => {
    const runs = workflows(); runs.workflow_runs.forEach((run) => { run.pull_requests = []; });
    expect(read(capture(), runs)).toBe('failing');
  });
  it('preserves no-check repositories', () => {
    const data = capture(); present(data.data.repository.pullRequest.commits.nodes[0]).commit.statusCheckRollup = null;
    expect(read(data, { total_count: 0, workflow_runs: [] })).toBe('none');
  });
  it.each(['SUCCESS', 'PENDING', 'EXPECTED', 'ERROR', 'FAILURE'])('preserves classic status %s', (state) => {
    const data = capture(); const contexts = contextsOf(data);
    const nodes = [{ __typename: 'StatusContext', id: 'status-id', context: 'legacy', state }];
    contexts.totalCount = 1;
    const text = JSON.stringify(data).replace(JSON.stringify(contexts.nodes), JSON.stringify(nodes));
    expect(read(JSON.parse(text) as Capture, { total_count: 0, workflow_runs: [] }))
      .toBe(state === 'SUCCESS' ? 'passing' : ['PENDING', 'EXPECTED'].includes(state) ? 'pending' : 'failing');
  });
  it.each(['head', 'count', 'errors', 'shape', 'repeat'])('refuses incomplete or unknown %s', (kind) => {
    const data = capture(); const contexts = contextsOf(data);
    if (kind === 'head') data.data.repository.pullRequest.headRefOid = 'a'.repeat(40);
    if (kind === 'count') contexts.totalCount += 1;
    if (kind === 'shape') delete (latestValidate(data) as Raw).status;
    if (kind === 'repeat') present(contexts.nodes[1]).id = present(contexts.nodes[0]).id;
    const answer = kind === 'errors' ? { ...data, errors: [{ message: 'partial' }] } : data;
    expect(() => readCurrentChecks(() => JSON.stringify(answer), subject)).toThrow();
  });
  it('reads every context page and refuses repeated cursors', () => {
    const data = capture(); const nodes = contextsOf(data).nodes; let page = 0;
    const run = (args: readonly string[]): string => {
      if (!args.includes('graphql')) return JSON.stringify(workflows());
      const current = capture(); const contexts = contextsOf(current); const index = page++;
      contexts.nodes = nodes.slice(index * 8, (index + 1) * 8);
      contexts.pageInfo = { hasNextPage: index === 0, endCursor: `page-${index}` };
      return JSON.stringify(current);
    };
    expect(readCurrentChecks(run, subject)).toBe('passing'); expect(page).toBe(2);
    const repeated = capture(); contextsOf(repeated).pageInfo.hasNextPage = true;
    expect(() => readCurrentChecks(() => JSON.stringify(repeated), subject)).toThrow();
  });
  it('reads every workflow page and refuses duplicate workflow IDs', () => {
    const runs = workflows();
    const seed = present(runs.workflow_runs[0]);
    const additional = Array.from({ length: 97 }, (_, index) => ({
      ...seed, id: 1000 + index, check_suite_node_id: `extra-suite-${index}`, pull_requests: [],
    }));
    const all = [...runs.workflow_runs, ...additional]; let pages = 0;
    const run = (args: readonly string[]): string => {
      if (args.includes('graphql')) return JSON.stringify(capture());
      const index = pages++;
      return JSON.stringify({ total_count: all.length, workflow_runs: all.slice(index * 100, (index + 1) * 100) });
    };
    expect(readCurrentChecks(run, subject)).toBe('passing'); expect(pages).toBe(2);
    present(runs.workflow_runs[1]).id = seed.id;
    expect(() => read(capture(), runs)).toThrow(/duplicate workflow/);
  });
  it('refuses an unbounded context history at ten pages', () => {
    let calls = 0;
    const run = (): string => {
      const data = capture(); const contexts = contextsOf(data); const seed = present(contexts.nodes[0]);
      const page = calls++;
      contexts.nodes = Array.from({ length: 100 }, (_, index) => ({ ...seed, id: `page-${page}-${index}` }));
      contexts.totalCount = 1001;
      contexts.pageInfo = { hasNextPage: true, endCursor: `page-${page}` };
      return JSON.stringify(data);
    };
    expect(() => readCurrentChecks(run, subject)).toThrow(/bounded pagination/);
    expect(calls).toBe(10);
  });
  it('refuses truncated workflow history', () => {
    const runs = workflows(); runs.total_count += 1;
    expect(() => read(capture(), runs)).toThrow();
  });
});
