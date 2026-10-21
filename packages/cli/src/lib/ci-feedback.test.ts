import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { isSeq, parseDocument } from 'yaml';

const ROOT = resolve(import.meta.dirname, '../../../..');
const REFERENCES = join(ROOT, 'packages/core/skills/void-verify/references');
const contexts = {
  draft: { event_name: 'pull_request', event: { pull_request: { number: 7, draft: true } }, run_id: 10 },
  ready: { event_name: 'pull_request', event: { pull_request: { number: 7, draft: false } }, run_id: 11 },
  queue: { event_name: 'merge_group', event: { pull_request: {} }, run_id: 12 },
  manual: { event_name: 'workflow_dispatch', event: { pull_request: {} }, run_id: 13 },
  push: { event_name: 'push', event: { pull_request: {} }, run_id: 14 },
};

function workflow(path: string) {
  const document = parseDocument(readFileSync(join(ROOT, path), 'utf8'), { uniqueKeys: true });
  expect(document.errors).toEqual([]);
  return document;
}

function sequence(document: ReturnType<typeof workflow>, path: readonly string[]): unknown[] {
  const node = document.getIn(path, true);
  if (!isSeq(node)) throw new Error(`Missing workflow sequence: ${path.join('.')}`);
  return node.toJSON() as unknown[];
}

function evaluate(value: unknown, github: object): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{\{([\s\S]*?)\}\}/g, (_match, expression: string) =>
    String(runInNewContext(expression, { github }, { timeout: 100 })));
}

function admission(eventName: string, event: object) {
  const fixture = mkdtempSync(join(tmpdir(), 'void-ci-event-'));
  try {
    const eventPath = join(fixture, 'event.json');
    writeFileSync(eventPath, JSON.stringify(event));
    return spawnSync(process.execPath, [join(REFERENCES, 'ci-admission.mjs')], {
      env: { GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath },
      encoding: 'utf8', timeout: 5_000,
    });
  } finally { rmSync(fixture, { recursive: true, force: true }); }
}

describe('development feedback and integration admission', () => {
  it('does not schedule heavy work for drafts, and restores it for the same ready head', () => {
    const ci = workflow('.github/workflows/ci.yml');
    for (const job of ['consumer-artifact', 'project-graph-conformance', 'node-current']) {
      const condition = ci.getIn(['jobs', job, 'if']);
      expect(evaluate(condition, contexts.draft), job).toBe('false');
      for (const context of [contexts.ready, contexts.queue, contexts.manual, contexts.push]) {
        expect(evaluate(condition, context), job).toBe('true');
      }
    }
    expect(ci.getIn(['jobs', 'validate', 'if'])).toBeUndefined();
  });

  it.each(['ci.yml', 'void-enforce.yml'])('%s starts fresh on ready and cancels only obsolete PR runs', (name) => {
    const ci = workflow(`.github/workflows/${name}`);
    const types = sequence(ci, ['on', 'pull_request', 'types']);
    expect(types).toEqual(expect.arrayContaining(['ready_for_review', 'converted_to_draft', 'synchronize']));
    const group = ci.getIn(['concurrency', 'group']);
    const cancel = ci.getIn(['concurrency', 'cancel-in-progress']);
    expect(evaluate(group, { ...contexts.draft, workflow: name }))
      .toBe(evaluate(group, { ...contexts.ready, workflow: name }));
    expect(evaluate(cancel, contexts.ready)).toBe('true');
    for (const context of [contexts.queue, contexts.push, contexts.manual]) {
      expect(evaluate(cancel, context)).toBe('false');
      expect(evaluate(group, { ...context, workflow: name }))
        .not.toBe(evaluate(group, { ...context, workflow: name, run_id: 999 }));
    }
  });

  it('keeps queue/main/manual validation without the develop post-merge duplicate', () => {
    const ci = workflow('.github/workflows/ci.yml');
    expect(sequence(ci, ['on', 'push', 'branches'])).toEqual(['main']);
    expect(sequence(ci, ['on', 'merge_group', 'types'])).toEqual(['checks_requested']);
    expect(ci.hasIn(['on', 'workflow_dispatch'])).toBe(true);
    expect(sequence(workflow('.github/workflows/promotion.yml'), ['on', 'push', 'branches']))
      .toEqual(['develop']);
  });

  it('keeps admission inside required jobs before dependencies, including the consumer template', () => {
    for (const [path, id] of [
      ['.github/workflows/ci.yml', 'validate'],
      ['.github/workflows/void-enforce.yml', 'enforce'],
      ['packages/core/skills/void-verify/references/quality.yml', 'quality'],
    ] as const) {
      const ci = workflow(path);
      expect(ci.getIn(['jobs', id, 'if'])).toBeUndefined();
      const steps = sequence(ci, ['jobs', id, 'steps']) as {
        run?: string; uses?: string; 'continue-on-error'?: boolean;
      }[];
      const admissionIndex = steps.findIndex((step) => step.run?.includes('ci-admission.mjs'));
      expect(admissionIndex).toBeGreaterThanOrEqual(0);
      expect(steps[admissionIndex]?.['continue-on-error']).toBeUndefined();
      expect(steps.slice(0, admissionIndex).some((step) => /install|npm ci/.test(step.run ?? ''))).toBe(false);
      expect(steps.slice(admissionIndex + 1).some((step) => /install|npm ci/.test(step.run ?? ''))).toBe(true);
    }
  });

  it('proves delivered skill admission rather than merely shipping an inaccessible asset', async () => {
    // @ts-expect-error dependency-free ESM conformance helper
    const { proveInstalledCiAdmission } = await import('../../scripts/conformance-install.mjs');
    const project = mkdtempSync(join(tmpdir(), 'void-ci-install-'));
    try {
      // An absent installed skill is an installation failure, not successful CI adoption.
      await expect(proveInstalledCiAdmission(project, '.agents', {})).rejects.toThrow();
    } finally { rmSync(project, { recursive: true, force: true }); }
  });

  it('refuses drafts explicitly without calling them failed tests', () => {
    const result = admission('pull_request', contexts.draft.event);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('CI_DEFERRED_DRAFT');
    expect(result.stderr).toContain('ready for review');
  });

  it.each(['opened', 'synchronize', 'reopened', 'ready_for_review'])('admits ready %s without changing the SHA', (action) => {
    const result = admission('pull_request', { ...contexts.ready.event, action });
    expect(result.status, result.stderr).toBe(0);
  });

  it.each(['merge_group', 'workflow_dispatch', 'push'])('admits %s to real validation', (name) => {
    const result = admission(name, {});
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([['pull_request', {}], ['pull_request', { pull_request: { draft: 'false' } }], ['unknown', {}]])(
    'refuses malformed or unsupported admission %s %j', (name, event) => {
      const result = admission(name, event);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('CI_INVALID_EVENT');
    });
});
