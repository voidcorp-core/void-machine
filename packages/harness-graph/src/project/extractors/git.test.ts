import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';

import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { createNodeProjectRootPort } from '../root.js';
import { createNodeGitPort, parseGitNameStatus, parseGitOwnership } from './git.js';
import { cleanupProjectTempDirs, projectTempDir } from '../test-support.js';

afterAll(cleanupProjectTempDirs);

const run = promisify(execFile);

async function isolatedProjectRoot(prefix: string): Promise<string> {
	const parent = await projectTempDir(prefix);
	const root = join(parent, 'root');
	await mkdir(root);
	return root;
}

describe('Git extractor', () => {
	it('distinguishes proven renames, deletions, and modifications from NUL-delimited output', () => {
		const parsed = parseGitNameStatus(
			'R095\0src/old.ts\0src/new.ts\0D\0src/deleted.ts\0M\0src/changed.ts\0',
		);
		expect(parsed).toEqual({
			changed: ['src/changed.ts', 'src/new.ts'],
			deleted: ['src/deleted.ts'],
			renames: [{ from: 'src/old.ts', to: 'src/new.ts', similarity: 95 }],
		});
	});

	it('keeps the newest observed owner and ignores paths outside the scanned set', () => {
		const log = '\u001eAda\u001f\0\nsrc/a.ts\0src/b.ts\0\u001eBob\u001f\0\nsrc/a.ts\0outside.ts\0';
		expect(parseGitOwnership(log, new Set(['src/a.ts', 'src/b.ts']))).toEqual({
			'src/a.ts': 'Ada',
			'src/b.ts': 'Ada',
		});
	});
});

describe('Git extractor commands', () => {
	it('reads ownership and rename proof through bounded argv-only Git commands', async () => {
		const root = await isolatedProjectRoot('void-project-git-');
		await mkdir(join(root, 'src'));
		await writeFile(join(root, 'src', 'old.ts'), 'export const value = 1;\n');
		await run('git', ['init', '--quiet'], { cwd: root });
		await run('git', ['config', 'user.name', 'Fixture Owner'], { cwd: root });
		await run('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root });
		await run('git', ['add', 'src/old.ts'], { cwd: root });
		await run('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root });
		const port = createNodeGitPort();
		const identity = await createNodeProjectRootPort().open(root);

		const committed = await port.inspect(identity.path, identity, ['src/old.ts']);
		expect(committed.issues).toEqual([]);
		expect(committed).toMatchObject({
			owners: { 'src/old.ts': 'Fixture Owner' },
		});
		await run('git', ['mv', 'src/old.ts', 'src/new.ts'], { cwd: root });
		const renamed = await port.inspect(identity.path, identity, ['src/new.ts']);
		expect(renamed.issues).toEqual([]);
		expect(renamed).toMatchObject({
			renames: [{ from: 'src/old.ts', to: 'src/new.ts', similarity: 100 }],
		});
	});

	it('ignores a repository-local Git shim even when PATH points at it first', async () => {
		const root = await isolatedProjectRoot('void-project-git-path-');
		await run('git', ['init', '--quiet'], { cwd: root });
		await run('git', ['config', 'user.name', 'Fixture Owner'], { cwd: root });
		await run('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root });
		await run('git', ['commit', '--quiet', '--allow-empty', '-m', 'fixture'], { cwd: root });
		const shimDirectory = join(root, 'node_modules', '.bin');
		const marker = join(root, 'shim-ran');
		await mkdir(shimDirectory, { recursive: true });
		await writeFile(
			join(shimDirectory, 'git'),
			`#!/bin/sh\nprintf hijacked > '${marker}'\nexit 1\n`,
		);
		await chmod(join(shimDirectory, 'git'), 0o755);
		const previousPath = process.env['PATH'];
		process.env['PATH'] = `${shimDirectory}:${previousPath ?? ''}`;
		try {
			const identity = await createNodeProjectRootPort().open(root);
			const snapshot = await createNodeGitPort().inspect(identity.path, identity, []);
			expect(snapshot.issues).toEqual([]);
			expect(snapshot.head).toMatch(/^[a-f0-9]{40}$/);
		} finally {
			if (previousPath === undefined) delete process.env['PATH'];
			else process.env['PATH'] = previousPath;
		}

		await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
	});
});

describe('Git extractor repository binding', () => {
	it('rejects an external gitdir that has no worktree backlink before running Git', async () => {
		const parent = await projectTempDir('void-project-gitdir-hostile-');
		const root = join(parent, 'root');
		const externalGitDirectory = join(parent, 'external.git');
		await mkdir(root);
		await mkdir(externalGitDirectory);
		await writeFile(join(root, '.git'), `gitdir: ${externalGitDirectory}\n`);
		const identity = await createNodeProjectRootPort().open(root);
		let commandCalls = 0;
		const snapshot = await createNodeGitPort({
			gitPath: '/trusted/git',
			commandRunner: async () => {
				commandCalls += 1;
				return `${'a'.repeat(40)}\n`;
			},
		}).inspect(identity.path, identity, []);

		expect(commandCalls).toBe(0);
		expect(snapshot.availability).toEqual({
			head: 'degraded',
			changes: 'degraded',
			ownership: 'degraded',
		});
		expect(snapshot.issues).toContainEqual({ operation: 'head', reason: 'identity-mismatch' });
	});

	it('accepts a linked worktree only with a backlink to this root', async () => {
		const parent = await projectTempDir('void-project-gitdir-worktree-');
		const repository = join(parent, 'repository');
		const worktree = join(parent, 'worktree');
		await mkdir(repository);
		await writeFile(join(repository, 'value.ts'), 'export const value = 1;\n');
		await run('git', ['init', '--quiet'], { cwd: repository });
		await run('git', ['config', 'user.name', 'Fixture Owner'], { cwd: repository });
		await run('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: repository });
		await run('git', ['add', '.'], { cwd: repository });
		await run('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: repository });
		await run('git', ['worktree', 'add', '--quiet', '--detach', worktree, 'HEAD'], {
			cwd: repository,
		});
		const identity = await createNodeProjectRootPort().open(worktree);

		const snapshot = await createNodeGitPort().inspect(identity.path, identity, ['value.ts']);

		expect(snapshot.issues).toEqual([]);
		expect(snapshot.availability.head).toBe('available');
		expect(snapshot.head).toMatch(/^[a-f0-9]{40}$/);
	});
});

describe('Git extractor degraded ownership', () => {
	it('preserves available HEAD and changes when ownership degrades independently', async () => {
		const root = await isolatedProjectRoot('void-project-git-degraded-');
		await mkdir(join(root, '.git'));
		const identity = await createNodeProjectRootPort().open(root);
		const port = createNodeGitPort({
			gitPath: '/trusted/git',
			commandRunner: async ({ args }) => {
				if (args.includes('rev-parse')) return `${'a'.repeat(40)}\n`;
				if (args.includes('log')) throw new Error('timed out');
				if (args.includes('--others')) return 'src/untracked.ts\0';
				return 'M\0src/changed.ts\0';
			},
		});

		const snapshot = await port.inspect(identity.path, identity, [
			'src/changed.ts',
			'src/untracked.ts',
		]);
		expect(snapshot).toMatchObject({
			head: 'a'.repeat(40),
			changed: ['src/changed.ts', 'src/untracked.ts'],
			availability: {
				head: 'available',
				changes: 'available',
				ownership: 'degraded',
			},
			issues: [{ operation: 'ownership', reason: 'failed' }],
		});
	});
});

describe('Git extractor identity changes', () => {
	it('degrades evidence when a swapped repository restores the root', async () => {
		const parent = await projectTempDir('void-project-git-aba-');
		const root = join(parent, 'root');
		const saved = join(parent, 'saved');
		const mallory = join(parent, 'mallory');
		await mkdir(root);
		await mkdir(mallory);
		for (const [path, owner] of [
			[root, 'Alice'],
			[mallory, 'Mallory'],
		] as const) {
			await writeFile(join(path, 'value.ts'), `export const owner = '${owner}';\n`);
			await run('git', ['init', '--quiet'], { cwd: path });
			await run('git', ['config', 'user.name', owner], { cwd: path });
			await run('git', ['config', 'user.email', `${owner.toLowerCase()}@example.invalid`], {
				cwd: path,
			});
			await run('git', ['add', '.'], { cwd: path });
			await run('git', ['commit', '--quiet', '-m', owner], { cwd: path });
		}
		const identity = await createNodeProjectRootPort().open(root);
		let generationValid = true;
		const port = createNodeGitPort({
			gitPath: '/trusted/git',
			commandRunner: async () => {
				await rename(root, saved);
				await rename(mallory, root);
				await rename(root, mallory);
				await rename(saved, root);
				generationValid = false;
				return '\u001eMallory\u001f\0\nvalue.ts\0';
			},
		});

		const snapshot = await port.inspect(
			identity.path,
			identity,
			['value.ts'],
			null,
			async () => generationValid,
		);

		expect(snapshot.availability).toEqual({
			head: 'degraded',
			changes: 'degraded',
			ownership: 'degraded',
		});
		expect(snapshot.owners).toEqual({});
		expect(snapshot.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ reason: 'identity-mismatch' })]),
		);
	});
});

describe('Git extractor journal validation', () => {
	it('checks the observed journal generation before and after every Git command', async () => {
		const root = await isolatedProjectRoot('void-project-git-journal-');
		await mkdir(join(root, '.git'));
		const identity = await createNodeProjectRootPort().open(root);
		let generationValid = true;
		let validationCalls = 0;
		let commandCalls = 0;
		const port = createNodeGitPort({
			gitPath: '/trusted/git',
			commandRunner: async () => {
				commandCalls += 1;
				generationValid = false;
				return '';
			},
		});

		const snapshot = await port.inspect(identity.path, identity, [], null, async () => {
			validationCalls += 1;
			return generationValid;
		});

		expect(commandCalls).toBe(1);
		expect(validationCalls).toBe(2);
		expect(snapshot.availability).toEqual({
			head: 'degraded',
			changes: 'degraded',
			ownership: 'degraded',
		});
		expect(snapshot.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ reason: 'identity-mismatch' })]),
		);
	});
});

it('degrades all Git evidence when HEAD changes during collection', async () => {
	const root = await isolatedProjectRoot('void-project-git-head-race-');
	await mkdir(join(root, '.git'));
	const identity = await createNodeProjectRootPort().open(root);
	let headReads = 0;
	const snapshot = await createNodeGitPort({
		gitPath: '/trusted/git',
		commandRunner: async ({ args }) => {
			if (args.includes('rev-parse')) {
				headReads += 1;
				return `${(headReads === 1 ? 'a' : 'b').repeat(40)}\n`;
			}
			if (args.includes('--others')) return '';
			if (args.includes('log')) return '';
			return 'M\0src/value.ts\0';
		},
	}).inspect(identity.path, identity, ['src/value.ts']);

	expect(headReads).toBe(2);
	expect(snapshot.head).toBeNull();
	expect(snapshot.availability).toEqual({
		head: 'degraded',
		changes: 'degraded',
		ownership: 'degraded',
	});
	expect(snapshot.issues).toEqual(
		expect.arrayContaining([expect.objectContaining({ reason: 'identity-mismatch' })]),
	);
});

it('pins every commit-dependent Git command to the initially observed HEAD', async () => {
	const root = await isolatedProjectRoot('void-project-git-head-aba-');
	await mkdir(join(root, '.git'));
	const identity = await createNodeProjectRootPort().open(root);
	const head = 'a'.repeat(40);
	const commitDependentArgs: string[][] = [];
	const snapshot = await createNodeGitPort({
		gitPath: '/trusted/git',
		commandRunner: async ({ args }) => {
			if (args.includes('rev-parse')) return `${head}\n`;
			if (args.includes('diff') || args.includes('log')) {
				commitDependentArgs.push([...args]);
			}
			if (args.includes('--others')) return '';
			if (args.includes('log')) return '\u001eAda\u001f\0\nsrc/value.ts\0';
			return 'M\0src/value.ts\0';
		},
	}).inspect(identity.path, identity, ['src/value.ts']);

	expect(snapshot.availability).toEqual({
		head: 'available',
		changes: 'available',
		ownership: 'available',
	});
	expect(commitDependentArgs).toHaveLength(2);
	for (const args of commitDependentArgs) {
		expect(args).toContain(head);
		expect(args).not.toContain('HEAD');
	}
});

describe('Git extractor history', () => {
	it('includes untracked files and proves a committed rename from the cached HEAD', async () => {
		const root = await isolatedProjectRoot('void-project-git-history-');
		await mkdir(join(root, 'src'));
		await writeFile(join(root, 'src', 'old.ts'), 'export const value = 1;\n');
		await run('git', ['init', '--quiet'], { cwd: root });
		await run('git', ['config', 'user.name', 'Fixture Owner'], { cwd: root });
		await run('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root });
		await run('git', ['add', 'src/old.ts'], { cwd: root });
		await run('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root });
		const previousHead = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
		await run('git', ['mv', 'src/old.ts', 'src/new.ts'], { cwd: root });
		await run('git', ['commit', '--quiet', '-m', 'rename'], { cwd: root });
		await writeFile(join(root, 'src', 'untracked.ts'), 'export {};\n');

		const identity = await createNodeProjectRootPort().open(root);
		const snapshot = await createNodeGitPort().inspect(
			identity.path,
			identity,
			['src/new.ts', 'src/untracked.ts'],
			previousHead,
		);
		expect(snapshot.issues).toEqual([]);
		expect(snapshot.changed).toContain('src/untracked.ts');
		expect(snapshot.renames).toContainEqual(
			expect.objectContaining({
				from: 'src/old.ts',
				to: 'src/new.ts',
				similarity: 100,
				proofHead: expect.stringMatching(/^[a-f0-9]{40}$/),
				proofRef: `git:${previousHead}..${snapshot.head}`,
			}),
		);
	});

	it('rejects timeout values that can disable the process ceiling', () => {
		for (const timeoutMs of [0, Number.NaN, Number.POSITIVE_INFINITY, 60_001]) {
			expect(() => createNodeGitPort({ timeoutMs })).toThrow(/PROJECT_GIT_INVALID/);
		}
	});
});

describe('Git extractor filters', () => {
	it('neutralizes local clean and process filters before inspecting content', async () => {
		const root = await isolatedProjectRoot('void-project-git-filter-');
		const marker = join(root, 'filter-ran');
		await writeFile(join(root, 'value.ts'), 'export const value = 1;\n');
		await writeFile(join(root, '.gitattributes'), '*.ts filter=hostile\n');
		await run('git', ['init', '--quiet'], { cwd: root });
		await run('git', ['config', 'user.name', 'Fixture Owner'], { cwd: root });
		await run('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root });
		await run('git', ['add', '.'], { cwd: root });
		await run('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root });
		await run('git', ['config', 'filter.hostile.clean', `touch '${marker}' && cat`], { cwd: root });
		await run('git', ['config', 'filter.hostile.process', `touch '${marker}' && exit 1`], {
			cwd: root,
		});
		await writeFile(join(root, 'value.ts'), 'export const value = 2;\n');
		await rm(marker, { force: true });

		const identity = await createNodeProjectRootPort().open(root);
		const snapshot = await createNodeGitPort().inspect(identity.path, identity, ['value.ts']);

		expect(snapshot.issues).toEqual([]);
		expect(snapshot.availability.changes).toBe('available');
		expect(snapshot.changed).toContain('value.ts');
		await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
	});
});
