// Proof that the baseline detects something real.
//
// Every other test here proves the harness refuses, bounds and judges
// correctly. None of them prove a scanner ever found a vulnerability — and a
// scanner that finds nothing on a clean tree looks exactly like one that is
// silently broken.
//
// So: a deliberately vulnerable fixture, local rules, and a real scanner run.
// When semgrep is not installed the detection test is SKIPPED rather than
// passed, for the same reason the engine reports an unmeasured surface as
// degraded: a green that means "we did not look" is worse than no green.

import { execFile as nodeExecFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { runAdapters } from '../../commands/security.js';
import { parseSecurityManifestYaml, type SecurityAdapter } from './manifest.js';

const execFile = promisify(nodeExecFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, '__fixtures__', 'owasp');

function fingerprint(): string {
  const hash = createHash('sha256');
  for (const name of readdirSync(FIXTURE).sort()) {
    hash.update(name).update(readFileSync(join(FIXTURE, name)));
  }
  return hash.digest('hex');
}

async function semgrepAvailable(): Promise<boolean> {
  try {
    await execFile('semgrep', ['--version'], { timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
}

const HAS_SEMGREP = await semgrepAvailable();

describe('the OWASP fixture', () => {
  it('is never imported by code that runs', () => {
    // A fixture that something imports is not a fixture, it is a vulnerability.
    const sources = resolve(HERE, '..', '..');
    const offenders: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__fixtures__' && entry.name !== 'node_modules') walk(path);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        if (path === fileURLToPath(import.meta.url)) continue;
        if (readFileSync(path, 'utf8').includes('__fixtures__/owasp')) offenders.push(path);
      }
    };
    walk(sources);

    expect(offenders).toEqual([]);
  });

  it('carries no credential-shaped string', () => {
    // Otherwise this repository's own secret scan cries wolf forever, and a
    // scanner nobody believes is a scanner nobody runs.
    const body = readFileSync(join(FIXTURE, 'vulnerable.js'), 'utf8');

    expect(body).not.toMatch(/AKIA[0-9A-Z]{16}|api[_-]?key\s*[:=]\s*['"][^'"]{16,}/i);
  });
});

describe.skipIf(!HAS_SEMGREP)('a real scanner over the fixture', () => {
  // Generous timeouts: these shell out to a real scanner, and a cold semgrep
  // start alone can outlast vitest's default. A flaky green here would be worse
  // than a slow one.
  it('finds both planted vulnerabilities without changing the fixture', { timeout: 300_000 }, async () => {
    const before = fingerprint();
    const adapter = parseSecurityManifestYaml(readFileSync(
      resolve(HERE, '../../../../core/src/adapters/security/manifest.yaml'), 'utf8',
    ), 'shipped manifest').adapters.find((entry) => entry.id === 'semgrep') as SecurityAdapter;
    const argv = adapter.args.map((arg) => arg === '.semgrep.yml' ? join(FIXTURE, 'rules.yml') : arg);
    const result = await runAdapters({ kind: 'planned', skipped: [], missingTools: [], run: [{
      adapter, argv: [...argv, '--no-git-ignore', FIXTURE],
    }] });
    expect(result.runs[0]).toMatchObject({ outcome: 'findings', exitCode: 1 });
    const found = result.findings.map((finding) => finding.rule.split('.').pop());

    expect(found).toEqual(
      expect.arrayContaining(['sql-query-string-concatenation', 'shell-command-string-concatenation']),
    );
    expect(fingerprint()).toBe(before);
  });
});
