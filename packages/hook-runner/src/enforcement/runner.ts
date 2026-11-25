import {
  existsSync,
  realpathSync,
} from 'node:fs';
import {
  basename,
  dirname,
  join,
  resolve,
} from 'node:path';
import { controlCharacter } from '../rules/control-character.js';
import { dangerousCommand } from '../rules/dangerous-command.js';
import { protectedFile } from '../rules/protected-file.js';
import { secretContent } from '../rules/secret-content.js';
import { allow } from '../rules/verdict.js';
import { normalizeReadCall, normalizeToolCall } from './normalize.js';
import { secretRead } from './secret-read.js';
import { shellWriteTargets } from './shell-writes.js';
import type {
  RuleVerdict,
} from './types.js';
import { productSetting } from '../identity.js';

export const MAX_HOOK_INPUT_BYTES = 1024 * 1024;
// CI scans complete added artifacts, including bundled runtime assets. This is
// separate from runtime tool payloads and never permits truncating a scan.
export const MAX_CI_CONTENT_BYTES = 8 * 1024 * 1024;

export type RuleName =
  | 'control-character'
  | 'dangerous-command'
  | 'protected-file'
  | 'secret-content';

export interface EvaluateRuleOptions {
  readonly root: string;
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
  return decodeText(input);
}

export function parseCiContent(input: Uint8Array): string {
  if (input.byteLength > MAX_CI_CONTENT_BYTES) throw new Error('CI_CONTENT_TOO_LARGE');
  return decodeText(input);
}

function decodeText(input: Uint8Array): string {
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

/** Shared defaults for fresh project configuration. */
export const DEFAULT_PROJECT_PATHS = {
  business: ['src/**', 'apps/*/src/**'],
  tests: ['src/**/*.test.{ts,tsx}', 'apps/*/src/**/*.test.{ts,tsx}'],
  spikes: ['scripts/spike-*', 'apps/*/scripts/spike-*'],
  serverActions: ['src/app/(api|actions)/**', 'apps/*/src/app/(api|actions)/**'],
  contracts: ['src/lib/contracts/**', 'apps/*/src/lib/contracts/**'],
  e2e: ['tests/e2e/**', 'apps/*/tests/e2e/**'],
} as const;

export function evaluateRule(
  rule: RuleName,
  rawInput: unknown,
  options: EvaluateRuleOptions,
): RuleVerdict {
  const call = normalizeToolCall(rawInput,
    options.source === 'checked-out' ? MAX_CI_CONTENT_BYTES : MAX_HOOK_INPUT_BYTES);
  const env = options.env ?? process.env;
  if (rule === 'protected-file' && options.source !== 'checked-out') {
    const reads = normalizeReadCall(rawInput, options.root);
    const verdict = secretRead(reads, reads.cwd);
    if (!verdict.allow) return verdict;
  }
  if (rule === 'dangerous-command') {
    if (call.tool !== 'Bash' && call.tool !== 'shell') return allow();
    if (productSetting(env, 'ALLOW_DANGEROUS') === '1') return allow('OVERRIDE', 'one-shot override');
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
    if (productSetting(env, 'ALLOW_SECRET_EDIT') === '1') return allow('OVERRIDE', 'one-shot override');
    // Exclusive manifest ownership prohibits tool writes, not reviewed installer commits.
    // Committed diffs still receive lexical protected-path and content checks.
    const ownership = options.source === 'checked-out' ? {} : { root: options.root };
    const shellWritePaths = call.tool === 'Bash' || call.tool === 'shell'
      ? shellWriteTargets(call.command) : [];
    return protectedFile(call.edits.map((edit) => edit.path), { ...ownership, shellWritePaths });
  }
  if (rule === 'secret-content') return secretContent(call.edits);
  // Judged on the raw edits, like secrets and protected files: a NUL byte is
  // damage wherever it lands, and narrowing to the project's business paths
  // would have missed both of the two that reached committed source.
  if (rule === 'control-character') return controlCharacter(call.edits);
  rule satisfies never;
  throw new Error('UNKNOWN_ENFORCEMENT_RULE');
}
