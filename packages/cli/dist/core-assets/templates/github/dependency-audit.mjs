// Bun 1.3.14: exit 1 means either advisories or a failed registry request.
// Interpret only a recognized JSON response; ambiguous output never passes.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const scope = 'npm advisories for packages Bun 1.3.14 sends to its default registry';
const severities = new Set(['info', 'low', 'moderate', 'high', 'critical']);
const object = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const advisory = (value) => object(value)
  && (typeof value.id === 'number' || typeof value.id === 'string')
  && ['url', 'title', 'vulnerable_versions'].every((key) => typeof value[key] === 'string' && value[key].length > 0)
  && severities.has(value.severity);

function classify(result) {
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    return { state: 'unavailable', exitCode: 2, reason: 'audit-process-failed' };
  }
  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch {
    return { state: 'unavailable', exitCode: 2, reason: 'invalid-registry-json' };
  }
  if (object(response)) {
    const entries = Object.entries(response);
    if (entries.length === 0 && result.status === 0) {
      return { state: 'clean', exitCode: 0, reason: 'no-advisories-in-response' };
    }
    if (entries.length > 0 && entries.every(([name, values]) => name.length > 0
      && Array.isArray(values) && values.length > 0 && values.every(advisory))) {
      return { state: 'vulnerabilities', exitCode: 1, reason: 'advisories-returned', advisories: response };
    }
  }
  return { state: 'unavailable', exitCode: 2, reason: 'unrecognized-registry-response' };
}

if (process.argv.length !== 3) {
  process.stderr.write('Usage: node dependency-audit.mjs <report-directory>\n');
  process.exitCode = 2;
} else {
  const result = spawnSync('bun', ['audit', '--json'], {
    encoding: 'utf8', shell: false, timeout: 120_000, maxBuffer: 1_048_576,
  });
  const report = { schemaVersion: 1, scope, ...classify(result) };
  const directory = process.argv[2];
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  const summary = `## Dependency audit: ${report.state}\n\nScope: ${scope}.\n\nReason: ${report.reason}. Exit code: ${report.exitCode}.\n\nUnavailability is not a clean audit. This result does not certify dependencies outside the stated scope.\n`;
  writeFileSync(join(directory, 'summary.md'), summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  process.stdout.write(summary);
  process.exitCode = report.exitCode;
}
