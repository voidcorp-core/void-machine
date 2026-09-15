import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { boundaryDirection } from '../rules/boundary-direction.js';
import { controlCharacter } from '../rules/control-character.js';
import { dangerousCommand } from '../rules/dangerous-command.js';
import { designSlop } from '../rules/design-slop.js';
import { noAny } from '../rules/no-any.js';
import { noAsCast } from '../rules/no-as-cast.js';
import { noConsole } from '../rules/no-console.js';
import { noFocusedTest } from '../rules/no-focused-test.js';
import { noNull } from '../rules/no-null.js';
import { protectedFile } from '../rules/protected-file.js';
import { secretContent } from '../rules/secret-content.js';
import {
  type TddMode,
  tddApplies,
  tddOrder,
} from '../rules/tdd-order.js';
import { testName } from '../rules/test-name.js';
import { allow } from '../rules/verdict.js';
import { normalizeToolCall } from './normalize.js';
import { proposedSource } from './proposed-source.js';
import { readOriginalSource } from './original-source.js';
import { inspectSourceSyntax, unavailableSyntax } from './syntax-inspection.js';
import { isTestPath } from '../rules/source-helpers.js';
import type {
  NormalizedEdit,
  RuleVerdict,
} from './types.js';

export const MAX_HOOK_INPUT_BYTES = 1024 * 1024;

export type RuleName =
  | 'control-character'
  | 'dangerous-command'
  | 'boundary-direction'
  | 'design-slop'
  | 'no-any'
  | 'no-as-cast'
  | 'no-console'
  | 'no-focused-test'
  | 'no-null'
  | 'protected-file'
  | 'secret-content'
  | 'tdd-order'
  | 'test-name';

export interface EvaluateRuleOptions {
  readonly root: string;
  /** Trusted TypeScript caller dependency; never read from CLI arguments or hook payloads. */
  readonly syntaxInspector?: typeof inspectSourceSyntax;
  /** CI judges the checked-out final file; pre-write hooks reconstruct tool intent. */
  readonly source?: 'tool-input' | 'checked-out';
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Why the payload was refused, rather than the bare code it used to carry.
 *
 * A NUL never reaches the `control-character` rule: this guard runs first,
 * because a NUL inside a JSON envelope is a parsing hazard before it is anything
 * else, and refusing here protects every rule at once. But refusing anonymously
 * left the author with a code and no idea what they had written -- and a NUL is
 * invisible, so there is nothing to see in the editor either.
 */
const BINARY_INPUT_MESSAGE =
  'HOOK_INPUT_BINARY: a NUL byte in the tool payload. A source file holding one is'
  + ' dropped from the project graph, and no diff shows it. A fixture that needs the'
  + ' byte builds it (String.fromCharCode(0), Buffer.concat) instead of holding it'
  + ' literally.';

function containsNul(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some((item) => containsNul(item));
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value).some((item) => containsNul(item));
}

export function parseHookText(input: Uint8Array): string {
  if (input.byteLength > MAX_HOOK_INPUT_BYTES) {
    throw new Error('HOOK_INPUT_TOO_LARGE');
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(input);
  if (text.includes('\u0000')) throw new Error(BINARY_INPUT_MESSAGE);
  return text;
}

export function parseHookPayload(input: Uint8Array): unknown {
  const text = parseHookText(input);
  const parsed: unknown = JSON.parse(text);
  if (containsNul(parsed)) throw new Error(BINARY_INPUT_MESSAGE);
  return parsed;
}

function physicalPath(path: string): string {
  const absolute = resolve(path);
  let existing = absolute;
  const suffix: string[] = [];
  while (true) {
    try {
      return join(realpathSync(existing), ...suffix);
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return absolute;
      suffix.unshift(basename(existing));
      existing = parent;
    }
  }
}

export function discoverProjectRoot(start: string): string {
  let current = physicalPath(start);
  while (true) {
    if (
      existsSync(join(current, '.void', 'config.json'))
      || existsSync(join(current, '.git'))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return physicalPath(start);
    current = parent;
  }
}

function projectRelativePath(root: string, path: string): string | undefined {
  const physicalRoot = physicalPath(root);
  const absolute = physicalPath(isAbsolute(path) ? path : resolve(physicalRoot, path));
  const projectPath = relative(physicalRoot, absolute).replaceAll('\\', '/');
  return projectPath === '..' || projectPath.startsWith('../') || isAbsolute(projectPath)
    ? undefined
    : projectPath;
}

type ProjectEdit = NormalizedEdit & { readonly originalPath: string };

function projectEdits(root: string, edits: readonly NormalizedEdit[]): ProjectEdit[] {
  return edits.flatMap((edit) => {
    const path = projectRelativePath(root, edit.path);
    return path === undefined ? [] : [{ ...edit, path, originalPath: edit.path }];
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function configuredString(
  parent: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): string {
  const value = parent?.[key];
  return typeof value === 'string' ? value : fallback;
}

/**
 * One glob or several, for a key that may legitimately name more than one source
 * root. A project with business logic in both `apps/` and `packages/` could not
 * declare it while this read a single string, and the rule below already took a
 * list: the limit was here, not in the matcher. An empty or malformed list falls
 * back rather than gating nothing, because gating nothing looks exactly like
 * having the guard switched off.
 */
export function configuredStrings(
  parent: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): string[] {
  const value = parent?.[key];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    const kept = value.filter((entry): entry is string => typeof entry === 'string');
    if (kept.length > 0) return kept;
  }
  return [fallback];
}

interface TddConfig {
  readonly mode: TddMode;
  readonly businessGlobs: readonly string[];
  readonly spikesGlob: string;
}

function readTddConfig(root: string): TddConfig {
  let config: Record<string, unknown> = {};
  try {
    config = record(JSON.parse(readFileSync(join(root, '.void/config.json'), 'utf8'))) ?? {};
  } catch {
    // Missing or invalid optional config keeps safe defaults.
  }
  const modes = record(config['modes']);
  const paths = record(config['paths']);
  const configuredMode = configuredString(modes, 'tdd', 'auto');
  const mode: TddMode = configuredMode === 'strict'
    || configuredMode === 'souple'
    || configuredMode === 'exploratory'
    ? configuredMode
    : 'auto';
  return {
    mode,
    businessGlobs: configuredStrings(paths, 'business', 'apps/*/src/**'),
    spikesGlob: configuredString(paths, 'spikes', 'apps/*/scripts/spike-*'),
  };
}


function focusedVerdict(root: string, edits: readonly NormalizedEdit[], raw: unknown,
  syntaxInspector: typeof inspectSourceSyntax): RuleVerdict {
  const deadline = performance.now() + 1_000;
  const governed = projectEdits(root, edits).filter((edit) => isTestPath(edit.path) && edit.operation !== 'delete');
  const limit = () => unavailableSyntax('operation exceeds its file or one-second work budget', '',
    'split the operation into smaller edits');
  if (governed.length > 32) return limit();
  if (new Set(governed.map((edit) => edit.path)).size !== governed.length) {
    return unavailableSyntax('patch must name each physical file exactly once', '', 'combine edits to the same file');
  }
  for (const edit of governed) {
    if (performance.now() >= deadline) return limit();
    const original = readOriginalSource(join(root, edit.path));
    const proposed = proposedSource(raw, root, edit.originalPath, original.kind === 'read' ? original.source : undefined);
    if (performance.now() >= deadline) return limit();
    if (proposed.kind === 'unresolved') return unavailableSyntax(proposed.reason, edit.path,
      'provide an exact supported Edit/patch or a complete Write within 64 KiB');
    // Absence can be proven cheaply; whitespace/comments may separate property
    // tokens, so looking only for the old contiguous test.only string is unsafe.
    if (!/\b(?:only|skip|xit|xdescribe)\b|\\u/.test(proposed.content)) continue;
    // A call at the start of the complete file is certainly code. Preserve the
    // dependency-free refusal for this common case; uncertainty needs the parser.
    if (/^[ \t]*(?:(?:it|test|describe)\.only|(?:it|test)\.skip|xit|xdescribe)[ \t]*\(/.test(proposed.content)) {
      return noFocusedTest([{ path: edit.path, addedContent: proposed.content.split('\n')[0] ?? '' }]);
    }
    const verdict = syntaxInspector(root, edit.path, proposed.content, deadline - performance.now());
    if (performance.now() >= deadline) return limit();
    if (!verdict.allow) return verdict;
  }
  return governed.length > 0 && performance.now() >= deadline ? limit() : allow();
}

function declaredTest(root: string, content: string): string | undefined {
  const lines = content.split(/\r?\n/);
  if (!/^\s*\/\/\s*tdd-cover:/.test(lines[0] ?? '')) return undefined;
  const match = /^\/\/ tdd-cover: e2e (.+)$/.exec(lines[0] ?? '');
  const path = match?.[1];
  if (path === undefined || path !== path.trim() || isAbsolute(path)
    || /^[A-Za-z]:|\\/.test(path) || path.split('/').some((part) => part === '..' || part === '.')
    || !isTestPath(path)) throw new Error('declare exactly one project-relative E2E spec on the first line');
  const target = realpathSync(join(root, path));
  const location = relative(root, target);
  if (location.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || location === '..' || isAbsolute(location) || !statSync(target).isFile()) {
    throw new Error('E2E spec must be a regular file inside the physical project root');
  }
  return path;
}

function tddOperationLimit(reason: string): RuleVerdict {
  return { allow: false, code: 'TDD_DECLARATION_UNVERIFIED',
    message: `cannot verify TDD evidence: ${reason}; split the operation into smaller edits`, evidence: [] };
}

function tddVerdict(root: string, edits: readonly NormalizedEdit[], raw: unknown, checkedOut: boolean,
  syntaxInspector: typeof inspectSourceSyntax): RuleVerdict {
  const physicalRoot = physicalPath(root);
  const projectChanges = projectEdits(physicalRoot, edits);
  const config = readTddConfig(physicalRoot);
  const existingHeaders: Record<string, string | undefined> = {};
  const originalSources: Record<string, string | undefined> = {};
  const siblingTests = new Set<string>();
  const declaredTests: Record<string, string> = {};
  const proposedSources: Record<string, string> = {};
  const deadline = performance.now() + 1_000;
  const governed = projectChanges.filter((edit) => !(edit.operation === 'delete' && edit.addedContent === '')
    && tddApplies(edit.path, config.businessGlobs, [config.spikesGlob]));
  if (governed.length > 32) return tddOperationLimit('operation exceeds 32 governed production files');
  if (new Set(governed.map((edit) => edit.path)).size !== governed.length) {
    return tddOperationLimit('patch must name each physical file exactly once');
  }
  for (const edit of governed) {
    if (performance.now() >= deadline) return tddOperationLimit('operation exhausted its one-second work budget');
    const original = readOriginalSource(join(physicalRoot, edit.path));
    if (original.kind === 'unavailable') return { allow: false, code: 'TDD_DECLARATION_UNVERIFIED',
      message: 'cannot read original TDD mode; restore readable regular source before editing', evidence: [edit.path] };
    const existing = original.kind === 'read' ? original.source : undefined;
    const proposed = checkedOut
      ? existing === undefined
        ? { kind: 'unresolved' as const, reason: 'checked-out source is absent or exceeds 64 KiB' }
        : { kind: 'source' as const, content: existing }
      : proposedSource(raw, physicalRoot, edit.originalPath, existing);
    if (performance.now() >= deadline) return tddOperationLimit('operation exhausted its one-second work budget');
    if (proposed.kind === 'unresolved') return { allow: false, code: 'TDD_DECLARATION_UNVERIFIED',
      message: `cannot verify E2E declaration: ${proposed.reason}; provide exact context, or a complete Write within 64 KiB (oversized originals require replacement or restructuring)`, evidence: [edit.path] };
    const [header = '', ...body] = proposed.content.split(/\r?\n/);
    const startsWithDeclaration = /^\/\/\s*tdd-cover:/.test(header);
    if (body.some((line) => line.includes('tdd-cover:'))
      || (header.includes('tdd-cover:') && !startsWithDeclaration)) {
      const syntax = syntaxInspector(physicalRoot, edit.path, proposed.content,
        deadline - performance.now(), 'declarations');
      if (performance.now() >= deadline) return tddOperationLimit('operation exhausted its one-second work budget');
      if (syntax.code === 'TDD_DECLARATION_HEADER' && !startsWithDeclaration) {
        return { allow: false, code: 'TDD_DECLARATION_INVALID',
          message: 'put the E2E declaration on its own first line before code', evidence: [edit.path] };
      }
      if (!syntax.allow) return { ...syntax, code: syntax.code === 'TDD_DECLARATION_INVALID'
        ? syntax.code : 'TDD_DECLARATION_UNVERIFIED' };
    }
    try {
      proposedSources[edit.path] = proposed.content;
      const test = declaredTest(physicalRoot, proposed.content);
      if (test !== undefined) declaredTests[edit.path] = test;
      existingHeaders[edit.path] = original.kind === 'read' ? original.header : '';
      originalSources[edit.path] = original.kind === 'read' ? original.source : '';
    } catch {
      return { allow: false, code: 'TDD_DECLARATION_INVALID',
        message: 'put one // tdd-cover: e2e <project-relative spec> on the first line, pointing to an existing regular test file inside the project',
        evidence: [edit.path] };
    }
    for (const sibling of [
      edit.path.replace(/\.tsx$/, '.test.tsx'),
      edit.path.replace(/\.ts$/, '.test.ts'),
      edit.path.replace(/\.jsx$/, '.test.jsx'),
      edit.path.replace(/\.js$/, '.test.js'),
    ]) {
      if (sibling !== edit.path && existsSync(join(physicalRoot, sibling))) {
        siblingTests.add(sibling);
      }
    }
  }
  const verdict = tddOrder({
    edits: projectChanges,
    mode: config.mode,
    businessGlobs: config.businessGlobs,
    spikeGlobs: [config.spikesGlob],
    existingHeaders,
    originalSources,
    siblingTests,
    declaredTests,
    proposedSources,
  });
  return governed.length > 0 && performance.now() >= deadline
    ? tddOperationLimit('operation exhausted its one-second work budget') : verdict;
}

export function evaluateRule(
  rule: RuleName,
  rawInput: unknown,
  options: EvaluateRuleOptions,
): RuleVerdict {
  const call = normalizeToolCall(rawInput);
  const env = options.env ?? process.env;
  if (rule === 'dangerous-command') {
    if (call.tool !== 'Bash' && call.tool !== 'shell') return allow();
    if (env['VOID_HARNESS_ALLOW_DANGEROUS'] === '1') return allow('OVERRIDE', 'one-shot override');
    return dangerousCommand(call.command);
  }
  if (
    call.tool !== 'Edit'
    && call.tool !== 'Write'
    && call.tool !== 'apply_patch'
    && call.tool !== 'Bash'
    && call.tool !== 'shell'
  ) {
    return allow();
  }
  if (rule === 'protected-file') {
    if (env['VOID_HARNESS_ALLOW_SECRET_EDIT'] === '1') return allow('OVERRIDE', 'one-shot override');
    // Manifest ownership prohibits tool writes, not reviewed installer commits.
    // Committed diffs still receive lexical protected-path and content checks.
    const ownership = options.source === 'checked-out' ? {} : { root: options.root };
    return protectedFile(call.edits.map((edit) => edit.path), ownership);
  }
  if (rule === 'secret-content') return secretContent(call.edits);
  // Judged on the raw edits, like secrets and protected files: a NUL byte is
  // damage wherever it lands, and narrowing to the project's business paths
  // would have missed both of the two that reached committed source.
  if (rule === 'control-character') return controlCharacter(call.edits);
  if (rule === 'tdd-order') return tddVerdict(options.root, call.edits, rawInput, options.source === 'checked-out',
    options.syntaxInspector ?? inspectSourceSyntax);
  if (rule === 'no-focused-test') return focusedVerdict(options.root, call.edits, rawInput,
    options.syntaxInspector ?? inspectSourceSyntax);
  const edits = projectEdits(options.root, call.edits);
  if (rule === 'no-any') return noAny(edits);
  if (rule === 'no-as-cast') return noAsCast(edits);
  if (rule === 'no-console') return noConsole(edits, options.root);
  if (rule === 'no-null') return noNull(edits);
  if (rule === 'boundary-direction') return boundaryDirection(edits, options.root);
  if (rule === 'test-name') return testName(edits);
  if (rule === 'design-slop') return designSlop(edits);
  rule satisfies never;
  throw new Error('UNKNOWN_ENFORCEMENT_RULE');
}
