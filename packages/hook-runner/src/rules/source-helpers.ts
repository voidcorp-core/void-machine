import type {
  RuleVerdict,
} from '../enforcement/types.js';
import { allow, block } from './verdict.js';

export function normalizedPath(path: string): string {
  return path.replaceAll('\\', '/');
}

export function evidenceVerdict(
  code: string,
  message: string,
  evidence: readonly string[],
): RuleVerdict {
  return evidence.length === 0 ? allow() : block(code, message, evidence);
}
