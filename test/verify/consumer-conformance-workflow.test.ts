import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..');
const workflow = readFileSync(resolve(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

function job(id: string): string {
  const start = workflow.indexOf(`  ${id}:\n`);
  if (start < 0) return '';
  const next = /^ {2}[a-z][a-z0-9-]+:\s*$/gm;
  next.lastIndex = start + id.length + 4;
  const match = next.exec(workflow);
  return workflow.slice(start, match?.index ?? workflow.length);
}

describe('packed consumer CI topology', () => {
  it('packs once and fans the same immutable artifact out to every operating system', () => {
    const producer = job('consumer-artifact');
    const consumers = job('install-conformance');
    expect(producer).not.toBe('');
    expect(consumers).toContain('needs: consumer-artifact');

    expect(producer.match(/conformance:pack/g) ?? []).toHaveLength(1);
    expect(producer).toContain('actions/upload-artifact@');
    expect(consumers).toContain('actions/download-artifact@');
    expect(consumers).toContain('conformance:consumer');
    const installSteps = consumers.split('      - ').filter(step => step.includes('run: pnpm install'));
    expect(installSteps).toHaveLength(1);
    expect(installSteps[0]).toContain("if: ${{ runner.os == 'Windows' }}");
    expect(installSteps[0]).toContain('run: pnpm install --frozen-lockfile');
    const regression = 'run: pnpm exec vitest run packages/cli/scripts/conformance-native-capture.test.ts --maxWorkers=1';
    const regressionSteps = consumers.split('      - ').filter(step => step.includes(regression));
    expect(regressionSteps).toHaveLength(1);
    expect(regressionSteps[0]).toContain("if: ${{ runner.os == 'Windows' }}");
    expect(consumers.indexOf('run: pnpm install --frozen-lockfile')).toBeLessThan(consumers.indexOf(regression));
    expect(consumers.indexOf(regression)).toBeLessThan(consumers.indexOf('conformance-native-capture.mjs --preflight'));
    expect(consumers).toContain('os: [ubuntu-latest, macos-latest, windows-latest]');
    expect(consumers).not.toContain('pnpm pack');
  });

  it('prepares ProjectGraph workspace types before isolated test and typecheck steps', () => {
    const graph = job('project-graph-conformance');

    expect(graph).toContain('pnpm --filter "@voidcorp/harness-graph^..." build');
    expect(graph).toContain('name: ProjectGraph tests');
    expect(graph).toContain('name: ProjectGraph typecheck');
    expect(graph).not.toContain('name: ProjectGraph tests and typecheck');
  });

  it('tests the packed document on a disposable runner and retains its review evidence', () => {
    const browser = job('browser-conformance');
    expect(browser).toContain('needs: consumer-artifact');
    expect(browser).toContain('runs-on: ubuntu-24.04');
    expect(browser).toContain('contents: read');
    expect(browser).toContain('persist-credentials: false');
    expect(browser).toContain('actions/download-artifact@');
    expect(browser).toContain('node test/browser/prepare.mjs');
    expect(browser).toContain('npm install --ignore-scripts --no-audit --no-fund --package-lock=false');
    expect(browser).toContain('node node_modules/@playwright/test/cli.js test');
    expect(browser).toContain('if: ${{ !cancelled() }}');
    expect(browser).toContain('actions/upload-artifact@');
    expect(browser).toContain('if-no-files-found: error');
    expect(browser).toContain('browser-evidence-${{ env.GATE_SHA }}');
    expect(browser).not.toContain('continue-on-error');
    expect(browser).not.toContain('pnpm conformance:pack');
    expect(browser).not.toContain('self-hosted');
  });

  it('uploads native browser diagnostics alongside the existing evidence on success or failure', () => {
    const browser = job('browser-conformance');
    expect(browser).toContain('DEBUG=pw:protocol,pw:browser');
    expect(browser).toContain('${{ runner.temp }}/browser-qa/browser-native.log');
    expect(browser).toContain('if: ${{ !cancelled() }}');
    expect(browser).toContain('retention-days: 14');
    expect(browser).not.toContain('MAX_LOG_LENGTH');
  });

  it.each([0, 37])('captures both streams without replacing browser exit %s', (exitCode) => {
    const step = job('browser-conformance')
      .split('      - name: Exercise the regenerated offline documents\n')[1]
      ?.split('      - name:')[0] ?? '';
    const inline = /        run: (.*)\n/.exec(step)?.[1];
    expect(inline).toBeDefined();
    const script = inline === '|'
      ? step.split('        run: |\n')[1]?.replace(/^          /gm, '') ?? ''
      : inline ?? '';
    const directory = mkdtempSync(resolve(tmpdir(), 'browser-workflow-'));
    try {
      // Substitute only the external browser command; execute the actual CI shell body.
      const stub = `node() { printf '%s\\n' "\${DEBUG:-unset}" "$*"; printf 'browser-stderr\\n' >&2; return ${exitCode}; }\n`;
      const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', stub + script], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 5_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(exitCode);
      const log = resolve(directory, 'browser-native.log');
      expect(existsSync(log)).toBe(true);
      expect(readFileSync(log, 'utf8')).toBe(
        'pw:protocol,pw:browser\nnode_modules/@playwright/test/cli.js test\nbrowser-stderr\n',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});


it('keeps Windows capture preflight and upload separate from the unchanged consumer gate', () => {
  const consumers = job('install-conformance');
  expect(consumers).toContain('conformance-native-capture.mjs --preflight');
  expect(consumers).toContain("runner.os == 'Windows'");
  expect(consumers).toContain("!cancelled() && runner.os == 'Windows'");
  expect(consumers).toContain('native-capture-${{ env.GATE_SHA }}');
  expect(consumers).toContain('retention-days: 14');
  expect(consumers).toContain('run: pnpm conformance:consumer --tarball "${{ runner.temp }}/void-consumer-artifact/consumer.tgz"');
  expect(consumers).not.toMatch(/continue-on-error|timeout-minutes|permissions:|retry/);
});
