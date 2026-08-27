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
