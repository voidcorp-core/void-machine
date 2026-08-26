import { execFile } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { promisify } from 'node:util';
import { parseDecision } from './parse.js';
import type {
  DecisionIssue,
  DecisionRecord,
} from './types.js';

const execFileAsync = promisify(execFile);
const SAFE_GIT_REF = /^(?!-)[A-Za-z0-9._/@{}^~+-]+$/;
const LOCAL_PATH_TOKEN = /(?<![A-Za-z0-9_./-])(?<path>(?:(?:\.|\.\.)\/)?[A-Za-z0-9_+.-]+(?:\/[A-Za-z0-9_+.*-]+)+\/?)(?![A-Za-z0-9_./-])/g;

export function isSafeGitRef(value: string): boolean {
  return SAFE_GIT_REF.test(value);
}

export type DecisionChange =
  | { readonly kind: 'modified'; readonly before: string }
  | { readonly kind: 'deleted'; readonly before: string }
  | {
      readonly kind: 'renamed';
      readonly before: string;
      readonly after: string;
    };

export function parseGitNameStatus(text: string): readonly DecisionChange[] {
  const changes: DecisionChange[] = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const [status = '', before = '', after = ''] = line.split('\t');
    if ((status === 'M' || status === 'T') && before !== '') {
      changes.push({ kind: 'modified', before });
    } else if (status === 'D' && before !== '') {
      changes.push({ kind: 'deleted', before });
    } else if (status.startsWith('R') && before !== '' && after !== '') {
      changes.push({ kind: 'renamed', before, after });
    }
  }
  return changes;
}

export function immutableDecisionIssues(
  changes: readonly DecisionChange[],
  baseRecords: ReadonlyMap<string, DecisionRecord>,
  allowedReferenceMigrations: ReadonlySet<string> = new Set(),
): readonly DecisionIssue[] {
  const issues: DecisionIssue[] = [];
  for (const change of changes) {
    const record = baseRecords.get(change.before);
    if (record === undefined) {
      issues.push({
        code: 'git-check-failed',
        file: change.before,
        message: 'could not prove the base decision status; immutability check fails closed',
      });
      continue;
    }
    if (record.status === 'proposed') continue;
    const suffix = `; create a new decision that supersedes '${record.id}'`;
    if (change.kind === 'modified') {
      if (allowedReferenceMigrations.has(change.before)) continue;
      issues.push({
        code: 'accepted-decision-modified',
        file: change.before,
        message: `accepted decision files are immutable${suffix}`,
      });
    } else if (change.kind === 'deleted') {
      issues.push({
        code: 'accepted-decision-deleted',
        file: change.before,
        message: `accepted decision files cannot be deleted${suffix}`,
      });
    } else {
      issues.push({
        code: 'accepted-decision-renamed',
        file: change.before,
        message: `accepted decision files cannot be renamed${suffix}`,
      });
    }
  }
  return issues;
}

interface ReferenceShape {
  readonly template: string;
  readonly references: readonly string[];
}

function referenceShape(text: string): ReferenceShape {
  const references: string[] = [];
  let template = '';
  let cursor = 0;
  for (const match of text.matchAll(LOCAL_PATH_TOKEN)) {
    const index = match.index;
    const path = match.groups?.['path'];
    if (index === undefined || path === undefined) continue;
    template += `${text.slice(cursor, index)}\0`;
    references.push(path);
    cursor = index + path.length;
  }
  return {
    template: `${template}${text.slice(cursor)}`,
    references,
  };
}

function frontmatter(text: string): string | undefined {
  return /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text)?.[0];
}

function headings(text: string): readonly string[] {
  return text.split(/\r?\n/).filter((line) => /^#{1,6}\s/.test(line));
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

function isExistingLocalTarget(root: string, target: string): boolean {
  try {
    const realRoot = realpathSync(root);
    const candidate = resolve(realRoot, target);
    if (!isInside(realRoot, candidate) || !existsSync(candidate)) return false;
    return isInside(realRoot, realpathSync(candidate));
  } catch {
    return false;
  }
}

/**
 * Accepted ADR prose stays byte-for-byte stable except for path-shaped tokens.
 * The unchanged template proves that no surrounding prose or Markdown structure
 * moved; frontmatter and headings are compared separately because paths there
 * carry decision identity rather than a mechanical reference.
 */
export function isMechanicalReferenceMigration(
  root: string,
  before: string,
  after: string,
): boolean {
  if (frontmatter(before) !== frontmatter(after)) return false;
  if (headings(before).join('\n') !== headings(after).join('\n')) return false;

  const previous = referenceShape(before);
  const current = referenceShape(after);
  if (previous.template !== current.template) return false;
  if (previous.references.length !== current.references.length) return false;

  let changed = false;
  for (const [index, target] of current.references.entries()) {
    if (target === previous.references[index]) continue;
    changed = true;
    if (!isExistingLocalTarget(root, target)) return false;
  }
  return changed;
}

function slash(path: string): string {
  return path.split(sep).join('/');
}

interface BaseDecision {
  readonly record: DecisionRecord;
  readonly text: string;
}

async function recordAtBase(
  root: string,
  base: string,
  file: string,
): Promise<BaseDecision | undefined> {
  try {
    const result = await execFileAsync('git', ['show', `${base}:${file}`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    });
    const parsed = parseDecision(result.stdout, file);
    return parsed.ok ? { record: parsed.value, text: result.stdout } : undefined;
  } catch {
    return undefined;
  }
}

function currentDecisionText(root: string, file: string): string | undefined {
  if (!isExistingLocalTarget(root, file)) return undefined;
  try {
    return readFileSync(resolve(root, file), 'utf8');
  } catch {
    return undefined;
  }
}

export async function checkDecisionImmutability(
  root: string,
  directory: string,
  base: string,
): Promise<readonly DecisionIssue[]> {
  if (!isSafeGitRef(base)) {
    return [{
      code: 'git-base-invalid',
      file: '(git)',
      message: `unsafe git base '${base}'`,
    }];
  }
  const relativeDirectory = slash(relative(resolve(root), resolve(directory)));
  try {
    const result = await execFileAsync(
      'git',
      ['diff', '--name-status', '--find-renames', base, '--', relativeDirectory],
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const changes = parseGitNameStatus(result.stdout);
    const baseRecords = new Map<string, DecisionRecord>();
    const allowedReferenceMigrations = new Set<string>();
    for (const file of new Set(changes.map((change) => change.before))) {
      const decision = await recordAtBase(root, base, file);
      if (decision === undefined) continue;
      baseRecords.set(file, decision.record);
      const current = currentDecisionText(root, file);
      if (
        decision.record.status !== 'proposed'
        && current !== undefined
        && isMechanicalReferenceMigration(root, decision.text, current)
      ) {
        allowedReferenceMigrations.add(file);
      }
    }
    return immutableDecisionIssues(
      changes,
      baseRecords,
      allowedReferenceMigrations,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [{
      code: 'git-check-failed',
      file: '(git)',
      message: `could not compare decisions with '${base}': ${message}`,
    }];
  }
}
