import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { isSeq, parseDocument } from 'yaml';

const ROOT = resolve(import.meta.dirname, '../../../..');
const REFERENCES = join(ROOT, 'packages/core/src/skills/void-verify/references');
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

function evaluate(value: unknown, github: object, extra: Record<string, unknown> = {}): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{\{([\s\S]*?)\}\}/g, (_match, expression: string) =>
    String(runInNewContext(expression, { github, ...extra }, { timeout: 100 })));
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
  it('refuses drafts before producer setup or pack work', () => {
    const steps = sequence(workflow('.github/workflows/ci.yml'), ['jobs', 'consumer-artifact', 'steps']) as { run?: string; uses?: string }[];
    const admissionIndex = steps.findIndex(step => step.run?.includes('ci-admission.mjs'));
    const installIndex = steps.findIndex(step => step.run?.includes('pnpm install'));
    const packIndex = steps.findIndex(step => step.run?.includes('conformance:pack'));
    expect(admissionIndex).toBeGreaterThanOrEqual(0);
    expect(installIndex).toBeGreaterThan(admissionIndex);
    expect(packIndex).toBeGreaterThan(installIndex);
    expect(admission('pull_request', contexts.draft.event).status).toBe(1);
    expect(admission('pull_request', contexts.ready.event).status).toBe(0);
  });

  it.each(['success', 'failure', 'skipped'])('keeps required validation admitted after producer %s unless cancelled', result => {
    const ci = workflow('.github/workflows/ci.yml');
    expect(ci.getIn(['jobs', 'validate', 'needs'])).toBe('consumer-artifact');
    const condition = ci.getIn(['jobs', 'validate', 'if']);
    for (const cancelled of [false, true]) {
      expect(evaluate(condition, contexts.draft, {
        needs: { 'consumer-artifact': { result } }, cancelled: () => cancelled,
      })).toBe(String(!cancelled));
    }
    // Draft refusal still executes inside the admitted required job.
    expect(admission('pull_request', contexts.draft.event).status).toBe(1);
  });

  it.each([
    '.github/workflows/ci.yml', '.github/workflows/void-enforce.yml',
    'packages/core/src/skills/void-verify/references/quality.yml',
    'packages/core/src/templates/github/void-dependency-audit.yml',
  ])('%s starts fresh on ready and cancels only obsolete PR runs', (name) => {
    const ci = workflow(name);
    const types = sequence(ci, ['on', 'pull_request', 'types']);
    expect(types).toEqual(expect.arrayContaining(['ready_for_review', 'converted_to_draft', 'synchronize', 'edited']));
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

  it('keeps caller readiness and concurrency in the documented reusable workflow adoption', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    const example = readme.match(/```yaml\n(name: void-enforce\n[\s\S]*?)```/)?.[1];
    expect(example).toBeDefined();
    const caller = parseDocument(example ?? '', { uniqueKeys: true });
    expect(caller.errors).toEqual([]);
    expect(sequence(caller, ['on', 'pull_request', 'types']))
      .toEqual(expect.arrayContaining(['ready_for_review', 'converted_to_draft']));
    expect(sequence(caller, ['on', 'merge_group', 'types'])).toEqual(['checks_requested']);
    expect(caller.getIn(['jobs', 'enforce', 'if'])).toBeUndefined();
    expect(caller.getIn(['jobs', 'enforce', 'uses'])).toMatch(/enforce\.yml@<full-sha>$/);
    const group = caller.getIn(['concurrency', 'group']);
    const cancel = caller.getIn(['concurrency', 'cancel-in-progress']);
    expect(evaluate(group, { ...contexts.draft, workflow: 'void-enforce' }))
      .toBe(evaluate(group, { ...contexts.ready, workflow: 'void-enforce' }));
    expect(evaluate(cancel, contexts.ready)).toBe('true');
    for (const context of [contexts.queue, contexts.manual, contexts.push]) {
      expect(evaluate(cancel, context)).toBe('false');
      expect(evaluate(group, { ...context, workflow: 'void-enforce' }))
        .not.toBe(evaluate(group, { ...context, workflow: 'void-enforce', run_id: 999 }));
    }
    const reusable = workflow('.github/workflows/enforce.yml');
    expect(reusable.getIn(['concurrency'])).toBeUndefined();
    expect(reusable.getIn(['jobs', 'enforce', 'concurrency'])).toBeUndefined();
  });

  it('admits reusable enforcement with immutable code before setup and floor execution', () => {
    const reusable = workflow('.github/workflows/enforce.yml');
    expect(reusable.getIn(['jobs', 'enforce', 'timeout-minutes'])).toBeLessThanOrEqual(10);
    expect(reusable.getIn(['jobs', 'enforce', 'if'])).toBeUndefined();
    const steps = sequence(reusable, ['jobs', 'enforce', 'steps']) as {
      run?: string; uses?: string; with?: Record<string, string>; 'continue-on-error'?: boolean;
    }[];
    const admissionIndex = steps.findIndex(step => step.run?.includes('ci-admission.mjs'));
    expect(admissionIndex).toBeGreaterThanOrEqual(0);
    expect(steps[admissionIndex]?.run).toBe(
      'node .void-enforce-runtime/packages/core/src/skills/void-verify/references/ci-admission.mjs',
    );
    expect(steps[admissionIndex]?.['continue-on-error']).toBeUndefined();
    const implementationIndex = steps.findIndex(step => step.with?.path === '.void-enforce-runtime');
    expect(implementationIndex).toBeLessThan(admissionIndex);
    expect(steps[implementationIndex]?.with?.ref).toBe(`\${{ job.workflow_sha }}`);
    expect(steps.findIndex(step => step.uses?.startsWith('actions/setup-node@')))
      .toBeGreaterThan(admissionIndex);
    expect(steps.findIndex(step => step.uses?.endsWith('/.github/actions/void-enforce')))
      .toBeGreaterThan(admissionIndex);
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
      ['packages/core/src/skills/void-verify/references/quality.yml', 'quality'],
    ] as const) {
      const ci = workflow(path);
      expect(ci.getIn(['jobs', id, 'if'])).toBe(id === 'validate' ? `\${{ !cancelled() }}` : undefined);
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

  it.each(['merge_group', 'workflow_dispatch', 'push', 'schedule'])('admits %s to real validation', (name) => {
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


describe('native CI failure and applicability', () => {
  const ci = workflow('.github/workflows/ci.yml');
  const producerSteps = sequence(ci, ['jobs', 'consumer-artifact', 'steps']) as { name?: string; id?: string; run?: string; env?: Record<string, string>; 'continue-on-error'?: boolean }[];
  const guard = producerSteps.find(step => step.name === 'Require every applicable cheap check');
  it.each(['failure', 'skipped', 'cancelled', ''])('refuses %s for an applicable cheap check despite continue-on-error', outcome => {
    const steps = Object.fromEntries(['references', 'version', 'structure', 'lint'].map(id => [id, { outcome: 'success' }]));
    steps.lint = { outcome };
    const passed = evaluate(guard?.env?.CHECKS_PASSED, {}, { steps: { ...steps, impact: { outputs: { docs: 'false', version: 'true' } } } });
    const result = spawnSync('bash', ['-e', '-c', guard?.run ?? 'exit 99'], { env: { CHECKS_PASSED: String(passed) } });
    expect(result.status).not.toBe(0);
  });
  it.each(['false', 'true', '', undefined])('requires version evidence unless explicitly inapplicable (%j)', version => {
    const versionStep = producerSteps.find(step => step.id === 'version') as { if?: string } | undefined;
    for (const outcome of ['success', 'failure', 'skipped', 'cancelled', '']) {
      const steps = {
        ...Object.fromEntries(['references', 'structure', 'lint'].map(id => [id, { outcome: 'success' }])),
        version: { outcome }, impact: { outputs: { docs: 'false', version } },
      };
      expect(evaluate(versionStep?.if, {}, { steps })).toBe(String(version !== 'false'));
      expect(evaluate(guard?.env?.CHECKS_PASSED, {}, { steps })).toBe(String(version === 'false' || outcome === 'success'));
    }
  });
  it('separates docs non-applicability from missing required test evidence', () => {
    const steps = { references: { outcome: 'success' }, impact: { outputs: { docs: 'true', version: 'false' } } };
    expect(evaluate(guard?.env?.CHECKS_PASSED, {}, { steps })).toBe('true');
    const buildIndex = producerSteps.findIndex(step => step.run?.includes('conformance:pack'));
    expect(producerSteps.indexOf(guard ?? {})).toBeLessThan(buildIndex);
    expect(producerSteps.filter(step => step['continue-on-error']).map(step => step.id)).toEqual(['references', 'version', 'structure', 'lint']);
  });
  it.each(['failure', 'skipped', 'cancelled', ''])('required validation refuses producer %s', result => {
    const steps = sequence(ci, ['jobs', 'validate', 'steps']) as { run?: string }[];
    expect(spawnSync('bash', ['-e', '-c', steps[0]?.run ?? 'exit 99'], { env: { PREPARATION_RESULT: result } }).status).not.toBe(0);
  });
  it('preserves all required OS identities while scheduling only applicable work', () => {
    for (const [id, os] of [['install-linux', 'ubuntu'], ['install-macos', 'macos'], ['install-windows', 'windows']] as const) {
      expect(ci.getIn(['jobs', id, 'name'])).toBe(`install conformance (${os}-latest)`);
      const nativeCondition = String(ci.getIn(['jobs', id, 'if'])).replaceAll('consumer-artifact', 'producer');
      for (const [consumer, crossPlatform, expected] of [[false, false, false], [true, false, os === 'ubuntu'], [true, true, true]]) {
        expect(evaluate(nativeCondition, {}, { needs: { producer: { outputs: { consumer: String(consumer), crossPlatform: String(crossPlatform) } } } })).toBe(String(expected));
      }
      // Alias resolution is native YAML, not generated duplication or a matrix losing names.
      const resolved = ci.toJS().jobs[id].steps as { run?: string }[];
      expect(resolved.some(step => step.run?.startsWith('pnpm conformance:consumer '))).toBe(true);
    }
  });
  it('binds develop head, combined merge group, and current main candidate separately', () => {
    const value = ci.getIn(['env', 'GATE_SHA']);
    const head = 'a'.repeat(40), combined = 'b'.repeat(40);
    const event = (base: string) => ({ event: { pull_request: { base: { ref: base }, head: { sha: head } } }, sha: combined });
    expect(evaluate(value, event('develop'))).toBe(head);
    expect(evaluate(value, event('main'))).toBe(combined);
    expect(evaluate(value, { event: { pull_request: { base: {}, head: {} } }, sha: combined })).toBe(combined);
  });
});
