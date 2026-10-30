import * as ts from '@typescript/typescript6';

import type { SyntaxInput } from './syntax-contract.js';
export type { SyntaxPurpose } from './syntax-contract.js';

/** Pure official TypeScript 6.0.3 AST adapter, bundled only into the child.
 * Public Compiler API: createSourceFile + virtual CompilerHost. No config,
 * project imports, plugins, type checking or inspected-source execution.
 * https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
 */
export function analyzeSyntax(input: SyntaxInput): { readonly lines: readonly number[] } {
  const kind = /\.tsx$/.test(input.path) ? ts.ScriptKind.TSX
    : /\.jsx$/.test(input.path) ? ts.ScriptKind.JSX
    : /\.[cm]?js$/.test(input.path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  // Traversal uses the explicit SourceFile; parent back-references are unused.
  const file = ts.createSourceFile(input.path, input.source, ts.ScriptTarget.Latest, false, kind);
  const host: import('@typescript/typescript6').CompilerHost = {
    getSourceFile: (name) => name === input.path ? file : undefined,
    getDefaultLibFileName: () => '', writeFile: () => {},
    getCurrentDirectory: () => '', getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
    fileExists: (name) => name === input.path,
    readFile: (name) => name === input.path ? input.source : undefined,
  };
  const program = ts.createProgram([input.path], { noResolve: true, noLib: true }, host);
  if (program.getSyntacticDiagnostics(file).length > 0) throw new SyntaxError();
  const pending: import('@typescript/typescript6').Node[] = [file];
  const lines = new Set<number>();
  const commentPositions = new Set<number>();
  const jsxTextRanges: { start: number; end: number }[] = [];
  let visited = 0;
  while (pending.length > 0) {
    if (++visited > 20_000) throw new RangeError();
    const node = pending.pop();
    if (node === undefined) break;
    if (input.purpose === 'declarations') {
      // JSX text is a literal token: its whitespace is not JavaScript trivia.
      if (node.kind === ts.SyntaxKind.JsxText) {
        jsxTextRanges.push({ start: node.pos, end: node.end });
        continue;
      }
      const comments = [...(ts.getLeadingCommentRanges(input.source, node.pos) ?? []),
        ...(ts.getTrailingCommentRanges(input.source, node.end) ?? [])];
      for (const comment of comments) {
        if (!/^\/\/\s*tdd-cover:/.test(input.source.slice(comment.pos, comment.end))) continue;
        commentPositions.add(comment.pos);
      }
      pending.push(...node.getChildren(file));
      continue;
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const owner = node.expression.text;
      if ((['it', 'test', 'describe'].includes(owner) && node.name.text === 'only')
        || (['it', 'test', 'describe'].includes(owner) && node.name.text === 'skip')) {
        lines.add(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
      }
    }
    if (ts.isCallExpression(node) || ts.isTaggedTemplateExpression(node)) {
      let target: import('@typescript/typescript6').Expression = ts.isCallExpression(node)
        ? node.expression : node.tag;
      // Jest's skipped aliases also own parameterized calls and tagged tables.
      // https://jestjs.io/docs/api
      while (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)
        || ts.isParenthesizedExpression(target) || ts.isAsExpression(target)
        || ts.isTypeAssertionExpression(target) || ts.isNonNullExpression(target)
        || ts.isSatisfiesExpression(target)) {
        if (++visited > 20_000) throw new RangeError();
        target = target.expression;
      }
      if (ts.isIdentifier(target) && ['xit', 'xdescribe', 'fit', 'fdescribe'].includes(target.text)) {
        lines.add(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
      }
    }
    ts.forEachChild(node, (child) => { pending.push(child); });
  }
  for (const position of commentPositions) {
    if (!jsxTextRanges.some((range) => position >= range.start && position < range.end)) {
      lines.add(file.getLineAndCharacterOfPosition(position).line + 1);
    }
  }
  return { lines: [...lines].sort((a, b) => a - b) };
}
