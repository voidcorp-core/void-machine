import type { NormalizedEdit, RuleVerdict } from '../enforcement/types.js';
import { evidenceVerdict, normalizedPath } from './source-helpers.js';

// Files whose whole meaning is that they are text. A control byte in one of
// these is never intended, and it is invisible: the editor renders nothing, the
// diff renders nothing, and review passes over it.
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|mjs|json|md|yaml|sh)$/;

/**
 * The three a text file legitimately holds. Everything else below `0x20`, plus
 * `0x7f`, is a control character. Keep this byte-level rule local to the portable hook
 * runner; it requires no indexing service.
 */
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);

function isControl(point: number): boolean {
  return (point < 0x20 || point === 0x7f) && !ALLOWED.has(point);
}

/** Enough to see the shape of the problem; not enough to bury the remedy. */
const MAX_EVIDENCE = 6;

function hexPoint(point: number): string {
  return `U+${point.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Refuse a control character written into a source file.
 *
 * On 2026-08-06 two NUL bytes reached committed source twenty minutes apart: one
 * in a key separator, one in a fixture meant to test binary detection, which
 * made the test file itself unreadable to the extractor it was testing. Neither
 * was blocked, and neither was visible.
 *
 * The cost is not cosmetic. A source file holding a NUL is excluded from
 * text indexing and can be treated as binary by search and diff tools, hiding
 * its imports, symbols and tests from inspection.
 *
 * It refuses rather than strips. Rewriting the content silently would leave the
 * author believing they wrote what they read, which is the failure mode again
 * with an extra step.
 */
export function controlCharacter(edits: readonly NormalizedEdit[]): RuleVerdict {
  const evidence: string[] = [];
  for (const edit of edits) {
    const path = normalizedPath(edit.path);
    if (!SOURCE_EXTENSIONS.test(path)) continue;
    edit.addedContent.split(/\r?\n/).forEach((line, lineIndex) => {
      [...line].forEach((character, column) => {
        if (evidence.length >= MAX_EVIDENCE) return;
        const point = character.codePointAt(0) ?? 0;
        if (!isControl(point)) return;
        evidence.push(`${path}:${lineIndex + 1}:${column + 1} ${hexPoint(point)}`);
      });
    });
  }
  return evidenceVerdict(
    'CONTROL_CHARACTER_IN_SOURCE',
    'control character in a source file; it is invisible in the diff and drops the file'
      + ' out of text indexing. A fixture that needs the byte builds it'
      + ' (String.fromCharCode(0), Buffer.concat) instead of holding it literally.',
    evidence,
  );
}
