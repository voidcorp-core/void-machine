// @test-resource filesystem
// Real AST semantics run against the trusted harness compiler without spawning a parser.
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ts from 'typescript';
import { analyzeSyntax } from './syntax-analysis.js';
import { syntaxVerdict, type inspectSourceSyntax } from './syntax-inspection.js';
import { describe, expect, it } from 'vitest';
import { evaluateRule as runRule } from './runner.js';

const syntaxInspector: typeof inspectSourceSyntax = (_root, path, source, _remaining, purpose = 'focused-tests') => {
  try {
    return syntaxVerdict(analyzeSyntax(ts, { path, source, purpose }), path, purpose);
  } catch {
    return syntaxVerdict({ unavailable: 'source could not be parsed within the supported limits' }, path, purpose);
  }
};

const evaluateRule: typeof runRule = (rule, input, options) => {
  const dependencies = { ...options, syntaxInspector };
  return runRule(rule, input, dependencies);
};

function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hook-evidence-')));
  mkdirSync(join(root, 'apps/web/src'), { recursive: true });
  mkdirSync(join(root, 'tests/e2e'), { recursive: true });
  writeFileSync(join(root, 'tests/e2e/page.spec.ts'), 'test("renders the route", () => {});');
  return root;
}

describe('evidence-aware hooks', () => {
  it.each(['xit', 'xdescribe'].flatMap((alias) => [
    `${alias}.each([1])("case %s", () => {});`,
    `${alias}.each\`value\n${1}\`("case", () => {});`,
    `(${alias}).each([1])("case", () => {});`,
    `${alias}['each']([1])("case", () => {});`,
    `(${alias} as Function)("case", () => {});`,
  ]))('refuses executable skipped-alias chains: %s', (content) => {
    expect(evaluateRule('no-focused-test', { tool_name: 'Write', tool_input: {
      file_path: 'page.test.ts', content,
    } }, { root: project() }).code).toBe('FOCUSED_OR_SKIPPED_TEST');
  });

  it.each(['// xit.each([1])', 'const prose = "xdescribe.each([1])";'])
    ('accepts skipped-alias prose: %s', (content) => {
      expect(evaluateRule('no-focused-test', { tool_name: 'Write', tool_input: {
        file_path: 'page.test.ts', content,
      } }, { root: project() }).allow).toBe(true);
    });

  it.each([
    'export const page = 1; // tdd-cover: e2e missing.spec.ts',
    '// tdd-cover: e2e tests/e2e/page.spec.ts\nexport const page = 1; // tdd-cover: e2e missing.spec.ts',
    'export const page = 1;\nexport const extra = 2; // tdd-cover: e2e missing.spec.ts',
  ])('refuses trailing declaration comments despite existing coverage: %s', (content) => {
    const root = project();
    writeFileSync(join(root, 'apps/web/src/page.test.ts'), 'test("page", () => {});');
    expect(evaluateRule('tdd-order', { tool_name: 'Write', tool_input: {
      file_path: 'apps/web/src/page.ts', content,
    } }, { root }).code).toBe('TDD_DECLARATION_INVALID');
  });

  it.each([false, true])('ignores declaration prose in a template with header=%s', (header) => {
    const root = project();
    const marker = '// tdd-cover: e2e tests/e2e/page.spec.ts';
    writeFileSync(join(root, 'apps/web/src/page.test.tsx'), 'test("page", () => {});');
    const content = `${header ? `${marker}\n` : ''}export const example = \`\n${marker}\n\`;`;
    const verdict = evaluateRule('tdd-order', { tool_name: 'Write', tool_input: {
      file_path: join(root, 'apps/web/src/page.tsx'), content,
    } }, { root });
    expect(verdict.code).toBe(header ? 'TDD_DECLARED_TEST' : 'ALLOW');
  });

  it.each(['Edit', 'apply_patch'])('keeps removal-only %s updates under the original test floor', (tool) => {
    const root = project();
    const path = join(root, 'apps/web/src/page.tsx');
    writeFileSync(path, 'export const page = 1;\n');
    const tool_input = tool === 'Edit'
      ? { file_path: path, old_string: 'export const page = 1;\n', new_string: '' }
      : { patch: '*** Begin Patch\n*** Update File: apps/web/src/page.tsx\n@@\n-export const page = 1;\n*** End Patch' };
    expect(evaluateRule('tdd-order', { tool_name: tool, tool_input }, { root }).code)
      .toBe('TDD_SIBLING_TEST_MISSING');
  });

  it('does not infer a barrel exemption from an unread oversized original', () => {
    const root = project();
    const path = join(root, 'apps/web/src/page.tsx');
    writeFileSync(path, `export const page = 1;\n${' '.repeat(65_536)}`);
    expect(evaluateRule('tdd-order', { tool_name: 'Write', tool_input: {
      file_path: path, content: '',
    } }, { root }).code).toBe('TDD_SIBLING_TEST_MISSING');
  });

  it.each([
    [`export const prose = \`before\n// tdd-cover: invalid example\n\${1}\nafter\`;`, 'ALLOW'],
    ['export const prose = <div>\n// tdd-cover: invalid example\n</div>;', 'ALLOW'],
    ['/*\n// tdd-cover: invalid example\n*/\nexport const page = 1;', 'ALLOW'],
    ['export const page = 1;\n// tdd-cover: e2e tests/e2e/page.spec.ts', 'TDD_DECLARATION_INVALID'],
    [`export const page = \`\${(() => {\n// tdd-cover: e2e tests/e2e/page.spec.ts\nreturn 1; })()}\`;`, 'TDD_DECLARATION_INVALID'],
  ])('uses comment syntax for declaration-shaped prose: %s', (content, code) => {
    const root = project();
    writeFileSync(join(root, 'apps/web/src/page.test.tsx'), 'test("page", () => {});');
    expect(evaluateRule('tdd-order', { tool_name: 'Write', tool_input: {
      file_path: join(root, 'apps/web/src/page.tsx'), content,
    } }, { root }).code).toBe(code);
  });

  it.each(['page.spec.ts', 'missing.spec.ts'])('discovers partial declaration edits for %s', (spec) => {
    const root = project();
    const path = join(root, 'apps/web/src/page.tsx');
    const original = `// cover: e2e tests/e2e/${spec}\nexport const page = 1;`;
    writeFileSync(path, original);
    const write = evaluateRule('tdd-order', { tool_name: 'Write', tool_input: {
      file_path: path, content: original.replace('cover', 'tdd-cover'),
    } }, { root });
    const edit = evaluateRule('tdd-order', { tool_name: 'Edit', tool_input: {
      file_path: path, old_string: 'cover', new_string: 'tdd-cover',
    } }, { root });
    expect(write.code).toBe(spec === 'page.spec.ts' ? 'TDD_DECLARED_TEST' : 'TDD_DECLARATION_INVALID');
    expect(edit).toEqual(write);
  });

  it.each([
    '// Explain why test.skip is not used.\ntest("renders", () => {});',
    '/**\n * Avoid test.skip in this suite.\n */\ntest("renders", () => {});',
    'const label = "test.only"; const pattern = /test.skip/;',
    'const prose = `Explain test.only`; test("renders", () => {});',
  ])('accepts non-executable focused-test prose: %s', (content) => {
    const root = project();
    const result = evaluateRule('no-focused-test', {
      tool_name: 'Write', tool_input: { file_path: join(root, 'view.test.ts'), content },
    }, { root });
    expect(result.allow).toBe(true);
  });

  it('uses the existing multiline comment context for an Edit', () => {
    const root = project();
    const path = join(root, 'view.test.ts');
    writeFileSync(path, '/*\nExplain the rule here.\n*/\ntest("renders", () => {});');
    expect(evaluateRule('no-focused-test', {
      tool_name: 'Edit', tool_input: {
        file_path: path, old_string: 'Explain the rule here.',
        new_string: 'Explain why test.skip is not used.',
      },
    }, { root }).allow).toBe(true);
  });

  it('preserves multiline context across patch hunks', () => {
    const root = project();
    writeFileSync(join(root, 'view.test.ts'), '/*\nOld explanation.\n*/\ntest("renders", () => {});\n');
    expect(evaluateRule('no-focused-test', {
      tool_name: 'apply_patch', tool_input: { patch: [
        '*** Begin Patch', '*** Update File: view.test.ts', '@@',
        ' /*', '-Old explanation.', '+Explain why test.skip is not used.',
        ' */', '*** End Patch',
      ].join('\n') },
    }, { root }).allow).toBe(true);
  });

  it.each([
    ['test.only("renders", () => {});', 1],
    ['\n  test.only("renders", () => {});', 2],
    [`const rendered = \`\${test.skip("renders", () => {})}\`;`, 1],
    ['const rendered = <div>{test.only("renders", () => {})}</div>;', 1],
  ] as const)('detects the executable focused call: %s', (content, line) => {
    const root = project();
    const result = evaluateRule('no-focused-test', {
      tool_name: 'Write', tool_input: { file_path: join(root, 'view.test.tsx'), content },
    }, { root });
    expect(result.code).toBe('FOCUSED_OR_SKIPPED_TEST');
    expect(result.evidence).toEqual([`view.test.tsx:${line}`]);
  });

  it('accepts a declared existing E2E test for a new production component', () => {
    const root = project();
    const result = evaluateRule('tdd-order', {
      tool_name: 'Write', tool_input: {
        file_path: join(root, 'apps/web/src/page.tsx'),
        content: '// tdd-cover: e2e tests/e2e/page.spec.ts\nexport default function Page() { return <main />; }',
      },
    }, { root });
    expect(result.allow).toBe(true);
    expect(result.code).toBe('TDD_DECLARED_TEST');
    expect(result.message).toContain('not executed');
  });

  it.each([
    '// tdd-cover: e2e tests/e2e/missing.spec.ts',
    '// tdd-cover: e2e /tmp/outside.spec.ts',
    '// tdd-cover: e2e ../outside.spec.ts',
    '// tdd-cover: e2e tests/e2e',
    '// tdd-cover: e2e tests/e2e/page.txt',
    '// tdd-cover: unit tests/e2e/page.spec.ts',
    '// other header\n// tdd-cover: e2e tests/e2e/page.spec.ts',
    '// tdd-cover: e2e tests/e2e/page.spec.ts\n// tdd-cover: e2e tests/e2e/page.spec.ts',
  ])('refuses an invalid declaration: %s', (header) => {
    const root = project();
    expect(evaluateRule('tdd-order', { tool_name: 'Write', tool_input: {
      file_path: join(root, 'apps/web/src/page.tsx'), content: `${header}\nexport const page = 1;`,
    } }, { root }).code).toBe('TDD_DECLARATION_INVALID');
  });

  it('rejects a declaration whose symlink escapes the physical project root', () => {
    const root = project();
    const outside = project();
    symlinkSync(join(outside, 'tests/e2e/page.spec.ts'), join(root, 'tests/e2e/escape.spec.ts'));
    expect(evaluateRule('tdd-order', { tool_name: 'Write', tool_input: {
      file_path: join(root, 'apps/web/src/page.tsx'),
      content: '// tdd-cover: e2e tests/e2e/escape.spec.ts\nexport const page = 1;',
    } }, { root }).code).toBe('TDD_DECLARATION_INVALID');
  });

  it.each(['absent', 'ambiguous'])('refuses %s Edit context', (kind) => {
    const root = project();
    const path = join(root, 'view.test.ts');
    writeFileSync(path, kind === 'absent' ? '// actual text' : '// repeated\n// repeated');
    expect(evaluateRule('no-focused-test', { tool_name: 'Edit', tool_input: {
      file_path: path, old_string: 'repeated', new_string: 'test.skip prose',
    } }, { root }).code).toBe('TEST_SYNTAX_UNVERIFIED');
  });

  it('does not grant verification for a syntax error or oversized file', () => {
    const root = project();
    for (const content of ['// test.skip\nconst = ;', `// test.skip\n${' '.repeat(65_536)}`]) {
      expect(evaluateRule('no-focused-test', { tool_name: 'Write', tool_input: {
        file_path: join(root, 'view.test.ts'), content,
      } }, { root }).code).toBe('TEST_SYNTAX_UNVERIFIED');
    }
  });

  it('accepts spaces in an explicit E2E filename without guessing a route', () => {
    const root = project();
    writeFileSync(join(root, 'tests/e2e/with space.spec.ts'), 'test("renders", () => {});');
    const result = evaluateRule('tdd-order', { tool_name: 'Write', tool_input: {
      file_path: join(root, 'apps/web/src/page.tsx'),
      content: '// tdd-cover: e2e tests/e2e/with space.spec.ts\nexport const page = 1;',
    } }, { root });
    expect(result.allow).toBe(true);
  });

  it.each(['docs/example.ts', 'apps/web/src/example.test.ts', 'apps/web/src/types.d.ts'])(
    'does not apply production E2E declarations to exempt path %s', (path) => {
      const root = project();
      expect(evaluateRule('tdd-order', { tool_name: 'Write', tool_input: {
        file_path: join(root, path), content: '// tdd-cover: invalid documentation example\nexport const example = 1;',
      } }, { root }).allow).toBe(true);
    },
  );

  it('checks additions and removal of E2E declarations through Edit and patch', () => {
    const root = project();
    const path = join(root, 'apps/web/src/page.tsx');
    const body = 'export const page = 1;';
    const declaration = '// tdd-cover: e2e tests/e2e/page.spec.ts';
    writeFileSync(path, body);
    expect(evaluateRule('tdd-order', { tool_name: 'Edit', tool_input: {
      file_path: path, old_string: body, new_string: `${declaration}\n${body}`,
    } }, { root }).code).toBe('TDD_DECLARED_TEST');
    expect(evaluateRule('tdd-order', { tool_name: 'apply_patch', tool_input: {
      patch: `*** Begin Patch\n*** Update File: apps/web/src/page.tsx\n@@\n+${declaration}\n ${body}\n*** End Patch`,
    } }, { root }).code).toBe('TDD_DECLARED_TEST');
    writeFileSync(path, `${declaration}\n${body}`);
    expect(evaluateRule('tdd-order', { tool_name: 'Edit', tool_input: {
      file_path: path, old_string: `${declaration}\n`, new_string: '',
    } }, { root }).code).toBe('TDD_SIBLING_TEST_MISSING');
  });
});
