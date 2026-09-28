import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayEventLog } from '@voidcorp/mission-engine';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The entrypoint runs on import, so it is exercised the way a hook actually runs
// it: bundled exactly as `pnpm build` does, then executed as a child process with
// a payload on stdin. Testing the committed bundle instead would prove the
// artefact, not the source it is built from.
const here = dirname(fileURLToPath(import.meta.url));
let hook = '';
let workspace = '';

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'void-hook-cli-'));
  hook = join(workspace, 'cli.mjs');
  await build({
    entryPoints: [join(here, 'cli.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    outfile: hook,
  });
}, 30_000);

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function enforce(rule: string, payload: unknown): { code: number; stderr: string } {
  const result = spawnSync(process.execPath, [hook, 'enforce', rule], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    // Telemetry writes under the project root; keep the run out of the real one.
    env: { ...process.env, VOID_PROJECT_ROOT: workspace },
  });
  return { code: result.status ?? 0, stderr: result.stderr ?? '' };
}

describe('CI TDD source evidence', () => {
  it('accepts the generated worker identity with its actual syntax inspection coverage', () => {
    const root = join(here, '../../..');
    const result = spawnSync(process.execPath, [hook, 'enforce-ci', 'tdd-order',
      'packages/hook-runner/src/enforcement/syntax-worker-identity.generated.ts'], {
      input: '', encoding: 'utf8', cwd: root,
      env: { ...process.env, VOID_PROJECT_ROOT: root },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('TDD_DECLARED_TEST');
  });

  it('can inspect the real Autopilot command without exceeding the bounded source reader', () => {
    const root = join(here, '../../..');
    const result = spawnSync(process.execPath, [hook, 'enforce-ci', 'tdd-order',
      'packages/cli/src/commands/autopilot.ts'], {
      input: '', encoding: 'utf8', cwd: root,
      env: { ...process.env, VOID_PROJECT_ROOT: root },
    });
    expect(result.stderr).not.toContain('TDD_DECLARATION_UNVERIFIED');
    expect(result.status).toBe(0);
  });

  it.each([true, false])('judges the checked-out declaration instead of diff fragments: %s', (declared) => {
    const root = mkdtempSync(join(tmpdir(), 'void-ci-tdd-'));
    mkdirSync(join(root, 'apps/web/src'), { recursive: true });
    mkdirSync(join(root, 'tests'));
    writeFileSync(join(root, 'tests/page.spec.ts'), 'test("page", () => {});');
    const header = '// tdd-cover: e2e tests/page.spec.ts\n';
    writeFileSync(join(root, 'apps/web/src/page.ts'), `${declared ? header : ''}export const value = 1;`);
    const result = spawnSync(process.execPath, [hook, 'enforce-ci', 'tdd-order', 'apps/web/src/page.ts'], {
      input: `${declared ? '' : header}export const added = 2;`, encoding: 'utf8', cwd: root,
      env: { ...process.env, VOID_PROJECT_ROOT: root },
    });
    expect(result.status).toBe(declared ? 0 : 2);
    expect(result.stderr).toContain(declared ? 'TDD_DECLARED_TEST' : 'TDD_SIBLING_TEST_MISSING');
  });
});

describe('CI content transport', () => {
  const ci = (input: string | Buffer) => {
    const path = join(workspace, 'ci-input');
    writeFileSync(path, input);
    const fd = openSync(path, 'r');
    try {
      return spawnSync(process.execPath,
        [hook, 'enforce-ci', 'secret-content', 'dist/worker.cjs'], {
          stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8',
          env: { ...process.env, VOID_PROJECT_ROOT: workspace },
        });
    } finally { closeSync(fd); }
  };

  it('scans a complete artifact up to the distinct 8 MiB CI limit', () => {
    const result = ci(' '.repeat(8 * 1024 * 1024));
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('finds a synthetic secret beyond the hook limit on a single minified line', () => {
    const result = ci(`${' '.repeat(4 * 1024 * 1024)}${'AKIA'}${'Z'.repeat(16)}`);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('SECRET_IN_CONTENT');
    expect(result.stderr).toContain('dist/worker.cjs:1');
  });

  it('refuses CI content above 8 MiB without truncating it', () => {
    const result = ci(' '.repeat(8 * 1024 * 1024 + 1));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CI_CONTENT_TOO_LARGE');
  });

  it.each([Buffer.from([0xff]), Buffer.from([0])])('refuses non-text CI content %s', (input) => {
    expect(ci(input).status).toBe(2);
  });

  it('keeps the runtime hook payload capped at 1 MiB', () => {
    const result = enforce('secret-content', { tool_name: 'Write', tool_input: {
      file_path: 'dist/worker.cjs', content: ' '.repeat(1024 * 1024),
    } });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('HOOK_INPUT_TOO_LARGE');
  });
});

const write = (file: string, content: string): unknown => ({
  tool_name: 'Write',
  tool_input: { file_path: file, content },
});

function stageLifecycle(
  root: string,
  payload: unknown,
): { readonly release: () => void; readonly completed: Promise<number | null> } {
  const child = spawn(
    process.execPath,
    [hook, 'lifecycle', 'context-continuity', 'codex'],
    {
      env: { ...process.env, VOID_PROJECT_ROOT: root },
      stdio: ['pipe', 'ignore', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const completed = new Promise<number | null>((resolveRun, rejectRun) => {
    child.on('error', rejectRun);
    child.on('close', (code) => {
      if (code === 0) resolveRun(code);
      else rejectRun(new Error(`staged hook failed (${String(code)}): ${stderr}`));
    });
  });
  return {
    release: () => child.stdin.end(JSON.stringify(payload)),
    completed,
  };
}

describe('enforce', () => {
  it('names the doctrine a refusal comes from, so the skill can be reached from the message', () => {
    const { code, stderr } = enforce('no-any', write('src/x.ts', 'const a: any = 1;'));
    expect(code).toBe(2);
    expect(stderr).toContain('TYPESCRIPT_ANY:');
    expect(stderr).toContain('(doctrine: the void-typescript-strict skill)');
  });

  it('keeps the evidence under the named doctrine rather than inside the sentence', () => {
    const { stderr } = enforce('no-console', write('src/x.ts', 'console.log("x");'));
    const [first] = stderr.split('\n');
    expect(first).toMatch(/\(doctrine: the void-observability skill\)$/);
    expect(stderr).toContain('\n- console.* in src/x.ts:1');
  });

  it('stays silent and allows when the rule finds nothing', () => {
    const { code, stderr } = enforce('no-any', write('src/x.ts', 'const a: number = 1;'));
    expect(code).toBe(0);
    expect(stderr).toBe('');
  });

  it('refuses an unknown rule rather than failing open on it', () => {
    const { code, stderr } = enforce('no-such-rule', write('src/x.ts', 'const a: any = 1;'));
    expect(code).toBe(2);
    expect(stderr).toContain('HOOK_INPUT_REJECTED: UNKNOWN_ENFORCEMENT_RULE');
  });

  it('refuses a payload it cannot parse rather than letting the write through', () => {
    const result = spawnSync(process.execPath, [hook, 'enforce', 'no-any'], {
      input: 'not json',
      encoding: 'utf8',
      env: { ...process.env, VOID_PROJECT_ROOT: workspace },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('HOOK_INPUT_REJECTED:');
  });

  // Codex runs a hook through the session shell, PowerShell by default on
  // Windows, and `powershell -Command` turns every non-zero exit into 1, which
  // Codex reads as a failed hook, not a refusal. The one decision every shell
  // carries is exit 0 with the documented PreToolUse JSON on stdout.
  function enforceCodex(rule: string, input: string): { code: number; stdout: string } {
    const result = spawnSync(process.execPath, [hook, 'enforce', rule, 'codex'], {
      input,
      encoding: 'utf8',
      env: { ...process.env, VOID_PROJECT_ROOT: workspace },
    });
    return { code: result.status ?? -1, stdout: result.stdout ?? '' };
  }

  // Codex rejects unknown fields, so the denial is compared whole.
  function expectCodexDenial(stdout: string, reason: string): void {
    expect(JSON.parse(stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining(reason),
      },
    });
  }

  it('refuses a Codex tool call with a denial every shell passes through intact', () => {
    const { code, stdout } = enforceCodex(
      'no-any',
      JSON.stringify(write('src/café.ts', 'const a: any = 1;')),
    );
    expect(code).toBe(0);
    expect(stdout).toMatch(/^[\x20-\x7e]*\n$/);
    expectCodexDenial(stdout, 'TYPESCRIPT_ANY:');
    expectCodexDenial(stdout, 'src/café.ts');
  });

  it('refuses a Codex payload it cannot parse through the same denial', () => {
    const { code, stdout } = enforceCodex('no-any', 'not json');
    expect(code).toBe(0);
    expectCodexDenial(stdout, 'HOOK_INPUT_REJECTED:');
  });

  it('lets a clean Codex tool call through without any decision', () => {
    const { code, stdout } = enforceCodex(
      'no-any',
      JSON.stringify(write('src/x.ts', 'const a: number = 1;')),
    );
    expect(code).toBe(0);
    expect(stdout).toBe('');
  });
});

describe('lifecycle context', () => {
  function banner(root: string): string {
    const result = spawnSync(process.execPath, [hook, 'lifecycle', 'context', 'claude'], {
      input: '{}',
      encoding: 'utf8',
      env: { ...process.env, VOID_PROJECT_ROOT: root },
    });
    return result.stdout ?? '';
  }

  function projectWith(skill: string, recorded: string): string {
    const root = mkdtempSync(join(tmpdir(), 'void-banner-'));
    mkdirSync(join(root, '.claude', 'skills', skill), { recursive: true });
    writeFileSync(join(root, '.claude', 'skills', skill, 'SKILL.md'), '---\n---\n');
    const mission = join(root, '.void', 'machine', 'runs', 'mis_aaaaaaaaaaaaaaaa');
    mkdirSync(mission, { recursive: true });
    writeFileSync(
      join(mission, 'events.jsonl'),
      `${JSON.stringify({
        kind: 'runtime.tool.started',
        subject: `skill:${recorded}`,
        ts: new Date().toISOString(),
        payload: { category: 'skill', tool: 'Skill' },
      })}\n`,
    );
    return root;
  }

  it('names a skill the project recorded but can no longer resolve, from the session after', () => {
    const root = projectWith('void-ticket', 'ticket-writer');
    try {
      // The first opening computes the verdict after its own stdout, so it is
      // the next one that carries it. One session of delay costs nothing here,
      // and it is what keeps the start instant.
      expect(banner(root)).not.toContain('ticket-writer');
      expect(banner(root)).toContain('ticket-writer');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('says nothing extra when every recorded name still resolves', () => {
    const root = projectWith('void-ticket', 'void-ticket');
    try {
      banner(root);
      expect(banner(root)).not.toContain('cannot resolve');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('injects identical resume context for Claude Code and Codex', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-resume-parity-'));
    mkdirSync(join(root, '.void', 'machine'), { recursive: true });
    writeFileSync(join(root, '.void', 'config.json'), '{}\n');
    writeFileSync(
      join(root, '.void', 'program.md'),
      '---\nschemaVersion: 1\nstatus: executing\nprogram: parity\nplan: docs/plan.md\nspec: docs/spec.md\nautopilot:\n  enabled: false\n---\n',
    );
    writeFileSync(join(root, '.void', 'machine', 'checkpoint.md'), '## Objective\n\nResume equally.\n');

    try {
      const context = (agentRuntime: 'claude' | 'codex'): string => {
        const result = spawnSync(process.execPath, [hook, 'lifecycle', 'context', agentRuntime], {
          input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact' }),
          encoding: 'utf8',
          env: { ...process.env, VOID_PROJECT_ROOT: root },
        });
        return JSON.parse(result.stdout ?? '{}').hookSpecificOutput.additionalContext as string;
      };
      expect(context('claude')).toBe(context('codex'));
      expect(context('codex')).toContain('Program: parity');
      expect(context('codex')).toContain('Objective: Resume equally.');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('seals PreCompact and resumes through the unique continuity handler', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-continuity-cli-'));
    mkdirSync(join(root, '.void', 'machine'), { recursive: true });
    writeFileSync(join(root, '.void', 'config.json'), '{}\n');
    writeFileSync(join(root, '.void', 'machine', 'checkpoint.md'), '## Objective\n\nCLI parity.\n');

    try {
      const compact = spawnSync(
        process.execPath,
        [hook, 'lifecycle', 'context-continuity', 'codex'],
        {
          input: JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'auto' }),
          encoding: 'utf8',
          env: { ...process.env, VOID_PROJECT_ROOT: root },
        },
      );
      expect(compact.status).toBe(0);
      expect(readFileSync(join(root, '.void', 'machine', 'checkpoint.md'), 'utf8')).toContain(
        'void-machine:context-continuity:begin',
      );

      const resume = spawnSync(
        process.execPath,
        [hook, 'lifecycle', 'context-continuity', 'claude'],
        {
          input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact' }),
          encoding: 'utf8',
          env: { ...process.env, VOID_PROJECT_ROOT: root },
        },
      );
      expect(JSON.parse(resume.stdout ?? '{}').hookSpecificOutput.additionalContext).toContain(
        'Context continuity: complete',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('lets each stale-lock takeover read what the previous one wrote', async () => {
    const root = mkdtempSync(join(tmpdir(), 'void-continuity-concurrent-'));
    mkdirSync(join(root, '.void', 'machine'), { recursive: true });
    writeFileSync(join(root, '.void', 'config.json'), '{}\n');
    const checkpoint = join(root, '.void', 'machine', 'checkpoint.md');
    const lock = `${checkpoint}.lock`;
    const orphanClaim = `${lock}.recovery`;
    writeFileSync(
      checkpoint,
      `## Objective\n\nSerialize stale recovery.\n\n${'bounded context '.repeat(25_000)}`,
    );
    writeFileSync(lock, 'stale\n');
    utimesSync(lock, new Date(0), new Date(0));
    writeFileSync(orphanClaim, 'abandoned\n');
    utimesSync(orphanClaim, new Date(0), new Date(0));

    try {
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_100));
      const paths = ['src/first.ts', 'src/second.ts', 'src/third.ts'];
      const contenders = paths.map((path) => stageLifecycle(root, {
          hook_event_name: 'PostToolUse',
          session_id: 'concurrent-context',
          tool_name: 'read_file',
          tool_input: { path },
          tool_response: { success: true },
      }));
      await new Promise((resolveReady) => setTimeout(resolveReady, 500));
      for (const contender of contenders) contender.release();
      await Promise.all(contenders.map((contender) => contender.completed));

      // How many contenders meet each other on the lock is the operating system's
      // business: on a loaded machine the first one releases before the next one
      // even asks, and that one takes a free lock legitimately. What must hold
      // whatever the interleaving is that no admitted writer erased another. A
      // writer reads the checkpoint only after taking the lock and replaces it by
      // rename, so two overlapping critical sections would leave the later
      // observation alone; every observation still present therefore proves its
      // writer read the one before it.
      const concurrent = readFileSync(checkpoint, 'utf8');
      const admitted = paths.filter((path) => concurrent.includes(path));
      expect(admitted.length).toBeGreaterThanOrEqual(1);
      expect(concurrent.match(/void-machine:context-continuity:begin/g)).toHaveLength(1);
      expect(concurrent).toContain('Serialize stale recovery.');
      expect(concurrent.match(/bounded context /g)).toHaveLength(25_000);
      expect(existsSync(orphanClaim)).toBe(false);
      expect(
        readdirSync(join(root, '.void', 'machine')).filter((entry) => entry.includes('.lock')),
      ).toEqual([]);
      const runs = join(root, '.void', 'machine', 'runs');
      const statuses = readdirSync(runs).flatMap((mission) =>
        readFileSync(join(runs, mission, 'events.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => JSON.parse(line) as { readonly payload?: { readonly status?: string } })
          .map((event) => event.payload?.status)
          .filter((status): status is string => status !== undefined));
      // An 'ok' with no observation left in the checkpoint would be a writer whose
      // work another one overwrote, which is the failure this test exists to refuse.
      expect(statuses.sort()).toEqual([
        ...admitted.map(() => 'ok'),
        ...paths.slice(admitted.length).map(() => 'skipped'),
      ]);
      for (const path of paths.filter((candidate) => !concurrent.includes(candidate))) {
        spawnSync(process.execPath, [hook, 'lifecycle', 'context-continuity', 'codex'], {
          input: JSON.stringify({
            hook_event_name: 'PostToolUse',
            session_id: 'concurrent-context',
            tool_name: 'read_file',
            tool_input: { path },
            tool_response: { success: true },
          }),
          encoding: 'utf8',
          env: { ...process.env, VOID_PROJECT_ROOT: root },
        });
      }
      const recovered = readFileSync(checkpoint, 'utf8');
      expect(recovered).toContain('src/first.ts');
      expect(recovered).toContain('src/second.ts');
      expect(recovered).toContain('src/third.ts');
      expect(recovered.match(/void-machine:context-continuity:begin/g)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('injects a threshold nudge without replacing the submitted prompt', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-continuity-nudge-'));
    mkdirSync(join(root, '.void', 'machine'), { recursive: true });
    writeFileSync(
      join(root, '.void', 'config.json'),
      '{"context":{"windowTokens":1000,"checkpointThresholdPercent":50}}\n',
    );
    writeFileSync(join(root, '.void', 'machine', 'checkpoint.md'), '## Objective\n\nNudge once.\n');
    const transcript = join(root, 'transcript.jsonl');
    writeFileSync(transcript, `${JSON.stringify({
      message: {
        usage: {
          input_tokens: 470,
          output_tokens: 10,
          cache_read_input_tokens: 10,
          cache_creation_input_tokens: 10,
        },
      },
    })}\n`);

    try {
      spawnSync(process.execPath, [hook, 'lifecycle', 'context-continuity', 'codex'], {
        input: JSON.stringify({ hook_event_name: 'PreCompact' }),
        encoding: 'utf8',
        env: { ...process.env, VOID_PROJECT_ROOT: root },
      });
      const result = spawnSync(
        process.execPath,
        [hook, 'lifecycle', 'context-continuity', 'codex'],
        {
          input: JSON.stringify({
            hook_event_name: 'UserPromptSubmit',
            transcript_path: transcript,
            prompt: 'continue the implementation',
          }),
          encoding: 'utf8',
          env: { ...process.env, VOID_PROJECT_ROOT: root },
        },
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout ?? '{}').hookSpecificOutput.additionalContext).toMatch(
        /void-checkpoint/i,
      );
      expect(result.stdout).not.toContain('continue the implementation');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('delegation-result lifecycle', () => {
  it('records the claimed result of a delegated session without writing stdout', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'void-delegation-')));
    try {
      spawnSync('git', ['init', '-q'], { cwd: root });
      const session = '6d5ea8bb-764f-4463-b733-8b94509eb25e';
      const run = join(root, '.void', 'machine', 'runs', 'mis_cli-contract', 'agents', 'run_x');
      mkdirSync(run, { recursive: true });
      mkdirSync(join(root, '.void', 'machine', 'agents', 'sessions'), { recursive: true });
      writeFileSync(join(root, '.void', 'machine', 'agents', 'sessions', `${session}.json`),
        JSON.stringify({ schemaVersion: 1, resultPath: join(run, 'result.json') }));
      const result = spawnSync(process.execPath, [hook, 'lifecycle', 'delegation-result', 'claude'], {
        input: JSON.stringify({ hook_event_name: 'Stop', session_id: session, cwd: root,
          last_assistant_message: 'Done.' }),
        encoding: 'utf8',
        env: { ...process.env, VOID_PROJECT_ROOT: root },
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
      expect(JSON.parse(readFileSync(join(run, 'result.json'), 'utf8')))
        .toMatchObject({ sessionId: session, lastAssistantMessage: 'Done.' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('delegation-capture lifecycle', () => {
  it('lets the native Agent call through, with nothing on stdout, when no multiplexer shows the caller', () => {
    const result = spawnSync(process.execPath, [hook, 'lifecycle', 'delegation-capture', 'claude'], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Agent', cwd: workspace,
        session_id: '6d5ea8bb-764f-4463-b733-8b94509eb25e', tool_input: { prompt: 'Review it.' } }),
      encoding: 'utf8',
      env: { PATH: process.env['PATH'], VOID_PROJECT_ROOT: workspace },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('refuses the native Agent call on stdout once the kernel has dispatched the run', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'void-capture-')));
    try {
      spawnSync('git', ['init', '-q'], { cwd: root });
      mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
      const runId = 'run_0f1e2d3c-4b5a-4968-8776-655443322110';
      writeFileSync(join(root, 'node_modules', '.bin', 'void-machine'),
        `#!/bin/sh\necho '${JSON.stringify({ ok: true, runId })}'\n`, { mode: 0o755 });
      const result = spawnSync(process.execPath, [hook, 'lifecycle', 'delegation-capture', 'claude'], {
        input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Agent', cwd: root, permission_mode: 'auto',
          session_id: '6d5ea8bb-764f-4463-b733-8b94509eb25e', tool_input: { prompt: 'Review it.' } }),
        encoding: 'utf8',
        env: { PATH: process.env['PATH'], HERDR_ENV: '1', VOID_PROJECT_ROOT: root },
      });
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout ?? '{}').hookSpecificOutput;
      expect(output).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
      expect(output.permissionDecisionReason).toContain(`agents wait ${runId}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('session close lifecycle', () => {
  it('emits a checkpoint reminder only for explicit close intent', () => {
    const invoke = (prompt: string): string => {
      const result = spawnSync(process.execPath, [hook, 'lifecycle', 'checkpoint-reminder', 'codex'], {
        input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt }),
        encoding: 'utf8',
        env: { ...process.env, VOID_PROJECT_ROOT: workspace },
      });
      return result.stdout ?? '';
    };
    expect(invoke('on reprend demain')).toContain('void-checkpoint');
    expect(invoke('stop the process')).toBe('');
  });

  it('audits SessionEnd without creating or changing a checkpoint', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-session-end-'));
    mkdirSync(join(root, '.void'), { recursive: true });
    writeFileSync(join(root, '.void', 'config.json'), '{}\n');
    const checkpoint = join(root, '.void', 'machine', 'checkpoint.md');

    try {
      const result = spawnSync(process.execPath, [hook, 'lifecycle', 'checkpoint-audit', 'claude'], {
        input: JSON.stringify({ hook_event_name: 'SessionEnd', reason: 'other' }),
        encoding: 'utf8',
        env: { ...process.env, VOID_PROJECT_ROOT: root },
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toContain('checkpoint-absent');
      expect(existsSync(checkpoint)).toBe(false);
      expect(readFileSync(join(root, '.void', 'config.json'), 'utf8')).toBe('{}\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// Neutralising the freshness call in `cli.ts` changed nothing any test could see,
// so the wiring was carried by nobody. It matters more than the wording: a
// SessionStart hook cannot write to the user, so if this line stops being emitted
// the upgrade prompt does not degrade, it disappears.
describe('the upgrade prompt the session banner carries', () => {
  function staleProject(): { root: string; cache: string } {
    const root = mkdtempSync(join(tmpdir(), 'void-freshness-root-'));
    const cache = mkdtempSync(join(tmpdir(), 'void-freshness-cache-'));
    mkdirSync(join(root, '.void', 'machine', 'receipts'), { recursive: true });
    writeFileSync(
      join(root, '.void', 'machine', 'receipts', 'install-v1.json'),
      JSON.stringify({ schemaVersion: 1, version: '0.17.0', source: 'local', runtimes: ['claude'], files: [] }),
    );
    mkdirSync(join(cache, 'void-machine'), { recursive: true });
    writeFileSync(
      join(cache, 'void-machine', 'freshness.json'),
      JSON.stringify({ latest: '2.1.0', checkedAt: Date.now() }),
    );
    return { root, cache };
  }

  const banner = (root: string, cache: string): string =>
    spawnSync(process.execPath, [hook, 'lifecycle', 'context', 'claude'], {
      input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'freshness', source: 'startup' }),
      encoding: 'utf8',
      env: { ...process.env, VOID_PROJECT_ROOT: root, XDG_CACHE_HOME: cache },
    }).stdout ?? '';

  it('names both versions and asks for the relay when the install is behind', () => {
    const { root, cache } = staleProject();
    const out = banner(root, cache);

    expect(out).toContain('0.17.0');
    expect(out).toContain('2.1.0');
    expect(out).toContain('void-machine update');
    expect(out.toLowerCase()).toContain('tell the user');
  });

  it('says nothing at all when the install is current', () => {
    const { root, cache } = staleProject();
    writeFileSync(
      join(cache, 'void-machine', 'freshness.json'),
      JSON.stringify({ latest: '0.17.0', checkedAt: Date.now() }),
    );

    expect(banner(root, cache).toLowerCase()).not.toContain('tell the user');
  });
});

// The mechanism the Codex adapter relies on, proven against a real linked
// worktree rather than asserted in a reference page. Measured on 2026-09-02: a
// worker whose runtime sets neither variable writes the run's telemetry into the
// worktree, and the reconciler deletes that worktree before anyone reads the
// pull request -- one run, two halves, one gone.
describe('a hook fired from a worktree', () => {
  function repositoryWithWorktree(): { readonly main: string; readonly worktree: string } {
    const main = mkdtempSync(join(tmpdir(), 'void-hook-worktree-'));
    const git = (...argv: readonly string[]): void => {
      const done = spawnSync('git', argv, { cwd: main, encoding: 'utf8' });
      if (done.status !== 0) throw new Error(`git ${argv.join(' ')}: ${done.stderr ?? ''}`);
    };
    git('init', '--initial-branch', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    writeFileSync(join(main, 'README.md'), '# root\n');
    git('add', 'README.md');
    git('commit', '--no-gpg-sign', '-m', 'root');
    const worktree = join(main, 'wt');
    git('worktree', 'add', '-b', 'worker', worktree);
    return { main, worktree };
  }

  function runsIn(root: string): readonly string[] {
    const runs = join(root, '.void', 'machine', 'runs');
    return existsSync(runs) ? readdirSync(runs) : [];
  }

  it.each([false, true])('sequences concurrent worker streams with explicit mission: %s', async (explicit) => {
    const { main, worktree } = repositoryWithWorktree();
    const second = join(main, 'second');
    const created = spawnSync('git', ['worktree', 'add', '-b', 'second', second], { cwd: main });
    expect(created.status).toBe(0);
    const nested = join(worktree, 'app');
    mkdirSync(join(nested, '.void'), { recursive: true });
    writeFileSync(join(nested, '.void/config.json'), '{}');
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env['VOID_PROJECT_ROOT'];
    delete env['CLAUDE_PROJECT_DIR'];
    delete env['VOID_MISSION_ID'];
    if (explicit) env['VOID_MISSION_ID'] = 'mis_ffffffffffffffff';
    const jobs = [worktree, nested, second].flatMap((cwd) => [
      { cwd, args: ['activation', 'codex'] },
      { cwd, args: ['enforce', 'tdd-order', 'codex'] },
      { cwd, args: ['lifecycle', 'checkpoint-reminder', 'codex'] },
    ]);
    await Promise.all(jobs.map(({ cwd, args }) => new Promise<void>((resolveJob, rejectJob) => {
      const child = spawn(process.execPath, [hook, ...args], { cwd, env });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('error', rejectJob);
      child.on('close', (code) => {
        if (code === 0 && stderr === '') resolveJob();
        else rejectJob(new Error(`hook failed: ${String(code)} ${stderr}`));
      });
      child.stdin.end(JSON.stringify({ session_id: 'same-native-session', prompt: 'continue' }));
    })));
    expect(runsIn(worktree)).toEqual([]);
    expect(runsIn(nested)).toEqual([]);
    expect(runsIn(second)).toEqual([]);
    const missions = runsIn(main);
    expect(missions).toHaveLength(1);
    const mission = missions[0] ?? '';
    if (explicit) expect(mission).toBe('mis_ffffffffffffffff');
    renameSync(worktree, join(main, 'retired-first'));
    renameSync(second, join(main, 'retired-second'));
    const replay = replayEventLog(readFileSync(join(main, '.void/machine/runs', mission, 'events.jsonl'), 'utf8'));
    expect(replay.continuity).toBe('complete');
    expect(replay.events).toHaveLength(9);
    expect(replay.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(replay.events.every((event) => event.missionId === mission && event.correlationId === mission)).toBe(true);
    expect(replay.events.filter((event) => event.kind.startsWith('runtime.'))).toHaveLength(3);
    const outcomes = replay.events.filter((event) => event.kind === 'hook.completed');
    expect(outcomes).toHaveLength(6);
    for (const event of outcomes) {
      expect(event.payload).toEqual(expect.objectContaining({ status: expect.stringMatching(/^(ok|skipped)$/) }));
    }
  });

  it('writes its event under the installation root, never under the worktree it ran in', () => {
    const { main, worktree } = repositoryWithWorktree();
    try {
      const done = spawnSync(process.execPath, [hook, 'activation', 'codex'], {
        input: '{}',
        encoding: 'utf8',
        // Exactly what the Codex adapter does at spawn: the worker's working
        // directory is the worktree, and the root it writes to is the install.
        cwd: worktree,
        env: { ...process.env, VOID_PROJECT_ROOT: main, VOID_MISSION_ID: 'mis_aaaaaaaaaaaaaaaa' },
      });

      expect(done.status ?? 0).toBe(0);
      expect(runsIn(main)).toContain('mis_aaaaaaaaaaaaaaaa');
      expect(readFileSync(join(main, '.void', 'machine', 'runs', 'mis_aaaaaaaaaaaaaaaa', 'events.jsonl'), 'utf8')).toContain('runtime.');
      expect(runsIn(worktree)).toEqual([]);
    } finally {
      rmSync(main, { recursive: true, force: true });
    }
  });

  it.each([false, true])('keeps native worker events central with nested configuration: %s', (nested) => {
    const { main, worktree } = repositoryWithWorktree();
    const workingDirectory = nested ? join(worktree, 'app') : worktree;
    if (nested) {
      mkdirSync(join(workingDirectory, '.void'), { recursive: true });
      writeFileSync(join(workingDirectory, '.void/config.json'), '{}');
    }
    try {
      // Annotated and indexed: a spread of `process.env` narrows to the keys it
      // happens to carry, and this package forbids property access on an index
      // signature, so both roots are removed by their names.
      const env: NodeJS.ProcessEnv = { ...process.env, VOID_MISSION_ID: 'mis_bbbbbbbbbbbbbbbb' };
      delete env['VOID_PROJECT_ROOT'];
      delete env['CLAUDE_PROJECT_DIR'];
      const done = spawnSync(process.execPath, [hook, 'activation', 'codex'], {
        input: '{}',
        encoding: 'utf8',
        cwd: workingDirectory,
        env,
      });

      expect(done.status).toBe(0);
      expect(done.stderr).toBe('');
      expect(runsIn(main)).toContain('mis_bbbbbbbbbbbbbbbb');
      expect(runsIn(worktree)).toEqual([]);
      expect(runsIn(workingDirectory)).toEqual([]);
      renameSync(worktree, join(main, 'retired-worker'));
      expect(readFileSync(join(main, '.void/machine/runs/mis_bbbbbbbbbbbbbbbb/events.jsonl'), 'utf8'))
        .toContain('runtime.');
    } finally {
      rmSync(main, { recursive: true, force: true });
    }
  });

  it.each([false, true])('keeps enforcement local with nested configuration: %s', (nested) => {
    const { main, worktree } = repositoryWithWorktree();
    const workingDirectory = nested ? join(worktree, 'app') : worktree;
    try {
      mkdirSync(join(workingDirectory, '.void'), { recursive: true });
      writeFileSync(join(workingDirectory, '.void/config.json'), '{"modes":{"tdd":"strict"},"paths":{"business":["**"]}}');
      writeFileSync(join(main, 'sample.test.ts'), 'export {};');
      const env: NodeJS.ProcessEnv = { ...process.env, VOID_MISSION_ID: 'mis_cccccccccccccccc' };
      delete env['VOID_PROJECT_ROOT'];
      delete env['CLAUDE_PROJECT_DIR'];
      const done = spawnSync(process.execPath, [hook, 'enforce', 'tdd-order'], {
        cwd: workingDirectory, env, encoding: 'utf8',
        input: JSON.stringify(write(join(workingDirectory, 'sample.ts'), 'export const answer = 42;')),
      });
      expect(done.status).toBe(2);
      expect(done.stderr).toContain('void-tdd');
      expect(runsIn(main)).toContain('mis_cccccccccccccccc');
      expect(runsIn(worktree)).toEqual([]);
      expect(runsIn(workingDirectory)).toEqual([]);
    } finally {
      rmSync(main, { recursive: true, force: true });
    }
  });

  it.each([false, true])('reports unresolved identity with nested configuration: %s', (nested) => {
    const { main, worktree } = repositoryWithWorktree();
    writeFileSync(join(worktree, '.git'), 'gitdir: missing\n');
    const workingDirectory = nested ? join(worktree, 'app') : worktree;
    try {
      mkdirSync(join(workingDirectory, '.void'), { recursive: true });
      writeFileSync(join(workingDirectory, '.void/config.json'), '{"modes":{"tdd":"strict"},"paths":{"business":["**"]}}');
      const env: NodeJS.ProcessEnv = { ...process.env, PATH: '', VOID_MISSION_ID: 'mis_dddddddddddddddd' };
      delete env['VOID_PROJECT_ROOT'];
      delete env['CLAUDE_PROJECT_DIR'];
      const done = spawnSync(process.execPath, [hook, 'enforce', 'tdd-order'], {
        cwd: workingDirectory, env, encoding: 'utf8',
        input: JSON.stringify(write(join(workingDirectory, 'sample.ts'), 'export const answer = 42;')),
      });
      expect(done.status).toBe(2);
      expect(done.stderr).toContain('TELEMETRY_ROOT_UNRESOLVED');
      expect(done.stderr).toContain('void-tdd');
      expect(done.stdout).toBe('');
      expect(runsIn(main)).toEqual([]);
      expect(runsIn(worktree)).toEqual([]);
      expect(runsIn(workingDirectory)).toEqual([]);
    } finally {
      rmSync(main, { recursive: true, force: true });
    }
  });

  it('reports a failed central write without exposing its payload or claiming success', () => {
    const { main, worktree } = repositoryWithWorktree();
    try {
      mkdirSync(join(main, '.void/machine'), { recursive: true });
      writeFileSync(join(main, '.void/machine/runs'), 'occupied');
      const env: NodeJS.ProcessEnv = { ...process.env, VOID_MISSION_ID: 'mis_eeeeeeeeeeeeeeee' };
      delete env['VOID_PROJECT_ROOT'];
      delete env['CLAUDE_PROJECT_DIR'];
      const done = spawnSync(process.execPath, [hook, 'activation', 'codex'], {
        cwd: worktree, env, encoding: 'utf8', input: '{"session_id":"private-marker"}',
      });
      expect(done.status).toBe(0);
      expect(done.stdout).toBe('');
      expect(done.stderr).toContain('TELEMETRY_WRITE_FAILED');
      expect(done.stderr).not.toContain('private-marker');
      expect(done.stderr).not.toContain(main);
      expect(runsIn(worktree)).toEqual([]);
    } finally {
      rmSync(main, { recursive: true, force: true });
    }
  });
});
