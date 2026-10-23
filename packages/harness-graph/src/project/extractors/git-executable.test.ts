import { chmod, mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { createNodeProjectRootPort } from '../root.js';
import { cleanupProjectTempDirs, projectTempDir } from '../test-support.js';
import { createNodeGitPort } from './git.js';

const boundary = vi.hoisted(() => ({
	candidates: new Map<string, string>(),
	executed: [] as string[],
}));
const systemCandidates = ['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git', '/bin/git'];
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

vi.mock('node:fs/promises', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs/promises')>();
	return {
		...actual,
		realpath: async (path: Parameters<typeof actual.realpath>[0]) => {
			if (typeof path === 'string' && systemCandidates.includes(path)) {
				const fixture = boundary.candidates.get(path);
				if (fixture === undefined) throw Object.assign(new Error('absent'), { code: 'ENOENT' });
				return actual.realpath(fixture);
			}
			return actual.realpath(path);
		},
	};
});
vi.mock('node:child_process', () => ({
	execFile: (
		executable: string,
		args: readonly string[],
		_options: unknown,
		callback: (error: Error | null, stdout: string) => void,
	) => {
		boundary.executed.push(executable);
		callback(null, args.includes('rev-parse') ? `${'a'.repeat(40)}\n` : '');
	},
}));

afterEach(() => {
	if (originalPlatform !== undefined) Object.defineProperty(process, 'platform', originalPlatform);
	boundary.candidates.clear();
	boundary.executed.length = 0;
});
afterAll(cleanupProjectTempDirs);

interface SelectionCase {
	readonly label: string;
	readonly available: readonly number[];
	readonly expected: number;
	readonly invalid?: number;
	readonly platform?: string;
	readonly explicit?: number;
}

it.each<SelectionCase>([
	{ label: 'Apple Silicon Homebrew', available: [0, 1, 2, 3], expected: 0 },
	{ label: 'Intel Homebrew', available: [1, 2, 3], expected: 1 },
	{ label: 'system fallback', available: [2, 3], expected: 2 },
	{ label: 'invalid Homebrew fallback', available: [0, 2], invalid: 0, expected: 2 },
	{ label: 'explicit Git override', available: [0, 2], explicit: 2, expected: 2 },
	{ label: 'unchanged Linux default', available: [0, 2], platform: 'linux', expected: 2 },
])('uses $label through the real resolver', async (fixture) => {
	const { available, expected, invalid, explicit, platform = 'darwin' } = fixture;
	const root = await realpath(await projectTempDir('void-git-selection-'));
	await mkdir(join(root, '.git'));
	const executables = [];
	for (const index of available) {
		const candidate = systemCandidates[index];
		if (candidate === undefined) throw new Error('invalid fixture candidate');
		const executable = join(root, `git-${index}`);
		if (index === invalid) await mkdir(executable);
		else {
			await writeFile(executable, 'fixture executable');
			await chmod(executable, 0o755);
		}
		boundary.candidates.set(candidate, executable);
		executables[index] = executable;
	}
	Object.defineProperty(process, 'platform', { value: platform, configurable: true });
	const identity = await createNodeProjectRootPort().open(root);
	const options = explicit === undefined ? {} : { gitPath: executables[explicit] };
	const snapshot = await createNodeGitPort(options).inspect(identity.path, identity, []);
	expect(snapshot.issues).toEqual([]);
	expect(snapshot.head).toBe('a'.repeat(40));
	expect(boundary.executed.length).toBeGreaterThan(0);
	expect(new Set(boundary.executed)).toEqual(new Set([executables[expected]]));
});
