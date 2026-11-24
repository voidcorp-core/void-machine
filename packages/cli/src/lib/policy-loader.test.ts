import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  loadProjectPolicies,
  MAX_POLICY_FILE_BYTES,
  parsePolicyYaml,
} from './policy-loader.js';

const CORE_POLICY = `schemaVersion: 1
id: core:quality-floor
version: 1
layer: core
rules:
  - id: core:security
    pass: security
    strength: required
    baseline: true
`;

async function fixture(): Promise<{ root: string; core: string }> {
  const root = await mkdtemp(join(tmpdir(), 'void-policy-loader-'));
  const core = join(root, 'core', 'dist');
  await mkdir(core, { recursive: true });
  await writeFile(join(core, 'core.yaml'), CORE_POLICY, 'utf8');
  await writeFile(
    join(core, 'ui.yaml'),
    CORE_POLICY.replaceAll('quality-floor', 'ui-quality').replaceAll('security', 'ux-ui'),
    'utf8',
  );
  return { root, core };
}

describe('parsePolicyYaml', () => {
  it('rejects duplicate mapping keys', () => {
    expect(() => parsePolicyYaml(
      CORE_POLICY.replace('version: 1', 'version: 1\nversion: 2'),
      'core.yaml',
    )).toThrow(/POLICY_YAML_INVALID/);
  });

  it('disallows aliases to prevent expansion attacks', () => {
    const aliased = `${CORE_POLICY}\nextra: &anchor [1]\ncopy: *anchor\n`;
    expect(() => parsePolicyYaml(aliased, 'core.yaml')).toThrow();
  });

  it('rejects oversized YAML before parsing it', () => {
    expect(() => parsePolicyYaml(
      'x'.repeat(MAX_POLICY_FILE_BYTES + 1),
      'huge.yaml',
    )).toThrow(/file exceeds/);
  });
});

describe('loadProjectPolicies', () => {
  it('loads every bundled core policy before project policies regardless of directory order', async () => {
    const { root, core } = await fixture();
    const policies = join(root, '.void', 'policies');
    await mkdir(policies, { recursive: true });
    await writeFile(
      join(policies, 'strict.yaml'),
      CORE_POLICY
        .replaceAll('core:quality-floor', 'project:quality-floor')
        .replace('layer: core', 'layer: project')
        .replace('strength: required', 'strength: blocking'),
      'utf8',
    );
    const loaded = await loadProjectPolicies(root, core);
    expect(loaded.map((item) => item.id)).toEqual([
      'core:quality-floor',
      'core:ui-quality',
      'project:quality-floor',
    ]);
  });

  it('rejects a symlinked policy that escapes the project root', async () => {
    const { root, core } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), 'void-policy-outside-'));
    await writeFile(join(outside, 'escape.yaml'), CORE_POLICY, 'utf8');
    const policies = join(root, '.void', 'policies');
    await mkdir(policies, { recursive: true });
    await symlink(join(outside, 'escape.yaml'), join(policies, 'escape.yaml'));
    await expect(loadProjectPolicies(root, core)).rejects.toThrow(
      /POLICY_PATH_ESCAPE/,
    );
  });
});
