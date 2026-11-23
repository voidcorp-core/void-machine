import { realpathSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { isSecretEnvironment } from '../rules/protected-file.js';
import { allow, block } from '../rules/verdict.js';
import type { ReadTargets } from './shell-reads.js';
import type { RuleVerdict } from './types.js';

function secretTarget(path: string): boolean {
  // Literal secret paths and environment-prefixed globs are refused without
  // expanding them. Glob expansion would traverse unbounded project trees.
  return isSecretEnvironment(path) || /^\.env[^/]*[*?{[]/i.test(basename(path.replaceAll('\\', '/')));
}

function regularFile(path: string, cwd: string): boolean {
  try { return statSync(resolve(cwd, path)).isFile(); } catch { return false; }
}

export function secretRead(reads: ReadTargets, cwd: string): RuleVerdict {
  if (reads.paths.length + reads.searchPaths.length > 128) {
    return block('SECRET_READ_SCOPE', 'too many read targets to check; split the operation', []);
  }
  for (const path of reads.paths) {
    let physical = path;
    try { physical = realpathSync(resolve(cwd, path)); } catch {
      // Missing/glob paths still receive the lexical check. No content is read.
    }
    if (secretTarget(path) || secretTarget(physical)) {
      return block('SECRET_FILE_READ',
        'refusing to read a secret environment file; use a safe example or non-sensitive metadata', []);
    }
  }
  return reads.unsafeSearch && !reads.searchPaths.every((path) => regularFile(path, cwd))
    ? block('SECRET_READ_SCOPE',
      'search can include secret environment files; use explicit files or exclude .env* from traversal', [])
    : allow();
}
