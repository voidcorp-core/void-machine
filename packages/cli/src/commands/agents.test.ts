import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { type AgentsIo, runAgents } from './agents.js';

function repository(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'cli-agents-')));
	onTestFinished(() => rmSync(root, { recursive: true, force: true }));
	execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
	return root;
}

/** Real kernel composition in a throwaway repository; attach is recorded, never run. */
function io(cwd: string): AgentsIo & { attached: string[][] } {
	const attached: string[][] = [];
	return {
		cwd,
		env: {},
		home: '/nonexistent',
		attached,
		attach: async (command) => {
			attached.push([...command]);
			return 0;
		},
	};
}

describe('void-machine agents', () => {
	it.each([
		[[]],
		[['launch']],
		[['dispatch', '--role', 'work']],
		[['dispatch', '--role', 'boss', '--brief-file', 'b.md']],
		[['wait']],
		[['wait', 'run_x', '--timeout', 'soon']],
		[['send', 'run_x']],
		[['accept']],
	])('refuses %j as a usage error without touching the kernel', async (args) => {
		const outcome = await runAgents(args, io(repository()));
		expect(outcome.code).toBe(2);
		expect(outcome.stderr).toContain('usage: void-machine agents');
		expect(outcome.stdout).toBe('');
	});

	it('refuses a runtime that has no adapter yet with its cause and action', async () => {
		const cwd = repository();
		writeFileSync(join(cwd, 'brief.md'), 'Do it.');
		const outcome = await runAgents(['dispatch', '--runtime', 'codex', '--role', 'work',
			'--brief-file', join(cwd, 'brief.md')], io(cwd));
		expect(outcome.code).toBe(1);
		expect(JSON.parse(outcome.stdout)).toMatchObject({ ok: false, cause: expect.stringContaining('codex') });
	});

	it('refuses an invalid dispatch as JSON with exit 1, before any runtime call', async () => {
		const cwd = repository();
		writeFileSync(join(cwd, 'brief.md'), 'Review.');
		const outcome = await runAgents(['dispatch', '--role', 'review', '--brief-file',
			join(cwd, 'brief.md')], io(cwd));
		expect(outcome.code).toBe(1);
		expect(JSON.parse(outcome.stdout)).toMatchObject({ ok: false, cause: expect.stringContaining('--type') });
	});

	it('reports an unknown run as a refusal naming the repair', async () => {
		const outcome = await runAgents(['status', 'run_00000000-0000-4000-8000-000000000000'],
			io(repository()));
		expect(outcome.code).toBe(1);
		expect(JSON.parse(outcome.stdout)).toMatchObject({ ok: false, action: expect.any(String) });
	});

	it('lists no run in a repository that never delegated', async () => {
		const outcome = await runAgents(['status'], io(repository()));
		expect(outcome).toMatchObject({ code: 0 });
		expect(JSON.parse(outcome.stdout)).toEqual({ ok: true, runs: [] });
	});

	it('refuses outside a Git repository with the repair', async () => {
		const outside = realpathSync(mkdtempSync(join(tmpdir(), 'cli-agents-outside-')));
		onTestFinished(() => rmSync(outside, { recursive: true, force: true }));
		const outcome = await runAgents(['status'], io(outside));
		expect(outcome.code).toBe(1);
		expect(JSON.parse(outcome.stdout)).toMatchObject({ ok: false, action: expect.stringContaining('git') });
	});
});
