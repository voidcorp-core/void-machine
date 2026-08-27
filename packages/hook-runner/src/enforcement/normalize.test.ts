import { describe, expect, it } from 'vitest';
import { normalizeToolCall } from './normalize.js';
import { protectedFile } from '../rules/protected-file.js';

describe('normalizeToolCall', () => {
  it.each([
    ['Read', 'file_path', 'src/claude.ts'],
    ['read_file', 'path', 'src/codex.ts'],
    ['view_image', 'path', 'assets/codex.png'],
  ])('normalizes the %s %s read path', (tool, field, path) => {
    expect(normalizeToolCall({
      tool_name: tool,
      tool_input: { [field]: path },
    }).edits).toEqual([{ path, addedContent: '' }]);
  });

  it('normalizes Claude Edit and Write content', () => {
    expect(normalizeToolCall({
      tool_name: 'Edit',
      tool_input: { file_path: 'apps/web/src/Card.tsx', new_string: 'export const Card = 1;' },
    })).toEqual({
      tool: 'Edit',
      command: '',
      edits: [{ path: 'apps/web/src/Card.tsx', addedContent: 'export const Card = 1;' }],
    });
  });

  it('normalizes a multi-file Codex apply_patch to added content only', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: apps/web/.env',
      '-OLD=gone',
      '+TOKEN=added',
      '*** Add File: apps/web/src/a.ts',
      '+export const a = 1;',
      '*** Delete File: apps/web/src/old.ts',
      '*** End Patch',
    ].join('\n');

    expect(normalizeToolCall({
      tool_name: 'apply_patch',
      tool_input: { patch },
    })).toEqual({
      tool: 'apply_patch',
      command: '',
      edits: [
        { path: 'apps/web/.env', addedContent: 'TOKEN=added\n' },
        { path: 'apps/web/src/a.ts', addedContent: 'export const a = 1;\n' },
        { path: 'apps/web/src/old.ts', addedContent: '' },
      ],
    });
  });

  it('joins shell argv and extracts an embedded apply_patch envelope', () => {
    const patch = '*** Begin Patch\n*** Update File: .env\n+S=1\n*** End Patch';
    const call = normalizeToolCall({
      tool_name: 'shell',
      tool_input: { command: ['apply_patch', patch] },
    });
    expect(call.command).toContain('apply_patch');
    expect(call.edits).toEqual([{ path: '.env', addedContent: 'S=1\n' }]);
  });

  it('rejects malformed shapes and NUL-bearing strings', () => {
    expect(() => normalizeToolCall(null)).toThrow(/invalid hook input/i);
    expect(() => normalizeToolCall({
      tool_name: 'Write',
      tool_input: { file_path: 'a.ts\u0000.env', content: 'x' },
    })).toThrow(/unsafe hook input/i);
  });
});

// The wiring, not the extraction: proving that a redirected write reaches the
// rule that refuses it. Both halves passed their own tests before this existed,
// while the path between them carried nothing.
describe('shell redirections reach the path rules', () => {
  const pathsOf = (command: string): string[] =>
    normalizeToolCall({ tool_name: 'Bash', tool_input: { command } }).edits.map((edit) => edit.path);

  it('hands a redirected secret to the protected-file rule', () => {
    expect(protectedFile(pathsOf('echo KEY=1 > .env')).allow).toBe(false);
  });

  it('hands a teed lockfile to it as well', () => {
    expect(protectedFile(pathsOf('echo x | tee pnpm-lock.yaml')).allow).toBe(false);
  });

  it('leaves an ordinary redirected command alone', () => {
    expect(protectedFile(pathsOf('pnpm test > out.log 2>&1')).allow).toBe(true);
  });
})
