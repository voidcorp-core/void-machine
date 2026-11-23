import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Characterization tests for the trim-large-output PostToolUse hook. They lock
// the contract: Bash/MCP results over the threshold are replaced with a trimmed
// view (via updatedToolOutput) plus a full spill file, while Read/Edit and small
// results pass through untouched, and any uncertainty fails OPEN.
const here = dirname(fileURLToPath(import.meta.url));
// PATH resolves the installed Bash even when the runner omits login-shell state.
const BASH = 'bash';
const HOOK = 'trim-large-output.sh';

function runHook(
  payload: Record<string, unknown>,
  env: Record<string, string> = {},
): { code: number; stdout: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'trim-hook-'));
  const res = spawnSync(BASH, [join(here, HOOK)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...env },
  });
  return { code: res.status ?? 0, stdout: res.stdout ?? '', root };
}

const bashResp = (response: unknown): Record<string, unknown> => ({
  tool_name: 'Bash',
  tool_input: { command: 'echo x' },
  tool_response: response,
});
const big = (n: number, seed = 'x'): string => seed.repeat(n);

describe('trim-large-output.sh', () => {
  it('passes small Bash output through untouched (no updatedToolOutput)', () => {
    const { code, stdout } = runHook(bashResp('all good\n'));
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('');
  });

  it('trims a large Bash string result and points to the spill file', () => {
    const { code, stdout, root } = runHook(bashResp(big(50_000)));
    expect(code).toBe(0);
    const out = JSON.parse(stdout);
    const updated = out.hookSpecificOutput.updatedToolOutput as string;
    expect(updated).toMatch(/\.void\/machine\/outputs\//);
    expect(updated.length).toBeLessThan(50_000);
    // Full output spilled to disk, intact.
    const files = readdirSync(join(root, '.void', 'machine', 'outputs'));
    expect(files).toHaveLength(1);
    expect(readFileSync(join(root, '.void', 'machine', 'outputs', files[0]), 'utf8').length).toBe(50_000);
  });

  it('trims a large object result with a stdout field', () => {
    const { stdout } = runHook(bashResp({ stdout: big(40_000), stderr: '' }));
    expect(JSON.parse(stdout).hookSpecificOutput.updatedToolOutput).toMatch(/trimmed/);
  });

  it('never trims a Read result, however large', () => {
    const { code, stdout } = runHook({
      tool_name: 'Read',
      tool_input: { file_path: 'src/big.ts' },
      tool_response: big(80_000),
    });
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('');
  });

  it('surfaces error lines buried in the elided middle', () => {
    const payload = bashResp(`${big(20_000, 'a')}\nError: boom at line 42\n${big(20_000, 'b')}`);
    const updated = JSON.parse(runHook(payload).stdout).hookSpecificOutput.updatedToolOutput as string;
    expect(updated).toMatch(/Error: boom/);
  });

  it('honors VOID_HARNESS_NO_TRIM=1', () => {
    const { stdout } = runHook(bashResp(big(50_000)), { VOID_HARNESS_NO_TRIM: '1' });
    expect(stdout.trim()).toBe('');
  });

  it('honors a lowered VOID_HARNESS_TRIM_BYTES threshold', () => {
    const { stdout } = runHook(bashResp(big(2_000)), { VOID_HARNESS_TRIM_BYTES: '500' });
    expect(JSON.parse(stdout).hookSpecificOutput.updatedToolOutput).toMatch(/trimmed/);
  });

  it('trims a large MCP tool result', () => {
    const { stdout } = runHook({
      tool_name: 'mcp__claude_ai_Linear__list_issues',
      tool_input: {},
      tool_response: big(60_000),
    });
    expect(JSON.parse(stdout).hookSpecificOutput.updatedToolOutput).toMatch(/trimmed/);
  });
});
