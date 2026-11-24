import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { printHelp } from '../../packages/cli/src/commands/help.js';
import { PRODUCT_IDENTITY } from '../../packages/hook-runner/src/identity.js';

const ROOT = resolve(__dirname, '..', '..');
const README = readFileSync(resolve(ROOT, 'README.md'), 'utf8');

function filesAt(path: string): string[] {
  return readdirSync(resolve(ROOT, path));
}

/** The number the README states for a row of the composition table. */
function statedCount(label: string): number {
  const row = new RegExp(`\\|\\s*${label}\\s*\\|\\s*(\\d+)\\s*\\|`).exec(README);
  if (row === null) throw new Error(`README has no composition row for "${label}"`);
  return Number(row[1]);
}

describe('the README composition table matches shipped sources', () => {
  it('counts core skills', () => {
    expect(statedCount('Core skills')).toBe(filesAt('packages/core/src/skills').filter(name => existsSync(resolve(ROOT, 'packages/core/src/skills', name, 'SKILL.md'))).length);
  });

  it('counts stack pack skills', () => {
    const count = filesAt('packages/packs').reduce((total, pack) =>
      total + filesAt(`packages/packs/${pack}/src/skills`).length, 0);
    expect(statedCount('Stack pack skills')).toBe(count);
  });

  it('counts executable hook entries, excluding private libraries and bundles', () => {
    const count = filesAt('packages/core/src/hooks').filter(name => name.endsWith('.sh') && !name.startsWith('_')).length;
    expect(statedCount('Hooks')).toBe(count);
  });

  it('counts agent definitions', () => {
    expect(statedCount('Agents')).toBe(filesAt('packages/core/dist/agents').filter(name => name.endsWith('.md')).length);
  });

  it('counts specialist contracts', () => {
    expect(statedCount('Specialists')).toBe(filesAt('packages/core/src/specialists').filter(name => name.endsWith('.yaml')).length);
  });
});

describe('the commands the README advertises', () => {
  it.each([['status'], ['doctor'], ['add'], ['runtime'], ['update'], ['init']])(
    '`%s` exists in the CLI help',
    (command) => {
      expect(README).toContain(`${PRODUCT_IDENTITY.packageName} ${command}`);
      let help = '';
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { help += String(chunk); return true; });
      try { printHelp(); } finally { spy.mockRestore(); }
      expect(help).toContain(command);
    },
  );

  it('states no version number, because a release ages one out silently', () => {
    // The npm badge reads the live version; nothing else should hardcode it.
    const body = README.split('\n').filter((line) => !line.includes('img.shields.io'));
    expect(body.join('\n')).not.toMatch(/\b\d+\.\d+\.\d+\b/);
  });
});
