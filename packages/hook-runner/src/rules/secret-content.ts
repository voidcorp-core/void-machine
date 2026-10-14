import type {
  NormalizedEdit,
  RuleVerdict,
} from '../enforcement/types.js';
import { allow, block } from './verdict.js';

const HIGH_CONFIDENCE = [
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}/,
  /\bgh[posru]_[A-Za-z0-9]{36}/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/,
  /\bsk-(?:ant|proj)-[A-Za-z0-9_-]{40,}\b/,
  /\bsk-[A-Za-z0-9]{40,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const GENERIC_ASSIGNMENT =
  /(?:_KEY|_SECRET|_TOKEN|_PASSWORD|_PASSWD|_APIKEY)["' ]*[:=]\s*["']([A-Za-z0-9+/=_-]{24,})["']/i;
// Keep camelCase suffixes case-sensitive: an unrelated word like monkey is not a key.
const CAMEL_ASSIGNMENT =
  /\b[a-z][A-Za-z0-9_$]*(?:Key|Secret|Token|Password|Passwd)["' ]*[:=]\s*["']([A-Za-z0-9+/=_-]{24,})["']/;
const PLACEHOLDER = /process\.env|import\.meta\.env|xxx|changeme|example|redacted|your[-_]|<[a-z]|placeholder|todo/i;
const EXEMPT_PATH = /\.(?:test|spec)\.|\/__tests__\/|\/__fixtures__\/|\/fixtures\/|\/__generated__\//;

// Source modules admitted by the credential-name heuristic still need content checks.
const CREDENTIAL_SOURCE_MODULE =
  /(?:secret|credential)[^/]*\.(?:[cm]?[jt]s|[jt]sx)$/i;

function lineHasSecret(line: string): boolean {
  if (line.includes('allow-secret-pattern:')) return false;
  if (HIGH_CONFIDENCE.some((pattern) => pattern.test(line))) return true;
  const assignment = line.match(GENERIC_ASSIGNMENT) ?? line.match(CAMEL_ASSIGNMENT);
  if (assignment === null || PLACEHOLDER.test(line)) return false;
  const value = assignment[1] ?? '';
  if (/^[0-9a-f]+$/i.test(value) || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    return false;
  }
  return /[A-Za-z]/.test(value) && /[0-9]/.test(value);
}

export function secretContent(edits: readonly NormalizedEdit[]): RuleVerdict {
  const evidence: string[] = [];
  for (const edit of edits) {
    const path = edit.path.replaceAll('\\', '/');
    if (EXEMPT_PATH.test(path) && !CREDENTIAL_SOURCE_MODULE.test(path)) continue;
    edit.addedContent.split(/\r?\n/).forEach((line, index) => {
      if (lineHasSecret(line)) evidence.push(`${edit.path}:${index + 1}`);
    });
  }
  return evidence.length === 0
    ? allow()
    : block('SECRET_IN_CONTENT', 'secret-in-content: likely secret detected in edited content', evidence);
}
