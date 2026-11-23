// @test-resource filesystem
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { readAutopilotAuthority } from './authority.js';
import { loopProgramOf, protectedPathsOf } from './loop.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'authority-'));
  roots.push(root); mkdirSync(join(root, '.void'));
  return root;
}
function declaration() {
  return {
    schemaVersion: 3, enabled: true, base: 'develop', deployBranch: 'main',
    clusterSize: 4, protectedPaths: ['infra/**', 'secrets/**'],
    verifyCommands: [['pnpm', 'build'], ['pnpm', 'test']],
    ownership: { sequential: ['lockfile'], reconcileOnly: ['generated/**'] },
    progress: { provider: 'linear', scope: 'team/project',
      states: { ready: ['Todo', 'Ready'], started: ['In Progress'], review: ['In Review'], done: ['Done'] } },
    humanGates: ['DEV-1'],
  };
}
function legacy(root: string, patch: Record<string, unknown> = {}) {
  const { enabled: _enabled, progress, humanGates, ...autopilot } = declaration();
  const text = `---\n${stringify({ schemaVersion: 1, status: 'executing', program: 'fixture',
    plan: 'docs/plan.md', spec: 'docs/spec.md', progress: { ...progress, order: ['DEV-1'] },
    humanGates, autopilot, ...patch })}---\nHistory kept.\n`;
  writeFileSync(join(root, '.void/program.md'), text);
  return text;
}
function configure(root: string, autopilot: unknown) {
  writeFileSync(join(root, '.void/config.json'), JSON.stringify({ autopilot }));
}

describe('explicit config authority after programme retirement', () => {
  it('never obtains authority from historical programmes or checkpoint intent', () => {
    const root = fixture();
    mkdirSync(join(root, '.void/machine'));
    writeFileSync(join(root, '.void/machine/checkpoint.md'), '## Planned work\nAutopilot enabled, DEV-1');
    legacy(root);
    expect(readAutopilotAuthority(root)).toBeUndefined();
  });

  it.each(['agree', 'disabled', 'conflict', 'malformed', 'unreadable'])('refuses v2 with %s historical programme', (state) => {
    const root = fixture(); const config = declaration();
    configure(root, { ...config, schemaVersion: 2 });
    legacy(root, { autopilot: { ...config, schemaVersion: 2, enabled: state !== 'disabled', base: state === 'conflict' ? 'other' : config.base } });
    if (state === 'malformed') writeFileSync(join(root, '.void/program.md'), 'invalid YAML');
    if (state === 'unreadable') { rmSync(join(root, '.void/program.md')); mkdirSync(join(root, '.void/program.md')); }
    expect(() => readAutopilotAuthority(root)).toThrow(/schemaVersion.*3|migration/i);
  });

  it.each(['.void/program.md', '.void/active.md', 'plans/ACTIVE.md'])('v3 ignores historical %s and preserves restrictions', (path) => {
    const root = fixture(); configure(root, declaration());
    mkdirSync(join(root, 'plans'), { recursive: true });
    writeFileSync(join(root, path), 'Customized history; invalid YAML.');
    const authority = readAutopilotAuthority(root);
    expect(authority?.source).toBe('.void/config.json');
    expect(authority?.autopilot).toMatchObject({ schemaVersion: 3, base: 'develop', deployBranch: 'main',
      protectedPaths: ['infra/**', 'secrets/**'], verifyCommands: [['pnpm', 'build'], ['pnpm', 'test']],
      ownership: { sequential: ['lockfile'], reconcileOnly: ['generated/**'] } });
    expect(authority?.progress).toEqual(declaration().progress);
    expect(authority?.humanGates).toEqual(['DEV-1']);
    expect(authority?.progress).not.toHaveProperty('order');
    expect(readFileSync(join(root, path), 'utf8')).toBe('Customized history; invalid YAML.');
    rmSync(join(root, path)); mkdirSync(join(root, path));
    expect(readAutopilotAuthority(root)?.autopilot?.schemaVersion).toBe(3);
  });

  it('withholds disabled config independently of historical consent', () => {
    const root = fixture(); legacy(root); configure(root, { ...declaration(), enabled: false });
    const authority = readAutopilotAuthority(root);
    expect(authority?.autopilot).toBeUndefined();
    expect(authority?.autopilotConsentWithheld).toBe(true);
    if (authority === undefined) throw new Error('fixture authority absent');
    expect(() => loopProgramOf(authority)).toThrow(/enabled.*false/);
  });

  it.each([{ schemaVersion: 1 }, { schemaVersion: 4 }, { schemaVersion: undefined }, { enabled: undefined },
    { progress: undefined }, { base: 'main' }, { protectedPaths: ['../outside'] }, { mergeGate: 'human' },
    { verifyCommands: ['pnpm test'] }, { clusterSize: 5 }, { humanWaitLabel: ' hold' }])('rejects invalid declarations without fallback: %j', (patch) => {
    const root = fixture(); legacy(root); configure(root, { ...declaration(), ...patch });
    expect(() => readAutopilotAuthority(root)).toThrow();
  });

  it('reports malformed and unreadable config', () => {
    const root = fixture(); legacy(root);
    writeFileSync(join(root, '.void/config.json'), '{');
    expect(() => readAutopilotAuthority(root)).toThrow(/JSON/);
    rmSync(join(root, '.void/config.json')); mkdirSync(join(root, '.void/config.json'));
    expect(() => readAutopilotAuthority(root)).toThrow(/could not be read/);
  });

  it('keeps admission owners protected', () => {
    const root = fixture(); configure(root, declaration());
    const authority = readAutopilotAuthority(root);
    if (authority === undefined) throw new Error('fixture authority absent');
    expect(protectedPathsOf(loopProgramOf(authority).autopilot)).toEqual(expect.arrayContaining([
      'packages/cli/src/lib/autopilot/authority.ts', 'packages/cli/src/lib/autopilot/config.ts',
      'packages/cli/src/lib/config-schema.ts', '.void/config.json',
    ]));
  });
});
