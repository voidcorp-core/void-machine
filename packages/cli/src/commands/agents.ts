import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
	type AgentsContext,
	acceptAgent,
	acceptReview,
	agentStatus,
	agentsContext,
	attachAgent,
	dispatchAgent,
	sendAgent,
	stopAgent,
	waitAgents,
} from '@voidcorp/void-machine/agents';
import { PRODUCT_IDENTITY } from '@voidcorp/hook-runner';

/**
 * `void-machine agents`: dispatch, follow and close delegated agent runs through the Void
 * Machine kernel. Every answer is one JSON document on stdout: exit 0 when it holds, 1 for a
 * refusal carrying its cause and repair, 2 for a usage error.
 */

const USAGE = `usage: void-machine agents <command>
  dispatch --role work|review --brief-file F [--runtime claude|codex] [--type T] [--model M]
           [--output-schema F] [--ticket DEV-123] [--mission ID] [--cwd PATH]
                                                               -> runId, at once
  wait <runId...> [--any] [--timeout S]                        -> next transitions (JSON)
  status [<runId>]                                             -> state, cause, action, result
  send <runId> --message-file F
  accept <runId>
  stop <runId>
  attach <runId>                                               -> the session, in this terminal`;

const WAIT_DEFAULT_S = 300;
const WAIT_MAX_S = 3_600;
const MAX_FILE_BYTES = 1_048_576;

export interface AgentsIo {
	readonly cwd: string;
	readonly env: NodeJS.ProcessEnv;
	readonly home: string;
	readonly attach: (command: readonly string[]) => Promise<number>;
}
export interface AgentsOutcome {
	readonly code: 0 | 1 | 2;
	readonly stdout: string;
	readonly stderr: string;
}

const usage = (detail?: string): AgentsOutcome => ({
	code: 2,
	stdout: '',
	stderr: `${detail === undefined ? '' : `${detail}\n`}${USAGE}\n`,
});
const refused = (value: object): boolean => 'ok' in value && value.ok === false;
const answer = (value: object, ok = !refused(value)): AgentsOutcome => ({
	code: ok ? 0 : 1,
	stdout: `${JSON.stringify(value)}\n`,
	stderr: '',
});

type Parsed = { readonly positional: string[]; readonly options: Map<string, string>; readonly flags: Set<string> };

function parse(args: readonly string[]): Parsed | string {
	const positional: string[] = [];
	const options = new Map<string, string>();
	const flags = new Set<string>();
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] ?? '';
		if (arg === '--any') flags.add(arg);
		else if (arg.startsWith('--')) {
			const value = args[index + 1];
			if (value === undefined || value.startsWith('--')) return `${arg} needs a value`;
			options.set(arg, value);
			index += 1;
		} else positional.push(arg);
	}
	return { positional, options, flags };
}

function readText(path: string): string | undefined {
	try {
		const info = statSync(path);
		return info.isFile() && info.size <= MAX_FILE_BYTES ? readFileSync(path, 'utf8') : undefined;
	} catch {
		return undefined;
	}
}

/** A JSON document from a bounded file; undefined when it cannot be read or parsed. */
function readJson(path: string): unknown {
	const text = readText(path);
	if (text === undefined) return undefined;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

function context(io: AgentsIo, cwd = io.cwd): AgentsContext | AgentsOutcome {
	const composed = agentsContext({ cwd, env: io.env, home: io.home,
		updateCommand: `npx ${PRODUCT_IDENTITY.packageName} update` });
	return 'ok' in composed ? answer(composed) : composed;
}

async function dispatch(parsed: Parsed, io: AgentsIo): Promise<AgentsOutcome> {
	const role = parsed.options.get('--role');
	const briefFile = parsed.options.get('--brief-file');
	if ((role !== 'work' && role !== 'review') || briefFile === undefined || parsed.positional.length > 0) {
		return usage('dispatch needs --role work|review and --brief-file');
	}
	const runtime = parsed.options.get('--runtime') ?? 'claude';
	if (runtime !== 'claude' && runtime !== 'codex') {
		return answer({ ok: false, cause: `the ${runtime} runtime has no delegation adapter`,
			action: 'dispatch with --runtime claude|codex' });
	}
	const brief = readText(resolve(io.cwd, briefFile));
	if (brief === undefined) return usage(`cannot read ${briefFile} (a regular file of at most 1 MiB)`);
	const schemaFile = parsed.options.get('--output-schema');
	const outputSchema = schemaFile === undefined ? undefined : readJson(resolve(io.cwd, schemaFile));
	if (schemaFile !== undefined && outputSchema === undefined) {
		return usage(`cannot read --output-schema ${schemaFile} as JSON (a regular file of at most 1 MiB)`);
	}
	const cwd = resolve(io.cwd, parsed.options.get('--cwd') ?? '.');
	const composed = context(io, cwd);
	if (!('store' in composed)) return composed;
	return answer(await dispatchAgent(composed, { runtime, role, cwd, brief, outputSchema,
		agentType: parsed.options.get('--type'),
		model: parsed.options.get('--model'), ticket: parsed.options.get('--ticket'),
		missionId: parsed.options.get('--mission') ?? io.env['VOID_MISSION_ID'] }));
}

async function wait(parsed: Parsed, composed: AgentsContext): Promise<AgentsOutcome> {
	const text = parsed.options.get('--timeout') ?? String(WAIT_DEFAULT_S);
	const seconds = Number(text);
	if (parsed.positional.length === 0 || !Number.isInteger(seconds) || seconds < 1 || seconds > WAIT_MAX_S) {
		return usage(`wait needs at least one runId and --timeout between 1 and ${String(WAIT_MAX_S)} seconds`);
	}
	const outcome = await waitAgents(composed, parsed.positional,
		{ any: parsed.flags.has('--any'), timeoutMs: seconds * 1_000 });
	return answer(outcome, outcome.kind !== 'unknown-run');
}

async function single(command: string, parsed: Parsed, io: AgentsIo, composed: AgentsContext)
	: Promise<AgentsOutcome> {
	const [runId] = parsed.positional;
	if (runId === undefined || parsed.positional.length !== 1) return usage(`${command} needs one runId`);
	if (command === 'accept') {
		// A review verdict is taken only from the session the runtime lists under the run.
		const known = await agentStatus(composed, runId);
		const review = 'runs' in known && known.runs[0]?.role === 'review';
		return answer(await (review ? acceptReview : acceptAgent)(composed, runId));
	}
	if (command === 'stop') return answer(await stopAgent(composed, runId));
	if (command === 'send') {
		const file = parsed.options.get('--message-file');
		const message = file === undefined ? undefined : readText(resolve(io.cwd, file));
		if (message === undefined) return usage('send needs a readable --message-file');
		return answer(await sendAgent(composed, runId, message));
	}
	const attach = await attachAgent(composed, runId);
	if (!attach.ok) return answer(attach);
	const code = await io.attach(attach.command);
	return { code: code === 0 ? 0 : 1, stdout: '', stderr: '' };
}

export async function runAgents(args: readonly string[], io: AgentsIo): Promise<AgentsOutcome> {
	const [command, ...rest] = args;
	const parsed = parse(rest);
	if (typeof parsed === 'string') return usage(parsed);
	if (command === 'dispatch') return dispatch(parsed, io);
	if (!['wait', 'status', 'send', 'accept', 'stop', 'attach'].includes(command ?? '')) return usage();
	if (command === 'send' && !parsed.options.has('--message-file')) return usage('send needs --message-file');
	if (command !== 'status' && command !== 'wait' && parsed.positional.length !== 1) {
		return usage(`${String(command)} needs one runId`);
	}
	if (command === 'wait' && parsed.positional.length === 0) return usage('wait needs at least one runId');
	const composed = context(io);
	if (!('store' in composed)) return composed;
	if (command === 'wait') return wait(parsed, composed);
	if (command === 'status') {
		if (parsed.positional.length > 1) return usage('status takes at most one runId');
		return answer(await agentStatus(composed, parsed.positional[0]));
	}
	return single(command ?? '', parsed, io, composed);
}

function attachInTerminal(command: readonly string[]): Promise<number> {
	const [executable, ...args] = command;
	if (executable === undefined) return Promise.resolve(1);
	return new Promise((done) => {
		const child = spawn(executable, args, { stdio: 'inherit', shell: false });
		child.once('error', () => done(1));
		child.once('close', (code) => done(code ?? 1));
	});
}

export async function agents(args: readonly string[]): Promise<void> {
	const outcome = await runAgents(args, { cwd: process.cwd(), env: process.env, home: homedir(),
		attach: attachInTerminal });
	if (outcome.stdout !== '') process.stdout.write(outcome.stdout);
	if (outcome.stderr !== '') process.stderr.write(outcome.stderr);
	process.exitCode = outcome.code;
}
