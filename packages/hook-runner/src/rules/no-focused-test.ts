import type {
  NormalizedEdit,
  RuleVerdict,
} from '../enforcement/types.js';
import {
  evidenceVerdict,
  isTestPath,
  lineEvidence,
} from './source-helpers.js';

const FOCUSED = /\b(?:it|test|describe)\.only\b|\b(?:it|test|describe)\.skip\b|\b(?:xit|xdescribe|fit|fdescribe)\b/;

export function noFocusedTest(edits: readonly NormalizedEdit[]): RuleVerdict {
  return evidenceVerdict(
    'FOCUSED_OR_SKIPPED_TEST',
    'focused or skipped test detected; use todo only for explicitly pending coverage',
    lineEvidence(edits, isTestPath, (line) => FOCUSED.test(line)),
  );
}
