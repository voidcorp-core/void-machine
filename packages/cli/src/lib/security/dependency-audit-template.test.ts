import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { isSeq, parseDocument } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const CORE = join(ROOT, 'packages/core/templates/github');
const SCRIPT = join(CORE, 'dependency-audit.mjs');
const advisory = { example: [{ id: 123, url: 'https://github.com/advisories/GHSA-example',
  title: 'Example vulnerability', severity: 'high', vulnerable_versions: '<2.0.0' }] };

function sequence(document: ReturnType<typeof parseDocument>, path: readonly string[]): unknown[] {
  const node = document.getIn(path, true);
  if (!isSeq(node)) throw new Error(`Missing workflow sequence: ${path.join('.')}`);
  return node.toJSON() as unknown[];
}

it.each([
  ['clean', 0, '{}', 0],
  ['vulnerabilities', 1, JSON.stringify(advisory), 1],
  ['unavailable', 1, '', 2],
  ['unavailable', 1, JSON.stringify({ error: 'service unavailable' }), 2],
  ['unavailable', 0, '<html>proxy error</html>', 2],
  ['unavailable', 0, '', 2],
  ['unavailable', 1, '{}', 2],
  ['unavailable', 0, JSON.stringify({ example: [{}] }), 2],
])('reports %s honestly for Bun exit %s and response %s', (state, bunExit, stdout, exitCode) => {
  const fixture = mkdtempSync(join(tmpdir(), 'void-dependency-audit-'));
  try {
    const bun = join(fixture, 'bun');
    writeFileSync(bun, `#!${process.execPath}\nif(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['audit','--json']))process.exit(99);process.stdout.write(${JSON.stringify(stdout)});process.exit(${bunExit});\n`);
    chmodSync(bun, 0o755);
    const summary = join(fixture, 'summary.md');
    const report = join(fixture, 'report');
    const observed = spawnSync(process.execPath, [SCRIPT, report], { cwd: fixture,
      env: { ...process.env, PATH: fixture, GITHUB_STEP_SUMMARY: summary }, encoding: 'utf8', timeout: 10_000 });
    expect(observed.status, observed.stderr).toBe(exitCode);
    expect(JSON.parse(readFileSync(join(report, 'result.json'), 'utf8'))).toMatchObject({ state, exitCode });
    expect(readFileSync(summary, 'utf8')).toContain(state);
  } finally {
    rmSync(fixture, { recursive: true });
  }
});

it('ships a bounded dependency-audit job independently from quality, preserving failure artifacts', () => {
  const source = readFileSync(join(CORE, 'void-dependency-audit.yml'), 'utf8');
  const document = parseDocument(source, { strict: true, uniqueKeys: true });
  expect(document.errors).toEqual([]);
  expect(document.getIn(['jobs', 'dependency-audit', 'needs'])).toBeUndefined();
  expect(document.getIn(['jobs', 'quality'])).toBeUndefined();
  expect(document.getIn(['jobs', 'dependency-audit', 'continue-on-error'])).toBeUndefined();
  expect(document.getIn(['jobs', 'dependency-audit', 'timeout-minutes'])).toBeLessThanOrEqual(10);
  expect(source).toContain('dependency-audit.mjs');
  const steps = sequence(document, ['jobs', 'dependency-audit', 'steps']) as {
    id?: string; run?: string; uses?: string; if?: string;
  }[];
  const admissionIndex = steps.findIndex(step => step.id === 'admission');
  expect(admissionIndex).toBeGreaterThanOrEqual(0);
  expect(steps[admissionIndex]?.run).toBe('node .github/scripts/ci-admission.mjs');
  expect(steps.findIndex(step => step.uses?.startsWith('oven-sh/setup-bun@')))
    .toBeGreaterThan(admissionIndex);
  const condition = steps.find(step => step.uses?.startsWith('actions/upload-artifact@'))?.if;
  expect(condition).toBeDefined();
  for (const outcome of ['success', 'failure', 'skipped']) {
    const admitted = runInNewContext(condition?.slice(3, -2) ?? '', {
      always: () => true, steps: { admission: { outcome } },
    }, { timeout: 100 });
    expect(admitted, outcome).toBe(outcome === 'success');
  }
  expect(source).toMatch(/actions\/upload-artifact@[a-f0-9]{40}/);
  expect(source).not.toMatch(/bun (?:run audit|install)|\|\| true/);
  for (const line of source.split('\n').filter(line => line.includes('uses:'))) {
    expect(line).toMatch(/@[a-f0-9]{40}\s+# v\d/);
  }
});

it('distributes the exact workflow and wrapper through the existing core-assets copier', () => {
  expect(existsSync(SCRIPT)).toBe(true);
  // Run the actual copier; no consumer install, build, network or lifecycle scripts.
  // It copies into a private directory, never into packages/cli/core-assets: the
  // copier empties its target before refilling it, and findCoreSource() reads that
  // directory first, so a copy there made concurrent mission tests read a
  // half-built core (ENOENT on policies/, profiles/, specialists/).
  const target = join(mkdtempSync(join(tmpdir(), 'void-core-assets-')), 'core-assets');
  try {
    execFileSync(process.execPath, ['packages/cli/scripts/copy-core-assets.mjs', target], {
      cwd: ROOT,
    });
    for (const name of ['dependency-audit.mjs', 'void-dependency-audit.yml']) {
      expect(readFileSync(join(target, 'templates/github', name)))
        .toEqual(readFileSync(join(CORE, name)));
    }
  } finally {
    rmSync(dirname(target), { recursive: true, force: true });
  }
});

it('audits new advisories periodically without depending on a lockfile change', () => {
  const document = parseDocument(readFileSync(join(CORE, 'void-dependency-audit.yml'), 'utf8'));
  expect(sequence(document, ['on', 'schedule'])).toEqual([{ cron: '17 4 * * 1' }]);
  expect(document.getIn(['on', 'pull_request', 'paths'])).toBeUndefined();
  expect(document.getIn(['on', 'pull_request', 'paths-ignore'])).toBeUndefined();
  expect(sequence(document, ['on', 'pull_request', 'types']))
    .toEqual(expect.arrayContaining(['ready_for_review', 'converted_to_draft']));
  expect(sequence(document, ['on', 'merge_group', 'types'])).toEqual(['checks_requested']);
  expect(document.getIn(['jobs', 'dependency-audit', 'if'])).toBeUndefined();
  expect(document.getIn(['jobs', 'dependency-audit', 'steps', 0, 'with', 'ref']))
    .toBe(`\${{ github.event.pull_request.head.sha || github.sha }}`);
});
