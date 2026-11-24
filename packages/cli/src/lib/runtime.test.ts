import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectRuntimes, parseRuntimeArg, resolveRuntimes, ALL_RUNTIMES } from './runtime.js';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'void-runtime-'));
}

describe('detectRuntimes', () => {
  it('detects claude from CLAUDE.md and codex from AGENTS.md', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'CLAUDE.md'), '# x');
    writeFileSync(join(dir, 'AGENTS.md'), '# x');
    expect([...detectRuntimes(dir)].sort()).toEqual(['claude', 'codex']);
  });

  it('does not mistake common AGENTS imported by Claude for Codex wiring', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
    writeFileSync(join(dir, 'AGENTS.md'), '# shared');
    expect([...detectRuntimes(dir)]).toEqual(['claude']);
    mkdirSync(join(dir, '.codex'));
    expect([...detectRuntimes(dir)]).toEqual(['claude', 'codex']);
  });

  it('detects claude from a .claude/ directory alone', () => {
    const dir = scratch();
    mkdirSync(join(dir, '.claude'));
    expect(detectRuntimes(dir).has('claude')).toBe(true);
    expect(detectRuntimes(dir).has('codex')).toBe(false);
  });

  it('detects codex from a .codex/ directory alone', () => {
    const dir = scratch();
    mkdirSync(join(dir, '.codex'));
    expect(detectRuntimes(dir).has('codex')).toBe(true);
    expect(detectRuntimes(dir).has('claude')).toBe(false);
  });

  it('is empty on a greenfield project', () => {
    expect(detectRuntimes(scratch()).size).toBe(0);
  });
});

describe('parseRuntimeArg', () => {
  it('maps both/all to every runtime', () => {
    expect(parseRuntimeArg('both')).toEqual([...ALL_RUNTIMES]);
    expect(parseRuntimeArg('all')).toEqual([...ALL_RUNTIMES]);
  });

  it('parses a comma list in canonical order, deduped', () => {
    expect(parseRuntimeArg('codex,claude,codex')).toEqual(['claude', 'codex']);
  });

  it('drops unknown tokens', () => {
    expect(parseRuntimeArg('hermes,claude')).toEqual(['claude']);
    expect(parseRuntimeArg('bogus')).toEqual([]);
  });
});

describe('resolveRuntimes', () => {
  it('honors an explicit selection over detection', () => {
    expect(resolveRuntimes(['codex'], new Set(['claude']))).toEqual(['codex']);
  });

  it('falls back to the detected set when nothing is explicit', () => {
    expect(resolveRuntimes([], new Set(['claude']))).toEqual(['claude']);
  });

  it('defaults to both on a greenfield project', () => {
    expect(resolveRuntimes([], new Set())).toEqual([...ALL_RUNTIMES]);
  });
});
