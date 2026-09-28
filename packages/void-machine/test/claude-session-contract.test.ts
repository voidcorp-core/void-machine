import { spawn as nodeSpawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  type ClaudeSpawn, MIN_CLAUDE_VERSION, createClaudeSessionRuntime, launchArgs, parseAcknowledgement,
  parseClaudeVersion, parseSessionRows, readSessions, resumeArgs, resultHookWiring, versionAtLeast,
} from '../src/adapters/runtime/claude-session.js';
import type { LaunchPlan } from '../src/runtime/delegation.js';

const fixture = fileURLToPath(new URL('./fixtures/claude-session-process.mjs', import.meta.url));
const captured = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/claude-session/${name}`, import.meta.url)), 'utf8');

const review: LaunchPlan = {
  name: 'vm-run_1', role: 'review', agentType: 'independent-code-reviewer', model: undefined,
  cwd: tmpdir(), instructionPath: '/work/.void/machine/runs/m/agents/run_1/brief/brief.md',
  instructionDirectory: '/work/.void/machine/runs/m/agents/run_1/brief',
};

/** Routes each claude subcommand to a replay mode, the way the real CLI routes its argv. */
function replay(modes: { launch?: string; version?: string; agents?: string; stop?: string }): ClaudeSpawn {
  return (_executable, args, options) => {
    const mode = args[0] === '--version' ? modes.version ?? 'version'
      : args[0] === 'agents' ? modes.agents ?? 'agents'
        : args[0] === 'stop' ? modes.stop ?? 'stop' : modes.launch ?? 'dispatch';
    return nodeSpawn(execPath, [fixture, mode, ...args], options);
  };
}

function runtime(modes: Parameters<typeof replay>[0] = {}, extra: { home?: string; launchTimeoutMs?: number } = {}) {
  return createClaudeSessionRuntime({ executable: 'claude', env: {}, home: extra.home ?? '/nonexistent',
    updateCommand: 'npx product update',
    spawn: replay(modes), ...(extra.launchTimeoutMs === undefined ? {} : { launchTimeoutMs: extra.launchTimeoutMs }) });
}

describe('argv', () => {
  it('launches a reviewer with its native agent type and a mode that never waits for input', () => {
    const args = launchArgs(review);
    expect(args.slice(0, 7)).toEqual(['--bg', '--name', 'vm-run_1', '--agent',
      'independent-code-reviewer', '--permission-mode', 'dontAsk']);
    expect(args).toContain('--add-dir');
    expect(args.at(-1)).toContain(review.instructionPath);
  });

  it('launches a worker in auto mode, with a model only when one is asked for', () => {
    const work = launchArgs({ ...review, role: 'work', agentType: undefined, model: 'sonnet' });
    expect(work).toEqual(expect.arrayContaining(['--permission-mode', 'auto', '--model', 'sonnet']));
    expect(work).not.toContain('--agent');
    expect(launchArgs({ ...review, model: undefined })).not.toContain('--model');
  });

  it('never widens permissions and never carries caller text in the prompt', () => {
    for (const plan of [review, { ...review, role: 'work' as const }]) {
      const joined = [...launchArgs(plan), ...resumeArgs('00d01c20-dfb6-4979-bd94-5bc6de2e2e1a', plan)].join(' ');
      expect(joined).not.toMatch(/bypassPermissions|dangerously|acceptEdits|--settings|-p\b/);
      expect(launchArgs(plan).at(-1)?.startsWith('-')).toBe(false);
    }
  });

  it('ends the options before the prompt, so the variadic --add-dir cannot swallow it', () => {
    // Observed on 2.1.283: without the terminator the session starts with no prompt and waits.
    for (const args of [launchArgs(review), resumeArgs('00d01c20-dfb6-4979-bd94-5bc6de2e2e1a', review)]) {
      expect(args.at(-2)).toBe('--');
      expect(args.indexOf('--add-dir')).toBeLessThan(args.indexOf('--'));
    }
  });

  it('resumes the bound session in the background with the next instruction file', () => {
    const args = resumeArgs('00d01c20-dfb6-4979-bd94-5bc6de2e2e1a', review);
    expect(args.slice(0, 5)).toEqual(['--resume', '00d01c20-dfb6-4979-bd94-5bc6de2e2e1a', '--bg',
      '--name', 'vm-run_1']);
    expect(args.at(-1)).toContain(review.instructionPath);
  });
});

describe('parsing captured outputs', () => {
  it('reads the launch acknowledgement, fresh or resumed', () => {
    expect(parseAcknowledgement(captured('dispatch.stdout'))).toEqual({ handle: '6d5ea8bb', name: 'vm-probe-env2' });
    expect(parseAcknowledgement(captured('resume.stdout'))).toEqual({ handle: '99c69fc2', name: 'vm-probe-env3' });
    expect(parseAcknowledgement('Starting background service…\n')).toBeUndefined();
    // A copy started without --name gets a generated name, with spaces.
    expect(parseAcknowledgement('backgrounded · a59ab8b9 · code review degraded\n'))
      .toEqual({ handle: 'a59ab8b9', name: 'code review degraded' });
  });

  it('reads the version and compares it numerically', () => {
    expect(parseClaudeVersion(captured('version.stdout'))).toBe('2.1.283');
    expect(versionAtLeast('2.1.283', MIN_CLAUDE_VERSION)).toBe(true);
    expect(versionAtLeast('2.1.256', MIN_CLAUDE_VERSION)).toBe(false);
    expect(versionAtLeast('2.10.0', '2.9.9')).toBe(true);
    expect(parseClaudeVersion('garbage')).toBeUndefined();
  });

  it('maps every listed session to an observation and ignores interactive sessions', () => {
    const rows = parseSessionRows(captured('agents.json'));
    expect(rows).toBeDefined();
    const sessions = readSessions(rows ?? [], [
      { name: 'vm-probe-working' }, { name: 'vm-probe-env', handle: '00d01c20' },
      { name: 'vm-probe-env2' }, { name: 'vm-probe-agent' }, { name: 'vm-probe-hold' },
      { name: 'coordinator-d1' }, { name: 'vm-never-launched' },
    ]);
    expect(sessions.get('vm-probe-working')?.observation).toEqual({ kind: 'present', state: 'working' });
    expect(sessions.get('vm-probe-env')?.observation)
      .toEqual({ kind: 'present', state: 'blocked', waitingFor: 'permission prompt', status: 'waiting' });
    expect(sessions.get('vm-probe-env2')?.observation).toEqual({ kind: 'present', state: 'done', status: 'idle' });
    expect(sessions.get('vm-probe-agent')?.observation).toEqual({ kind: 'present', state: 'failed' });
    expect(sessions.get('vm-probe-hold')?.observation).toEqual({ kind: 'present', state: 'stopped' });
    expect(sessions.has('coordinator-d1')).toBe(false);
    expect(sessions.has('vm-never-launched')).toBe(false);
    expect(sessions.get('vm-probe-env')?.binding)
      .toEqual({ handle: '00d01c20', sessionId: '00d01c20-dfb6-4979-bd94-5bc6de2e2e1a' });
  });

  it('prefers the bound handle over the name when a copy shares the name', () => {
    const rows = parseSessionRows(JSON.stringify([
      { id: 'aaaaaaaa', kind: 'background', cwd: '/w', startedAt: 2, name: 'vm-x', state: 'working',
        sessionId: 'aaaaaaaa-1111-2222-3333-444444444444' },
      { id: 'bbbbbbbb', kind: 'background', cwd: '/w', startedAt: 1, name: 'vm-x', state: 'done',
        sessionId: 'bbbbbbbb-1111-2222-3333-444444444444' },
    ])) ?? [];
    expect(readSessions(rows, [{ name: 'vm-x', handle: 'bbbbbbbb' }]).get('vm-x')?.observation)
      .toEqual({ kind: 'present', state: 'done' });
    expect(readSessions(rows, [{ name: 'vm-x' }]).get('vm-x')?.binding?.handle).toBe('aaaaaaaa');
  });

  it('refuses a listing that is not a JSON array of sessions', () => {
    expect(parseSessionRows('[{"id": ')).toBeUndefined();
    expect(parseSessionRows('{"id": "x"}')).toBeUndefined();
  });

  it('finds the delegation-result hook on Stop, and says whether it runs the local bundle', () => {
    const local = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command',
      command: 'node "$CLAUDE_PROJECT_DIR/.void/hooks/_void-hook.mjs" lifecycle delegation-result claude' }] }] } });
    expect(resultHookWiring(local)).toBe('local-bundle');
    expect(resultHookWiring(JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command',
      command: 'node /opt/hooks/_void-hook.mjs lifecycle delegation-result claude' }] }] } }))).toBe('wired');
    expect(resultHookWiring(JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command',
      command: 'node x stop claude' }] }] } }))).toBe('missing');
    expect(resultHookWiring('not json')).toBe('missing');
  });
});

describe('the Claude session runtime', () => {
  it('acknowledges a launch from its real output', async () => {
    await expect(runtime().dispatch(review)).resolves.toEqual({ kind: 'acknowledged', handle: '6d5ea8bb' });
  });

  it('refuses an untrusted workspace with the repair Claude prints', async () => {
    const outcome = await runtime({ launch: 'untrusted' }).dispatch(review);
    expect(outcome).toMatchObject({ kind: 'refused', cause: 'Workspace not trusted',
      action: expect.stringContaining('accept the trust prompt') });
  });

  it('refuses an unknown agent type and hands back the session to stop', async () => {
    expect(await runtime({ launch: 'unknown-agent' }).dispatch(review)).toMatchObject({
      kind: 'refused', handle: 'e4c0c72c', cause: expect.stringContaining('independent-code-reviewer') });
  });

  it('reports a launch without acknowledgement as lost, never as refused', async () => {
    expect(await runtime({ launch: 'dispatch-no-ack' }).dispatch(review)).toMatchObject({ kind: 'lost' });
    expect(await runtime({ launch: 'hang' }, { launchTimeoutMs: 300 }).dispatch(review))
      .toMatchObject({ kind: 'lost' });
  });

  it('observes sessions from the listing, and a failed listing as unreadable', async () => {
    const read = await runtime().observe([{ name: 'vm-probe-env2' }]);
    expect(read.kind === 'read' && read.sessions.get('vm-probe-env2')?.observation)
      .toEqual({ kind: 'present', state: 'done', status: 'idle' });
    expect(await runtime({ agents: 'agents-garbage' }).observe([{ name: 'x' }]))
      .toMatchObject({ kind: 'unreadable' });
    expect(await runtime({ agents: 'agents-fail' }).observe([{ name: 'x' }]))
      .toMatchObject({ kind: 'unreadable' });
  });

  it('stops a session and gives the command that shows it', async () => {
    await expect(runtime().stop({ name: 'vm-x', handle: '00d01c20' })).resolves.toEqual({ ok: true });
    expect(runtime().attachCommand({ name: 'vm-x', handle: '00d01c20' })).toEqual(['claude', 'attach', '00d01c20']);
    expect(runtime().attachCommand({ name: 'vm-x' })).toBeUndefined();
  });

  it('refuses to resume a session it has not bound yet', async () => {
    expect(await runtime().send({ name: 'vm-x', handle: '00d01c20' }, review)).toMatchObject({ kind: 'refused' });
    expect(await runtime({ launch: 'resume' })
      .send({ name: 'vm-x', handle: '99c69fc2', sessionId: '99c69fc2-b7c9-43eb-b964-087840a7d155' }, review))
      .toEqual({ kind: 'acknowledged', handle: '99c69fc2' });
    // A session still running is resumed as a copy under a new handle.
    expect(await runtime({ launch: 'resume-copy' })
      .send({ name: 'vm-x', handle: 'fc5554fd', sessionId: 'fc5554fd-8512-4fff-9c65-f81fe9644463' }, review))
      .toEqual({ kind: 'acknowledged', handle: '9a012d67' });
  });
});

describe('preflight', () => {
  function project(settings: string | undefined, bundle: string | undefined): string {
    const root = mkdtempSync(join(tmpdir(), 'vm-preflight-'));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, '.claude'), { recursive: true });
    mkdirSync(join(root, '.void', 'hooks'), { recursive: true });
    if (settings !== undefined) writeFileSync(join(root, '.claude', 'settings.json'), settings);
    if (bundle !== undefined) writeFileSync(join(root, '.void', 'hooks', '_void-hook.mjs'), bundle);
    return root;
  }
  const wired = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command',
    command: 'node "$CLAUDE_PROJECT_DIR/.void/hooks/_void-hook.mjs" lifecycle delegation-result claude' }] }] } });

  it('passes when Claude is recent and the project runs a bundle that records results', async () => {
    const root = project(wired, "if (hook === 'delegation-result') {}");
    await expect(runtime().preflight(root)).resolves.toEqual({ ok: true });
  });

  it.each([
    ['the hook is not wired', undefined, "'delegation-result'"],
    ['the local bundle predates the hook', wired, '// 4.0.0 bundle'],
  ])('refuses with the update command when %s', async (_case, settings, bundle) => {
    const outcome = await runtime().preflight(project(settings, bundle));
    expect(outcome).toMatchObject({ ok: false, cause: expect.stringContaining('delegation-result'),
      action: expect.stringContaining('npx product update') });
  });

  it('refuses a Claude Code older than the resumable background sessions', async () => {
    expect(await runtime({ version: 'version-old' }).preflight(project(wired, 'delegation-result')))
      .toMatchObject({ ok: false, cause: expect.stringContaining('2.1.256'),
        action: expect.stringContaining(MIN_CLAUDE_VERSION) });
  });

  it('refuses when claude is not installed', async () => {
    const missing = createClaudeSessionRuntime({ executable: '/nonexistent/claude-dev923', env: {},
      home: '/nonexistent', updateCommand: 'npx product update' });
    expect(await missing.preflight(project(wired, 'delegation-result')))
      .toMatchObject({ ok: false, action: expect.stringContaining('Claude Code') });
  });
});
