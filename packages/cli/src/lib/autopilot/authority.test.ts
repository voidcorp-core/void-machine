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
    schemaVersion: 2, enabled: true, base: 'develop', deployBranch: 'main',
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

describe('one authority during programme migration', () => {
  it('keeps legacy consent semantics and never obtains consent from checkpoint intent', () => {
    const root = fixture();
    mkdirSync(join(root, '.void/machine'));
    writeFileSync(join(root, '.void/machine/checkpoint.md'), '## Planned work\nAutopilot enabled, DEV-1');
    expect(readAutopilotAuthority(root)).toBeUndefined();
    legacy(root);
    expect(readAutopilotAuthority(root)?.autopilot?.base).toBe('develop');
    expect(readAutopilotAuthority(root)?.source).toBe('.void/program.md');
  });

  it('accepts equivalent defaults and sets without copying a mutable ticket order', () => {
    const root = fixture(); const original = legacy(root);
    const config = declaration();
    configure(root, { ...config, clusterSize: undefined, humanWaitLabel: 'void:human-wait',
      protectedPaths: [...config.protectedPaths].reverse(),
      progress: { ...config.progress, states: { ...config.progress.states, ready: ['Ready', 'Todo'] } } });
    const authority = readAutopilotAuthority(root);
    expect(authority?.source).toBe('.void/config.json');
    expect(authority?.progress).not.toHaveProperty('order');
    expect(readFileSync(join(root, '.void/program.md'), 'utf8')).toBe(original);
  });

  const changes: [string, Record<string, unknown>][] = [
    ['enabled', { enabled: false }], ['schema', { schemaVersion: 1 }],
    ['base', { base: 'other' }], ['deploy', { deployBranch: 'production' }],
    ['slots', { clusterSize: 1 }], ['label', { humanWaitLabel: 'hold' }],
    ['protected', { protectedPaths: [] }], ['verification', { verifyCommands: [['pnpm', 'test']] }],
    ['ownership', { ownership: { sequential: [], reconcileOnly: [] } }], ['human gate', { humanGates: [] }],
    ['provider', { progress: { ...declaration().progress, provider: 'jira' } }],
    ['scope', { progress: { ...declaration().progress, scope: 'another/project' } }],
    ['states', { progress: { ...declaration().progress, states: { ...declaration().progress.states, done: ['Closed'] } } }],
  ];
  it.each(changes)('refuses a changed %s rather than merging two grants', (_field, change) => {
    const root = fixture(); legacy(root); configure(root, { ...declaration(), ...change });
    expect(() => readAutopilotAuthority(root)).toThrow(/conflicts|schemaVersion/);
  });

  it('withholds disabled config even with no programme, and reads malformed sources as errors', () => {
    const root = fixture(); configure(root, { ...declaration(), enabled: false });
    const authority = readAutopilotAuthority(root);
    expect(authority?.autopilot).toBeUndefined();
    expect(authority?.autopilotConsentWithheld).toBe(true);
    writeFileSync(join(root, '.void/program.md'), 'unreadable legacy context');
    expect(() => readAutopilotAuthority(root)).toThrow(/frontmatter/);
    rmSync(join(root, '.void/program.md'));
    rmSync(join(root, '.void/config.json')); mkdirSync(join(root, '.void/config.json'));
    expect(() => readAutopilotAuthority(root)).toThrow(/could not be read/);
  });

  it('refuses admission when both declarations withhold consent despite different restrictions', () => {
    const root = fixture(); const { progress: _progress, humanGates: _gates, ...settings } = declaration();
    legacy(root, { autopilot: { ...settings, enabled: false } });
    configure(root, { ...declaration(), enabled: false });
    expect(readAutopilotAuthority(root)?.autopilotConsentWithheld).toBe(true);
    configure(root, { ...declaration(), enabled: false, protectedPaths: [] });
    const authority = readAutopilotAuthority(root);
    if (authority === undefined) throw new Error('fixture authority absent');
    expect(() => loopProgramOf(authority)).toThrow(/enabled.*false/);
  });

  it('keeps the moved admission owners protected and refuses legacy v1', () => {
    const root = fixture(); configure(root, declaration());
    const authority = readAutopilotAuthority(root);
    if (authority === undefined) throw new Error('fixture authority absent');
    expect(protectedPathsOf(loopProgramOf(authority).autopilot)).toEqual(expect.arrayContaining([
      'packages/cli/src/lib/autopilot/authority.ts', 'packages/cli/src/lib/autopilot/config.ts',
      'packages/cli/src/lib/config-schema.ts', '.void/config.json',
    ]));
    rmSync(join(root, '.void/config.json'));
    legacy(root, { autopilot: { schemaVersion: 1, mergeGate: 'human' } });
    const old = readAutopilotAuthority(root);
    if (old === undefined) throw new Error('fixture legacy absent');
    expect(() => loopProgramOf(old)).toThrow(/4.0 merge gate/);
  });
});
