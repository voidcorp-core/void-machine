import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'activation-meter.sh');
// Resolve before the no-jq fixtures restrict PATH; login-shell state is irrelevant.
const BASH = execFileSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim();

interface HookResult {
  readonly dir: string;
  readonly activations: readonly Record<string, unknown>[];
  readonly usage: string;
}

/** Run the hook with `payload` on stdin in a throwaway project dir; return parsed output. */
function runHook(payload: Record<string, unknown>, env: Record<string, string> = {}): HookResult {
  const dir = mkdtempSync(join(tmpdir(), 'act-meter-'));
  execFileSync(BASH, [script], {
    input: JSON.stringify(payload),
    // Isolate the global rollup index so self-registration (#72) never touches ~/.void.
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, VOID_GLOBAL_DIR: join(dir, '_global'), ...env },
  });
  const runs = join(dir, '.void', 'machine', 'runs');
  const mission = existsSync(runs) ? readdirSync(runs)[0] : undefined;
  const actPath = mission === undefined
    ? ''
    : join(runs, mission, 'events.jsonl');
  const usagePath = join(dir, '.void', 'machine', 'usage.log');
  const raw = actPath !== '' && existsSync(actPath)
    ? readFileSync(actPath, 'utf8').trim()
    : '';
  const activations = raw === '' ? [] : raw.split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
  return { dir, activations, usage: existsSync(usagePath) ? readFileSync(usagePath, 'utf8') : '' };
}

const pre = (toolName: string, toolInput: Record<string, unknown>): Record<string, unknown> => ({
  hook_event_name: 'PreToolUse',
  session_id: 'sess-1',
  tool_name: toolName,
  tool_input: toolInput,
});

describe('activation-meter — classification', () => {
  it('records a Skill call as kind=skill and no longer writes the legacy usage.log (#70)', () => {
    const { activations, usage } = runHook(pre('Skill', { skill: 'void-tdd' }));
    expect(activations).toHaveLength(1);
    expect(activations[0]).toMatchObject({
      schemaVersion: 1,
      seq: 1,
      kind: 'runtime.tool.started',
      subject: 'skill:void-tdd',
    });
    expect(JSON.stringify(activations[0])).not.toContain('sess-1');
    expect(usage).toBe('');
  });

  it('records a Task call as kind=agent using subagent_type', () => {
    const { activations, usage } = runHook(pre('Task', { subagent_type: 'Explore' }));
    expect(activations[0]).toMatchObject({ subject: 'agent:Explore' });
    expect(usage).toBe('');
  });

  it('records an Agent call (this harness names the spawn tool Agent, not Task) as kind=agent', () => {
    const { activations } = runHook(pre('Agent', { subagent_type: 'harness:doctrine-critic' }));
    expect(activations[0]).toMatchObject({ subject: 'agent:harness:doctrine-critic' });
  });

  it('defaults an Agent call with no subagent_type to claude', () => {
    const { activations } = runHook(pre('Agent', { prompt: 'do a thing' }));
    expect(activations[0]).toMatchObject({ subject: 'agent:claude' });
  });

  it('records a Workflow call as kind=workflow using its name', () => {
    const { activations } = runHook(pre('Workflow', { name: 'find-flaky' }));
    expect(activations[0]).toMatchObject({ subject: 'workflow:find-flaky' });
  });

  it('derives a scriptPath-launched Workflow name from its basename (matches the workflow-def node)', () => {
    const { activations } = runHook(
      pre('Workflow', { scriptPath: 'packages/core/skills/void-autopilot/workflows/autopilot.workflow.js' }),
    );
    expect(activations[0]).toMatchObject({ subject: 'workflow:autopilot' });
  });

  it('prefers an explicit name over scriptPath for a Workflow', () => {
    const { activations } = runHook(pre('Workflow', { name: 'custom', scriptPath: 'x/other.workflow.js' }));
    expect(activations[0]).toMatchObject({ subject: 'workflow:custom' });
  });

  it('falls back to inline for a Workflow with neither name nor scriptPath', () => {
    const { activations } = runHook(pre('Workflow', { script: 'export const meta = {}' }));
    expect(activations[0]).toMatchObject({ subject: 'workflow:inline' });
  });

  it('treats an empty name as absent and derives from scriptPath (jq // only guards null/false)', () => {
    const { activations } = runHook(pre('Workflow', { name: '', scriptPath: 'a/b/deploy.workflow.js' }));
    expect(activations[0]).toMatchObject({ subject: 'workflow:deploy' });
  });

  it('falls back to inline when scriptPath yields an empty basename (trailing slash)', () => {
    const { activations } = runHook(pre('Workflow', { scriptPath: 'workflows/deploy/' }));
    expect(activations[0]).toMatchObject({ subject: 'workflow:inline' });
  });

  it('falls back to inline for an empty name and no scriptPath', () => {
    const { activations } = runHook(pre('Workflow', { name: '' }));
    expect(activations[0]).toMatchObject({ subject: 'workflow:inline' });
  });

  it('records any other tool as kind=tool with the tool name', () => {
    const { activations } = runHook(pre('Bash', { command: 'ls' }));
    expect(activations[0]).toMatchObject({ subject: 'tool:Bash' });
  });
});

describe('activation-meter — file trigger context', () => {
  it('relativizes file_path into trigger.fileGlobs and derives ext (never content)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'act-meter-'));
    execFileSync(BASH, [script], {
      input: JSON.stringify(pre('Edit', { file_path: join(dir, 'src/render/live.ts'), new_string: 'SECRET CONTENT' })),
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    const runs = join(dir, '.void', 'machine', 'runs');
    const mission = readdirSync(runs)[0] ?? '';
    const ev = JSON.parse(
      readFileSync(join(runs, mission, 'events.jsonl'), 'utf8').trim(),
    ) as {
      kind: string;
      payload: { tool: string; fileGlobs: string[]; extensions: string[] };
    };
    expect(ev.kind).toBe('runtime.tool.started');
    expect(ev.payload.tool).toBe('Edit');
    expect(ev.payload.fileGlobs).toContain('src/render/live.ts');
    expect(ev.payload.extensions).toContain('ts');
    expect(JSON.stringify(ev)).not.toContain('SECRET CONTENT');
  });
});

describe('activation-meter — robustness', () => {
  it('always exits 0 (best-effort) even on an empty/garbage payload', () => {
    // execFileSync throws on non-zero exit; reaching the assertion means exit 0.
    expect(() => runHook({})).not.toThrow();
  });

  it('records a well-formed event when jq is absent', () => {
    const binDir = mkdtempSync(join(tmpdir(), 'act-bin-'));
    for (const tool of ['cat', 'date', 'mkdir']) symlinkSync(`/bin/${tool}`, join(binDir, tool));
    symlinkSync(process.execPath, join(binDir, 'node'));
    const dir = mkdtempSync(join(tmpdir(), 'act-meter-'));
    execFileSync(BASH, [script], {
      input: JSON.stringify(pre('Skill', { skill: 'void-tdd' })),
      env: { CLAUDE_PROJECT_DIR: dir, PATH: binDir },
    });
    const runs = join(dir, '.void', 'machine', 'runs');
    const mission = readdirSync(runs)[0] ?? '';
    const ev = JSON.parse(
      readFileSync(join(runs, mission, 'events.jsonl'), 'utf8').trim(),
    ) as Record<string, unknown>;
    expect(ev).toMatchObject({
      kind: 'runtime.tool.started',
      subject: 'skill:void-tdd',
    });
  });

  it('stays best-effort when the project root cannot be created', () => {
    expect(() => runHook(pre('Skill', { skill: 'void-tdd' }), {
      CLAUDE_PROJECT_DIR: '/dev/null/nonexistent',
    })).not.toThrow();
  });
});
