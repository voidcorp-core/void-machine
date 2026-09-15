// @test-resource subprocess
// evaluateRule invokes the bounded compiler child; filesystem-only routing hides that cost.
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { evaluateRule } from './runner.js';

function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hook-evidence-')));
  mkdirSync(join(root, 'node_modules'));
  const compiler = createRequire(import.meta.url).resolve('typescript/package.json');
  symlinkSync(compiler.slice(0, -'/package.json'.length), join(root, 'node_modules/typescript'), 'junction');
  mkdirSync(join(root, 'apps/web/src'), { recursive: true });
  mkdirSync(join(root, 'tests/e2e'), { recursive: true });
  writeFileSync(join(root, 'tests/e2e/page.spec.ts'), 'test("renders the route", () => {});');
  return root;
}

describe('evidence-aware hooks', () => {
  it('does not grant TDD evidence after the aggregate deadline expires during syntax inspection', () => {
    const root = project();
    writeFileSync(join(root, 'apps/web/src/page.test.tsx'), 'test("page", () => {});');
    const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(0)
      .mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(1_000);
    try {
      const verdict = evaluateRule('tdd-order', { tool_name: 'Write', tool_input: {
        file_path: join(root, 'apps/web/src/page.tsx'),
        content: 'export const prose = `\n// tdd-cover: invalid example\n`;',
      } }, { root });
      expect(verdict.code).toBe('TDD_DECLARATION_UNVERIFIED');
      expect(verdict.message).toContain('split');
    } finally {
      clock.mockRestore();
    }
  });

  it('refuses focused-test success after syntax inspection exhausts the shared budget', () => {
    const root = project();
    const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(0)
      .mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(1_000);
    try {
      const verdict = evaluateRule('no-focused-test', { tool_name: 'Write', tool_input: {
        file_path: 'page.test.ts', content: '// test.only is prose\ntest("page", () => {});',
      } }, { root });
      expect(verdict.code).toBe('TEST_SYNTAX_UNVERIFIED');
      expect(verdict.message).toContain('split');
    } finally {
      clock.mockRestore();
    }
  });

  it('finds a workspace-only compiler and recovers after installation in the same project', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'hook-workspace-')));
    const directory = join(root, 'apps/web/node_modules');
    mkdirSync(directory, { recursive: true });
    const check = () => evaluateRule('no-focused-test', { tool_name: 'Write', tool_input: {
      file_path: join(root, 'apps/web/src/view.test.ts'), content: '// Explain test.skip\ntest("renders", () => {});',
    } }, { root });
    expect(check().code).toBe('TEST_SYNTAX_UNVERIFIED');
    const compiler = createRequire(import.meta.url).resolve('typescript/package.json');
    symlinkSync(compiler.slice(0, -'/package.json'.length), join(directory, 'typescript'), 'junction');
    expect(check().code).toBe('ALLOW');
  });

  it.each(['module.exports = { version: "6.0.0" };', 'throw new Error("PRIVATE_ERROR");'])(
    'does not fall back from a broken nearest compiler to the root compiler', (code) => {
      const root = project();
      const directory = join(root, 'apps/web/node_modules/typescript');
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ main: 'index.cjs' }));
      writeFileSync(join(directory, 'index.cjs'), code);
      const result = evaluateRule('no-focused-test', { tool_name: 'Write', tool_input: {
        file_path: join(root, 'apps/web/src/view.test.ts'), content: '// Explain test.skip',
      } }, { root });
      expect(result.code).toBe('TEST_SYNTAX_UNVERIFIED');
      expect(result.message).not.toContain('PRIVATE_ERROR');
    },
  );

  it('uses no compiler on a plain test and names missing compiler when syntax needs one', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'hook-no-compiler-')));
    const check = (content: string) => evaluateRule('no-focused-test', { tool_name: 'Write',
      tool_input: { file_path: join(root, 'view.test.ts'), content } }, { root });
    expect(check('test("renders", () => {});').allow).toBe(true);
    const result = check('// Explain test.skip');
    expect(result.code).toBe('TEST_SYNTAX_UNVERIFIED');
    expect(result.message).toContain('compiler');
  });

  it('does not execute inspected source or expose its contents in failures', () => {
    const root = project();
    const marker = join(root, 'source-was-executed');
    const check = (content: string) => evaluateRule('no-focused-test', { tool_name: 'Write',
      tool_input: { file_path: join(root, 'view.test.ts'), content } }, { root });
    expect(check(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad'); // test.skip`).allow).toBe(true);
    expect(existsSync(marker)).toBe(false);
    expect(check('// PRIVATE_PAYLOAD test.skip\nconst = ;').message).not.toContain('PRIVATE_PAYLOAD');
  });

  it.each([
    'throw new Error("PRIVATE_COMPILER_ERROR");',
    'module.exports = { version: "6.0.0" };',
    'process.stdout.write(JSON.stringify({unavailable:"PRIVATE_COMPILER_ERROR"})); process.exit(0);',
    'process.on("SIGTERM", () => {}); while (true) {}',
  ])('bounds a broken compiler and redacts its output', (code) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'hook-broken-compiler-')));
    const directory = join(root, 'node_modules/typescript');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'typescript', main: 'index.cjs' }));
    writeFileSync(join(directory, 'index.cjs'), code);
    const result = evaluateRule('no-focused-test', { tool_name: 'Write',
      tool_input: { file_path: join(root, 'view.test.ts'), content: '// test.skip prose' } }, { root });
    expect(result.code).toBe('TEST_SYNTAX_UNVERIFIED');
    expect(result.message).not.toContain('PRIVATE_COMPILER_ERROR');
  });


});
