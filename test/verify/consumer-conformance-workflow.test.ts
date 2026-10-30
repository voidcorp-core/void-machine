import { spawnSync } from 'node:child_process';
import {
  existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// GitHub expressions are literal workflow data, not JavaScript placeholders.
const expression = (inner: string): string => ['$', '{{ ', inner, ' }}'].join('');

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
    expect(consumers).not.toContain('pnpm install');
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
    expect(browser).toContain('npm ci --ignore-scripts --no-audit --no-fund');
    expect(browser).toContain('node node_modules/@playwright/test/cli.js test');
    expect(browser).toContain(`if: ${expression('!cancelled()')}`);
    expect(browser).toContain('actions/upload-artifact@');
    expect(browser).toContain('if-no-files-found: error');
    expect(browser).toContain(`browser-evidence-${expression('env.GATE_SHA')}`);
    expect(browser).not.toContain('continue-on-error');
    expect(browser).not.toContain('pnpm conformance:pack');
    expect(browser).not.toContain('self-hosted');
  });
});

describe('reusable browser environment and primary Node', () => {
  it('uses container-native temporary paths for every browser input and evidence path', () => {
    const browser = job('browser-conformance');
    const temporary = expression('steps.browser-paths.outputs.temp');
    expect(browser).not.toContain(expression('runner.temp'));
    expect(browser).toContain(`path: ${temporary}/void-consumer-artifact`);
    expect(browser).toContain(`VOID_CONFORMANCE_TARBALL: ${temporary}/void-consumer-artifact/consumer.tgz`);
    expect(browser).toContain(`working-directory: ${temporary}/browser-qa`);
    for (const evidence of ['browser-qa/playwright-report/', 'browser-qa/test-results/',
      'browser-qa/tooling-tree.json', 'cheatsheet-fixture/evidence.json']) {
      expect(browser).toContain(`            ${temporary}/${evidence}`);
    }
    expect(browser.indexOf('id: browser-paths')).toBeLessThan(browser.indexOf('actions/download-artifact@'));
  });

  it('publishes the runtime temporary directory through the native step output', () => {
    const script = job('browser-conformance').match(/id: browser-paths\n\s+run: (.+)/)?.[1];
    expect(script).toBeDefined();
    const root = mkdtempSync(resolve(tmpdir(), 'browser-paths-'));
    try {
      const output = resolve(root, 'output');
      writeFileSync(output, '');
      const result = spawnSync('sh', ['-ec', script ?? ''], {
        encoding: 'utf8',
        env: { ...process.env, RUNNER_TEMP: '/__w/_temp/with spaces', GITHUB_OUTPUT: output },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(output, 'utf8')).toBe('temp=/__w/_temp/with spaces\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('derives the official image from the tooling manifest in the existing producer', () => {
    expect(job('consumer-artifact')).toContain(`playwright-version: ${expression('steps.browser-version.outputs.version')}`);
    expect(job('browser-conformance')).toContain(
      `image: mcr.microsoft.com/playwright:v${expression('needs.consumer-artifact.outputs.playwright-version')}-noble`,
    );
    expect(job('browser-conformance')).not.toMatch(/install --with-deps|actions\/cache@|node_modules.*cache/);
    expect(job('browser-conformance')).toContain('cache: npm');
    expect(job('browser-conformance')).toContain('cache-dependency-path: test/browser/package-lock.json');
    expect(job('browser-conformance')).toContain('cp test/browser/package.json test/browser/package-lock.json');
  });

  it('locks browser tooling and proposes scoped dependency updates', () => {
    const lockPath = resolve(ROOT, 'test/browser/package-lock.json');
    expect(existsSync(lockPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'test/browser/package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(lock.packages[''].dependencies).toEqual(manifest.dependencies);
    for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
      expect(lock.packages[`node_modules/${name}`].version).toBe(manifest.dependencies['@playwright/test']);
    }
    const updates = readFileSync(resolve(ROOT, '.github/dependabot.yml'), 'utf8');
    expect(updates).toContain('package-ecosystem: npm');
    expect(updates).toContain('directory: /test/browser');
  });

  it('provisions consumer enforcement from its own immutable version file', () => {
    const reusable = readFileSync(resolve(ROOT, '.github/workflows/enforce.yml'), 'utf8');
    expect(reusable).toContain('path: .void-enforce-runtime');
    expect(reusable).toContain('node-version-file: .void-enforce-runtime/.node-version');
    expect(reusable).not.toMatch(/node-version-file: \.node-version/);
    expect(reusable.indexOf('node-version-file:')).toBeGreaterThan(
      reusable.indexOf('path: .void-enforce-runtime'),
    );
  });

  it('shares the exact current Node without a separate older-runtime lane', () => {
    expect(existsSync(resolve(ROOT, '.node-version'))).toBe(true);
    expect(readFileSync(resolve(ROOT, '.node-version'), 'utf8').trim()).toBe('26.12.1');
    expect(job('validate')).toContain('node-version-file: .node-version');
    expect(job('node-compatibility')).toBe('');
    const sources = readdirSync(resolve(ROOT, '.github/workflows'))
      .filter(name => name.endsWith('.yml'))
      .map(name => readFileSync(resolve(ROOT, '.github/workflows', name), 'utf8'));
    const literalVersions = sources.flatMap(source => [...source.matchAll(/node-version: ([0-9][^\n]*)/g)].map(match => match[1]));
    expect(literalVersions).toEqual([]);
    const release = readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf8');
    expect(release).toContain('node-version-file: release-control/.node-version');
    expect(release).not.toMatch(/node-version-file: \.node-version/);
    expect(release).toContain(`node-version: ${expression('needs.validate-release.outputs.node-version')}`);
    expect(release).toContain(`node-version: ${expression('steps.primary-node.outputs.node-version')}`);
  });
});

it('aligns every first-party declared Node floor with the exact runtime CI proves', () => {
  const version = readFileSync(resolve(ROOT, '.node-version'), 'utf8').trim();
  const directories = ['.', ...['apps', 'packages', 'packages/packs'].flatMap(parent =>
    readdirSync(resolve(ROOT, parent), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => `${parent}/${entry.name}`))];
  const manifests = directories.map(directory => resolve(ROOT, directory, 'package.json'))
    .filter(path => existsSync(path));
  for (const path of manifests) {
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (manifest.engines?.node !== undefined) {
      expect(manifest.engines.node, path).toBe(`>=${version}`);
    }
  }
});

describe('browser image version boundary', () => {
  // Execute the workflow's inline derivation against a real temporary manifest.
  it.each([
    ['1.63.0', '1.63.0', true], ['1.64.0', '1.64.0', true],
    ['^1.63.0', '1.63.0', false], ['1.63.0', '1.62.0', false],
    ['1.63.0\ninjected=x', '1.63.0', false], ['1.63.0\n', '1.63.0\n', false],
  ])('validates package %s and override %s', (version, override, accepted) => {
    const script = job('consumer-artifact').match(/node --input-type=module <<'NODE'\n([\s\S]*?) {10}NODE/)?.[1];
    expect(script, 'producer must derive a bounded image version').toBeDefined();
    const root = mkdtempSync(resolve(tmpdir(), 'browser-image-'));
    try {
      mkdirSync(resolve(root, 'test/browser'), { recursive: true });
      writeFileSync(resolve(root, 'test/browser/package.json'), JSON.stringify({
        dependencies: { '@playwright/test': version }, overrides: { 'playwright-core': override },
      }));
      const output = resolve(root, 'output');
      writeFileSync(output, '');
      const result = spawnSync(process.execPath, ['--input-type=module'], {
        input: script, cwd: root, encoding: 'utf8', timeout: 5_000,
        env: { ...process.env, GITHUB_OUTPUT: output },
      });
      expect(result.status === 0, result.stderr).toBe(accepted);
      expect(readFileSync(output, 'utf8')).toBe(accepted ? `version=${version}\n` : '');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
