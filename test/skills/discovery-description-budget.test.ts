import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const ANTI_BLOAT_CHECK = join(ROOT, 'scripts', 'anti-bloat-check.sh');
const fixtures: string[] = [];

type DescriptionOwner = 'skill' | 'pack' | 'agent' | 'specialist';
type ScalarStyle = 'plain' | 'quoted' | 'folded';

interface Fixture {
  readonly root: string;
  readonly relativePath: string;
}

function write(path: string, content: string): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

function descriptionField(descriptionLength: number, style: ScalarStyle): string {
  const value = 'x'.repeat(descriptionLength);
  if (style === 'quoted') return `description: ${JSON.stringify(value)}`;
  if (style === 'folded') {
    const firstLength = Math.floor((descriptionLength - 1) / 2);
    const secondLength = descriptionLength - firstLength - 1;
    return `description: >-\n  ${'x'.repeat(firstLength)}\n  ${'x'.repeat(secondLength)}`;
  }
  return `description: ${value}`;
}

function createFixture(
  owner: DescriptionOwner,
  descriptionLength: number,
  style: ScalarStyle = 'plain',
): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'void-description-budget-'));
  fixtures.push(root);

  const skillDirectory = join(root, 'packages', 'core', 'src', 'skills', 'void-example');
  const skillDescription = owner === 'skill'
    ? descriptionField(descriptionLength, style)
    : 'description: A short discovery description.';
  write(
    join(skillDirectory, 'SKILL.md'),
    `---\nname: void-example\n${skillDescription}\n---\n\n# Example\n`,
  );
  write(join(skillDirectory, 'harness.yaml'), 'kind: standard\nruntimes: [claude, codex]\n');
  write(join(skillDirectory, '.source'), 'Fixture source.\n');
  write(join(root, 'docs', 'plans', 'skill-audits', 'void-example.md'), '# Fixture audit\n');

  let relativePath = 'packages/core/src/skills/void-example/SKILL.md';
  if (owner === 'pack') {
    relativePath = 'packages/packs/example/src/skills/void-pack-example/SKILL.md';
    const packSkillDirectory = join(root, 'packages', 'packs', 'example', 'src', 'skills', 'void-pack-example');
    write(
      join(packSkillDirectory, 'SKILL.md'),
      `---\nname: void-pack-example\n${descriptionField(descriptionLength, style)}\n---\n\n# Pack example\n`,
    );
    write(join(packSkillDirectory, 'harness.yaml'), 'kind: standard\nruntimes: [claude, codex]\n');
    write(join(packSkillDirectory, '.source'), 'Fixture source.\n');
    write(join(root, 'docs', 'plans', 'skill-audits', 'void-pack-example.md'), '# Pack fixture audit\n');
  }

  if (owner === 'agent') {
    relativePath = 'packages/core/src/agents/example-agent.md';
    write(
      join(root, 'packages', 'core', 'src', 'agents', 'example-agent.md'),
      `---\nname: example-agent\n${descriptionField(descriptionLength, style)}\ntools: Read, Grep, Glob\n---\n\n# Example agent\n`,
    );
  }

  if (owner === 'specialist') {
    relativePath = 'packages/core/src/specialists/example-agent.yaml';
    write(
      join(root, relativePath),
      `name: example-agent\n${descriptionField(descriptionLength, style)}\n`,
    );
  }

  return { root, relativePath };
}

function runGate(owner: DescriptionOwner, descriptionLength: number, style: ScalarStyle = 'plain') {
  const fixture = createFixture(owner, descriptionLength, style);
  const result = spawnSync('bash', [ANTI_BLOAT_CHECK], {
    cwd: fixture.root,
    encoding: 'utf8',
  });
  return { ...fixture, result };
}

function runFixture(fixture: Fixture) {
  return spawnSync('bash', [ANTI_BLOAT_CHECK], {
    cwd: fixture.root,
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe('discovery description budget', () => {
  it('accepts the 250-character target without a note', () => {
    const { result } = runGate('skill', 250);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(0);
    expect(output).toContain('target 250 chars, hard cap 500 chars');
    expect(output).not.toContain('NOTE:');
  });

  it.each([251, 500])('accepts %i characters with a non-blocking note', (descriptionLength) => {
    const { result } = runGate('skill', descriptionLength);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(0);
    expect(output).toContain(
      `NOTE: packages/core/src/skills/void-example/SKILL.md description is ${descriptionLength} chars ` +
        '(target 250, cap 500)',
    );
  });

  it('rejects a 501-character skill description', () => {
    const { result } = runGate('skill', 501);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain(
      'FAIL: packages/core/src/skills/void-example/SKILL.md description is 501 chars (cap 500)',
    );
  });

  it('rejects a 501-character agent description', () => {
    const { result } = runGate('agent', 501);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain('FAIL: packages/core/src/agents/example-agent.md description is 501 chars (cap 500)');
  });

  it('rejects an agent without a tools allowlist', () => {
    const fixture = createFixture('agent', 10);
    write(
      join(fixture.root, fixture.relativePath),
      `---\nname: example-agent\ndescription: short\n---\n\n# Example agent\n`,
    );
    const result = runFixture(fixture);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain(
      `FAIL: ${fixture.relativePath} must declare a non-empty frontmatter 'tools:' allowlist`,
    );
  });

  it('rejects an agent with an empty tools allowlist', () => {
    const fixture = createFixture('agent', 10);
    write(
      join(fixture.root, fixture.relativePath),
      `---\nname: example-agent\ndescription: short\ntools:   \n---\n\n# Example agent\n`,
    );
    const result = runFixture(fixture);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain(
      `FAIL: ${fixture.relativePath} must declare a non-empty frontmatter 'tools:' allowlist`,
    );
  });

  it.each([251, 501])('enforces %i characters for a pack skill', (descriptionLength) => {
    const { relativePath, result } = runGate('pack', descriptionLength);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(descriptionLength === 501 ? 1 : 0);
    expect(output).toContain(
      `${descriptionLength === 501 ? 'FAIL' : 'NOTE'}: ${relativePath} description is ${descriptionLength} chars`,
    );
  });

  it.each([500, 501])('measures the resolved value of a %i-character folded scalar', (descriptionLength) => {
    const { relativePath, result } = runGate('skill', descriptionLength, 'folded');
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(descriptionLength === 501 ? 1 : 0);
    expect(output).toContain(
      `${descriptionLength === 501 ? 'FAIL' : 'NOTE'}: ${relativePath} description is ${descriptionLength} chars`,
    );
  });

  it('measures a quoted scalar by its resolved 500-character value', () => {
    const { relativePath, result } = runGate('skill', 500, 'quoted');
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(0);
    expect(output).toContain(`NOTE: ${relativePath} description is 500 chars`);
  });

  it.each([251, 501])('enforces %i characters at the canonical specialist boundary', (descriptionLength) => {
    const { relativePath, result } = runGate('specialist', descriptionLength);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(descriptionLength === 501 ? 1 : 0);
    expect(output).toContain(
      `${descriptionLength === 501 ? 'FAIL' : 'NOTE'}: ${relativePath} description is ${descriptionLength} chars`,
    );
  });

  it.each([
    ['malformed YAML', 'description: ['],
    ['a missing description', 'license: MIT'],
    ['a non-string description', 'description: [one, two]'],
  ])('fails closed when %s cannot be measured', (_label, field) => {
    const fixture = createFixture('skill', 10);
    write(
      join(fixture.root, fixture.relativePath),
      `---\nname: void-example\n${field}\n---\n\n# Example\n`,
    );
    const result = runFixture(fixture);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain(`FAIL: ${fixture.relativePath} description cannot be measured`);
  });
});
