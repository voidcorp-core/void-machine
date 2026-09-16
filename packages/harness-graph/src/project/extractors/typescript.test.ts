import { posix } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import {
	createTypeScriptExtractor,
	createTypeScriptModuleResolver,
	parseTypeScriptConfig,
	resolveTypeScriptConfigInheritance,
	resolveTypeScriptModule,
} from './typescript.js';

describe('TypeScript Compiler API declaration extractor', () => {
	it('extracts imports, exports, symbols, dynamic imports, and tests from AST nodes', () => {
		const extraction = createTypeScriptExtractor(ts).extract({
			path: 'src/example.test.ts',
			hash: `sha256:${'a'.repeat(64)}`,
			kind: 'test',
			content: [
				"import { value } from './value.js';",
				'export type PublicType = { value: string };',
				'export const load = async () => import("./lazy.js");',
				"it('loads lazily', () => value);",
			].join('\n'),
		});

		expect(extraction.imports).toEqual([
			{ specifier: './lazy.js', dynamic: true },
			{ specifier: './value.js', dynamic: false },
		]);
		expect(extraction.exports).toEqual(['PublicType', 'load']);
		expect(extraction.symbols).toEqual([
			{ kind: 'type', name: 'PublicType', exported: true },
			{ kind: 'variable', name: 'load', exported: true },
		]);
		expect(extraction.tests).toEqual(['loads lazily']);
		expect(extraction.diagnostics).toEqual([]);
	});

	it('extracts every local name from exported object and array bindings', () => {
		const extraction = createTypeScriptExtractor(ts).extract({
			path: 'src/bindings.ts',
			hash: `sha256:${'7'.repeat(64)}`,
			kind: 'source',
			content: [
				'export const { first, source: renamed, nested: { leaf } } = value;',
				'export const [head, , ...tail] = values;',
			].join('\n'),
		});

		expect(extraction.exports).toEqual(['first', 'head', 'leaf', 'renamed', 'tail']);
		expect(extraction.symbols).toEqual([
			{ kind: 'variable', name: 'first', exported: true },
			{ kind: 'variable', name: 'head', exported: true },
			{ kind: 'variable', name: 'leaf', exported: true },
			{ kind: 'variable', name: 'renamed', exported: true },
			{ kind: 'variable', name: 'tail', exported: true },
		]);
	});
});

describe('TypeScript syntax evidence', () => {
	it('recognizes bounded Vitest calls without treating arbitrary methods as tests', () => {
		const extraction = createTypeScriptExtractor(ts).extract({
			path: 'src/variants.ts',
			hash: `sha256:${'9'.repeat(64)}`,
			kind: 'source',
			content: [
				"it('direct', () => {});",
				'it' + ".only('only', () => {});",
				'test' + ".skip('skip', () => {});",
				"it.todo('todo');",
				"test.concurrent('concurrent', async () => {});",
				"test.sequential('sequential', () => {});",
				"test.fails('fails', () => {});",
				"test.skipIf(true)('skip-if', () => {});",
				"test.runIf(true)('run-if', () => {});",
				"it.each([[1]])('each %s', () => {});",
				"test.concurrent.each([[1]])('concurrent each %s', async () => {});",
				'describe' + ".only('suite', () => {});",
				"fixture.it('member', () => {});",
				"it.retry('unsupported', () => {});",
				"test.extend({})('unsupported extension', () => {});",
			].join('\n'),
		});

		expect(extraction.tests).toEqual([
			'concurrent',
			'concurrent each %s',
			'direct',
			'each %s',
			'fails',
			'only',
			'run-if',
			'sequential',
			'skip',
			'skip-if',
			'todo',
		]);
	});

	it('resolves aliases and extension substitution through Compiler API', () => {
		const config = parseTypeScriptConfig(ts, 
			'tsconfig.json',
			JSON.stringify({
				compilerOptions: {
					baseUrl: '.',
					module: 'NodeNext',
					moduleResolution: 'NodeNext',
					paths: { '@fixture/*': ['packages/core/src/*'] },
				},
			}),
		);
		const files = new Set(['packages/app/src/index.ts', 'packages/core/src/value.ts']);
		expect(
			resolveTypeScriptModule(ts, '@fixture/value.js', 'packages/app/src/index.ts', files, config),
		).toBe('packages/core/src/value.ts');
	});
});

describe('TypeScript extraction diagnostics', () => {
	it('gives compiler paths precedence over a same-named workspace package', () => {
		const config = parseTypeScriptConfig(ts, 
			'tsconfig.json',
			JSON.stringify({
				compilerOptions: {
					baseUrl: '.',
					paths: { '@fixture/core': ['overrides/core.ts'] },
				},
			}),
		);
		const workspace = {
			path: 'packages/core',
			name: '@fixture/core',
			patterns: [],
			dependencies: [],
			entrypoints: ['packages/core/src/index.ts'],
			exports: { '.': ['packages/core/src/index.ts'] },
		};
		const resolver = createTypeScriptModuleResolver(ts, 
			new Set(['overrides/core.ts', 'packages/core/src/index.ts']),
			[workspace],
		);

		expect(resolver.resolve('@fixture/core', 'src/index.ts', config)).toBe('overrides/core.ts');
	});

	it('surfaces parse diagnostics while preserving the recoverable AST', () => {
		const extraction = createTypeScriptExtractor(ts).extract({
			path: 'src/broken.ts',
			hash: `sha256:${'b'.repeat(64)}`,
			kind: 'source',
			content: 'export const broken = ;',
		});
		expect(extraction.diagnostics.length).toBeGreaterThan(0);
		expect(extraction.exports).toEqual(['broken']);
	});

	it('turns an overlong module specifier into a diagnostic', () => {
		const extraction = createTypeScriptExtractor(ts).extract({
			path: 'src/hostile.ts',
			hash: `sha256:${'c'.repeat(64)}`,
			kind: 'source',
			content: `import '${'a'.repeat(513)}';`,
		});

		expect(extraction.imports).toEqual([]);
		// Not a diagnostic: the file is not defective, the specifier is simply not
		// something a static reader can turn into an edge.
		expect(extraction.diagnostics).toEqual([]);
		expect(extraction.unresolved).toContain('module specifier is not a bounded printable string');
	});

	it('reports a non-literal dynamic import instead of silently dropping topology', () => {
		const extraction = createTypeScriptExtractor(ts).extract({
			path: 'src/dynamic.ts',
			hash: `sha256:${'d'.repeat(64)}`,
			kind: 'source',
			content: 'export async function load(name: string) { return import(name); }',
		});

		expect(extraction.imports).toEqual([]);
		expect(extraction.diagnostics).toEqual([]);
		expect(extraction.unresolved).toContain('dynamic import specifier is not a string literal');
	});
});

describe('syntax-only compiler diagnostics', () => {
	const extract = (path: string, content: string) => createTypeScriptExtractor(ts).extract({
		path, content, hash: `sha256:${'a'.repeat(64)}`, kind: 'source',
	});

	it.each(['d.ts', 'd.mts', 'd.cts'])('reports invalid %s syntax and keeps recoverable exports', (extension) => {
		const result = extract(`src/types.${extension}`, 'export declare const broken: ;');
		expect(result.diagnostics).toContain('Type expected.');
		expect(result.exports).toEqual(['broken']);
	});

	it.each(['d.ts', 'd.mts', 'd.cts'])('accepts valid %s without trying to emit it', (extension) => {
		const result = extract(`src/types.${extension}`, "import type { Missing } from './absent'; export declare const value: Missing;");
		expect(result.diagnostics).toEqual([]);
		expect(result.exports).toEqual(['value']);
		expect(result.imports).toEqual([{ specifier: './absent', dynamic: false }]);
	});

	it.each(['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'])('reports broken %s syntax without losing topology', (extension) => {
		const result = extract(`src/broken.${extension}`, "import './absent'; export const broken = ;");
		expect(result.diagnostics).toContain('Expression expected.');
		expect(result.exports).toEqual(['broken']);
		expect(result.imports).toEqual([{ specifier: './absent', dynamic: false }]);
	});

	it.each(['tsx', 'jsx'])('preserves valid %s and reports malformed JSX', (extension) => {
		expect(extract(`src/view.${extension}`, 'export const View = () => <Missing />;').diagnostics).toEqual([]);
		const broken = extract(`src/view.${extension}`, 'export const View = () => <div></span>;');
		expect(broken.diagnostics.join(' ')).toContain('Expected corresponding JSX closing tag');
		expect(broken.exports).toEqual(['View']);
	});

	it.each(['js', 'jsx', 'mjs', 'cjs'])('retains JavaScript-specific syntax errors in %s', (extension) => {
		expect(extract(`src/value.${extension}`, 'export const value: number = 1;').diagnostics.join(' '))
			.toContain('Type annotations can only be used in TypeScript files.');
	});

	it.each(['ts', 'mts', 'cts', 'tsx'])('does not turn semantic errors into source defects in %s', (extension) => {
		const result = extract(`src/value.${extension}`, "import { absent } from './missing'; export const value: string = 42; export const other: Unknown = absent;");
		expect(result.diagnostics).toEqual([]);
		expect(result.exports).toEqual(['other', 'value']);
	});

	it('reuses one AST without filesystem access, emit, binding or semantic checks', () => {
		let parsed = 0;
		let programs = 0;
		const forbidden = () => { throw new Error('syntax extraction requested a forbidden compiler phase or filesystem access'); };
		const filesystem = ['readFile', 'writeFile', 'fileExists', 'directoryExists', 'getDirectories', 'readDirectory'] as const;
		const spies = filesystem.map((method) => vi.spyOn(ts.sys, method).mockImplementation(forbidden));
		const api: typeof ts = {
			...ts,
			transpileModule: forbidden,
			createSourceFile: new Proxy(ts.createSourceFile, {
				apply(target, receiver, args) { parsed += 1; return Reflect.apply(target, receiver, args); },
			}),
			createProgram: new Proxy(ts.createProgram, {
				apply(target, receiver, args) {
					programs += 1;
					const program: ts.Program = Reflect.apply(target, receiver, args);
					return new Proxy(program, {
						get(value, key, owner) {
							if (['emit', 'getTypeChecker', 'getSemanticDiagnostics', 'getDeclarationDiagnostics'].includes(String(key))) return forbidden;
							return Reflect.get(value, key, owner);
						},
					});
				},
			}),
		};
		try {
			const result = createTypeScriptExtractor(api).extract({
				path: 'src/example.ts', hash: `sha256:${'b'.repeat(64)}`, kind: 'source',
				content: '/// <reference path="../missing.d.ts" />\nimport { absent } from "missing"; export const value: Unknown = absent;',
			});
			expect(result.diagnostics).toEqual([]);
			expect(result.exports).toEqual(['value']);
			expect(parsed).toBe(1);
			expect(programs).toBe(1);
		} finally {
			for (const spy of spies) spy.mockRestore();
		}
	});
});

describe('TypeScript config inheritance', () => {
	it('resolves bounded root-confined tsconfig inheritance for monorepo aliases', () => {
		const base = parseTypeScriptConfig(ts, 
			'tsconfig.base.json',
			JSON.stringify({
				compilerOptions: { paths: { '@core/*': ['packages/core/src/*'] } },
			}),
		);
		const app = parseTypeScriptConfig(ts, 
			'packages/app/tsconfig.json',
			JSON.stringify({
				extends: '../../tsconfig.base.json',
				compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' },
			}),
		);
		const configs = resolveTypeScriptConfigInheritance(ts, [base, app]);
		const inherited = configs.get('packages/app');
		const resolver = createTypeScriptModuleResolver(ts, 
			new Set(['packages/app/src/index.ts', 'packages/core/src/value.ts']),
		);

		expect(inherited?.basePath).toBe('.');
		expect(resolver.resolve('@core/value', 'packages/app/src/index.ts', inherited)).toBe(
			'packages/core/src/value.ts',
		);
	});

	it('matches official TypeScript option origins across an extends chain', () => {
		const baseRaw = {
			compilerOptions: {
				baseUrl: '.',
				paths: { '@base/*': ['shared/*'] },
			},
		};
		const appRaw = {
			extends: '../../tsconfig.base.json',
			compilerOptions: { paths: { '@app/*': ['src/*'] } },
		};
		const base = parseTypeScriptConfig(ts, 'tsconfig.base.json', JSON.stringify(baseRaw));
		const app = parseTypeScriptConfig(ts, 'packages/app/tsconfig.json', JSON.stringify(appRaw));
		const inherited = resolveTypeScriptConfigInheritance(ts, [base, app]).get('packages/app');
		const rawByPath = new Map([
			['/project/tsconfig.base.json', JSON.stringify(baseRaw)],
			['/project/packages/app/tsconfig.json', JSON.stringify(appRaw)],
		]);
		const official = ts.parseJsonConfigFileContent(
			structuredClone(appRaw),
			{
				useCaseSensitiveFileNames: true,
				readDirectory: () => [],
				fileExists: (path) => rawByPath.has(posix.normalize(path)),
				readFile: (path) => rawByPath.get(posix.normalize(path)),
			},
			'/project/packages/app',
			undefined,
			'/project/packages/app/tsconfig.json',
		);
		const resolver = createTypeScriptModuleResolver(ts, new Set(['shared/value.ts', 'src/value.ts']));

		expect(inherited?.resolvedOptions).toMatchObject({
			baseUrl: official.options.baseUrl,
			paths: official.options.paths,
			pathsBasePath: official.options.pathsBasePath,
		});
		expect(resolver.resolve('@app/value', 'packages/app/index.ts', inherited)).toBe('src/value.ts');
		expect(resolver.resolve('shared/value', 'packages/app/index.ts', inherited)).toBe(
			'shared/value.ts',
		);
	});
});

describe('TypeScript effective config selection', () => {
	it('keeps child-relative paths at the declaring config when no baseUrl overrides them', () => {
		const base = parseTypeScriptConfig(ts, 
			'tsconfig.base.json',
			JSON.stringify({
				compilerOptions: { strict: true },
			}),
		);
		const app = parseTypeScriptConfig(ts, 
			'packages/app/tsconfig.json',
			JSON.stringify({
				extends: '../../tsconfig.base.json',
				compilerOptions: { paths: { '@app/*': ['src/*'] } },
			}),
		);
		const inherited = resolveTypeScriptConfigInheritance(ts, [base, app]).get('packages/app');
		const resolver = createTypeScriptModuleResolver(ts, new Set(['packages/app/src/value.ts']));

		expect(inherited?.resolvedOptions?.['pathsBasePath']).toBe('/project/packages/app');
		expect(resolver.resolve('@app/value', 'packages/app/index.ts', inherited)).toBe(
			'packages/app/src/value.ts',
		);
	});

	it('indexes a referenced Vite app config at its included source directory', () => {
		const root = parseTypeScriptConfig(ts, 
			'tsconfig.json',
			JSON.stringify({
				files: [],
				references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.node.json' }],
			}),
		);
		const app = parseTypeScriptConfig(ts, 
			'tsconfig.app.json',
			JSON.stringify({
				compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } },
				include: ['src'],
			}),
		);
		const node = parseTypeScriptConfig(ts, 
			'tsconfig.node.json',
			JSON.stringify({
				include: ['vite.config.ts'],
			}),
		);
		const configs = resolveTypeScriptConfigInheritance(ts, [root, app, node], true);
		const effective = configs.get('src');
		const resolver = createTypeScriptModuleResolver(ts, 
			new Set(['src/main.ts', 'src/components/Button.ts']),
		);

		expect(effective?.path).toBe('tsconfig.app.json');
		expect(configs.get('vite.config.ts')?.path).toBe('tsconfig.node.json');
		expect(resolver.resolve('@/components/Button', 'src/main.ts', effective)).toBe(
			'src/components/Button.ts',
		);
	});
});

it('distinguishes implicit config scope from an explicit empty files list', () => {
	const referencedRoot = (path: string) =>
		parseTypeScriptConfig(ts, 
			'tsconfig.json',
			JSON.stringify({ files: [], references: [{ path }] }),
		);
	const implicit = parseTypeScriptConfig(ts, 'tsconfig.app.json', JSON.stringify({}));
	const explicitEmpty = parseTypeScriptConfig(ts, 
		'tsconfig.empty.json',
		JSON.stringify({ files: [], references: [{ path: './leaf/tsconfig.json' }] }),
	);
	const leaf = parseTypeScriptConfig(ts, 
		'leaf/tsconfig.json',
		JSON.stringify({ compilerOptions: { composite: true } }),
	);
	const implicitConfigs = resolveTypeScriptConfigInheritance(ts, 
		[referencedRoot('./tsconfig.app.json'), implicit],
		true,
	);
	const explicitConfigs = resolveTypeScriptConfigInheritance(ts, 
		[referencedRoot('./tsconfig.empty.json'), explicitEmpty, leaf],
		true,
	);

	expect(implicitConfigs.get('.')?.path).toBe('tsconfig.app.json');
	expect(explicitConfigs.get('.')?.path).toBe('tsconfig.json');
});

describe('TypeScript effective config case behavior', () => {
	it('honors the project case contract while resolving config inheritance', () => {
		const base = parseTypeScriptConfig(ts, 
			'Config/Base.json',
			JSON.stringify({
				compilerOptions: { paths: { '@core/*': ['src/*'] } },
			}),
		);
		const app = parseTypeScriptConfig(ts, 
			'tsconfig.json',
			JSON.stringify({
				extends: './config/base.json',
			}),
		);

		expect(() => resolveTypeScriptConfigInheritance(ts, [base, app], true)).toThrow(/missing/);
		expect(resolveTypeScriptConfigInheritance(ts, [base, app], false).get('.')?.path).toBe(
			'tsconfig.json',
		);
	});

	it('indexes effective config scopes using the project case contract', () => {
		const root = parseTypeScriptConfig(ts, 
			'tsconfig.json',
			JSON.stringify({
				references: [{ path: './tsconfig.app.json' }],
			}),
		);
		const app = parseTypeScriptConfig(ts, 
			'tsconfig.app.json',
			JSON.stringify({
				include: ['Src'],
			}),
		);
		const configs = resolveTypeScriptConfigInheritance(ts, [root, app], false);

		expect(configs.get('src')?.path).toBe('tsconfig.app.json');
	});
});

describe('TypeScript export surfaces', () => {
	it('extracts named clauses, re-exports, wildcard namespaces, and default exports', () => {
		const extraction = createTypeScriptExtractor(ts).extract({
			path: 'src/exports.ts',
			hash: `sha256:${'e'.repeat(64)}`,
			kind: 'source',
			content: [
				'const local = 1;',
				'export { local as publicValue };',
				"export { remote as forwarded } from './remote.js';",
				"export * as namespace from './namespace.js';",
				"export * from './star.js';",
				'export default function NamedDefault() {}',
			].join('\n'),
		});

		expect(extraction.exports).toEqual(['*', 'default', 'forwarded', 'namespace', 'publicValue']);
		expect(extraction.symbols).toEqual(
			expect.arrayContaining([
				{ kind: 'function', name: 'NamedDefault', exported: false },
				{ kind: 'export', name: '*', exported: true },
				{ kind: 'export', name: 'default', exported: true },
				{ kind: 'export', name: 'forwarded', exported: true },
				{ kind: 'export', name: 'namespace', exported: true },
				{ kind: 'export', name: 'publicValue', exported: true },
			]),
		);
		expect(extraction.imports.map((entry) => entry.specifier)).toEqual([
			'./namespace.js',
			'./remote.js',
			'./star.js',
		]);

		const anonymous = createTypeScriptExtractor(ts).extract({
			path: 'src/anonymous.ts',
			hash: `sha256:${'a'.repeat(64)}`,
			kind: 'source',
			content: 'export default class {}',
		});
		expect(anonymous.exports).toEqual(['default']);
		expect(anonymous.symbols).toContainEqual({
			kind: 'export',
			name: 'default',
			exported: true,
		});
	});
});

describe('TypeScript default export surfaces', () => {
	it('represents valid default type surfaces for named and anonymous declarations', () => {
		const extractor = createTypeScriptExtractor(ts);
		const specimens = [
			['interface', 'export default interface Contract {}', 'Contract', 'interface'],
			['named class', 'export default class Service {}', 'Service', 'class'],
			['anonymous class', 'export default class {}', undefined, undefined],
			['named function', 'export default function load() {}', 'load', 'function'],
			['anonymous function', 'export default function() {}', undefined, undefined],
			['type clause', 'type Shape = string; export type { Shape as default };', 'Shape', 'type'],
		] as const;

		for (const [name, content, declarationName, declarationKind] of specimens) {
			const extraction = extractor.extract({
				path: `src/default-${name.replaceAll(' ', '-')}.ts`,
				hash: `sha256:${'8'.repeat(64)}`,
				kind: 'source',
				content,
			});
			expect(extraction.exports, name).toContain('default');
			expect(extraction.symbols, name).toContainEqual({
				kind: 'export',
				name: 'default',
				exported: true,
			});
			if (declarationName !== undefined && declarationKind !== undefined) {
				expect(extraction.symbols, name).toContainEqual({
					kind: declarationKind,
					name: declarationName,
					exported: false,
				});
			}
		}
	});
});

describe('TypeScript config rejection and arrays', () => {
	it('extracts CommonJS exports only from supported JavaScript inputs', () => {
		const extractor = createTypeScriptExtractor(ts);
		const javascript = extractor.extract({
			path: 'src/exports.cjs',
			hash: `sha256:${'f'.repeat(64)}`,
			kind: 'source',
			content: 'const value = 1; module.exports = value; exports.named = value;',
		});
		const typescript = extractor.extract({
			path: 'src/exports.ts',
			hash: `sha256:${'0'.repeat(64)}`,
			kind: 'source',
			content: 'const value = 1; module.exports = value; exports.named = value;',
		});

		expect(javascript.exports).toEqual(['default', 'named']);
		expect(typescript.exports).toEqual([]);
	});
});

describe('TypeScript rejected and array config inheritance', () => {
	it('rejects cyclic and root-escaping tsconfig inheritance', () => {
		const first = parseTypeScriptConfig(ts, 
			'tsconfig.json',
			JSON.stringify({
				extends: './tsconfig.base.json',
			}),
		);
		const second = parseTypeScriptConfig(ts, 
			'tsconfig.base.json',
			JSON.stringify({
				extends: './tsconfig.json',
			}),
		);

		expect(() => resolveTypeScriptConfigInheritance(ts, [first, second])).toThrow(/cyclic/);
		expect(() =>
			parseTypeScriptConfig(ts, 
				'tsconfig.json',
				JSON.stringify({
					extends: '../outside.json',
				}),
			),
		).toThrow(/escapes/);
	});

	it('rejects absolute project reference and include paths', () => {
		const outside = parseTypeScriptConfig(ts, 'outside.json', '{}');
		const reference = parseTypeScriptConfig(ts, 
			'tsconfig.json',
			JSON.stringify({
				references: [{ path: '/outside.json' }],
			}),
		);
		expect(() => resolveTypeScriptConfigInheritance(ts, [reference, outside])).toThrow(/references/);

		const root = parseTypeScriptConfig(ts, 
			'tsconfig.json',
			JSON.stringify({
				references: [{ path: './tsconfig.app.json' }],
			}),
		);
		const app = parseTypeScriptConfig(ts, 
			'tsconfig.app.json',
			JSON.stringify({
				include: ['/src'],
			}),
		);
		expect(() => resolveTypeScriptConfigInheritance(ts, [root, app])).toThrow(/include/);
	});
});

describe('TypeScript array config inheritance', () => {
	it('matches TypeScript 5.9 ordered extends-array merging and option origins', () => {
		const strict = parseTypeScriptConfig(ts, 
			'configs/strict.json',
			JSON.stringify({
				compilerOptions: { strict: true },
			}),
		);
		const paths = parseTypeScriptConfig(ts, 
			'configs/paths.json',
			JSON.stringify({
				compilerOptions: { noUncheckedIndexedAccess: true, paths: { '@lib/*': ['src/*'] } },
			}),
		);
		const child = parseTypeScriptConfig(ts, 
			'packages/app/tsconfig.json',
			JSON.stringify({
				extends: ['../../configs/strict.json', '../../configs/paths.json'],
			}),
		);
		const inherited = resolveTypeScriptConfigInheritance(ts, [strict, paths, child]).get(
			'packages/app',
		);
		const resolver = createTypeScriptModuleResolver(ts, new Set(['configs/src/value.ts']));

		expect(inherited?.resolvedOptions).toMatchObject({
			strict: true,
			noUncheckedIndexedAccess: true,
			paths: { '@lib/*': ['src/*'] },
			pathsBasePath: '/project/configs',
		});
		expect(resolver.resolve('@lib/value', 'packages/app/index.ts', inherited)).toBe(
			'configs/src/value.ts',
		);
	});

	it('rejects cycles and over-depth branches introduced through extends arrays', () => {
		const cycleA = parseTypeScriptConfig(ts, 'a.json', JSON.stringify({ extends: ['./b.json'] }));
		const cycleB = parseTypeScriptConfig(ts, 'b.json', JSON.stringify({ extends: ['./a.json'] }));
		expect(() => resolveTypeScriptConfigInheritance(ts, [cycleA, cycleB])).toThrow(/cyclic/);

		const chain = Array.from({ length: 18 }, (_, index) =>
			parseTypeScriptConfig(ts, 
				`depth/${index}.json`,
				JSON.stringify(index === 17 ? {} : { extends: [`./${index + 1}.json`] }),
			),
		);
		expect(() => resolveTypeScriptConfigInheritance(ts, chain)).toThrow(/16 levels/);
	});
});

describe('TypeScript workspace resolution', () => {
	it('indexes workspace package names instead of scanning every workspace per import', () => {
		let nameReads = 0;
		const workspaces = Array.from({ length: 200 }, (_, index) => ({
			path: `packages/package-${index}`,
			get name() {
				nameReads += 1;
				return `@fixture/package-${index}`;
			},
			patterns: [],
			dependencies: [],
			entrypoints: [`packages/package-${index}/src/index.ts`],
			exports: { '.': [`packages/package-${index}/src/index.ts`] },
		}));
		const resolver = createTypeScriptModuleResolver(ts, new Set(), workspaces);
		const readsAfterIndexing = nameReads;

		expect(resolver.resolve('@missing/package', 'src/index.ts')).toBeUndefined();
		expect(nameReads - readsAfterIndexing).toBe(0);
	});

	it('resolves bare and explicit workspace export subpaths to distinct targets', () => {
		const workspace = {
			path: 'packages/core',
			name: '@fixture/core',
			patterns: [],
			dependencies: [],
			entrypoints: ['packages/core/src/index.ts'],
			exports: {
				'.': ['packages/core/src/index.ts'],
				'./secondary': ['packages/core/src/secondary.ts'],
			},
		};
		const resolver = createTypeScriptModuleResolver(ts, 
			new Set(['packages/core/src/index.ts', 'packages/core/src/secondary.ts']),
			[workspace],
		);

		expect(resolver.resolve('@fixture/core', 'src/index.ts')).toBe('packages/core/src/index.ts');
		expect(resolver.resolve('@fixture/core/secondary', 'src/index.ts')).toBe(
			'packages/core/src/secondary.ts',
		);
	});

	it('leaves duplicate workspace package names unresolved for central issue handling', () => {
		const workspace = (path: string) => ({
			path,
			name: '@fixture/core',
			patterns: [],
			dependencies: [],
			entrypoints: [`${path}/src/index.ts`],
			exports: { '.': [`${path}/src/index.ts`] },
		});
		const resolver = createTypeScriptModuleResolver(ts, 
			new Set(['packages/a/src/index.ts', 'packages/b/src/index.ts']),
			[workspace('packages/a'), workspace('packages/b')],
		);

		expect(resolver.workspaceNameCollisions).toEqual([
			{
				name: '@fixture/core',
				paths: ['packages/a', 'packages/b'],
			},
		]);
		expect(resolver.resolve('@fixture/core', 'src/index.ts')).toBeUndefined();
	});
});

describe('TypeScript workspace wildcards and casing', () => {
	it('matches one bounded package export wildcard and substitutes its capture', () => {
		const resolver = createTypeScriptModuleResolver(ts, 
			new Set(['packages/core/src/features/value.ts']),
			[
				{
					path: 'packages/core',
					name: '@fixture/core',
					patterns: [],
					dependencies: [],
					entrypoints: [],
					exports: { './*': ['packages/core/src/features/*.ts'] },
				},
			],
		);

		expect(resolver.resolve('@fixture/core/value', 'src/index.ts')).toBe(
			'packages/core/src/features/value.ts',
		);
	});

	it('uses the project volume case contract instead of the host TypeScript default', () => {
		const files = new Set(['src/Foo.ts', 'src/foo.ts']);
		const sensitive = createTypeScriptModuleResolver(ts, files, [], true);
		const insensitive = createTypeScriptModuleResolver(ts, new Set(['src/Foo.ts']), [], false);

		expect(sensitive.resolve('./Foo.js', 'src/index.ts')).toBe('src/Foo.ts');
		expect(sensitive.resolve('./foo.js', 'src/index.ts')).toBe('src/foo.ts');
		expect(insensitive.resolve('./foo.js', 'src/index.ts')).toBe('src/Foo.ts');
	});

	it('does not infer case-sensitive behavior when the volume contract is unknown', () => {
		const config = parseTypeScriptConfig(ts, 'tsconfig.json', '{}');
		const resolver = createTypeScriptModuleResolver(ts, new Set(['src/Foo.ts']), [], 'unknown');

		expect(resolver.resolve('./Foo.js', 'src/index.ts', config)).toBeUndefined();
		expect(resolveTypeScriptConfigInheritance(ts, [config], 'unknown').size).toBe(0);
	});
});
