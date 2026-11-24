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
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayEventLog } from '@voidcorp/mission-engine';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRODUCT_IDENTITY } from './identity.js';

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
    banner: { js: "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);" },
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

describe('secret reads through the shipped manifests and bundled runner', () => {
  it.each(['claude', 'codex'])('refuses before reading for %s with a content-free diagnostic', (runtime) => {
    const manifestPath = runtime === 'claude' ? '../core/src/.claude-plugin/plugin.json' : '../core/src/codex/hooks.json';
    const manifest = JSON.parse(readFileSync(join(here, '..', manifestPath), 'utf8')) as {
      hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] };
    };
    const cases: [string, Record<string, string>][] = [
      ['Read', { file_path: '.env' }], ['Grep', { path: '.env', pattern: 'SYNTHETIC_PATTERN' }],
      ['Grep', { glob: '.env*', pattern: 'SYNTHETIC_PATTERN' }],
      ['Bash', { command: 'grep -n SYNTHETIC_PATTERN .env*' }],
      ['Bash', { command: "rg '|' .env" }],
      ['Bash', { command: 'grep -c SYNTHETIC_PATTERN .env' }],
      ['Bash', { command: 'grep --color SYNTHETIC_PATTERN .env' }],
    ];
    for (const [tool, tool_input] of cases) {
      const configured = manifest.hooks.PreToolUse.find((entry) =>
        entry.hooks.some((entry) => entry.command.endsWith(` enforce protected-file ${runtime}`))
        && new RegExp(`^(?:${entry.matcher})$`).test(tool));
      expect(configured, `${runtime} must intercept ${tool}`).toBeDefined();
      const result = spawnSync(process.execPath, [hook, 'enforce', 'protected-file', runtime], {
        cwd: workspace, encoding: 'utf8',
        input: JSON.stringify({ tool_name: tool, tool_input }),
        env: { ...process.env, VOID_PROJECT_ROOT: workspace, VOID_MACHINE_ALLOW_SECRET_EDIT: '1' },
      });
      expect(result.status).toBe(runtime === 'codex' ? 0 : 2);
      const output = result.stdout + result.stderr;
      expect(output).toContain('SECRET_FILE_READ');
      expect(output).not.toContain('SYNTHETIC_PATTERN');
      if (runtime === 'codex') {
        expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
      }
    }
  });
});

describe('bundled credential source content enforcement', () => {
  it.each([['claude', 'Bash'], ['codex', 'shell']])(
    'refuses uninspectable redirected source modules for %s through %s', (runtime, tool) => {
      const target = join(workspace, 'deploy/infisical/client-secrets.mjs');
      const safe = join(workspace, 'ordinary.test.ts');
      const token = `AKIA${'A1'.repeat(8)}`;
      const commands = [
        `printf '${token}' > '${target}'`, `printf synthetic >> '${target}'`,
        `printf synthetic | tee -a '${target}'`,
        `printf synthetic > '${safe}'; printf synthetic > '${target}'`,
        `printf synthetic > '${target}'; printf synthetic > '${safe}'`,
      ];
      for (const command of commands) {
        const result = spawnSync(process.execPath, [hook, 'enforce', 'protected-file', runtime], {
          input: JSON.stringify({ tool_name: tool, tool_input: { command } }),
          encoding: 'utf8', cwd: workspace,
          env: { ...process.env, VOID_PROJECT_ROOT: workspace },
        });
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status).toBe(runtime === 'claude' ? 2 : 0);
        if (runtime === 'codex') expect(result.stdout).not.toBe('');
        const reason = runtime === 'codex'
          ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason : result.stderr;
        if (runtime === 'codex') {
          expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
        }
        expect(reason).toContain('PROTECTED_FILE');
        expect(reason).toContain(target);
        expect(reason).not.toContain(token);
      }
    },
  );

  it.each(['claude', 'codex'])('refuses secret-bearing mixed edits in either order for %s', (runtime) => {
    const safe = join(workspace, 'ordinary.test.ts');
    const denied = 'C:\\project\\__fixtures__\\CREDENTIALS.CTS';
    for (const content of [`AKIA${'A1'.repeat(8)}`, `SERVICE_TOKEN="${'Az19'.repeat(8)}"`]) {
      for (const paths of [[safe, denied], [denied, safe]]) {
        const payload = { tool_name: 'apply_patch', tool_input: { patch: ['*** Begin Patch',
          ...paths.flatMap((path) => [`*** Update File: ${path}`, '@@', '-old',
            `+${path === denied ? content : 'synthetic'}`]), '*** End Patch'].join('\n') } };
        for (const rule of ['protected-file', 'secret-content']) {
          const result = spawnSync(process.execPath, [hook, 'enforce', rule, runtime], {
            input: JSON.stringify(payload), encoding: 'utf8', cwd: workspace,
            env: { ...process.env, VOID_PROJECT_ROOT: workspace },
          });
          expect(result.error).toBeUndefined();
          expect(result.signal).toBeNull();
          expect(result.status).toBe(rule === 'secret-content' && runtime === 'claude' ? 2 : 0);
          if (rule === 'protected-file') {
            expect(result.stdout).toBe('');
            expect(result.stderr).toBe('');
          } else {
            const reason = runtime === 'codex'
              ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason : result.stderr;
            if (runtime === 'codex') {
              expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
            }
            expect(reason).toContain('SECRET_IN_CONTENT');
            expect(reason).toContain(`${denied}:1`);
            expect(reason).not.toContain(`${safe}:`);
            expect(reason).not.toContain(content);
          }
        }
      }
    }
  });

  it.each(['claude', 'codex'])('combines filename and content protection for %s', (runtime) => {
    const path = join(workspace, 'deploy/infisical/client-secrets.mjs');
    const cases = [
      ['', false],
      ['export async function provision(generate, store) { await store(await generate()); }', false],
      ['-----BEGIN PRIVATE KEY-----', true],
      [`AKIA${'A1'.repeat(8)}`, true],
      [`SERVICE_TOKEN="${'Az19'.repeat(8)}"`, true],
      [`export const clientSecret = "${'Az19'.repeat(8)}";`, true],
      [`const HASH_KEY = "${'ab12'.repeat(8)}", clientSecret = "${'Az19'.repeat(8)}";`, true],
      [`const clientSecret = "${'Az19'.repeat(8)}", HASH_KEY = "${'ab12'.repeat(8)}";`, true],
      [`AKIA${'A1'.repeat(8)} // allow-secret-pattern: intentional synthetic fixture`, false],
    ] as const;
    for (const [content, blocked] of cases) {
      const payload = runtime === 'claude'
        ? { tool_name: 'Write', tool_input: { file_path: path, content } }
        : { tool_name: 'apply_patch', tool_input: {
          patch: `*** Begin Patch\n*** Update File: ${path}\n@@\n-old\n+${content}\n*** End Patch`,
        } };
      for (const rule of ['protected-file', 'secret-content']) {
        const deny = rule === 'secret-content' && blocked;
        const result = spawnSync(process.execPath, [hook, 'enforce', rule, runtime], {
          input: JSON.stringify(payload), encoding: 'utf8', cwd: workspace,
          env: { ...process.env, VOID_PROJECT_ROOT: workspace },
        });
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status).toBe(deny && runtime === 'claude' ? 2 : 0);
        if (!deny) {
          expect(result.stdout).toBe('');
          expect(result.stderr).toBe('');
        } else {
          const reason = runtime === 'codex'
            ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason : result.stderr;
          if (runtime === 'codex') {
            expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
          }
          expect(reason).toContain('SECRET_IN_CONTENT');
          expect(reason).toContain(`${path}:1`);
          expect(reason).not.toContain(content);
        }
      }
    }
  });
});

describe('bundled co-owned enforcement', () => {
  it.each(['claude', 'codex'])('refuses mixed test and protected targets in both orders for %s', (runtime) => {
    const allowed = join(workspace, runtime === 'claude' ? 'ordinary.test.ts' : 'client-secrets.test.mjs');
    const denied = join(workspace, 'secrets.json');
    for (const paths of [[allowed, denied], [denied, allowed]]) {
      const payload = runtime === 'claude'
        ? { tool_name: 'Bash', tool_input: {
          command: paths.map((path) => `printf synthetic > '${path}'`).join('; '),
        } }
        : { tool_name: 'apply_patch', tool_input: { patch: ['*** Begin Patch',
          ...paths.flatMap((path) => [`*** Update File: ${path}`, '@@', '-old', '+synthetic']),
          '*** End Patch'].join('\n') } };
      const result = spawnSync(process.execPath, [hook, 'enforce', 'protected-file', runtime], {
        input: JSON.stringify(payload), encoding: 'utf8', cwd: workspace,
        env: { ...process.env, VOID_PROJECT_ROOT: workspace },
      });
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(runtime === 'codex' ? 0 : 2);
      const reason = runtime === 'codex'
        ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason : result.stderr;
      if (runtime === 'codex') {
        expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
      }
      expect(reason).toContain('PROTECTED_FILE');
      expect(reason).toContain(denied);
      expect(reason).not.toContain(allowed);
    }
  });

  it.each(['claude', 'codex'])('preserves allow and denial protocols for %s', (runtime) => {
    const root = join(workspace, `${PRODUCT_IDENTITY.packageName}-${runtime}-ownership`);
    mkdirSync(join(root, '.void'), { recursive: true });
    mkdirSync(join(root, '.git'));
    const exclusive = '.void/hooks/runner.mjs';
    writeFileSync(join(root, '.void/install-manifest.json'), JSON.stringify({
      files: ['AGENTS.md', exclusive].map((path) => ({ path })),
    }));
    const cases = [
      ['protected-file', 'AGENTS.md', 'approved prose', 'ALLOW'],
      ['protected-file', 'client-secrets.test.mjs', 'export const fixture = 1;', 'ALLOW'],
      ['protected-file', '.env.test.mjs', 'synthetic', 'PROTECTED_FILE'],
      ['protected-file', '.git/client-secrets.test.mjs', 'synthetic', 'PROTECTED_FILE'],
      ['protected-file', 'client-secrets.test.json', 'synthetic', 'PROTECTED_FILE'],
      ['protected-file', exclusive, 'changed', 'PROTECTED_FILE'],
      ['protected-file', '.env', 'changed', 'PROTECTED_FILE'],
      ['secret-content', 'AGENTS.md', `AKIA${'Z'.repeat(16)}`, 'SECRET_IN_CONTENT'],
      ['control-character', 'AGENTS.md', String.fromCharCode(1), 'CONTROL_CHARACTER_IN_SOURCE'],
    ] as const;
    for (const [rule, file, content, code] of cases) {
      const path = join(root, file);
      const payload = runtime === 'claude'
        ? { tool_name: 'Write', tool_input: { file_path: path, content } }
        : { tool_name: 'apply_patch', tool_input: {
          patch: `*** Begin Patch\n*** Update File: ${path}\n@@\n-old\n+${content}\n*** End Patch`,
        } };
      const result = spawnSync(process.execPath, [hook, 'enforce', rule, runtime], {
        input: JSON.stringify(payload), encoding: 'utf8', cwd: root,
        env: { ...process.env, VOID_PROJECT_ROOT: root },
      });
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(code === 'ALLOW' || runtime === 'codex' ? 0 : 2);
      if (code === 'ALLOW') {
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('');
      } else if (runtime === 'codex') {
        const output = JSON.parse(result.stdout).hookSpecificOutput;
        expect(output.permissionDecision).toBe('deny');
        expect(output.permissionDecisionReason).toContain(code);
        expect(output.permissionDecisionReason).toContain(path);
      } else {
        expect(result.stderr).toContain(code);
        expect(result.stderr).toContain(path);
      }
    }
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

describe('enforce', () => {
  it('names the doctrine a refusal comes from, so the skill can be reached from the message', () => {
    const { code, stderr } = enforce('secret-content', write('src/x.ts', `const token = 'ghp_${'a'.repeat(36)}';`));
    expect(code).toBe(2);
    expect(stderr).toContain('SECRET_IN_CONTENT:');
    expect(stderr).toContain('(doctrine: the void-security-guidance skill)');
  });

  it('keeps the evidence under the named doctrine rather than inside the sentence', () => {
    const { stderr } = enforce('secret-content', write('src/x.ts', `const token = 'ghp_${'a'.repeat(36)}';`));
    const [first] = stderr.split('\n');
    expect(first).toMatch(/\(doctrine: the void-security-guidance skill\)$/);
    expect(stderr).toContain('\n- ');
  });

  it('stays silent and allows when the rule finds nothing', () => {
    const { code, stderr } = enforce('secret-content', write('src/x.ts', 'const a: number = 1;'));
    expect(code).toBe(0);
    expect(stderr).toBe('');
  });

  it('refuses an unknown rule rather than failing open on it', () => {
    const { code, stderr } = enforce('no-such-rule', write('src/x.ts', `const token = 'ghp_${'a'.repeat(36)}';`));
    expect(code).toBe(2);
    expect(stderr).toContain('HOOK_INPUT_REJECTED: UNKNOWN_ENFORCEMENT_RULE');
  });

  it('refuses a payload it cannot parse rather than letting the write through', () => {
    const result = spawnSync(process.execPath, [hook, 'enforce', 'secret-content'], {
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
      'secret-content',
      JSON.stringify(write('src/café.ts', `const token = 'ghp_${'a'.repeat(36)}';`)),
    );
    expect(code).toBe(0);
    expect(stdout).toMatch(/^[\x20-\x7e]*\n$/);
    expectCodexDenial(stdout, 'SECRET_IN_CONTENT:');
    expectCodexDenial(stdout, 'src/café.ts');
  });

  it('refuses a Codex payload it cannot parse through the same denial', () => {
    const { code, stdout } = enforceCodex('secret-content', 'not json');
    expect(code).toBe(0);
    expectCodexDenial(stdout, 'HOOK_INPUT_REJECTED:');
  });

  it('lets a clean Codex tool call through without any decision', () => {
    const { code, stdout } = enforceCodex(
      'secret-content',
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

  it('ignores historical usage alerts without rewriting user history', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-banner-'));
    const machine = join(root, '.void', 'machine');
    mkdirSync(machine, { recursive: true });
    const cache = join(machine, 'invocation.json');
    const historical = JSON.stringify({ version: 2, fingerprint: 'historical', alert: 'STALE-USAGE-ALERT' });
    writeFileSync(cache, historical);
    try {
      expect(banner(root)).not.toContain('STALE-USAGE-ALERT');
      expect(readFileSync(cache, 'utf8')).toBe(historical);
      rmSync(cache);
      expect(banner(root)).toContain('Non-negotiable floor');
      expect(existsSync(cache)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(['startup', 'resume', 'clear', 'compact'])('injects identical work handoff on %s for Claude Code and Codex', source => {
    const root = mkdtempSync(join(tmpdir(), 'void-resume-parity-'));
    mkdirSync(join(root, '.void', 'machine'), { recursive: true });
    writeFileSync(join(root, '.void', 'config.json'), '{}\n');
    writeFileSync(
      join(root, '.void', 'program.md'),
      '---\nschemaVersion: 1\nstatus: executing\nprogram: parity\nplan: docs/plan.md\nspec: docs/spec.md\nautopilot:\n  enabled: false\n---\n',
    );
    writeFileSync(join(root, '.void', 'machine', 'checkpoint.md'), '## Engaged work\n\nA-1: worker uncertain.\n\n## Planned work\n\nA-3\nA-2\n');

    try {
      const context = (agentRuntime: 'claude' | 'codex'): string => {
        const result = spawnSync(process.execPath, [hook, 'lifecycle', 'context', agentRuntime], {
          input: JSON.stringify({ hook_event_name: 'SessionStart', source }),
          encoding: 'utf8',
          env: { ...process.env, VOID_PROJECT_ROOT: root },
        });
        return JSON.parse(result.stdout ?? '{}').hookSpecificOutput.additionalContext as string;
      };
      const claude = context('claude');
      const codex = context('codex');
      expect(claude).toBe(codex);
      expect(codex).not.toContain('Program: parity');
      expect(codex).toContain('Engaged work: A-1: worker uncertain.');
      expect(codex).toContain('Planned work: A-3\nA-2');
      expect(codex).toContain('Full checkpoint: .void/machine/checkpoint.md');
      expect(codex).toContain('Observations and intentions to verify; no authorization.');
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

  it('does not intercept Agent even when a multiplexer and kernel are available', () => {
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
      expect(result.stdout).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

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
      { cwd, args: ['enforce', 'secret-content', 'codex'] },
      { cwd, args: ['lifecycle', 'context', 'codex'] },
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
    expect(replay.events).toHaveLength(3);
    expect(replay.events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(replay.events.every((event) => event.missionId === mission && event.correlationId === mission)).toBe(true);
    expect(replay.events.filter((event) => event.kind.startsWith('runtime.'))).toHaveLength(3);
    const outcomes = replay.events.filter((event) => event.kind === 'hook.completed');
    expect(outcomes).toEqual([]);
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

  it.each([false, true])('keeps secret enforcement local with nested configuration: %s', (nested) => {
    const { main, worktree } = repositoryWithWorktree();
    const workingDirectory = nested ? join(worktree, 'app') : worktree;
    try {
      mkdirSync(join(workingDirectory, '.void'), { recursive: true });
      writeFileSync(join(workingDirectory, '.void/config.json'), '{"modes":{"tdd":"strict"},"paths":{"business":["**"]}}');
      writeFileSync(join(main, 'sample.test.ts'), 'export {};');
      const env: NodeJS.ProcessEnv = { ...process.env, VOID_MISSION_ID: 'mis_cccccccccccccccc' };
      delete env['VOID_PROJECT_ROOT'];
      delete env['CLAUDE_PROJECT_DIR'];
      const done = spawnSync(process.execPath, [hook, 'enforce', 'secret-content'], {
        cwd: workingDirectory, env, encoding: 'utf8',
        input: JSON.stringify(write(join(workingDirectory, 'sample.ts'), `const token = 'ghp_${'a'.repeat(36)}';`)),
      });
      expect(done.status).toBe(2);
      expect(done.stderr).toContain('void-security-guidance');
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
      const done = spawnSync(process.execPath, [hook, 'enforce', 'secret-content'], {
        cwd: workingDirectory, env, encoding: 'utf8',
        input: JSON.stringify(write(join(workingDirectory, 'sample.ts'), `const token = 'ghp_${'a'.repeat(36)}';`)),
      });
      expect(done.status).toBe(2);
      expect(done.stderr).toContain('TELEMETRY_ROOT_UNRESOLVED');
      expect(done.stderr).toContain('void-security-guidance');
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

// Fixture executables keep this globally invoked route away from active Herdr and personal hooks.
describe('global Herdr session guard', () => {
  function fixture() {
    const root = mkdtempSync(join(workspace, 'herdr-session-'));
    const bin = join(root, 'bin');
    const home = join(root, 'home');
    const codex = join(home, '.codex');
    mkdirSync(bin); mkdirSync(codex, { recursive: true });
    const capture = join(root, 'relayed');
    writeFileSync(join(codex, 'herdr-agent-state.sh'),
      'test "$1" = session || exit 42\ncat > "$RELAY_CAPTURE"\nprintf "native-output\\n"\n');
    writeFileSync(join(bin, 'herdr'), `#!${process.execPath}\n`
      + 'const mode = process.env.DISCOVERY_MODE;\n'
      + 'if (mode === "timeout") { setTimeout(() => {}, 10000); }\n'
      + 'else if (mode === "failure") { process.stderr.write("private-payload"); process.exitCode = 1; }\n'
      + 'else if (mode === "invalid") { process.stdout.write("private-payload"); }\n'
      + 'else { const entries = JSON.parse(process.env.FOREGROUND_PIDS).map(pid => ({ pid }));\n'
      + 'process.stdout.write(JSON.stringify({ result: { process_info: {\n'
      + 'pane_id: process.env.RESPONSE_PANE, shell_pid: 2, foreground_process_group_id: 3,\n'
      + 'foreground_processes: entries } } })); }\n', { mode: 0o755 });
    const env: NodeJS.ProcessEnv = {
      PATH: `${bin}:/usr/bin:/bin`, HOME: home, CODEX_HOME: codex,
      HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HERDR_SOCKET_PATH: join(root, 'unused.socket'),
      RESPONSE_PANE: 'w1:p1', FOREGROUND_PIDS: JSON.stringify([process.pid]),
      RELAY_CAPTURE: capture,
    };
    const input = Buffer.from(' { "hook_event_name": "SessionStart", "session_id": "fixture" } \n\n');
    const run = (payload: Buffer = input, runtime = 'codex') => spawnSync(process.execPath,
      [hook, 'lifecycle', 'herdr-session', runtime], {
        cwd: root, env, input: payload, timeout: 4000, maxBuffer: 262144,
      });
    const fakePs = (body: string) => writeFileSync(join(bin, 'ps'),
      `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
    return { root, codex, capture, env, input, run, fakePs };
  }

  it('relays original bytes once only when a real foreground ancestor owns the hook', () => {
    const f = fixture();
    const result = f.run();
    expect(result.status).toBe(0);
    expect(result.stderr.toString()).toBe('');
    expect(result.stdout.toString()).toBe('native-output\n');
    expect(readFileSync(f.capture)).toEqual(f.input);
    expect(existsSync(join(f.root, '.void'))).toBe(false);
    expect(existsSync(join(f.env['HOME'] ?? '', '.void'))).toBe(false);
  });

  it.each([
    ['unrelated foreground or shared daemon', [2147483647], 'ownership-unproven'],
    ['empty foreground', [], 'invalid-discovery'],
    ['non-numeric PID', ['123'], 'invalid-discovery'],
    ['mixed invalid PID', [process.pid, '123'], 'invalid-discovery'],
    ['root PID', [1], 'invalid-discovery'],
    ['negative PID', [-2], 'invalid-discovery'],
    ['fractional PID', [2.5], 'invalid-discovery'],
    ['unsafe PID', [Number.MAX_SAFE_INTEGER + 1], 'invalid-discovery'],
    ['oversized foreground', Array.from({ length: 257 }, () => process.pid), 'invalid-discovery'],
  ])('refuses %s without native relay', (_name, pids, reason) => {
    const f = fixture(); f.env['FOREGROUND_PIDS'] = JSON.stringify(pids);
    const result = f.run();
    expect(result.status).toBe(0);
    expect(result.stderr.toString()).toContain(`herdr-session: ${reason}`);
    expect(result.stdout.length).toBe(0);
    expect(existsSync(f.capture)).toBe(false);
  });

  it.each(['invalid', 'failure', 'timeout'])('diagnoses discovery %s without leaking output', mode => {
    const f = fixture(); f.env['DISCOVERY_MODE'] = mode;
    const result = f.run();
    expect(result.status).toBe(0);
    expect(result.stderr.toString()).toContain('herdr-session:');
    expect(result.stderr.toString()).not.toContain('private-payload');
    expect(result.stdout.length).toBe(0);
    expect(existsSync(f.capture)).toBe(false);
  });

  it('refuses a response for a different pane', () => {
    const f = fixture(); f.env['RESPONSE_PANE'] = 'w2:p9';
    expect(f.run().stderr.toString()).toContain('herdr-session: invalid-discovery');
    expect(existsSync(f.capture)).toBe(false);
  });

  it.each([
    ['cycle', 'process.stdout.write(process.argv.at(-1));'],
    ['depth', 'process.stdout.write(String(Number(process.argv.at(-1)) + 1));'],
    ['malformed', 'process.stdout.write("2 3");'],
    ['failure', 'process.stderr.write("private-payload"); process.exitCode = 1;'],
    ['timeout', 'setTimeout(() => {}, 10000);'],
  ])('refuses parent lookup %s within its fixed budget', (_mode, body) => {
    const f = fixture(); f.env['FOREGROUND_PIDS'] = '[2147483647]'; f.fakePs(body);
    const result = f.run();
    expect(result.status).toBe(0);
    expect(result.stderr.toString()).toContain('herdr-session:');
    expect(result.stderr.toString()).not.toContain('private-payload');
    expect(existsSync(f.capture)).toBe(false);
  });

  it.each(['claude', 'unknown'])('does not relay for runtime %s', runtime => {
    const f = fixture(); expect(f.run(f.input, runtime).stdout.length).toBe(0);
    expect(existsSync(f.capture)).toBe(false);
  });

  it.each(['{}', '{"hook_event_name":"Stop"}', 'broken', '', '[1]'])('does not relay payload %s', payload => {
    const f = fixture(); const result = f.run(Buffer.from(payload));
    expect(result.stdout.length).toBe(0); expect(existsSync(f.capture)).toBe(false);
    expect(existsSync(join(f.root, '.void'))).toBe(false);
  });

  it('refuses an absent native hook without creating project state', () => {
    const f = fixture(); f.env['CODEX_HOME'] = join(f.root, 'absent');
    expect(f.run().stderr.toString()).toContain('herdr-session: native-hook-unavailable');
    expect(existsSync(f.capture)).toBe(false); expect(existsSync(join(f.root, '.void'))).toBe(false);
  });

  it('uses the native default directory when CODEX_HOME is empty', () => {
    const f = fixture(); f.env['CODEX_HOME'] = '';
    expect(f.run().stderr.toString()).toBe('');
    expect(readFileSync(f.capture)).toEqual(f.input);
  });

  it('bounds the global input without logging it or creating telemetry', () => {
    const f = fixture(); const result = f.run(Buffer.alloc(1048577, 32));
    expect(result.stderr.toString()).toContain('HOOK_INPUT_TOO_LARGE');
    expect(result.stdout.length).toBe(0); expect(existsSync(f.capture)).toBe(false);
    expect(existsSync(join(f.root, '.void'))).toBe(false);
  });

  it.each(['HERDR_ENV', 'HERDR_PANE_ID', 'HERDR_SOCKET_PATH'])('cannot relay without %s', name => {
    const f = fixture(); delete f.env[name];
    expect(f.run().stdout.length).toBe(0); expect(existsSync(f.capture)).toBe(false);
  });

  it('refuses binary input without logging its contents', () => {
    const f = fixture(); const result = f.run(Buffer.from([0, 255]));
    expect(result.stderr.toString()).toBe('herdr-session: invalid-input\n');
    expect(result.stdout.length).toBe(0); expect(existsSync(f.capture)).toBe(false);
  });

  it.each(['exit 8', 'exec /bin/sleep 10'])('reports native failure without exposing stderr: %s', body => {
    const f = fixture();
    writeFileSync(join(f.codex, 'herdr-agent-state.sh'), `printf private-payload >&2\n${body}\n`);
    const result = f.run();
    expect(result.status).toBe(0);
    expect(result.stderr.toString()).toContain('herdr-session: native-relay-failed');
    expect(result.stderr.toString()).not.toContain('private-payload');
    expect(result.stdout.length).toBe(0);
  });
});
