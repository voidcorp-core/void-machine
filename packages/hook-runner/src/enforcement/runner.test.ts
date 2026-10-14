import {
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PRODUCT_IDENTITY } from '../identity.js';
import {
  configuredStrings,
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

describe('complete TDD evidence and operation bounds', () => {
  it.each([
    ['strict', 'exploratory', 'TDD_SIBLING_TEST_MISSING'],
    ['exploratory', 'strict', 'ALLOW'],
    ['souple', 'strict', 'TDD_SIBLING_TEST_WARNING'],
  ])('preserves oversized original mode %s over configured %s', (mode, configured, code) => {
    const root = mkdtempSync(join(tmpdir(), 'void-tdd-header-'));
    write(root, '.void/config.json', JSON.stringify({ modes: { tdd: configured } }));
    write(root, 'apps/web/src/page.ts', `// tdd-mode: ${mode}\nexport const page = 1;\n${' '.repeat(65_536)}`);
    const input = { tool_name: 'Write', tool_input: {
      file_path: 'apps/web/src/page.ts', content: 'export const page = 2;',
    } };
    expect(evaluateRule('tdd-order', input, { root }).code).toBe(code);
    write(root, 'apps/web/src/page.test.ts', 'test("page", () => {});');
    expect(evaluateRule('tdd-order', input, { root }).allow).toBe(true);
  });

  it.each(['alias/page.ts', 'absolute-root-alias'])('reconstructs exact patches through %s', (name) => {
    const root = mkdtempSync(join(tmpdir(), 'void-tdd-alias-'));
    write(root, 'apps/web/src/page.ts', 'export const page = 1;\n');
    write(root, 'apps/web/src/page.test.ts', 'test("page", () => {});');
    symlinkSync(join(root, 'apps/web/src'), join(root, 'alias'), 'junction');
    const rootAlias = `${root}-alias`;
    symlinkSync(root, rootAlias, 'junction');
    const path = name === 'absolute-root-alias' ? join(rootAlias, 'apps/web/src/page.ts') : name;
    expect(evaluateRule('tdd-order', { tool_name: 'apply_patch', tool_input: {
      patch: `*** Begin Patch\n*** Update File: ${path}\n@@\n-export const page = 1;\n+export const page = 2;\n*** End Patch`,
    } }, { root }).code).toBe('ALLOW');
  });

  it.each(['before', 'after'])('bounds marker-free focused-test work %s reconstruction', (point) => {
    const root = mkdtempSync(join(tmpdir(), 'void-focused-clock-'));
    const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(0);
    if (point === 'after') clock.mockReturnValueOnce(0);
    clock.mockReturnValue(5_000);
    try {
      const verdict = evaluateRule('no-focused-test', { tool_name: 'Write', tool_input: {
        file_path: 'page.test.ts', content: 'test("page", () => {});',
      } }, { root });
      expect(verdict.code).toBe('TEST_SYNTAX_UNVERIFIED');
      expect(verdict.message).toContain('split');
    } finally {
      clock.mockRestore();
    }
  });

  it.each(['tdd-order', 'no-focused-test'] as const)('refuses multiple aliases of one physical file for %s', (rule) => {
    const root = mkdtempSync(join(tmpdir(), 'void-hook-duplicate-'));
    const name = rule === 'tdd-order' ? 'page.ts' : 'page.test.ts';
    write(root, `apps/web/src/${name}`, 'export const page = 1;\n');
    symlinkSync(join(root, 'apps/web/src'), join(root, 'alias'), 'junction');
    const patch = ['*** Begin Patch', ...[`apps/web/src/${name}`, `alias/${name}`].flatMap((path) =>
      [`*** Update File: ${path}`, '@@', '-export const page = 1;', '+export const page = 2;']),
    '*** End Patch'].join('\n');
    const verdict = evaluateRule(rule, { tool_name: 'apply_patch', tool_input: { patch } }, { root });
    expect(verdict.allow).toBe(false);
    expect(verdict.message).toContain('physical file exactly once');
  });

  it('reconstructs focused-test patches through an internal alias', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-focused-alias-'));
    write(root, 'tests/page.test.ts', 'test("before", () => {});\n');
    symlinkSync(join(root, 'tests'), join(root, 'alias'), 'junction');
    const patch = '*** Begin Patch\n*** Update File: alias/page.test.ts\n@@\n-test("before", () => {});\n+test("after", () => {});\n*** End Patch';
    expect(evaluateRule('no-focused-test', { tool_name: 'apply_patch', tool_input: { patch } }, { root }).code)
      .toBe('ALLOW');
  });

  it('still exempts an exact edit whose complete original and result only re-export', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-tdd-barrel-'));
    write(root, 'apps/web/src/page.ts', "export { page } from './before';\n");
    expect(evaluateRule('tdd-order', { tool_name: 'Edit', tool_input: {
      file_path: 'apps/web/src/page.ts', old_string: './before', new_string: './after',
    } }, { root }).code).toBe('ALLOW');
  });

  it.each(['', '\nexport {};'])('requires coverage when an edit activates commented behavior: %s', (suffix) => {
    const root = mkdtempSync(join(tmpdir(), 'void-tdd-complete-'));
    write(root, 'apps/web/src/page.ts', `// export const page = 1;${suffix}\n`);
    const result = evaluateRule('tdd-order', { tool_name: 'Edit', tool_input: {
      file_path: 'apps/web/src/page.ts', old_string: '// ', new_string: '',
    } }, { root });
    expect(result.code).toBe('TDD_SIBLING_TEST_MISSING');
    expect(result.message).toContain('// tdd-cover: e2e');
  });

  it.each([32, 33])('bounds %s governed files before reconstructing a marker-free patch', (count) => {
    const root = mkdtempSync(join(tmpdir(), 'void-tdd-budget-'));
    const sections: string[] = [];
    for (let index = 0; index < count; index += 1) {
      write(root, `apps/web/src/file${index}.test.ts`, 'test("file", () => {});');
      sections.push(`*** Add File: apps/web/src/file${index}.ts`, '+export const value = 1;');
      sections.push(`*** Add File: docs/example${index}.ts`, '+// tdd-cover: invalid example');
    }
    const result = evaluateRule('tdd-order', { tool_name: 'apply_patch', tool_input: {
      patch: ['*** Begin Patch', ...sections, '*** End Patch'].join('\n'),
    } }, { root });
    expect(result.code).toBe(count === 32 ? 'ALLOW' : 'TDD_DECLARATION_UNVERIFIED');
    if (count === 33) expect(result.message).toContain('32');
  });

  it('refuses excessive governed files before trying unavailable original sources', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-tdd-unread-'));
    const sections = Array.from({ length: 33 }, (_, index) =>
      `*** Update File: apps/web/src/file${index}.ts\n@@\n-old\n+new`);
    const result = evaluateRule('tdd-order', { tool_name: 'apply_patch', tool_input: {
      patch: ['*** Begin Patch', ...sections, '*** End Patch'].join('\n'),
    } }, { root });
    expect(result.code).toBe('TDD_DECLARATION_UNVERIFIED');
    expect(result.message).toContain('32');
    expect(result.message).toContain('split');
  });

  it.each(['before', 'after'])('refuses at the exact aggregate deadline %s reconstruction', (point) => {
    const root = mkdtempSync(join(tmpdir(), 'void-tdd-clock-'));
    write(root, 'apps/web/src/page.test.ts', 'test("page", () => {});');
    const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(0);
    if (point === 'after') clock.mockReturnValueOnce(0);
    clock.mockReturnValue(5_000);
    try {
      const result = evaluateRule('tdd-order', { tool_name: 'Write', tool_input: {
        file_path: 'apps/web/src/page.ts', content: 'export const page = 1;',
      } }, { root });
      expect(result.code).toBe('TDD_DECLARATION_UNVERIFIED');
      expect(result.message).toContain('split');
    } finally {
      clock.mockRestore();
    }
  });

  it('shares the deadline across marker-free files rather than resetting it per file', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-tdd-shared-clock-'));
    for (const name of ['first', 'second']) write(root, `apps/web/src/${name}.test.ts`, 'test("page", () => {});');
    const clock = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(5_000);
    try {
      const result = evaluateRule('tdd-order', { tool_name: 'apply_patch', tool_input: {
        patch: '*** Begin Patch\n*** Add File: apps/web/src/first.ts\n+export const first = 1;\n*** Add File: apps/web/src/second.ts\n+export const second = 2;\n*** End Patch',
      } }, { root });
      expect(result.code).toBe('TDD_DECLARATION_UNVERIFIED');
    } finally {
      clock.mockRestore();
    }
  });
});

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

  it('resolves TDD policy against the physical project root', () => {
    const physicalRoot = mkdtempSync(join(tmpdir(), 'void-rule-root-'));
    const linkedRoot = `${physicalRoot}-link`;
    symlinkSync(physicalRoot, linkedRoot);
    write(physicalRoot, 'apps/web/src/Card.tsx', 'export const Card = 1;\n');

    const verdict = evaluateRule('tdd-order', {
      tool_name: 'Write',
      tool_input: {
        file_path: join(physicalRoot, 'apps/web/src/Card.tsx'),
        content: 'export const Card = 2;',
      },
    }, { root: linkedRoot });

    expect(verdict.allow).toBe(false);
    expect(verdict.evidence).toContain('apps/web/src/Card.tsx -> apps/web/src/Card.test.tsx');
  });

  it('does not apply project TDD policy to an absolute path outside the root', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-rule-'));
    expect(evaluateRule('tdd-order', {
      tool_name: 'Write',
      tool_input: {
        file_path: '/outside/apps/web/src/Card.tsx',
        content: 'export const Card = 1;',
      },
    }, { root }).allow).toBe(true);
  });

  it('does not follow an in-project symlink to read policy headers outside the root', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-rule-'));
    const outside = mkdtempSync(join(tmpdir(), 'void-rule-outside-'));
    write(outside, 'Card.tsx', 'export const Card = 1;\n');
    mkdirSync(join(root, 'apps/web/src'), { recursive: true });
    symlinkSync(join(outside, 'Card.tsx'), join(root, 'apps/web/src/Card.tsx'));

    expect(evaluateRule('tdd-order', {
      tool_name: 'Write',
      tool_input: {
        file_path: 'apps/web/src/Card.tsx',
        content: 'export const Card = 2;',
      },
    }, { root }).allow).toBe(true);
  });

  it('resolves the nearest existing parent before accepting a new edit path', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-rule-'));
    const outside = mkdtempSync(join(tmpdir(), 'void-rule-outside-'));
    mkdirSync(join(root, 'apps/web'), { recursive: true });
    symlinkSync(outside, join(root, 'apps/web/src'));

    expect(evaluateRule('tdd-order', {
      tool_name: 'Write',
      tool_input: {
        file_path: 'apps/web/src/New.ts',
        content: 'export const New = 1;',
      },
    }, { root }).allow).toBe(true);
  });

  it('reads mode, globs, headers and sibling tests without jq', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-rule-'));
    write(root, '.void/config.json', JSON.stringify({
      modes: { tdd: 'strict' },
      paths: { business: 'src/**', spikes: 'src/spikes/**' },
    }));
    write(root, 'src/Card.tsx', '// tdd-mode: souple\nexport const Card = 1;\n');

    const warning = evaluateRule('tdd-order', {
      tool_name: 'Edit',
      tool_input: { file_path: 'src/Card.tsx', old_string: 'export const Card = 1;', new_string: 'export const Card = 2;' },
    }, { root });
    expect(warning.code).toBe('TDD_SIBLING_TEST_WARNING');

    write(root, 'src/Card.test.tsx', 'test("Card", () => {});\n');
    expect(evaluateRule('tdd-order', {
      tool_name: 'Edit',
      tool_input: { file_path: 'src/Card.tsx', old_string: 'export const Card = 1;', new_string: 'export const Card = 3;' },
    }, { root }).allow).toBe(true);
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
describe('paths.business accepts more than one root', () => {
  it('reads a list', () => {
    expect(configuredStrings({ business: ['apps/*/src/**', 'packages/*/src/**'] }, 'business', 'x'))
      .toEqual(['apps/*/src/**', 'packages/*/src/**']);
  });

  it('still reads a single string, which is what every project declares today', () => {
    expect(configuredStrings({ business: 'apps/*/src/**' }, 'business', 'x')).toEqual(['apps/*/src/**']);
  });

  it('falls back when the key is absent or malformed', () => {
    expect(configuredStrings({}, 'business', 'x')).toEqual(['x']);
    expect(configuredStrings({ business: 7 }, 'business', 'x')).toEqual(['x']);
  });

  // An empty list would silently gate nothing, which reads as "TDD is off" with
  // no line anywhere saying so.
  it('falls back on an empty list rather than gating nothing', () => {
    expect(configuredStrings({ business: [] }, 'business', 'x')).toEqual(['x']);
  });

  it('drops non-string members instead of matching on them', () => {
    expect(configuredStrings({ business: ['a', 3, 'b'] }, 'business', 'x')).toEqual(['a', 'b']);
  });
})

// The NUL byte never reaches the control-character rule: the runner refuses the
// whole payload first, because a NUL in a JSON envelope is a parsing hazard
// before it is a style question, and that guard protects every rule at once.
//
// It refused anonymously though, and `HOOK_INPUT_BINARY` alone tells the author
// nothing about what they just wrote or what to do instead -- which is the exact
// failure the governing-skill work exists to end. The guard stays where it is;
// only the sentence changes.
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
