import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseMechanicalContextBlock } from '@voidcorp/mission-engine/session';
import { executeContextContinuity } from './context-continuity-executor.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'void-context-continuity-'));
  roots.push(root);
  mkdirSync(join(root, '.void', 'machine'), { recursive: true });
  writeFileSync(join(root, '.void', 'config.json'), '{}\n');
  return root;
}

function checkpoint(root: string): string {
  return join(root, '.void', 'machine', 'checkpoint.md');
}

describe('executeContextContinuity PreCompact', () => {
  it.each(['claude', 'codex'] as const)('seals the same mechanical block for %s', (runtime) => {
    const root = project();
    writeFileSync(checkpoint(root), '## Objective\n\nShip continuity.\n');

    const execution = executeContextContinuity(
      { hook_event_name: 'PreCompact', trigger: 'auto' },
      root,
      runtime,
      1_000,
    );

    expect(execution.status).toBe('ok');
    expect(readFileSync(checkpoint(root), 'utf8')).toContain('## Objective\n\nShip continuity.');
    expect(parseMechanicalContextBlock(readFileSync(checkpoint(root), 'utf8')).status).toBe('valid');
  });

  it('refuses an ambiguous block and leaves the old checkpoint byte-identical', () => {
    const root = project();
    const raw = [
      '## Objective',
      '',
      'Do not corrupt me.',
      '<!-- void-harness:context-continuity:begin -->',
      '<!-- void-harness:context-continuity:begin -->',
      '<!-- void-harness:context-continuity:end -->',
    ].join('\n');
    writeFileSync(checkpoint(root), raw);

    const execution = executeContextContinuity(
      { hook_event_name: 'PreCompact', trigger: 'manual' },
      root,
      'claude',
      2_000,
    );

    expect(execution.status).toBe('degraded');
    expect(readFileSync(checkpoint(root), 'utf8')).toBe(raw);
  });

  it('skips a fresh lock without waiting or changing the checkpoint', () => {
    const root = project();
    writeFileSync(checkpoint(root), '## Objective\n\nStay intact.\n');
    writeFileSync(`${checkpoint(root)}.lock`, 'locked\n');
    const before = readFileSync(checkpoint(root), 'utf8');

    const execution = executeContextContinuity(
      { hook_event_name: 'PreCompact', trigger: 'auto' },
      root,
      'codex',
      Date.now(),
    );

    expect(execution.status).toBe('skipped');
    expect(readFileSync(checkpoint(root), 'utf8')).toBe(before);
    expect(existsSync(`${checkpoint(root)}.lock`)).toBe(true);
  });
});

function mechanicalState(root: string): ReturnType<typeof parseMechanicalContextBlock> {
  return parseMechanicalContextBlock(readFileSync(checkpoint(root), 'utf8'));
}

describe('executeContextContinuity cumulative state', () => {
  it('normalizes Claude and Codex modifications into one cumulative working set', () => {
    const root = project();
    writeFileSync(checkpoint(root), '## Objective\n\nTrack paths.\n');
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'claude', 1_000);

    executeContextContinuity({
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/claude.ts', new_string: 'changed' },
      tool_response: { success: true },
    }, root, 'claude', 2_000);
    executeContextContinuity({
      hook_event_name: 'PostToolUse',
      tool_name: 'apply_patch',
      tool_input: {
        patch: '*** Begin Patch\n*** Update File: src/codex.ts\n+changed\n*** End Patch',
      },
      tool_response: { success: true },
    }, root, 'codex', 3_000);

    const parsed = mechanicalState(root);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid') return;
    expect(parsed.state.modifiedFiles).toEqual(['src/claude.ts', 'src/codex.ts']);
  });

  it('tracks known read tools without storing paths outside the project', () => {
    const root = project();
    writeFileSync(checkpoint(root), '## Objective\n\nTrack reads.\n');
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'claude', 1_000);

    executeContextContinuity({
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: { file_path: join(root, 'src', 'inside.ts') },
      tool_response: { success: true },
    }, root, 'claude', 2_000);
    executeContextContinuity({
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: { file_path: join(root, '..', 'outside.ts') },
      tool_response: { success: true },
    }, root, 'claude', 3_000);

    const parsed = mechanicalState(root);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid') return;
    expect(parsed.state.readFiles).toEqual(['src/inside.ts']);
  });

  it('keeps clear degraded until a successful checkpoint write preserves the block', () => {
    const root = project();
    writeFileSync(checkpoint(root), '## Objective\n\nRecover clear.\n');
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'claude', 1_000);
    executeContextContinuity({
      hook_event_name: 'SessionStart',
      source: 'clear',
    }, root, 'codex', 2_000);

    const afterClear = mechanicalState(root);
    expect(afterClear.status).toBe('valid');
    if (afterClear.status !== 'valid') return;
    expect(afterClear.state.clearPending).toBe(true);
    expect(afterClear.state.semanticRevision).toBeLessThan(afterClear.state.workRevision);

    const preserved = readFileSync(checkpoint(root), 'utf8').replace(
      '## Objective\n\nRecover clear.',
      '## Objective\n\nRecover clear.\n\n## Next action\n\nRun the reconstruction proof.',
    );
    writeFileSync(checkpoint(root), preserved);
    executeContextContinuity({
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '.void/machine/checkpoint.md', content: preserved },
      tool_response: { success: true },
    }, root, 'claude', 3_000);

    const reconciled = mechanicalState(root);
    expect(reconciled.status).toBe('valid');
    if (reconciled.status !== 'valid') return;
    expect(reconciled.state.semanticRevision).toBe(reconciled.state.workRevision);
    expect(reconciled.state.clearPending).toBe(false);
  });

  it('does not reconcile a failed semantic checkpoint write', () => {
    const root = project();
    writeFileSync(checkpoint(root), '## Objective\n\nKeep degraded.\n');
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'claude', 1_000);
    executeContextContinuity({ hook_event_name: 'SessionStart', source: 'clear' }, root, 'claude', 2_000);
    const before = readFileSync(checkpoint(root), 'utf8');

    executeContextContinuity({
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '.void/machine/checkpoint.md', content: before },
      tool_response: { is_error: true },
    }, root, 'claude', 3_000);

    expect(readFileSync(checkpoint(root), 'utf8')).toBe(before);
  });
});
