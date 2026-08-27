import {
  appendFileSync,
  closeSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMechanicalContextBlock } from '@voidcorp/mission-engine/session';
import { afterEach, describe, expect, it } from 'vitest';
import {
  claimStaleLock,
  executeContextContinuity,
  isExternalTranscriptBound,
  readBoundedDescriptor,
} from './context-continuity-executor.js';
import { observeResume } from './resume-observer.js';

const roots: string[] = [];
const originalHome = process.env['HOME'];

afterEach(() => {
  if (originalHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = originalHome;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(config: unknown = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'void-context-continuity-'));
  roots.push(root);
  mkdirSync(join(root, '.void', 'machine'), { recursive: true });
  writeFileSync(join(root, '.void', 'config.json'), `${JSON.stringify(config)}\n`);
  return root;
}

function usageLine(usedTokens: number): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      usage: {
        input_tokens: Math.max(0, usedTokens - 30),
        output_tokens: 10,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 10,
      },
    },
  });
}

function transcript(root: string): string {
  return join(root, 'transcript.jsonl');
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

  it('does not take over a stale lock while another recovery owns the election', () => {
    const root = project();
    const raw = '## Objective\n\nKeep one stale-lock recovery owner.\n';
    const lock = `${checkpoint(root)}.lock`;
    writeFileSync(checkpoint(root), raw);
    writeFileSync(lock, 'stale\n');
    utimesSync(lock, new Date(0), new Date(0));
    writeFileSync(`${lock}.recovery`, 'recovering\n');

    const execution = executeContextContinuity(
      { hook_event_name: 'PreCompact', trigger: 'auto' },
      root,
      'codex',
      Date.now(),
    );

    expect(execution.status).toBe('skipped');
    expect(readFileSync(checkpoint(root), 'utf8')).toBe(raw);
    expect(existsSync(lock)).toBe(true);
  });

  it('does not remove the recovery claim when another contender wins the hardlink race', () => {
    const root = project();
    const lock = `${checkpoint(root)}.lock`;
    writeFileSync(lock, 'stale\n');
    const observed = lstatSync(lock);
    linkSync(lock, `${lock}.recovery`);

    expect(claimStaleLock(lock, observed)).toBeUndefined();
    expect(existsSync(`${lock}.recovery`)).toBe(true);
    expect(lstatSync(`${lock}.recovery`).ino).toBe(observed.ino);
  });

  it('recovers an aged hardlink election orphan left by process death', () => {
    const root = project();
    const lock = `${checkpoint(root)}.lock`;
    writeFileSync(checkpoint(root), '## Objective\n\nRecover a dead election owner.\n');
    writeFileSync(lock, 'stale\n');
    utimesSync(lock, new Date(0), new Date(0));
    linkSync(lock, `${lock}.recovery`);

    const execution = executeContextContinuity(
      { hook_event_name: 'PreCompact', trigger: 'auto' },
      root,
      'codex',
      Date.now() + 2_000,
    );

    expect(execution.status).toBe('ok');
    expect(existsSync(`${lock}.recovery`)).toBe(false);
    expect(mechanicalState(root).status).toBe('valid');
  });

  it('leaves the old checkpoint intact when the atomic temporary write fails', () => {
    const root = project();
    const raw = '## Objective\n\nKeep the previous authority.\n';
    const now = 4_000;
    writeFileSync(checkpoint(root), raw);
    writeFileSync(
      join(root, '.void', 'machine', `.checkpoint-${String(process.pid)}-${String(now)}.tmp`),
      'collision',
    );

    const execution = executeContextContinuity(
      { hook_event_name: 'PreCompact' },
      root,
      'codex',
      now,
    );

    expect(execution.status).toBe('skipped');
    expect(readFileSync(checkpoint(root), 'utf8')).toBe(raw);
  });

  it('rejects a checkpoint parent symlink without writing outside the project', () => {
    const root = project();
    const outside = mkdtempSync(join(tmpdir(), 'void-context-outside-'));
    roots.push(outside);
    rmSync(join(root, '.void', 'machine'), { recursive: true });
    symlinkSync(outside, join(root, '.void', 'machine'));

    const execution = executeContextContinuity(
      { hook_event_name: 'PreCompact' },
      root,
      'codex',
      5_000,
    );

    expect(execution.status).toBe('degraded');
    expect(existsSync(join(outside, 'checkpoint.md'))).toBe(false);
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

  it('normalizes runtime-faithful Claude and Codex read payloads into the same working set', () => {
    const root = project();
    writeFileSync(checkpoint(root), '## Objective\n\nKeep runtime parity.\n');
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'claude', 1_000);

    executeContextContinuity({
      hook_event_name: 'PostToolUse',
      session_id: 'claude-session',
      tool_name: 'Read',
      tool_input: { file_path: 'src/shared.ts' },
      tool_response: { success: true },
    }, root, 'claude', 2_000);
    executeContextContinuity({
      hook_event_name: 'PostToolUse',
      thread_id: 'codex-session',
      tool_name: 'read_file',
      tool_input: { path: 'src/shared.ts' },
      tool_response: { success: true },
    }, root, 'codex', 3_000);

    const parsed = mechanicalState(root);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid') return;
    expect(parsed.state.readFiles).toEqual(['src/shared.ts']);
  });

  it('rejects reserved mechanical delimiters in observed file names', () => {
    const root = project();
    writeFileSync(checkpoint(root), '## Objective\n\nKeep markers authoritative.\n');
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'claude', 1_000);

    executeContextContinuity({
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: {
        file_path: 'src/<!-- void-harness:context-continuity:begin -->.ts',
      },
      tool_response: { success: true },
    }, root, 'claude', 2_000);

    expect(mechanicalState(root).status).toBe('valid');
    expect(readFileSync(checkpoint(root), 'utf8').match(
      /<!-- void-harness:context-continuity:begin -->/g,
    )).toHaveLength(1);
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

  it('keeps a failed PreCompact seal degraded at the following compact resume', () => {
    const root = project();
    writeFileSync(checkpoint(root), '## Objective\n\nKeep seal failures visible.\n');
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'claude', 1_000);
    const semantic = readFileSync(checkpoint(root), 'utf8').replace(
      '## Objective\n\nKeep seal failures visible.',
      '## Objective\n\nKeep seal failures visible.\n\n## Next action\n\nResume safely.',
    );
    writeFileSync(checkpoint(root), semantic);
    executeContextContinuity({
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '.void/machine/checkpoint.md', content: semantic },
      tool_response: { success: true },
    }, root, 'claude', 2_000);
    const beforeFailure = mechanicalState(root);
    expect(beforeFailure.status).toBe('valid');
    if (beforeFailure.status !== 'valid') return;
    expect(beforeFailure.state.sealedWorkRevision).toBe(0);
    writeFileSync(`${checkpoint(root)}.lock`, 'busy\n');

    const failed = executeContextContinuity(
      { hook_event_name: 'PreCompact' },
      root,
      'claude',
      Date.now(),
    );
    const resume = observeResume(root, 3_000, { source: 'compact' });

    expect(failed.status).toBe('skipped');
    expect(resume.bundle.continuity.status).toBe('degraded');
    expect(resume.context).toContain('pre-compaction seal is not confirmed');
    expect(resume.context).toContain('Reconstruct context before any mutation.');
  });
});

describe('executeContextContinuity transcript threshold', () => {
  it('caps descriptor reads even when the opened file is larger than the advertised bound', () => {
    const root = project();
    const path = join(root, 'growing.txt');
    writeFileSync(path, '12345678901');
    const descriptor = openSync(path, 'r');
    try {
      expect(readBoundedDescriptor(descriptor, 10)).toBe(undefined);
    } finally {
      closeSync(descriptor);
    }
  });

  it('binds only exact strong Claude session names outside the project', () => {
    expect(isExternalTranscriptBound(
      '/runtime/.codex/sessions/codex-session.jsonl',
      'codex',
      'codex-session',
    )).toBe(false);
    expect(isExternalTranscriptBound(
      '/runtime/.claude/projects/project/prefix-x-suffix.jsonl',
      'claude',
      'x',
    )).toBe(false);
    expect(isExternalTranscriptBound(
      '/runtime/.claude/projects/project/claude-session.jsonl',
      'claude',
      'claude-session',
    )).toBe(true);
  });

  it('uses the last complete usage entry and emits one nudge at the default threshold', () => {
    const root = project({ context: { windowTokens: 1_000 } });
    writeFileSync(checkpoint(root), '## Objective\n\nMeasure context.\n');
    writeFileSync(transcript(root), `${usageLine(300)}\n${usageLine(500)}\n`);
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'claude', 1_000);

    const first = executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: transcript(root),
    }, root, 'claude', 2_000);
    const duplicate = executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: transcript(root),
    }, root, 'claude', 2_000);

    expect(first.output?.hookSpecificOutput.additionalContext).toMatch(/void-checkpoint/i);
    expect(duplicate.output).toBe(undefined);
    const parsed = mechanicalState(root);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid') return;
    expect(parsed.state.lastUsedTokens).toBe(500);
    expect(parsed.state.nudgeEmitted).toBe(true);
  });

  it('records usage but emits no percentage or nudge without a known window', () => {
    const root = project();
    writeFileSync(checkpoint(root), '## Objective\n\nUnknown window.\n');
    writeFileSync(transcript(root), `${usageLine(900)}\n`);
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'codex', 1_000);

    const result = executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: transcript(root),
    }, root, 'codex', 2_000);

    expect(result.output).toBe(undefined);
    expect(JSON.stringify(result.details)).not.toContain('%');
    const parsed = mechanicalState(root);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid') return;
    expect(parsed.state.lastUsedTokens).toBe(900);
  });

  it('does not read a transcript outside runtime-owned roots', () => {
    const root = project({ context: { windowTokens: 1_000 } });
    const outside = mkdtempSync(join(tmpdir(), 'void-transcript-outside-'));
    roots.push(outside);
    const externalTranscript = join(outside, 'private.jsonl');
    writeFileSync(checkpoint(root), '## Objective\n\nConfine transcripts.\n');
    writeFileSync(externalTranscript, `${usageLine(900)}\n`);
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'codex', 1_000);

    const result = executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: externalTranscript,
    }, root, 'codex', 2_000);

    expect(result.output).toBe(undefined);
    const parsed = mechanicalState(root);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid') return;
    expect(parsed.state.lastUsedTokens).toBe(0);
  });

  it('rejects a self-asserted Codex session transcript outside the project', () => {
    const root = project({ context: { windowTokens: 1_000 } });
    const fakeHome = mkdtempSync(join(tmpdir(), 'void-context-home-'));
    roots.push(fakeHome);
    process.env['HOME'] = fakeHome;
    const externalTranscript = join(
      fakeHome,
      '.codex',
      'sessions',
      'codex-session.jsonl',
    );
    mkdirSync(join(fakeHome, '.codex', 'sessions'), { recursive: true });
    writeFileSync(checkpoint(root), '## Objective\n\nReject self-asserted sessions.\n');
    writeFileSync(externalTranscript, `${usageLine(900)}\n`);
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'codex', 1_000);

    const result = executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'codex-session',
      transcript_path: externalTranscript,
    }, root, 'codex', 2_000);

    expect(result.output).toBe(undefined);
    const parsed = mechanicalState(root);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid') return;
    expect(parsed.state.lastUsedTokens).toBe(0);
  });

  it('requires an exact strong session token for external Claude transcripts', () => {
    const root = project({ context: { windowTokens: 1_000 } });
    const fakeHome = mkdtempSync(join(tmpdir(), 'void-context-home-'));
    roots.push(fakeHome);
    process.env['HOME'] = fakeHome;
    const projectTranscripts = join(
      fakeHome,
      '.claude',
      'projects',
      root.replace(/[^a-zA-Z0-9]/g, '-'),
    );
    const externalTranscript = join(projectTranscripts, 'prefix-x-suffix.jsonl');
    mkdirSync(projectTranscripts, { recursive: true });
    writeFileSync(checkpoint(root), '## Objective\n\nBind Claude sessions exactly.\n');
    writeFileSync(externalTranscript, `${usageLine(900)}\n`);
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'claude', 1_000);

    const result = executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'x',
      transcript_path: externalTranscript,
    }, root, 'claude', 2_000);

    expect(result.output).toBe(undefined);
    const parsed = mechanicalState(root);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid') return;
    expect(parsed.state.lastUsedTokens).toBe(0);
  });

  it('ignores symlinked and oversized context configuration files', () => {
    const root = project({ context: { windowTokens: 1_000 } });
    const outside = mkdtempSync(join(tmpdir(), 'void-config-outside-'));
    roots.push(outside);
    const externalConfig = join(outside, 'config.json');
    writeFileSync(externalConfig, '{"context":{"windowTokens":1000}}\n');
    unlinkSync(join(root, '.void', 'config.json'));
    symlinkSync(externalConfig, join(root, '.void', 'config.json'));
    writeFileSync(checkpoint(root), '## Objective\n\nBound config.\n');
    writeFileSync(transcript(root), `${usageLine(900)}\n`);
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'claude', 1_000);

    const symlinked = executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: transcript(root),
    }, root, 'claude', 2_000);
    expect(symlinked.output).toBe(undefined);

    unlinkSync(join(root, '.void', 'config.json'));
    writeFileSync(join(root, '.void', 'config.json'), ' '.repeat(70_000));
    appendFileSync(transcript(root), `${usageLine(950)}\n`);
    const oversized = executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: transcript(root),
    }, root, 'claude', 3_000);
    expect(oversized.output).toBe(undefined);
  });

  it('waits for a complete line, skips malformed input, and resumes after truncation', () => {
    const root = project({ context: { windowTokens: 10_000 } });
    writeFileSync(checkpoint(root), '## Objective\n\nTolerate transcript lag.\n');
    writeFileSync(transcript(root), `{malformed}\n${usageLine(123)}`);
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'claude', 1_000);

    executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: transcript(root),
    }, root, 'claude', 2_000);
    let parsed = mechanicalState(root);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid') return;
    expect(parsed.state.lastUsedTokens).toBe(0);

    appendFileSync(transcript(root), '\n');
    executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: transcript(root),
    }, root, 'claude', 3_000);
    parsed = mechanicalState(root);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid') return;
    expect(parsed.state.lastUsedTokens).toBe(123);

    writeFileSync(transcript(root), `${usageLine(42)}\n`);
    executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: transcript(root),
    }, root, 'claude', 4_000);
    parsed = mechanicalState(root);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid') return;
    expect(parsed.state.lastUsedTokens).toBe(42);
  });

  it('bounds an oversized delta and keeps the final complete usage observation', () => {
    const root = project({ context: { windowTokens: 1_000 } });
    writeFileSync(checkpoint(root), '## Objective\n\nBound transcript reads.\n');
    writeFileSync(transcript(root), `${'x'.repeat(1_100_000)}\n${usageLine(600)}\n`);
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'codex', 1_000);

    const result = executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: transcript(root),
    }, root, 'codex', 2_000);

    expect(result.details['transcriptSkippedBytes']).toBeGreaterThan(0);
    const parsed = mechanicalState(root);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid') return;
    expect(parsed.state.lastUsedTokens).toBe(600);
    expect(parsed.state.transcriptCursorBytes).toBeGreaterThan(1_000_000);
  });

  it('respects the PostToolUse cooldown while still merging paths', () => {
    const root = project({ context: { windowTokens: 1_000 } });
    writeFileSync(checkpoint(root), '## Objective\n\nBound hot-path reads.\n');
    writeFileSync(transcript(root), `${usageLine(100)}\n`);
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'claude', 1_000);

    executeContextContinuity({
      hook_event_name: 'PostToolUse',
      transcript_path: transcript(root),
      tool_name: 'Read',
      tool_input: { file_path: 'src/first.ts' },
      tool_response: { success: true },
    }, root, 'claude', 10_000);
    appendFileSync(transcript(root), `${usageLine(700)}\n`);
    executeContextContinuity({
      hook_event_name: 'PostToolUse',
      transcript_path: transcript(root),
      tool_name: 'Edit',
      tool_input: { file_path: 'src/second.ts', new_string: 'changed' },
      tool_response: { success: true },
    }, root, 'claude', 12_000);

    let parsed = mechanicalState(root);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid') return;
    expect(parsed.state.lastUsedTokens).toBe(100);
    expect(parsed.state.modifiedFiles).toContain('src/second.ts');

    executeContextContinuity({
      hook_event_name: 'PostToolUse',
      transcript_path: transcript(root),
      tool_name: 'Read',
      tool_input: { file_path: 'src/third.ts' },
      tool_response: { success: true },
    }, root, 'claude', 16_000);
    parsed = mechanicalState(root);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid') return;
    expect(parsed.state.lastUsedTokens).toBe(700);
  });

  it('lets PreCompact ignore the cooldown for its final measurement', () => {
    const root = project({ context: { windowTokens: 1_000 } });
    writeFileSync(checkpoint(root), '## Objective\n\nMeasure before compaction.\n');
    writeFileSync(transcript(root), `${usageLine(100)}\n`);
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'codex', 1_000);
    appendFileSync(transcript(root), `${usageLine(800)}\n`);

    executeContextContinuity({
      hook_event_name: 'PreCompact',
      transcript_path: transcript(root),
    }, root, 'codex', 2_000);

    const parsed = mechanicalState(root);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid') return;
    expect(parsed.state.lastUsedTokens).toBe(800);
  });
});
