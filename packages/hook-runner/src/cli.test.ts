import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    target: 'node22',
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

const write = (file: string, content: string): unknown => ({
  tool_name: 'Write',
  tool_input: { file_path: file, content },
});

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
        ts: '2026-08-19T10:00:00.000Z',
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
        'void-harness:context-continuity:begin',
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
