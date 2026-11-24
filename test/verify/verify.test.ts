import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script
import { GATES, parseArgs, parseNameStatus, selectGates, selectImpact, ciImpact } from '../../scripts/verify.mjs';
const ids = (changes: object[]) => selectGates(changes).map((gate: { id: string }) => gate.id);
const all = GATES.map((gate: { id: string }) => gate.id);

describe('bounded native impact selection', () => {
  it('keeps explanatory Markdown narrow and product Markdown broad', () => {
    expect(ids([{ path: 'docs/guides/consumer.md' }])).toEqual(['skill-references']);
    for (const path of ['packages/core/src/skills/void-tdd/SKILL.md', 'docs/example.ts']) expect(ids([{ path }])).toEqual(all);
  });
  it.each(['pnpm-lock.yaml', 'package.json', '.github/workflows/ci.yml', 'test/support/setup.ts',
    'packages/cli/src/commands/init.ts', 'packages/core/src/data/identity.json', 'unknown/file.ts', 'packages/unknown/value.test.ts'])('broadens %s', path => {
    expect(selectImpact([{ path }])).toMatchObject({ engine: true, local: true, network: true, consumer: true, crossPlatform: true });
  });
  it('selects an existing test project without dropping source dependents', () => {
    expect(selectImpact([{ path: 'packages/mission-engine/src/risk/value.test.ts' }])).toMatchObject({ engine: true, local: false, network: false, crossPlatform: false });
    expect(selectImpact([{ path: 'packages/mission-engine/src/risk/value.ts' }])).toMatchObject({ engine: true, local: true, network: true, consumer: true, crossPlatform: false });
    expect(selectImpact([{ path: 'test/verify/verify.test.ts' }])).toMatchObject({ engine: false, local: true, network: false });
    expect(selectImpact([{ path: 'packages/cli/src/lib/ui/server.test.ts' }])).toMatchObject({ engine: false, local: false, network: true });
  });
  it.each([
    [], [{}], [{ path: '', status: 'modified' }], [{ path: 'docs/new.md', previousPath: 'packages/core/src/old.md', status: 'renamed' }],
    [{ path: 'docs/deleted.md', status: 'deleted' }],
  ].map(changes => [changes]))('fails conservative for incomplete or structurally changed input %j', changes => expect(ids(changes)).toEqual(all));
  it('parses both rename paths and deletion, rejecting incomplete records', () => {
    expect(parseNameStatus('R100\0old\0new\0D\0removed\0')).toEqual([
      { path: 'new', previousPath: 'old', status: 'renamed' }, { path: 'removed', status: 'deleted' },
    ]);
    expect(parseNameStatus('R100\0old')).toEqual([]);
    expect(parseNameStatus('M\0')).toEqual([]);
    expect(parseNameStatus('unexpected\0file\0')).toEqual([]);
  });
  it('forces complete promotion and fails broad on unavailable event input', () => {
    const changes = [{ path: 'docs/guide.md' }];
    expect(ciImpact('pull_request', { pull_request: { base: { ref: 'develop', sha: 'a'.repeat(40) } } }, changes).consumer).toBe(false);
    expect(ciImpact('merge_group', { merge_group: { base_sha: 'a'.repeat(40) } }, changes).consumer).toBe(false);
    for (const event of ['push', 'workflow_dispatch']) expect(ciImpact(event, {}, changes).crossPlatform).toBe(true);
    expect(ciImpact('pull_request', { pull_request: { base: { ref: 'main' } } }, changes).crossPlatform).toBe(true);
    expect(ciImpact('pull_request', {}, changes).crossPlatform).toBe(true);
  });
});

describe('local verification arguments', () => {
  it('retains useful local selection and refuses removed CI report options', () => {
    expect(parseArgs(['--changed-from', 'HEAD~1', '--list'])).toMatchObject({ changedFrom: 'HEAD~1', list: true, unknown: [] });
    expect(parseArgs(['--aggregate']).unknown).toEqual(['--aggregate']);
    expect(parseArgs(['--report', 'file']).unknown).toContain('--report');
    expect(parseArgs(['--gate', 'lint']).gateId).toBe('lint');
  });
});
