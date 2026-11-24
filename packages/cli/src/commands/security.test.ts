import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSecurityManifestYaml, type SecurityAdapter } from '../lib/security/manifest.js';
import { outcomeOf, parseSecurityArgs, runAdapters } from './security.js';

describe('parseSecurityArgs', () => {
  it('asks for help when given nothing, rather than guessing a subcommand', () => {
    expect(parseSecurityArgs([]).kind).toBe('help');
    expect(parseSecurityArgs(['--help']).kind).toBe('help');
    expect(parseSecurityArgs(['scan', '--help']).kind).toBe('help');
  });

  it('reads the adapters subcommand', () => {
    expect(parseSecurityArgs(['adapters']).kind).toBe('adapters');
    const parsed = parseSecurityArgs(['adapters', '--json']);

    expect(parsed.kind === 'adapters' && parsed.json).toBe(true);
  });

  it('defaults a scan to team mode, online, non-destructive and targetless', () => {
    const parsed = parseSecurityArgs(['scan']);

    expect(parsed.kind).toBe('scan');
    if (parsed.kind === 'scan') {
      expect(parsed.mode).toBe('team');
      expect(parsed.prelaunch).toBe(false);
      expect(parsed.offline).toBe(false);
      expect(parsed.target).toBeUndefined();
    }
  });

  it('carries the target and its authorization', () => {
    const parsed = parseSecurityArgs([
      'scan',
      '--target',
      'https://staging.example.com',
      '--authorization',
      './grant.json',
    ]);

    if (parsed.kind === 'scan') {
      expect(parsed.target).toBe('https://staging.example.com');
      expect(parsed.authorizationPath).toBe('./grant.json');
    }
  });

  it('refuses an authorization with no target, which authorizes nothing', () => {
    const parsed = parseSecurityArgs(['scan', '--authorization', './grant.json']);

    expect(parsed.kind).toBe('invalid');
  });

  it('refuses a mode the engine does not define', () => {
    const parsed = parseSecurityArgs(['scan', '--mode', 'prelaunch']);

    // `prelaunch` is a phase, not a mode. It has its own flag.
    expect(parsed.kind).toBe('invalid');
    if (parsed.kind === 'invalid') expect(parsed.fix).toMatch(/--prelaunch/);
  });

  it('takes pre-launch as its own dimension, alongside any mode', () => {
    const parsed = parseSecurityArgs(['scan', '--mode', 'fast', '--prelaunch']);

    if (parsed.kind === 'scan') {
      expect(parsed.mode).toBe('fast');
      expect(parsed.prelaunch).toBe(true);
    }
  });

  it('refuses an unknown option instead of ignoring it', () => {
    expect(parseSecurityArgs(['scan', '--yolo']).kind).toBe('invalid');
  });

  it('refuses an option that was given no value', () => {
    expect(parseSecurityArgs(['scan', '--target']).kind).toBe('invalid');
  });

  it('refuses an unknown subcommand', () => {
    expect(parseSecurityArgs(['attack']).kind).toBe('invalid');
  });

  it('never prompts: every input is an argument', () => {
    // A security command that stops to ask a question cannot run in CI, which
    // is the place it matters most.
    const parsed = parseSecurityArgs(['scan', '--json', '--offline']);

    expect(parsed.kind).toBe('scan');
    if (parsed.kind === 'scan') {
      expect(parsed.json).toBe(true);
      expect(parsed.offline).toBe(true);
    }
  });
});

describe('outcomeOf', () => {
  const adapter = parseSecurityManifestYaml(
    `schemaVersion: 1
adapters:
  - id: semgrep
    kind: sast
    description: static analysis
    command: semgrep
    args: []
    versionArgs: [--version]
    reach: none
    provides: [static-analysis]
    limits: {timeoutSeconds: 60, maxOutputBytes: 1024}
    exitCodes: {clean: [0], findings: [1]}
`,
    'test.yaml',
  ).adapters[0] as SecurityAdapter;

  it('reads a declared clean code as clean', () => {
    expect(outcomeOf(adapter, 0)).toBe('clean');
  });

  it('reads a declared findings code as findings', () => {
    expect(outcomeOf(adapter, 1)).toBe('findings');
  });

  it('treats any undeclared code as an error rather than as findings', () => {
    // Observed for real: semgrep exits 7 when its ruleset is missing. Counting
    // that as "found something" reports a scan that never ran as one that did,
    // which is the exact false negative this layer exists to prevent.
    for (const code of [2, 3, 7, 127, 255]) {
      expect(outcomeOf(adapter, code), String(code)).toBe('errored');
    }
  });
});


describe('Semgrep process results through the production runner', () => {
  const adapter = parseSecurityManifestYaml(readFileSync(
    new URL('../../../core/src/adapters/security/manifest.yaml', import.meta.url), 'utf8',
  ), 'shipped manifest').adapters.find((entry) => entry.id === 'semgrep') as SecurityAdapter;
  const finding = { check_id: 'sql-injection', path: 'app.js', start: { line: 1 },
    extra: { severity: 'ERROR', message: 'Unsafe query' } };

  it.each([
    [0, { results: [finding] }, 'findings', 1],
    [1, { results: [finding] }, 'findings', 1],
    [0, { results: [] }, 'clean', 0],
    [0, { unexpected: true }, 'errored', 0],
    [0, 'not JSON', 'errored', 0],
    [0, { results: [null] }, 'errored', 0],
    [0, { results: [], errors: [{ message: 'scan failed' }] }, 'errored', 0],
    [7, { results: [] }, 'errored', 0],
  ])('reads exit %s with %j as %s', async (exitCode, output, outcome, count) => {
    const raw = typeof output === 'string' ? output : JSON.stringify(output);
    const result = await runAdapters({ kind: 'planned', skipped: [], missingTools: [], run: [{
      adapter: { ...adapter, command: process.execPath },
      argv: ['--eval', `process.stdout.write(${JSON.stringify(raw)}); process.exitCode = ${exitCode};`],
    }] });
    expect(result.runs[0]).toMatchObject({ exitCode, outcome });
    expect(result.findings).toHaveLength(count);
    if (count > 0) expect(result.findings[0]?.securityClass).toBe('injection');
  });
});
