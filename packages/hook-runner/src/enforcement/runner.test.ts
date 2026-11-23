import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRODUCT_IDENTITY } from '../identity.js';
import {
  evaluateRule,
  MAX_HOOK_INPUT_BYTES,
  parseHookText,
  parseHookPayload,
} from './runner.js';

function write(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

describe('co-owned enforcement across tool adapters', () => {
  it.each(['Bash', 'shell'])('refuses uninspectable credential-named source writes through %s', (tool) => {
    const root = mkdtempSync(join(tmpdir(), 'void-shell-content-'));
    const target = 'fixtures/client-secrets.mjs';
    const safe = 'ordinary.test.ts';
    const windows = 'C:\\project\\__fixtures__\\CREDENTIALS.CTS';
    const commands = [
      `printf synthetic > ${target}`, `printf synthetic >> '${target}'`,
      `printf synthetic 2> "${target}"`, `printf synthetic &> ${target}`,
      `printf synthetic | tee ${target}`, `printf synthetic | tee -a '${target}'`,
      `printf synthetic > '${windows}'`,
      `printf synthetic > ${safe}; printf synthetic > ${target}`,
      `printf synthetic > ${target}; printf synthetic > ${safe}`,
      `printf synthetic > ${target} # allow-secret-pattern: cannot inspect a shell write`,
    ];
    for (const command of commands) {
      const payload = { tool_name: tool, tool_input: { command } };
      const verdicts = (['protected-file', 'secret-content'] as const).map((rule) =>
        evaluateRule(rule, payload, { root, env: {} }));
      expect(verdicts[0]).toMatchObject({ allow: false, code: 'PROTECTED_FILE' });
      expect(verdicts.some((verdict) => !verdict.allow)).toBe(true);
    }
  });

  it.each(['Write', 'Edit', 'apply_patch'])('permits inspectable empty source modules through %s', (tool) => {
    const root = mkdtempSync(join(tmpdir(), 'void-empty-content-'));
    const path = 'client-secrets.mjs';
    const payload = tool === 'apply_patch'
      ? { tool_name: tool, tool_input: {
        patch: `*** Begin Patch\n*** Update File: ${path}\n@@\n-old\n+\n*** End Patch`,
      } }
      : { tool_name: tool, tool_input: { file_path: path, content: '', new_string: '' } };
    for (const rule of ['protected-file', 'secret-content'] as const) {
      expect(evaluateRule(rule, payload, { root, env: {} }).code).toBe('ALLOW');
    }
  });

  it('does not let inspectable patch content hide a shell write to the same target', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-mixed-shell-content-'));
    const target = 'client-secrets.mjs';
    const patch = `*** Begin Patch\n*** Update File: ${target}\n@@\n-old\n+synthetic\n*** End Patch`;
    const payload = { tool_name: 'shell', tool_input: {
      command: `apply_patch '${patch}'; printf synthetic > ${target}`,
    } };
    expect(evaluateRule('protected-file', payload, { root, env: {} }))
      .toMatchObject({ allow: false, code: 'PROTECTED_FILE' });
  });

  function rootWithManifest(paths: readonly string[]): string {
    const root = mkdtempSync(join(tmpdir(), `${PRODUCT_IDENTITY.packageName}-co-owned-`));
    write(root, '.void/install-manifest.json', JSON.stringify({ files: paths.map((path) => ({ path })) }));
    return root;
  }

  function edit(tool: string, path: string, content: string): unknown {
    return tool === 'apply_patch'
      ? { tool_name: tool, tool_input: {
        patch: `*** Begin Patch\n*** Update File: ${path}\n@@\n-old\n+${content}\n*** End Patch`,
      } }
      : { tool_name: tool, tool_input: { file_path: path, content, new_string: content } };
  }

  it.each(['Write', 'Edit', 'apply_patch'])(
    'scans newly permitted source content through %s', (tool) => {
      const root = rootWithManifest([]);
      const path = join(root, 'fixtures/client-secrets.mjs');
      for (const source of ['tool-input', 'checked-out'] as const) {
        for (const content of [`AKIA${'A1'.repeat(8)}`, `SERVICE_TOKEN="${'Az19'.repeat(8)}"`]) {
          const payload = edit(tool, path, content);
          expect(evaluateRule('protected-file', payload, { root, source, env: {} }).code).toBe('ALLOW');
          const verdict = evaluateRule('secret-content', payload, { root, source, env: {} });
          expect(verdict).toMatchObject({ allow: false, code: 'SECRET_IN_CONTENT' });
          expect(verdict.evidence).toEqual([`${path}:1`]);
        }
      }
    },
  );

  it.each(['Write', 'Edit', 'apply_patch'])(
    'allows credential automation source through %s', (tool) => {
      const root = rootWithManifest([]);
      for (const source of ['tool-input', 'checked-out'] as const) {
        const payload = edit(tool, join(root, 'deploy/infisical/client-secrets.mjs'),
          'export async function provision(generate, store) { await store(await generate()); }');
        expect(evaluateRule('protected-file', payload, { root, source, env: {} }))
          .toMatchObject({ allow: true, code: 'ALLOW' });
        expect(evaluateRule('secret-content', payload, { root, source, env: {} }).code).toBe('ALLOW');
      }
    },
  );

  it.each(['Bash', 'shell', 'apply_patch'])(
    'preserves protected targets beside a synthetic test through %s', (tool) => {
      const owned = 'managed/client-secrets.test.mjs';
      const root = rootWithManifest([owned]);
      const payload = (paths: readonly string[]) => tool === 'apply_patch'
        ? { tool_name: tool, tool_input: { patch: ['*** Begin Patch', ...paths.flatMap((path) =>
          [`*** Update File: ${path}`, '@@', '-old', '+synthetic']), '*** End Patch'].join('\n') } }
        : { tool_name: tool, tool_input: {
          command: paths.map((path) => `printf synthetic > '${path}'`).join('; '),
        } };
      const allowed = join(root, tool === 'apply_patch' ? 'client-secrets.test.mjs' : 'ordinary.test.ts');
      expect(evaluateRule('protected-file', payload([allowed]), { root, env: {} }).code).toBe('ALLOW');
      for (const path of [owned, '.env.test.mjs', 'secrets.json', 'private.key',
        '.aws/credentials', '.git/client-secrets.test.mjs', 'pnpm-lock.yaml',
        'client-secrets.test.json', 'client-secrets.test.mjs.bak']) {
        const denied = join(root, path);
        for (const paths of [[allowed, denied], [denied, allowed]]) {
          const verdict = evaluateRule('protected-file', payload(paths), { root, env: {} });
          expect(verdict).toMatchObject({ allow: false, code: 'PROTECTED_FILE' });
          expect(verdict.evidence[0]?.startsWith(`${denied}:`)).toBe(true);
        }
      }
    },
  );

  it.each(['Write', 'Edit', 'apply_patch'])(
    'permits project doctrine in tool-input and checked-out evidence through %s', (tool) => {
      const path = '.void/PROJECT-DOCTRINE.md';
      const root = rootWithManifest([path]);
      for (const source of ['tool-input', 'checked-out'] as const) {
        const verdict = evaluateRule('protected-file', edit(tool, join(root, path), 'approved prose'),
          { root, source, env: {} });
        expect(verdict).toMatchObject({ allow: true, code: 'ALLOW' });
      }
    },
  );

  it.each(['Bash', 'apply_patch'])(
    'judges every normalized target of a multi-file %s operation', (tool) => {
      const exclusive = '.void/hooks/runner.mjs';
      const namesakes = ['nested/AGENTS.md', 'agents.md', 'AGENTS.md.bak'];
      const root = rootWithManifest(['AGENTS.md', 'CLAUDE.md', exclusive, ...namesakes]);
      const payload = (paths: readonly string[]) => tool === 'Bash'
        ? { tool_name: tool, tool_input: { command: paths.map((path) => `printf updated > '${path}'`).join('; ') } }
        : { tool_name: tool, tool_input: { patch: ['*** Begin Patch', ...paths.flatMap((path) =>
          [`*** Update File: ${path}`, '@@', '-old', '+updated']), '*** End Patch'].join('\n') } };
      const allowed = ['./folder/../AGENTS.md', join(root, 'CLAUDE.md')];
      expect(evaluateRule('protected-file', payload(allowed), { root, env: {} }).code).toBe('ALLOW');
      for (const path of [exclusive, ...namesakes, '.env', 'private.key', 'pnpm-lock.yaml', '.git/config']) {
        const denied = join(root, path);
        for (const paths of [[...allowed, denied], [denied, ...allowed]]) {
          const verdict = evaluateRule('protected-file', payload(paths), { root, env: {} });
          expect(verdict).toMatchObject({ allow: false, code: 'PROTECTED_FILE' });
          expect(verdict.evidence[0]?.startsWith(`${denied}:`)).toBe(true);
        }
      }
    },
  );

  it.each(['Write', 'apply_patch'])('retains co-owned content checks through %s', (tool) => {
    const root = rootWithManifest(['AGENTS.md']);
    const cases = [
      ['secret-content', `AKIA${'Z'.repeat(16)}`, 'SECRET_IN_CONTENT'],
      ['control-character', `prose${String.fromCharCode(1)}`, 'CONTROL_CHARACTER_IN_SOURCE'],
    ] as const;
    for (const [rule, content, code] of cases) {
      const payload = edit(tool, 'AGENTS.md', content);
      for (const source of ['tool-input', 'checked-out'] as const) {
        expect(evaluateRule('protected-file', payload, { root, source, env: {} }).code).toBe('ALLOW');
        const verdict = evaluateRule(rule, payload, { root, source, env: {} });
        expect(verdict).toMatchObject({ allow: false, code });
        expect(verdict.evidence[0]).toContain('AGENTS.md:1');
      }
    }
  });
});

describe('parseHookPayload', () => {
  it('accepts bounded UTF-8 JSON', () => {
    expect(parseHookPayload(Buffer.from('{"tool_name":"Read"}'))).toEqual({
      tool_name: 'Read',
    });
  });

  it.each([
    ['invalid JSON', Buffer.from('{')],
    ['binary NUL', Buffer.from('{"x":"\\u0000"}\u0000')],
    ['oversized input', Buffer.alloc(MAX_HOOK_INPUT_BYTES + 1, 0x61)],
  ])('fails safe on %s', (_name, input) => {
    expect(() => parseHookPayload(input)).toThrow();
  });
});

describe('parseHookText', () => {
  it('preserves bounded diff content and rejects binary input', () => {
    expect(parseHookText(Buffer.from('added line\n'))).toBe('added line\n');
    expect(() => parseHookText(Buffer.from([0xff]))).toThrow();
  });
});

describe('evaluateRule', () => {
  it('gives Claude and Codex edits the same protected-file verdict', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-rule-'));
    const claude = evaluateRule('protected-file', {
      tool_name: 'Write',
      tool_input: { file_path: '.env', content: 'x' },
    }, { root });
    const codex = evaluateRule('protected-file', {
      tool_name: 'apply_patch',
      tool_input: {
        patch: '*** Begin Patch\n*** Update File: .env\n+X=1\n*** End Patch',
      },
    }, { root });
    expect(codex).toEqual(claude);
    expect(claude.allow).toBe(false);
  });

  it.each(['.void/hooks/runner.mjs', '.codex/hooks.json'])(
    'distinguishes an attempted installed-asset edit from a committed diff: %s', (path) => {
      const root = mkdtempSync(join(tmpdir(), 'void-installed-diff-'));
      write(root, '.void/install-manifest.json', JSON.stringify({ files: [{ path }] }));
      const payload = { tool_name: 'Write', tool_input: { file_path: path, content: '{}' } };
      expect(evaluateRule('protected-file', payload, { root }).allow).toBe(false);
      expect(evaluateRule('protected-file', payload, { root, source: 'checked-out' }).allow).toBe(true);
    },
  );

  it.each(['.env', 'private.key', '.git/config', 'pnpm-lock.yaml'])(
    'retains protected-path refusal in committed evidence even when installed: %s', (path) => {
      const root = mkdtempSync(join(tmpdir(), 'void-protected-diff-'));
      write(root, '.void/install-manifest.json', JSON.stringify({ files: [{ path }] }));
      const payload = { tool_name: 'Write', tool_input: { file_path: path, content: '' } };
      const verdict = evaluateRule('protected-file', payload, { root, source: 'checked-out' });
      expect(verdict.allow).toBe(false);
      expect(verdict.evidence.join(' ')).not.toContain('delivered harness asset');
    },
  );

  it('normalizes an argv command before dangerous-command enforcement', () => {
    const verdict = evaluateRule('dangerous-command', {
      tool_name: 'shell',
      tool_input: { command: ['sh', '-c', 'rm -rf /'] },
    }, { root: process.cwd() });
    expect(verdict.allow).toBe(false);
  });

  it('honors only the rule-specific one-shot overrides', () => {
    expect(evaluateRule('dangerous-command', {
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
    }, {
      root: process.cwd(),
      env: { VOID_HARNESS_ALLOW_DANGEROUS: '1' },
    }).allow).toBe(true);
    expect(evaluateRule('protected-file', {
      tool_name: 'Write',
      tool_input: { file_path: '.env', content: 'x' },
    }, {
      root: process.cwd(),
      env: { VOID_HARNESS_ALLOW_SECRET_EDIT: '1' },
    }).allow).toBe(true);
  });

  it('reads the overrides under the current prefix, which wins over the deprecated one', () => {
    const dangerous = { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } };
    const allowed = (env: Record<string, string>) =>
      evaluateRule('dangerous-command', dangerous, { root: process.cwd(), env }).allow;
    expect(allowed({ VOID_MACHINE_ALLOW_DANGEROUS: '1' })).toBe(true);
    // A person who turned the override off under the new name is not overruled by a stale one.
    expect(allowed({ VOID_MACHINE_ALLOW_DANGEROUS: '0', VOID_HARNESS_ALLOW_DANGEROUS: '1' })).toBe(false);
    expect(evaluateRule('protected-file', {
      tool_name: 'Write',
      tool_input: { file_path: '.env', content: 'x' },
    }, { root: process.cwd(), env: { VOID_MACHINE_ALLOW_SECRET_EDIT: '1' } }).allow).toBe(true);
  });
});

// `paths.business` was read as a single string while the rule below it already
// took a list, so a project could never gate two source roots at once. This
// repository is the case in point: its own densest logic lives in packages/,
// which the one available glob could not reach while apps/ was declared.
describe('the binary-input guard says what it caught', () => {
  const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
  const NUL = String.fromCharCode(0);

  it('still refuses a payload carrying a NUL byte', () => {
    expect(() => parseHookPayload(encode({ tool_input: { content: `a${NUL}b` } })))
      .toThrow(/HOOK_INPUT_BINARY/);
  });

  it('names the byte and the remedy rather than a bare code', () => {
    let message = '';
    try {
      parseHookPayload(encode({ tool_input: { content: `a${NUL}b` } }));
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('NUL');
    expect(message).toContain('String.fromCharCode');
  });
});
