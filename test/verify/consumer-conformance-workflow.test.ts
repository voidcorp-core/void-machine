import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

});

describe('shared primary Node', () => {
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
