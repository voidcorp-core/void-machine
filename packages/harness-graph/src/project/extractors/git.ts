import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, open, realpath } from 'node:fs/promises';
import { devNull } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { readBoundedHandle } from '../bounded-read.js';
import { normalizeProjectPath } from './filesystem.js';
import type {
	ProjectGitIssue,
	ProjectGitPort,
	ProjectRootIdentity,
	ProjectGitSnapshot,
} from './types.js';
import { validateNodeProjectRootIdentity } from '../root.js';

const GIT_HEAD = /^[a-f0-9]{40,64}$/;
const MAX_GIT_BUFFER = 16 * 1024 * 1024;
const MAX_GIT_TIMEOUT_MS = 60_000;
const MAX_FILTER_DRIVERS = 256;
const MAX_GIT_POINTER_BYTES = 4_096;
const FILTER_KEY = /^filter\.([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.(?:clean|process)$/;
// Git for Windows translates Git-style paths itself. Its documented null config
// path is `/dev/null`; Node's Win32 device spelling (`\\.\nul`) is not a Git path.
const GIT_NULL_CONFIG = '/dev/null';

export interface ProjectGitCommand {
	readonly executable: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly timeoutMs: number;
	readonly env: Readonly<Record<string, string>>;
}

export type ProjectGitCommandRunner = (command: ProjectGitCommand) => Promise<string>;

function gitError(message: string): never {
	throw new Error(`PROJECT_GIT_INVALID: ${message}`);
}

function safeGitPath(value: string): string {
	try {
		return normalizeProjectPath(value);
	} catch {
		return gitError('Git returned a path outside the project contract');
	}
}

function containsControl(value: string): boolean {
	return [...value].some((character) => {
		const point = character.codePointAt(0) ?? 0;
		return point < 0x20 || point === 0x7f;
	});
}

export function parseGitNameStatus(
	output: string,
): Pick<ProjectGitSnapshot, 'changed' | 'deleted' | 'renames'> {
	const values = output.split('\0');
	if (values.at(-1) === '') values.pop();
	const changed = new Set<string>();
	const deleted = new Set<string>();
	const renames: { from: string; to: string; similarity: number }[] = [];
	for (let index = 0; index < values.length; ) {
		const status = values[index++];
		if (status === undefined) break;
		if (/^R\d{3}$/.test(status)) {
			const from = values[index++];
			const to = values[index++];
			if (from === undefined || to === undefined) gitError('rename record is truncated');
			const similarity = Number.parseInt(status.slice(1), 10);
			const rename = Object.freeze({ from: safeGitPath(from), to: safeGitPath(to), similarity });
			renames.push(rename);
			changed.add(rename.to);
			continue;
		}
		const path = values[index++];
		if (path === undefined) gitError('status record is truncated');
		const normalized = safeGitPath(path);
		if (status === 'D') deleted.add(normalized);
		else changed.add(normalized);
	}
	return Object.freeze({
		changed: Object.freeze([...changed].sort()),
		deleted: Object.freeze([...deleted].sort()),
		renames: Object.freeze(renames.sort((left, right) => left.from.localeCompare(right.from))),
	});
}

function parseUntracked(output: string): readonly string[] {
	const paths = output
		.split('\0')
		.filter((path) => path.length > 0)
		.map(safeGitPath);
	return Object.freeze([...new Set(paths)].sort());
}

export function parseGitOwnership(
	output: string,
	knownPaths: ReadonlySet<string>,
): Readonly<Record<string, string>> {
	const owners: Record<string, string> = {};
	for (const record of output.split('\u001e').slice(1)) {
		const boundary = record.indexOf('\u001f');
		if (boundary < 1) continue;
		const owner = record.slice(0, boundary);
		if (owner.length > 256 || containsControl(owner)) continue;
		const paths = record.slice(boundary + 1).split('\0');
		for (const rawPath of paths) {
			const path = rawPath.startsWith('\n') ? rawPath.slice(1) : rawPath;
			if (path.length === 0) continue;
			const normalized = safeGitPath(path);
			if (knownPaths.has(normalized) && owners[normalized] === undefined) {
				owners[normalized] = owner;
			}
		}
	}
	return Object.freeze(
		Object.fromEntries(Object.entries(owners).sort(([left], [right]) => left.localeCompare(right))),
	);
}

function defaultCommandRunner(command: ProjectGitCommand): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			command.executable,
			[...command.args],
			{
				cwd: command.cwd,
				encoding: 'utf8',
				env: command.env,
				maxBuffer: MAX_GIT_BUFFER,
				timeout: command.timeoutMs,
				windowsHide: true,
			},
			(error, stdout) => {
				if (error) reject(error);
				else resolve(stdout);
			},
		);
	});
}

function executableCandidates(): readonly string[] {
	if (process.platform === 'win32') {
		const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
		return [
			join(programFiles, 'Git', 'cmd', 'git.exe'),
			join(programFiles, 'Git', 'bin', 'git.exe'),
		];
	}
	// Apple /usr/bin tools can launch Xcode discovery; prefer a direct installed Git.
	if (process.platform === 'darwin') {
		return ['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git', '/bin/git'];
	}
	return ['/usr/bin/git', '/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'];
}

async function trustedGitPath(explicit: string | undefined): Promise<string> {
	const candidates = explicit === undefined ? executableCandidates() : [explicit];
	for (const candidate of candidates) {
		if (!isAbsolute(candidate)) {
			if (explicit !== undefined) gitError('gitPath must be absolute');
			continue;
		}
		try {
			const canonical = await realpath(candidate);
			const stats = await lstat(canonical);
			await access(canonical, constants.X_OK);
			if (stats.isFile() && !stats.isSymbolicLink()) return canonical;
		} catch {
			// Try the next fixed system location.
		}
	}
	throw new Error('PROJECT_GIT_UNAVAILABLE: no trusted absolute Git executable was found');
}

function repositoryIdentity(path: string, stats: Awaited<ReturnType<typeof lstat>>) {
	return Object.freeze({
		path,
		device: stats.dev.toString(),
		inode: stats.ino.toString(),
	});
}

function sameRepositoryIdentity(left: RepositoryIdentity, right: RepositoryIdentity): boolean {
	return left.path === right.path && left.device === right.device && left.inode === right.inode;
}

async function directoryIdentity(path: string): Promise<RepositoryIdentity | undefined> {
	const canonical = await realpath(path);
	const stats = await lstat(canonical);
	if (!stats.isDirectory() || stats.isSymbolicLink()) return undefined;
	return repositoryIdentity(canonical, stats);
}

async function boundedPointer(
	path: string,
): Promise<{ readonly text: string; readonly identity: RepositoryIdentity }> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const opened = await handle.stat();
		if (!opened.isFile() || opened.isSymbolicLink()) gitError('Git pointer must be a regular file');
		const bytes = await readBoundedHandle(handle, opened.size, MAX_GIT_POINTER_BYTES);
		const confirmed = await handle.stat();
		if (
			confirmed.dev !== opened.dev ||
			confirmed.ino !== opened.ino ||
			confirmed.size !== opened.size ||
			confirmed.mtimeMs !== opened.mtimeMs ||
			confirmed.ctimeMs !== opened.ctimeMs
		)
			gitError('Git pointer changed while it was read');
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r?\n$/, '');
		if (text.length === 0 || text.includes('\n') || text.includes('\r') || containsControl(text)) {
			gitError('Git pointer is not a single printable line');
		}
		return Object.freeze({ text, identity: repositoryIdentity(path, confirmed) });
	} finally {
		await handle.close();
	}
}

function linkedWorktreeLocationIsValid(
	commonDirectory: RepositoryIdentity,
	gitDirectory: RepositoryIdentity,
): boolean {
	const path = relative(commonDirectory.path, gitDirectory.path);
	const parts = path.split(sep);
	return (
		!isAbsolute(path) &&
		parts.length === 2 &&
		parts[0] === 'worktrees' &&
		parts[1] !== undefined &&
		parts[1].length > 0
	);
}

async function linkedWorktreeBinding(
	markerPath: string,
): Promise<GitRepositoryBinding | undefined> {
	const marker = await boundedPointer(markerPath);
	if (!marker.text.startsWith('gitdir: ')) return undefined;
	const rawGitDirectory = marker.text.slice('gitdir: '.length);
	const gitDirectory = await directoryIdentity(resolve(dirname(markerPath), rawGitDirectory));
	if (gitDirectory === undefined) return undefined;
	const [backlink, commonPointer] = await Promise.all([
		boundedPointer(join(gitDirectory.path, 'gitdir')),
		boundedPointer(join(gitDirectory.path, 'commondir')),
	]);
	const backlinkPath = await realpath(resolve(gitDirectory.path, backlink.text));
	const commonDirectory = await directoryIdentity(resolve(gitDirectory.path, commonPointer.text));
	if (
		backlinkPath !== markerPath ||
		commonDirectory === undefined ||
		!linkedWorktreeLocationIsValid(commonDirectory, gitDirectory)
	)
		return undefined;
	return Object.freeze({ marker: marker.identity, gitDirectory, commonDirectory });
}

async function discoverRepositoryBinding(root: string): Promise<GitRepositoryBinding | undefined> {
	const markerPath = join(root, '.git');
	try {
		const stats = await lstat(markerPath);
		if (stats.isSymbolicLink()) return undefined;
		if (stats.isDirectory()) {
			const identity = await directoryIdentity(markerPath);
			if (identity === undefined || identity.path !== markerPath) return undefined;
			return Object.freeze({
				marker: identity,
				gitDirectory: identity,
				commonDirectory: identity,
			});
		}
		if (!stats.isFile()) return undefined;
		return await linkedWorktreeBinding(markerPath);
	} catch {
		return undefined;
	}
}

async function validateRepositoryBinding(
	root: string,
	expected: GitRepositoryBinding,
): Promise<boolean> {
	const actual = await discoverRepositoryBinding(root);
	return (
		actual !== undefined &&
		sameRepositoryIdentity(actual.marker, expected.marker) &&
		sameRepositoryIdentity(actual.gitDirectory, expected.gitDirectory) &&
		sameRepositoryIdentity(actual.commonDirectory, expected.commonDirectory)
	);
}

function gitEnvironment(
	executable: string,
	root: string,
	repository: GitRepositoryBinding,
): Readonly<Record<string, string>> {
	const systemPaths =
		process.platform === 'win32'
			? [dirname(executable), dirname(process.execPath)]
			: [dirname(executable), '/usr/bin', '/bin'];
	return Object.freeze({
		GIT_CONFIG_GLOBAL: GIT_NULL_CONFIG,
		GIT_CONFIG_SYSTEM: GIT_NULL_CONFIG,
		GIT_CONFIG_NOSYSTEM: '1',
		GIT_COMMON_DIR: repository.commonDirectory.path,
		GIT_DIR: repository.gitDirectory.path,
		GIT_ATTR_NOSYSTEM: '1',
		GIT_ALLOW_PROTOCOL: '',
		GIT_LITERAL_PATHSPECS: '1',
		GIT_OPTIONAL_LOCKS: '0',
		GIT_PAGER: 'cat',
		GIT_PROTOCOL_FROM_USER: '0',
		GIT_TERMINAL_PROMPT: '0',
		GIT_WORK_TREE: root,
		LANG: 'C',
		LC_ALL: 'C',
		PATH: [...new Set(systemPaths)].join(delimiter),
	});
}

function parseFilterDrivers(output: string): readonly string[] {
	const drivers = new Set<string>();
	for (const key of output.split('\0').filter(Boolean)) {
		const match = FILTER_KEY.exec(key);
		if (match?.[1] !== undefined) drivers.add(match[1]);
		else if (key.startsWith('filter.') && (key.endsWith('.clean') || key.endsWith('.process'))) {
			gitError('repository config declares an unsafe filter driver name');
		}
		if (drivers.size > MAX_FILTER_DRIVERS) {
			gitError('repository config declares too many filter drivers');
		}
	}
	return Object.freeze([...drivers].sort());
}

function safeGitArgs(
	root: string,
	args: readonly string[],
	filters: readonly string[] = [],
): readonly string[] {
	return Object.freeze([
		'--no-replace-objects',
		'-c',
		'core.bare=false',
		'-c',
		'core.fsmonitor=false',
		'-c',
		`core.hooksPath=${devNull}`,
		'-c',
		`core.worktree=${root}`,
		'-c',
		'protocol.allow=never',
		'-c',
		'submodule.recurse=false',
		...filters.flatMap((driver) => [
			'-c',
			`filter.${driver}.clean=`,
			'-c',
			`filter.${driver}.process=`,
			'-c',
			`filter.${driver}.required=false`,
		]),
		...args,
	]);
}

function failureReason(error: unknown): ProjectGitIssue['reason'] {
	if (typeof error === 'object' && error !== null) {
		if ('killed' in error && error.killed === true) return 'timeout';
		if ('code' in error && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'overflow';
	}
	if (error instanceof Error && error.message.startsWith('PROJECT_GIT_ROOT_MISMATCH')) {
		return 'identity-mismatch';
	}
	return error instanceof Error && error.message.startsWith('PROJECT_GIT_INVALID')
		? 'invalid-output'
		: 'failed';
}

interface CommandResult {
	readonly ok: boolean;
	readonly output: string;
	readonly reason?: ProjectGitIssue['reason'];
}

async function commandResult(promise: Promise<string>): Promise<CommandResult> {
	try {
		return { ok: true, output: await promise };
	} catch (error) {
		return { ok: false, output: '', reason: failureReason(error) };
	}
}

function combineStatus(
	outputs: readonly string[],
): Pick<ProjectGitSnapshot, 'changed' | 'deleted' | 'renames'> {
	const parsed = outputs.map(parseGitNameStatus);
	const renames = new Map<string, ProjectGitSnapshot['renames'][number]>();
	for (const rename of parsed.flatMap((status) => status.renames)) {
		renames.set(`${rename.from}\0${rename.to}`, rename);
	}
	return Object.freeze({
		changed: Object.freeze([...new Set(parsed.flatMap((status) => status.changed))].sort()),
		deleted: Object.freeze([...new Set(parsed.flatMap((status) => status.deleted))].sort()),
		renames: Object.freeze(
			[...renames.values()].sort((left, right) => left.from.localeCompare(right.from)),
		),
	});
}

interface GitPortOptions {
	readonly timeoutMs?: number;
	readonly gitPath?: string;
	readonly commandRunner?: ProjectGitCommandRunner;
}

type GitStatus = Pick<ProjectGitSnapshot, 'changed' | 'deleted' | 'renames'>;
type ValidatedGitRunner = (args: readonly string[], filters?: readonly string[]) => Promise<string>;

interface RepositoryIdentity {
	readonly path: string;
	readonly device: string;
	readonly inode: string;
}

interface GitRepositoryBinding {
	readonly marker: RepositoryIdentity;
	readonly gitDirectory: RepositoryIdentity;
	readonly commonDirectory: RepositoryIdentity;
}

interface GitEvidence {
	readonly head: string | null;
	readonly headResult: CommandResult;
	readonly finalHeadResult: CommandResult;
	readonly worktreeResult: CommandResult;
	readonly untrackedResult: CommandResult;
	readonly ownershipResult: CommandResult;
	readonly historyResult: CommandResult;
}

function parsedHead(result: CommandResult): string | null {
	const output = result.output.trim();
	return result.ok && GIT_HEAD.test(output) ? output : null;
}

function gitEvidenceHeadIsStable(evidence: GitEvidence): boolean {
	const finalHead = parsedHead(evidence.finalHeadResult);
	return evidence.head !== null && evidence.head === finalHead;
}

interface ParsedGitEvidence {
	readonly status: GitStatus;
	readonly untracked: readonly string[];
	readonly owners: Readonly<Record<string, string>>;
	readonly issues: readonly ProjectGitIssue[];
}

function degradedSnapshot(reason: ProjectGitIssue['reason']): ProjectGitSnapshot {
	const issues: readonly ProjectGitIssue[] = Object.freeze([
		{ operation: 'head', reason },
		{ operation: 'changes', reason },
		{ operation: 'ownership', reason },
	]);
	return Object.freeze({
		head: null,
		changed: Object.freeze([]),
		deleted: Object.freeze([]),
		renames: Object.freeze([]),
		owners: Object.freeze({}),
		availability: Object.freeze({ head: 'degraded', changes: 'degraded', ownership: 'degraded' }),
		issues,
	});
}

async function resolveGitExecutable(options: GitPortOptions): Promise<string | null> {
	try {
		if (options.commandRunner === undefined) return await trustedGitPath(options.gitPath);
		if (options.gitPath === undefined || !isAbsolute(options.gitPath)) {
			gitError('an injected commandRunner requires an absolute gitPath');
		}
		return options.gitPath;
	} catch {
		return null;
	}
}

async function validateGitObservation(
	root: string,
	repository: GitRepositoryBinding,
	expectedRoot: ProjectRootIdentity,
	validateObservation: (() => Promise<boolean>) | undefined,
): Promise<boolean> {
	if (!(await validateNodeProjectRootIdentity(expectedRoot))) return false;
	if (!(await validateRepositoryBinding(root, repository))) return false;
	return validateObservation === undefined || (await validateObservation());
}

function createValidatedRunner(context: {
	readonly root: string;
	readonly expectedRoot: ProjectRootIdentity;
	readonly executable: string;
	readonly timeoutMs: number;
	readonly runner: ProjectGitCommandRunner;
	readonly repository: GitRepositoryBinding;
	readonly validateObservation?: () => Promise<boolean>;
}): ValidatedGitRunner {
	const env = gitEnvironment(context.executable, context.root, context.repository);
	return async (args, filters = []) => {
		if (
			!(await validateGitObservation(
				context.root,
				context.repository,
				context.expectedRoot,
				context.validateObservation,
			))
		) {
			throw new Error('PROJECT_GIT_ROOT_MISMATCH: root changed before Git command');
		}
		const output = await context.runner({
			executable: context.executable,
			args: safeGitArgs(context.root, args, filters),
			cwd: context.root,
			timeoutMs: context.timeoutMs,
			env,
		});
		if (
			!(await validateGitObservation(
				context.root,
				context.repository,
				context.expectedRoot,
				context.validateObservation,
			))
		) {
			throw new Error('PROJECT_GIT_ROOT_MISMATCH: root changed during Git command');
		}
		return output;
	};
}

async function loadFilterDrivers(
	run: ValidatedGitRunner,
): Promise<
	| { readonly ok: true; readonly filters: readonly string[] }
	| { readonly ok: false; readonly reason: ProjectGitIssue['reason'] }
> {
	const result = await commandResult(
		run(['config', '--includes', '--name-only', '--null', '--list']),
	);
	if (!result.ok) return { ok: false, reason: result.reason ?? 'failed' };
	try {
		return { ok: true, filters: parseFilterDrivers(result.output) };
	} catch {
		return { ok: false, reason: 'invalid-output' };
	}
}

async function collectGitEvidence(
	run: ValidatedGitRunner,
	filters: readonly string[],
	paths: readonly string[],
	previousHead: string | null,
	head: string,
	headResult: CommandResult,
): Promise<GitEvidence> {
	const [worktreeResult, untrackedResult, ownershipResult] = await Promise.all([
		commandResult(
			run(
				['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '-M', head, '--'],
				filters,
			),
		),
		commandResult(run(['ls-files', '--others', '--exclude-standard', '-z', '--'], filters)),
		paths.length === 0
			? Promise.resolve<CommandResult>({ ok: true, output: '' })
			: commandResult(
					run(
						[
							'log',
							'--max-count=5000',
							'--format=%x1e%an%x1f',
							'--name-only',
							'-z',
							head,
							'--',
							'.',
						],
						filters,
					),
				),
	]);
	const historyResult = await collectHistoryEvidence(run, filters, head, previousHead);
	const finalHeadResult = await commandResult(run(['rev-parse', 'HEAD'], filters));
	return {
		head,
		headResult,
		finalHeadResult,
		worktreeResult,
		untrackedResult,
		ownershipResult,
		historyResult,
	};
}

async function collectHistoryEvidence(
	run: ValidatedGitRunner,
	filters: readonly string[],
	head: string | null,
	previousHead: string | null,
): Promise<CommandResult> {
	if (
		head === null ||
		previousHead === null ||
		!GIT_HEAD.test(previousHead) ||
		previousHead === head
	) {
		return { ok: true, output: '' };
	}
	return commandResult(
		run(
			[
				'diff',
				'--no-ext-diff',
				'--no-textconv',
				'--name-status',
				'-z',
				'-M',
				`${previousHead}..${head}`,
				'--',
			],
			filters,
		),
	);
}

function parseGitChanges(
	evidence: GitEvidence,
	knownPaths: ReadonlySet<string>,
	previousHead: string | null,
): Pick<ParsedGitEvidence, 'status' | 'untracked' | 'issues'> {
	const issues: ProjectGitIssue[] = [];
	let status: GitStatus = Object.freeze({
		changed: Object.freeze([]),
		deleted: Object.freeze([]),
		renames: Object.freeze([]),
	});
	let untracked: readonly string[] = Object.freeze([]);
	try {
		status = combineStatus([
			...(evidence.worktreeResult.ok ? [evidence.worktreeResult.output] : []),
			...(evidence.historyResult.ok ? [evidence.historyResult.output] : []),
		]);
		status = addRenameEvidence(status, evidence, previousHead);
		if (evidence.untrackedResult.ok) {
			untracked = Object.freeze(
				parseUntracked(evidence.untrackedResult.output).filter((path) => knownPaths.has(path)),
			);
		}
	} catch {
		issues.push({ operation: 'changes', reason: 'invalid-output' });
	}
	if (!evidence.worktreeResult.ok || !evidence.untrackedResult.ok || !evidence.historyResult.ok) {
		issues.push({
			operation: 'changes',
			reason:
				evidence.worktreeResult.reason ??
				evidence.untrackedResult.reason ??
				evidence.historyResult.reason ??
				'failed',
		});
	}
	return { status, untracked, issues };
}

function addRenameEvidence(
	status: GitStatus,
	evidence: GitEvidence,
	previousHead: string | null,
): GitStatus {
	const historyRenameKeys = new Set(
		evidence.historyResult.ok
			? parseGitNameStatus(evidence.historyResult.output).renames.map(
					(rename) => `${rename.from}\0${rename.to}`,
				)
			: [],
	);
	return Object.freeze({
		...status,
		renames: Object.freeze(
			status.renames.map((rename) =>
				Object.freeze({
					...rename,
					...(evidence.head === null
						? {}
						: {
								proofHead: evidence.head,
								proofRef:
									historyRenameKeys.has(`${rename.from}\0${rename.to}`) && previousHead !== null
										? `git:${previousHead}..${evidence.head}`
										: 'git:working-tree',
							}),
				}),
			),
		),
	});
}

function parseOwnershipEvidence(
	result: CommandResult,
	knownPaths: ReadonlySet<string>,
): Pick<ParsedGitEvidence, 'owners' | 'issues'> {
	if (!result.ok) {
		return {
			owners: Object.freeze({}),
			issues: [{ operation: 'ownership', reason: result.reason ?? 'failed' }],
		};
	}
	try {
		return { owners: parseGitOwnership(result.output, knownPaths), issues: [] };
	} catch {
		return {
			owners: Object.freeze({}),
			issues: [{ operation: 'ownership', reason: 'invalid-output' }],
		};
	}
}

function parseGitEvidence(
	evidence: GitEvidence,
	paths: readonly string[],
	previousHead: string | null,
): ParsedGitEvidence {
	const knownPaths = new Set(paths);
	const changes = parseGitChanges(evidence, knownPaths, previousHead);
	const ownership = parseOwnershipEvidence(evidence.ownershipResult, knownPaths);
	const headIssues: readonly ProjectGitIssue[] =
		evidence.head === null
			? [
					{
						operation: 'head',
						reason: evidence.headResult.ok
							? 'invalid-output'
							: (evidence.headResult.reason ?? 'failed'),
					},
				]
			: [];
	return {
		status: changes.status,
		untracked: changes.untracked,
		owners: ownership.owners,
		issues: [...headIssues, ...changes.issues, ...ownership.issues],
	};
}

function sealGitSnapshot(evidence: GitEvidence, parsed: ParsedGitEvidence): ProjectGitSnapshot {
	const uniqueIssues = [
		...new Map(
			parsed.issues.map((issue) => [`${issue.operation}:${issue.reason}`, issue]),
		).values(),
	];
	const degraded = new Set(uniqueIssues.map((issue) => issue.operation));
	return Object.freeze({
		head: evidence.head,
		changed: Object.freeze([...new Set([...parsed.status.changed, ...parsed.untracked])].sort()),
		deleted: parsed.status.deleted,
		renames: parsed.status.renames,
		owners: parsed.owners,
		availability: Object.freeze({
			head: degraded.has('head') ? 'degraded' : 'available',
			changes: degraded.has('changes') ? 'degraded' : 'available',
			ownership: degraded.has('ownership') ? 'degraded' : 'available',
		}),
		issues: Object.freeze(uniqueIssues),
	});
}

async function inspectGitProject(
	options: GitPortOptions,
	timeoutMs: number,
	root: string,
	expectedRoot: ProjectRootIdentity,
	paths: readonly string[],
	previousHead: string | null,
	validateObservation: (() => Promise<boolean>) | undefined,
): Promise<ProjectGitSnapshot> {
	if (root !== expectedRoot.path || !(await validateNodeProjectRootIdentity(expectedRoot))) {
		return degradedSnapshot('identity-mismatch');
	}
	const repository = await discoverRepositoryBinding(root);
	if (repository === undefined) return degradedSnapshot('identity-mismatch');
	const executable = await resolveGitExecutable(options);
	if (executable === null) return degradedSnapshot('unavailable');
	const run = createValidatedRunner({
		root,
		expectedRoot,
		executable,
		timeoutMs,
		runner: options.commandRunner ?? defaultCommandRunner,
		repository,
		...(validateObservation === undefined ? {} : { validateObservation }),
	});
	const filterResult = await loadFilterDrivers(run);
	if (!filterResult.ok) return degradedSnapshot(filterResult.reason);
	const headResult = await commandResult(run(['rev-parse', 'HEAD'], filterResult.filters));
	const head = parsedHead(headResult);
	if (head === null) {
		return degradedSnapshot(headResult.ok ? 'invalid-output' : (headResult.reason ?? 'failed'));
	}
	const evidence = await collectGitEvidence(
		run,
		filterResult.filters,
		paths,
		previousHead,
		head,
		headResult,
	);
	if (!gitEvidenceHeadIsStable(evidence)) return degradedSnapshot('identity-mismatch');
	return sealGitSnapshot(evidence, parseGitEvidence(evidence, paths, previousHead));
}

export function createNodeGitPort(options: GitPortOptions = {}): ProjectGitPort {
	const timeoutMs = options.timeoutMs ?? 5_000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_GIT_TIMEOUT_MS) {
		gitError(`timeoutMs must be between 1 and ${MAX_GIT_TIMEOUT_MS}`);
	}
	return Object.freeze({
		inspect(
			root: string,
			expectedRoot: ProjectRootIdentity,
			paths: readonly string[] = [],
			previousHead: string | null = null,
			validateObservation: (() => Promise<boolean>) | undefined = undefined,
		) {
			return inspectGitProject(
				options,
				timeoutMs,
				root,
				expectedRoot,
				paths,
				previousHead,
				validateObservation,
			);
		},
	});
}
