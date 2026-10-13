import { readFileSync, readdirSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from '@typescript/typescript6';
import { expect, it } from 'vitest';

const sourceRoot = resolve(import.meta.dirname, '../src');
const allowedLocal: Readonly<Record<string, readonly string[]>> = {
  core: ['core'],
  runtime: ['core', 'runtime'],
  verticals: ['core', 'verticals'],
  adapters: ['core', 'runtime', 'verticals', 'adapters'],
  application: ['core', 'runtime', 'verticals', 'adapters', 'application'],
};
// External packages each layer may name; any other package is refused.
const allowedPackages: Readonly<Record<string, readonly string[]>> = {
  core: ['zod'],
  runtime: ['zod'],
  verticals: ['zod'],
  adapters: ['zod', 'smol-toml', 'ws'],
  application: ['zod'],
};
const pureLayers: ReadonlySet<string> = new Set(['core', 'runtime', 'verticals']);
type ModuleEdge = { readonly specifier: string; readonly dynamic: boolean;
  readonly computed: boolean };

/** Why a path under src/ is not a production source of a known layer, if it is not. */
function sourceRefusal(path: string): string | undefined {
  const layer = path.split(sep)[0];
  if (layer === undefined || !(layer in allowedLocal) || !path.includes(sep)) {
    return `${path}: source is outside the known layers`;
  }
  if (!path.endsWith('.ts') || path.endsWith('.d.ts') || path.endsWith('.test.ts')) {
    return `${path}: only production .ts sources belong in src`;
  }
  return undefined;
}

/** Every entry of src/: a file that is not a production source is refused, never skipped. */
function sourceScan(): { readonly files: string[]; readonly refused: string[] } {
  const pending = [sourceRoot];
  const files: string[] = [];
  const refused: string[] = [];
  for (let scanned = 0; pending.length > 0 && scanned < 256; scanned += 1) {
    const directory = pending.pop();
    if (directory === undefined) break;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { pending.push(path); continue; }
      const problem = entry.isFile() ? sourceRefusal(relative(sourceRoot, path))
        : `${relative(sourceRoot, path)}: not a regular file`;
      if (problem === undefined) files.push(path);
      else refused.push(problem);
    }
  }
  if (pending.length > 0 || files.length + refused.length > 256) {
    throw new Error('Machine source scan exceeded 256 entries');
  }
  return { files, refused };
}

function moduleEdges(file: string, source: string): ModuleEdge[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const edges: ModuleEdge[] = [];
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      edges.push({ specifier: node.moduleSpecifier.text, dynamic: false, computed: false });
    }
    if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression !== undefined
      && ts.isStringLiteral(node.moduleReference.expression)) {
      edges.push({ specifier: node.moduleReference.expression.text,
        dynamic: false, computed: false });
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
      && ts.isStringLiteral(node.argument.literal)) {
      edges.push({ specifier: node.argument.literal.text, dynamic: false, computed: false });
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      const literal = argument !== undefined && ts.isStringLiteralLike(argument);
      edges.push({ specifier: literal ? argument.text : node.getText(parsed),
        dynamic: true, computed: !literal });
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return edges;
}

function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] ?? specifier;
}

function externalViolation(
  importer: string, layer: string, specifier: string,
): string | undefined {
  if (isBuiltin(specifier)) {
    return pureLayers.has(layer)
      ? `${importer} -> ${specifier}: Node built-in modules belong to an adapter` : undefined;
  }
  return allowedPackages[layer]?.includes(packageName(specifier))
    ? undefined : `${importer} -> ${specifier}: package is not allowed in ${layer}`;
}

function violation(importer: string, edge: ModuleEdge): string | undefined {
  const layer = importer.split(sep)[0];
  const { specifier } = edge;
  if (layer === undefined || !(layer in allowedLocal)) {
    return `${importer} -> ${specifier}: source is outside the known layers`;
  }
  if (edge.computed) {
    return `${importer} -> ${specifier}: dynamic import with a computed specifier`;
  }
  if (edge.dynamic && (layer === 'core' || layer === 'runtime')) {
    return `${importer} -> ${specifier}: dynamic import in the kernel`;
  }
  if (!specifier.startsWith('.')) return externalViolation(importer, layer, specifier);
  // NodeNext maps a .js specifier to its .ts source; any other names a non-production file.
  if (!specifier.endsWith('.js')) {
    return `${importer} -> ${specifier}: a local import names a .js specifier`;
  }
  const resolved = resolve(dirname(join(sourceRoot, importer)), specifier);
  const target = relative(sourceRoot, resolved);
  const targetLayer = target.split(sep)[0];
  return target.startsWith('..') || targetLayer === undefined
    || !allowedLocal[layer]?.includes(targetLayer)
    ? `${importer} -> ${specifier}: forbidden layer import` : undefined;
}

it('reads type imports and reexports as module edges', () => {
  const source = "import type { A } from './a.js'; export type { B } from './b.js';"
    + "type C = import('./c.js').C;";
  expect(moduleEdges('fixture.ts', source).map((edge) => edge.specifier))
    .toEqual(['./a.js', './b.js', './c.js']);
});

// A scan that read nothing would find nothing: it must see every layer's known modules.
const expectedSources = [
  ['core', 'mission.ts'], ['runtime', 'mission.ts'], ['runtime', 'execution.ts'],
  ['verticals', 'sourced-note', 'note.ts'], ['adapters', 'store', 'file-journal.ts'],
  ['application', 'cli.ts'],
].map((parts) => join(sourceRoot, ...parts));

it('keeps the Machine module graph within its layer owners', () => {
  const { files, refused } = sourceScan();
  expect(refused, refused.join('\n')).toEqual([]);
  expect(files).toEqual(expect.arrayContaining(expectedSources));
  const violations: string[] = [];
  for (const file of files) {
    const importer = relative(sourceRoot, file);
    for (const edge of moduleEdges(file, readFileSync(file, 'utf8'))) {
      const problem = violation(importer, edge);
      if (problem !== undefined) violations.push(problem);
    }
  }
  expect(violations, violations.join('\n')).toEqual([]);
});

function problemsIn(importer: string, source: string): string[] {
  return moduleEdges(importer, source).flatMap((edge) => {
    const problem = violation(importer, edge);
    return problem === undefined ? [] : [problem];
  });
}

// Each source must stay refused: a detector that stops reporting breaks this test.
const refusedSources: readonly { readonly importer: string; readonly source: string;
  readonly names: string }[] = [
  { importer: join('core', 'x.ts'), source: "import { readFileSync } from 'fs';", names: 'fs' },
  { importer: join('verticals', 'x.ts'), source: "import { hostname } from 'node:os';",
    names: 'node:os' },
  { importer: join('runtime', 'x.ts'),
    source: "import { createRequire } from 'node:module'; createRequire(import.meta.url)('fs');",
    names: 'node:module' },
  { importer: join('verticals', 'x.ts'), source: "import pad from 'left-pad';",
    names: 'left-pad' },
  { importer: join('adapters', 'x.ts'), source: 'const loaded = await import(name);',
    names: 'import(name)' },
  { importer: join('runtime', 'x.ts'), source: "export { a } from '../verticals/a.js';",
    names: '../verticals/a.js' },
  { importer: join('core', 'x.ts'), source: "import type { A } from '../adapters/a.js';",
    names: '../adapters/a.js' },
  { importer: join('runtime', 'x.ts'), source: "import { b } from '../verticals/sourced-note/b';",
    names: '../verticals/sourced-note/b' },
  { importer: join('core', 'mission.ts'), source: "import './evil.mjs';", names: './evil.mjs' },
  { importer: join('core', 'x.ts'), source: "export * from 'fs';", names: 'fs' },
  { importer: join('core', 'x.ts'), source: "import x = require('fs');", names: 'fs' },
  { importer: join('core', 'x.ts'), source: "type T = import('fs');", names: 'fs' },
  { importer: join('core', 'x.ts'), source: "const a = await import('./a.js');", names: './a.js' },
  { importer: 'io.ts', source: "import { readFileSync } from 'node:fs';", names: 'node:fs' },
];

it.each(refusedSources)('refuses $names imported by $importer', ({ importer, source, names }) => {
  const problems = problemsIn(importer, source);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain(`${importer} -> ${names}:`);
});

it.each([
  join('core', 'evil.mts'), join('core', 'evil.cts'), join('runtime', 'x.js'),
  join('runtime', 'x.mjs'), join('verticals', 'x.tsx'), join('core', 'helper.test.ts'),
  join('core', 'ambient.d.ts'), 'io.ts', join('unknown', 'x.ts'),
])('refuses %s as a Machine source', (path) => {
  expect(sourceRefusal(path)).toContain(`${path}:`);
});

it('accepts a production source of a known layer', () => {
  expect(sourceRefusal(join('verticals', 'sourced-note', 'note.ts'))).toBeUndefined();
});

it('accepts the packages and built-ins each layer is allowed', () => {
  expect(problemsIn(join('core', 'x.ts'), "import { z } from 'zod';")).toEqual([]);
  expect(problemsIn(join('adapters', 'x.ts'),
    "import { open } from 'node:fs/promises'; import { parse } from 'smol-toml';"))
    .toEqual([]);
});
