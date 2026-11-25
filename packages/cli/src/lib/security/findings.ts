// Scanner output turned into findings the engine can judge.
//
// Each tool reports in its own shape, and none of them agree on what a severity
// means. This module reads them into one structure carrying what a reviewer
// actually needs: where it is, how to see it again, and what to do about it.
//
// Two rules run through the whole file.
//
// A secret never enters a finding. gitleaks reports the credential it matched;
// a report that quotes it back is a second place the credential now lives, and
// this one gets pasted into tickets and CI logs. Only the location is kept.
//
// Output we cannot read is `unreadable`, never an empty list. A scanner that
// found nothing and a scanner whose output failed to parse produce the same
// empty array, and only one of them means the code is fine — the caller turns
// `unreadable` into an errored scan, which blocks.

import type { FindingSeverity } from '@voidcorp/mission-engine';
import type { SecurityClass } from '@voidcorp/mission-engine';

/** Beyond this, we do not attempt a parse: an enormous output is a broken run. */
export const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface NormalizedFinding {
  readonly adapter: string;
  readonly securityClass: SecurityClass;
  /** What the tool claimed. The engine treats it as a floor, never a cap. */
  readonly reportedSeverity: FindingSeverity;
  readonly rule: string;
  readonly file?: string;
  readonly line?: number;
  /** One line, safe to paste anywhere. Never contains matched secret material. */
  readonly summary: string;
  readonly reproduction: string;
  readonly remediation: string;
}

export interface NormalizedOutput {
  readonly findings: readonly NormalizedFinding[];
  /** True when the output could not be read at all. Not the same as no findings. */
  readonly unreadable: boolean;
}

const UNREADABLE: NormalizedOutput = Object.freeze({ findings: Object.freeze([]), unreadable: true });

function readable(findings: NormalizedFinding[]): NormalizedOutput {
  return Object.freeze({ findings: Object.freeze(findings), unreadable: false });
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function at(file: string | undefined, line: number | undefined): string {
  if (file === undefined) return 'no location reported';
  return line === undefined ? file : `${file}:${line}`;
}

/**
 * Which class a semgrep rule belongs to.
 *
 * Only rules whose id states the category are classified. Everything else is
 * `unknown`, which carries a medium floor — inventing a class from a loose
 * string match would be inventing a severity along with it.
 */
function semgrepClass(checkId: string): SecurityClass {
  const id = checkId.toLowerCase();
  if (/\b(?:sqli|sql-injection|sql-string-concat|command-injection|xss|path-traversal)\b/.test(id)) {
    return 'injection';
  }
  if (/\bauthz|authorization|access-control\b/.test(id)) return 'authz';
  if (/\bauthn|authentication|jwt|session\b/.test(id)) return 'authn';
  if (/\bcrypto|hash|cipher|random\b/.test(id)) return 'crypto';
  if (/\bsecret|credential|hardcoded-token\b/.test(id)) return 'secret-exposure';
  return 'unknown';
}

const SEMGREP_SEVERITY: Record<string, FindingSeverity> = {
  ERROR: 'high',
  WARNING: 'medium',
  INFO: 'low',
};

function fromSemgrep(payload: unknown): NormalizedOutput {
  const { results, errors } = payload as { results?: unknown; errors?: unknown };
  if (!Array.isArray(results)) return UNREADABLE;
  if (errors !== undefined && (!Array.isArray(errors) || errors.length > 0)) return UNREADABLE;
  const findings: NormalizedFinding[] = [];
  for (const entry of results as unknown[]) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return UNREADABLE;
    if (!('check_id' in entry) || typeof entry.check_id !== 'string' || !entry.check_id.trim()) {
      return UNREADABLE;
    }
    const result = entry as Record<string, unknown>;
    const checkId = text(result['check_id'], 'unknown-rule');
    const file = text(result['path']) || undefined;
    const line = positiveInteger((result['start'] as { line?: unknown } | undefined)?.line);
    const extra = (result['extra'] ?? {}) as Record<string, unknown>;
    findings.push({
      adapter: 'semgrep',
      securityClass: semgrepClass(checkId),
      reportedSeverity: SEMGREP_SEVERITY[text(extra['severity'], 'INFO').toUpperCase()] ?? 'low',
      rule: checkId,
      ...(file === undefined ? {} : { file }),
      ...(line === undefined ? {} : { line }),
      summary: text(extra['message'], checkId),
      reproduction: `semgrep reported \`${checkId}\` at ${at(file, line)}`,
      remediation: 'Read the rule and fix the pattern at that line, or justify it in the ruleset.',
    });
  }
  return readable(findings);
}

function fromGitleaks(payload: unknown): NormalizedOutput {
  if (!Array.isArray(payload)) return UNREADABLE;
  const findings: NormalizedFinding[] = [];
  for (const entry of payload as Record<string, unknown>[]) {
    const rule = text(entry['RuleID'], 'unknown-rule');
    const file = text(entry['File']) || undefined;
    const line = positiveInteger(entry['StartLine']);
    // `Secret` and `Match` are deliberately never read.
    findings.push({
      adapter: 'gitleaks',
      securityClass: 'secret-exposure',
      reportedSeverity: 'critical',
      rule,
      ...(file === undefined ? {} : { file }),
      ...(line === undefined ? {} : { line }),
      summary: `${text(entry['Description'], 'credential')} detected at ${at(file, line)}`,
      reproduction: `gitleaks matched \`${rule}\` at ${at(file, line)} (value withheld)`,
      remediation:
        'Rotate the credential first — it is exposed whether or not the line is deleted — then remove it from the source and from history.',
    });
  }
  return readable(findings);
}

const OSV_SEVERITY: Record<string, FindingSeverity> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MODERATE: 'medium',
  MEDIUM: 'medium',
  LOW: 'low',
};

function fromOsv(payload: unknown): NormalizedOutput {
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return UNREADABLE;
  const findings: NormalizedFinding[] = [];
  for (const result of results as Record<string, unknown>[]) {
    const packages = Array.isArray(result['packages']) ? (result['packages'] as Record<string, unknown>[]) : [];
    for (const entry of packages) {
      const info = (entry['package'] ?? {}) as Record<string, unknown>;
      const name = text(info['name'], 'unknown package');
      const version = text(info['version']);
      const vulnerabilities = Array.isArray(entry['vulnerabilities'])
        ? (entry['vulnerabilities'] as Record<string, unknown>[])
        : [];
      for (const vulnerability of vulnerabilities) {
        const id = text(vulnerability['id'], 'unknown advisory');
        const severity = text((vulnerability['database_specific'] as { severity?: unknown } | undefined)?.severity);
        findings.push({
          adapter: 'osv-scanner',
          securityClass: 'dependency',
          reportedSeverity: OSV_SEVERITY[severity.toUpperCase()] ?? 'medium',
          rule: id,
          summary: `${name}${version === '' ? '' : `@${version}`}: ${text(vulnerability['summary'], id)}`,
          reproduction: `osv-scanner matched ${id} against ${name}${version === '' ? '' : `@${version}`}`,
          remediation: `Upgrade ${name} to a version the advisory marks fixed, or record why the path is not reachable.`,
        });
      }
    }
  }
  return readable(findings);
}

const ZAP_SEVERITY: Record<string, FindingSeverity> = {
  '3': 'high',
  '2': 'medium',
  '1': 'low',
  '0': 'info',
};

function fromZap(payload: unknown): NormalizedOutput {
  const sites = (payload as { site?: unknown }).site;
  if (!Array.isArray(sites)) return UNREADABLE;
  const findings: NormalizedFinding[] = [];
  for (const site of sites as Record<string, unknown>[]) {
    const host = text(site['@name']);
    const alerts = Array.isArray(site['alerts']) ? (site['alerts'] as Record<string, unknown>[]) : [];
    for (const alert of alerts) {
      const name = text(alert['name'], 'unnamed alert');
      const reference = text(alert['alertRef'], 'unknown');
      findings.push({
        adapter: 'zap-baseline',
        securityClass: 'misconfiguration',
        reportedSeverity: ZAP_SEVERITY[text(alert['riskcode'], '0')] ?? 'info',
        rule: reference,
        summary: `${name}${host === '' ? '' : ` on ${host}`}`,
        reproduction: `zap-baseline raised alert ${reference} (${name})${host === '' ? '' : ` against ${host}`}`,
        remediation: text(alert['solution'], 'Read the ZAP alert reference and fix the response the scan describes.'),
      });
    }
  }
  return readable(findings);
}

const NORMALIZERS: Record<string, (payload: unknown) => NormalizedOutput> = {
  semgrep: fromSemgrep,
  gitleaks: fromGitleaks,
  'osv-scanner': fromOsv,
  'zap-baseline': fromZap,
};

/**
 * Read one scanner's output.
 *
 * An adapter with no normaliser is `unreadable`, not empty: a project may
 * declare its own scanner, and until we can read what it says, its surface is
 * unmeasured rather than clean.
 */
export function normalizeScannerOutput(adapterId: string, output: string): NormalizedOutput {
  const normalize = NORMALIZERS[adapterId];
  if (normalize === undefined) return UNREADABLE;
  if (new TextEncoder().encode(output).byteLength > MAX_OUTPUT_BYTES) return UNREADABLE;
  let payload: unknown;
  try {
    payload = JSON.parse(output);
  } catch {
    return UNREADABLE;
  }
  if (typeof payload !== 'object' || payload === null) return UNREADABLE;
  return normalize(payload);
}
