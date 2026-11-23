import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { isExternalTranscriptBound, measureHerdrContext, readBoundedDescriptor } from './herdr-context.js';

const roots: string[] = [];
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'herdr-context-')));
  roots.push(root);
  mkdirSync(join(root, '.void/machine'), { recursive: true });
  writeFileSync(join(root, '.void/config.json'), JSON.stringify({ context: { windowTokens: 1000 } }));
  return root;
}
const usage = (tokens: number) => JSON.stringify({ message: { usage: { input_tokens: tokens } } });
function measure(root: string, path = join(root, 'transcript.jsonl'), extra: object = {}) {
  return measureHerdrContext({ transcript_path: path, ...extra }, root, 'claude');
}
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('reads fresh complete usage without creating or changing checkpoint state', () => {
  const root = fixture();
  const checkpoint = join(root, '.void/machine/checkpoint.md');
  writeFileSync(checkpoint, '## Objective\n\nKeep my manual note.\n');
  writeFileSync(join(root, 'transcript.jsonl'), `${usage(100)}\nbroken\n${usage(420)}\n${usage(999)}`);
  expect(measure(root)).toBe(42);
  expect(readFileSync(checkpoint, 'utf8')).toBe('## Objective\n\nKeep my manual note.\n');
  expect(readdirSync(join(root, '.void/machine'))).toEqual(['checkpoint.md']);
  writeFileSync(join(root, 'transcript.jsonl'), `${usage(250)}\n`);
  expect(measure(root)).toBe(25);
});

it('does not invent a window, reuse pre-clear usage or claim Codex parity', () => {
  const root = fixture();
  const path = join(root, 'transcript.jsonl');
  writeFileSync(path, `${usage(420)}\n`);
  expect(measure(root, path, { source: 'clear' })).toBeUndefined();
  expect(measureHerdrContext({ transcript_path: path }, root, 'codex')).toBeUndefined();
  expect(measureHerdrContext({ transcript_path: path }, root, 'unknown')).toBeUndefined();
  writeFileSync(join(root, '.void/config.json'), '{}');
  expect(measure(root)).toBeUndefined();
  expect(existsSync(join(root, '.void/machine/checkpoint.md'))).toBe(false);
});

it('keeps the last complete usage in a bounded transcript tail', () => {
  const root = fixture();
  writeFileSync(join(root, 'transcript.jsonl'), `${'x'.repeat(2_000_000)}\n${usage(730)}\n`);
  expect(measure(root)).toBe(73);
  const file = join(root, 'growing.txt');
  writeFileSync(file, '12345678901');
  const descriptor = openSync(file, 'r');
  try { expect(readBoundedDescriptor(descriptor, 10)).toBeUndefined(); }
  finally { closeSync(descriptor); }
});

it('refuses foreign and symlinked transcripts and unsafe configuration', () => {
  const root = fixture();
  const outside = fixture();
  const foreign = join(outside, 'transcript.jsonl');
  writeFileSync(foreign, `${usage(900)}\n`);
  expect(measure(root, foreign)).toBeUndefined();
  const path = join(root, 'transcript.jsonl');
  symlinkSync(foreign, path);
  expect(measure(root)).toBeUndefined();
  unlinkSync(path);
  writeFileSync(path, `${usage(900)}\n`);
  const config = join(root, '.void/config.json');
  unlinkSync(config);
  symlinkSync(join(outside, '.void/config.json'), config);
  expect(measure(root)).toBeUndefined();
  unlinkSync(config);
  writeFileSync(config, ' '.repeat(70_000));
  expect(measure(root)).toBeUndefined();
});

it('requires exact strong Claude session binding in the canonical runtime project directory', () => {
  const root = fixture();
  const home = fixture();
  vi.stubEnv('HOME', home);
  const directory = join(home, '.claude/projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'claude-session.jsonl');
  writeFileSync(path, `${usage(640)}\n`);
  expect(measure(root, path)).toBeUndefined();
  expect(measure(root, path, { session_id: 'other-session' })).toBeUndefined();
  expect(measure(root, path, { session_id: 'claude-session' })).toBe(64);
  expect(isExternalTranscriptBound(path, 'codex', 'claude-session')).toBe(false);
  expect(isExternalTranscriptBound(path, 'claude', 'x')).toBe(false);
});
