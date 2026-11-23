// Fresh read-only Herdr projection; no checkpoint, lock, cursor or reminder state.
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { record, within } from './executor-shared.js';

const MAX_TRANSCRIPT_BYTES = 1_048_576;
const MAX_CONFIG_BYTES = 65_536;

function canonicalDirectory(path: string): string | undefined {
  try {
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink()) return undefined;
    const canonical = realpathSync(path);
    return canonical === resolve(path) ? canonical : undefined;
  } catch {
    return undefined;
  }
}

function encodedClaudeProject(root: string): string {
  return root.replace(/[^a-zA-Z0-9]/g, '-');
}

function transcriptRoots(
  root: string,
  runtime: 'claude' | 'codex' | 'unknown',
): readonly string[] {
  const canonicalRoot = realpathSync(resolve(root));
  const candidates = [canonicalRoot];
  if (runtime === 'claude') {
    candidates.push(
      join(homedir(), '.claude', 'projects', encodedClaudeProject(canonicalRoot)),
    );
  }
  return candidates
    .map(canonicalDirectory)
    .filter((path): path is string => path !== undefined);
}

function runtimeSessionId(input: Record<string, unknown>): string | undefined {
  const value = input['session_id'] ?? input['sessionId']
    ?? input['thread_id'] ?? input['threadId'];
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(value)
    ? value
    : undefined;
}

export function isExternalTranscriptBound(
  path: string,
  runtime: 'claude' | 'codex' | 'unknown',
  sessionId: string,
): boolean {
  return runtime === 'claude'
    && /^[A-Za-z0-9_-]{8,200}$/.test(sessionId)
    && basename(path) === `${sessionId}.jsonl`;
}

interface OpenedRegularFile {
  readonly descriptor: number;
  readonly canonicalPath: string;
  readonly size: number;
}

function openBoundedRegularFile(
  path: string,
  maxBytes: number,
  allowedRoots: readonly string[],
): OpenedRegularFile | undefined {
  let descriptor: number | undefined;
  try {
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) return undefined;
    const canonicalPath = realpathSync(path);
    if (!allowedRoots.some((root) => within(root, canonicalPath))) return undefined;
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor);
    const currentPath = realpathSync(path);
    const current = statSync(currentPath);
    if (
      !opened.isFile()
      || opened.size > maxBytes
      || currentPath !== canonicalPath
      || opened.dev !== current.dev
      || opened.ino !== current.ino
      || !allowedRoots.some((root) => within(root, currentPath))
    ) {
      closeSync(descriptor);
      return undefined;
    }
    return { descriptor, canonicalPath, size: opened.size };
  } catch {
    if (descriptor !== undefined) closeSync(descriptor);
    return undefined;
  }
}

export function readBoundedDescriptor(
  descriptor: number,
  maxBytes: number,
): string | undefined {
  const bytes = Buffer.alloc(maxBytes + 1);
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
    if (count === 0) break;
    offset += count;
  }
  return offset > maxBytes ? undefined : bytes.subarray(0, offset).toString('utf8');
}

function finiteToken(value: unknown): number | undefined {
  if (value === undefined) return 0;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

type UsageLine =
  | { readonly status: 'none' | 'invalid' }
  | { readonly status: 'usage'; readonly usedTokens: number };

function usageFromLine(line: string): UsageLine {
  try {
    const parsed = record(JSON.parse(line));
    const usage = record(record(parsed?.['message'])?.['usage']);
    if (usage === undefined) return { status: 'none' };
    const input = finiteToken(usage['input_tokens']);
    const output = finiteToken(usage['output_tokens']);
    const cacheRead = finiteToken(usage['cache_read_input_tokens']);
    const cacheCreation = finiteToken(usage['cache_creation_input_tokens']);
    return input === undefined || output === undefined
      || cacheRead === undefined || cacheCreation === undefined
      ? { status: 'invalid' }
      : { status: 'usage', usedTokens: input + output + cacheRead + cacheCreation };
  } catch {
    return { status: 'invalid' };
  }
}

function observeTranscript(
  path: string,
  input: Record<string, unknown>,
  root: string,
  runtime: 'claude' | 'codex' | 'unknown',
): number | undefined {
  if (path === '' || path.length > 4_096 || path.includes('\u0000') || !isAbsolute(path)) {
    return undefined;
  }
  let descriptor: number | undefined;
  try {
    const roots = transcriptRoots(root, runtime);
    const opened = openBoundedRegularFile(path, Number.MAX_SAFE_INTEGER, roots);
    if (opened === undefined) return undefined;
    descriptor = opened.descriptor;
    const canonicalRoot = realpathSync(resolve(root));
    if (!within(canonicalRoot, opened.canonicalPath)) {
      const sessionId = runtimeSessionId(input);
      if (
        sessionId === undefined
        || !isExternalTranscriptBound(opened.canonicalPath, runtime, sessionId)
      ) {
        return undefined;
      }
    }
    const available = opened.size;
    if (available === 0) return undefined;
    const readStart = available > MAX_TRANSCRIPT_BYTES
      ? opened.size - MAX_TRANSCRIPT_BYTES
      : 0;
    const requested = Math.min(MAX_TRANSCRIPT_BYTES, opened.size - readStart);
    const bytes = Buffer.alloc(requested);
    const bytesRead = readSync(descriptor, bytes, 0, requested, readStart);
    const bounded = bytes.subarray(0, bytesRead);
    let contentStart = 0;
    if (readStart > 0) {
      const firstNewline = bounded.indexOf(0x0a);
      if (firstNewline < 0) return undefined;
      contentStart = firstNewline + 1;
    }
    const lastNewline = bounded.lastIndexOf(0x0a);
    if (lastNewline < contentStart) return undefined;
    const complete = bounded.subarray(contentStart, lastNewline).toString('utf8');
    let usedTokens: number | undefined;
    for (const line of complete.split('\n')) {
      if (line.trim() === '') continue;
      const usage = usageFromLine(line);
      if (usage.status === 'usage') {
        usedTokens = usage.usedTokens;
      }
    }
    return usedTokens;
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function contextConfig(root: string): unknown {
  let descriptor: number | undefined;
  try {
    const canonicalRoot = realpathSync(resolve(root));
    const opened = openBoundedRegularFile(
      join(canonicalRoot, '.void', 'config.json'),
      MAX_CONFIG_BYTES,
      [canonicalRoot],
    );
    if (opened === undefined) return undefined;
    descriptor = opened.descriptor;
    const raw = readBoundedDescriptor(descriptor, MAX_CONFIG_BYTES);
    return raw === undefined ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function measureHerdrContext(
  input: Record<string, unknown>, root: string,
  runtime: 'claude' | 'codex' | 'unknown',
): number | undefined {
  if (runtime !== 'claude' || input['source'] === 'clear') return undefined;
  const path = input['transcript_path'];
  if (typeof path !== 'string') return undefined;
  const usedTokens = observeTranscript(path, input, root, runtime);
  const window = record(record(contextConfig(root))?.['context'])?.['windowTokens'];
  if (usedTokens === undefined || !Number.isSafeInteger(usedTokens) || usedTokens < 0
    || typeof window !== 'number' || !Number.isSafeInteger(window) || window <= 0) return undefined;
  return (usedTokens / window) * 100;
}
