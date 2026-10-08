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
  type Mode,
  type OpenMode,
  type PathLike,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMechanicalContextBlock } from './checkpoint-codec.js';
import {
  claimStaleLock,
  executeContextContinuity,
  measureHerdrContext,
  isExternalTranscriptBound,
  readBoundedDescriptor,
} from './context-continuity-executor.js';
import { observeResume } from './resume-observer.js';

const recoveryOpenFault = vi.hoisted(() => ({ attempts: 0, remaining: 0 }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    openSync(path: PathLike, flags: OpenMode, mode?: Mode | null) {
      if (
        recoveryOpenFault.remaining > 0
        && typeof path === 'string'
        && path.endsWith('.recovery')
        && typeof flags === 'number'
        && (flags & actual.constants.O_EXCL) !== 0
      ) {
        recoveryOpenFault.attempts += 1;
        recoveryOpenFault.remaining -= 1;
        throw Object.assign(new Error('recovery claim creation failed'), { code: 'EACCES' });
      }
      return actual.openSync(path, flags, mode);
    },
  };
});

const roots: string[] = [];
describe('fresh read-only context projection', () => {
  it('measures Claude usage with a configured window without writing a checkpoint', () => {
    const root = project({ context: { windowTokens: 1000 } });
    writeFileSync(transcript(root), `${usageLine(420)}\n`);
    expect(measureHerdrContext({ transcript_path: transcript(root) }, root, 'claude', 100))
      .toBe(42);
    expect(existsSync(checkpoint(root))).toBe(false);
    expect(measureHerdrContext({ transcript_path: transcript(root) }, root, 'codex', 100))
      .toBeUndefined();
  });
  it('does not reuse pre-clear usage or invent a window', () => {
    const root = project();
    writeFileSync(transcript(root), `${usageLine(420)}\n`);
    expect(measureHerdrContext({ transcript_path: transcript(root) }, root, 'claude', 100))
      .toBeUndefined();
    writeFileSync(join(root, '.void', 'config.json'), JSON.stringify({ context: { windowTokens: 1000 } }));
    expect(measureHerdrContext({ source: 'clear', transcript_path: transcript(root) }, root, 'claude', 100))
      .toBeUndefined();
  });
});
const originalHome = process.env['HOME'];

afterEach(() => {
  recoveryOpenFault.attempts = 0;
  recoveryOpenFault.remaining = 0;
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

  it('abandons recovery when a missing claim cannot be created', () => {
    const root = project();
    const lock = `${checkpoint(root)}.lock`;
    writeFileSync(lock, 'stale\n');
    const observed = lstatSync(lock);
    recoveryOpenFault.remaining = 100;

    const claim = claimStaleLock(lock, observed, Date.now() + 2_000);

    if (claim !== undefined) closeSync(claim.descriptor);
    expect(claim).toBeUndefined();
    expect(recoveryOpenFault.attempts).toBe(1);
  });

  it('preserves a fresh lock whose identity matches an earlier stale observation', () => {
    const root = project();
    const lock = `${checkpoint(root)}.lock`;
    const recovery = `${lock}.recovery`;
    writeFileSync(lock, 'stale\n');
    writeFileSync(recovery, 'abandoned\n');
    const observed = lstatSync(lock);
    const orphan = lstatSync(recovery);
    // Whole-second fixture times survive platform-specific stat precision exactly.
    const now = Math.ceil(Math.max(observed.ctimeMs, orphan.ctimeMs) / 1_000) * 1_000 + 2_000;

    // Model Linux reusing the old inode for a fresh owner's lock without relying
    // on the allocator or process scheduling to produce that identity again.
    writeFileSync(lock, 'current owner\n');
    utimesSync(lock, new Date(now), new Date(now));
    const current = lstatSync(lock);
    expect(current.ino).toBe(observed.ino);
    expect(current.dev).toBe(observed.dev);
    expect(now - Math.max(observed.mtimeMs, observed.ctimeMs)).toBeGreaterThan(1_000);
    expect(current.mtimeMs).toBe(now);

    const claim = claimStaleLock(lock, observed, now);
    if (claim !== undefined) closeSync(claim.descriptor);

    expect(claim).toBeUndefined();
    expect(readFileSync(lock, 'utf8')).toBe('current owner\n');
    expect(lstatSync(lock).ino).toBe(current.ino);
    expect(existsSync(recovery)).toBe(false);
  });

  it('does not remove an older generation when another contender already owns recovery', () => {
    const root = project();
    const lock = `${checkpoint(root)}.lock`;
    writeFileSync(lock, 'stale\n');
    const observed = lstatSync(lock);
    const competing = `${lock}.recovery`;
    writeFileSync(competing, 'claimed\n');

    const claim = claimStaleLock(lock, observed, Date.now());
    if (claim !== undefined) closeSync(claim.descriptor);
    expect(claim).toBeUndefined();
    expect(existsSync(competing)).toBe(true);
  });

  it('advances an equal-ctime chain without letting the later lexical path preempt', () => {
    const root = project();
    const lock = `${checkpoint(root)}.lock`;
    writeFileSync(lock, 'stale\n');
    const observed = lstatSync(lock);
    const recovery = `${lock}.recovery`;
    writeFileSync(recovery, 'abandoned\n');
    const recoveryInfo = lstatSync(recovery);
    const laterLexicalPath = `${lock}.recovery-1-${String(recoveryInfo.dev)}-${String(recoveryInfo.ino)}`;
    linkSync(recovery, laterLexicalPath);
    expect(lstatSync(laterLexicalPath).ctimeMs).toBe(lstatSync(recovery).ctimeMs);

    const claim = claimStaleLock(lock, observed, Date.now() + 2_000);

    expect(claim).toBeDefined();
    if (claim === undefined) return;
    closeSync(claim.descriptor);
    unlinkSync(lock);
    expect(existsSync(recovery)).toBe(false);
    expect(existsSync(laterLexicalPath)).toBe(false);
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

  it.each(['void-machine', 'void-harness'])(
    'rejects reserved %s mechanical delimiters in observed file names',
    (namespace) => {
      const root = project();
      writeFileSync(checkpoint(root), '## Objective\n\nKeep markers authoritative.\n');
      executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'claude', 1_000);

      executeContextContinuity({
        hook_event_name: 'PostToolUse',
        tool_name: 'Read',
        tool_input: {
          file_path: `src/<!-- ${namespace}:context-continuity:begin -->.ts`,
        },
        tool_response: { success: true },
      }, root, 'claude', 2_000);

      const written = readFileSync(checkpoint(root), 'utf8');
      expect(mechanicalState(root).status).toBe('valid');
      expect(written.match(/<!-- void-machine:context-continuity:begin -->/g)).toHaveLength(1);
      expect(written).not.toContain('void-harness:');
    },
  );

  it('takes over a block a 3.x install wrote under the former name, in place', () => {
    const root = project();
    writeFileSync(checkpoint(root), '## Objective\n\nSurvive the rename.\n');
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'claude', 1_000);
    const former = readFileSync(checkpoint(root), 'utf8').replaceAll('void-machine:', 'void-harness:');
    writeFileSync(checkpoint(root), `${former}\n## Notes\n\nWritten by hand.\n`);

    executeContextContinuity({
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: { file_path: 'src/index.ts' },
      tool_response: { success: true },
    }, root, 'claude', 2_000);

    const written = readFileSync(checkpoint(root), 'utf8');
    expect(mechanicalState(root).status).toBe('valid');
    expect(written).not.toContain('void-harness:');
    expect(written.match(/void-machine:context-continuity:begin/g)).toHaveLength(1);
    expect(written).toContain('Survive the rename.');
    expect(written).toContain('## Notes\n\nWritten by hand.');
    expect(written).toContain('- src/index.ts');
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

    executeContextContinuity({
      hook_event_name: 'SessionStart',
      source: 'clear',
    }, root, 'codex', 4_000);
    const clearedAgain = mechanicalState(root);
    expect(clearedAgain.status).toBe('valid');
    if (clearedAgain.status !== 'valid') return;
    expect(clearedAgain.state.clearPending).toBe(true);
    expect(clearedAgain.state.semanticRevision).toBeLessThan(clearedAgain.state.workRevision);
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

  it('rearms a nudge after successive compact cycles with the same source', () => {
    const root = project({ context: { windowTokens: 1_000 } });
    writeFileSync(checkpoint(root), '## Objective\n\nRepeat compact cycles.\n');
    writeFileSync(transcript(root), `${usageLine(500)}\n`);
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'claude', 1_000);
    executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: transcript(root),
    }, root, 'claude', 2_000);
    executeContextContinuity({
      hook_event_name: 'SessionStart',
      source: 'compact',
    }, root, 'claude', 3_000);
    appendFileSync(transcript(root), `${usageLine(700)}\n`);
    const secondNudge = executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: transcript(root),
    }, root, 'claude', 9_000);
    expect(secondNudge.output?.hookSpecificOutput.additionalContext).toMatch(/void-checkpoint/i);

    executeContextContinuity({
      hook_event_name: 'SessionStart',
      source: 'compact',
    }, root, 'claude', 10_000);
    const rearmed = mechanicalState(root);
    expect(rearmed.status).toBe('valid');
    if (rearmed.status !== 'valid') return;
    expect(rearmed.state.nudgeEmitted).toBe(false);
  });

  // A watchdog that cannot watch says so, once. Silence is reserved for a
  // mechanism that DID its job and found nothing — otherwise "quiet" and "broken"
  // are the same observation, and the quiet one wins by default.
  //
  // Measured on 2026-08-30: this session ran to 73% of its window with
  // `nudge_emitted: false`, because no `windowTokens` was ever configured. The
  // hook recorded every measurement faithfully and never mentioned that it could
  // not act on any of them.
  it('says once that it cannot watch, rather than staying quiet forever', () => {
    const root = project();
    writeFileSync(checkpoint(root), '## Objective\n\nUnknown window.\n');
    writeFileSync(transcript(root), `${usageLine(900)}\n`);
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'codex', 1_000);

    const first = executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: transcript(root),
    }, root, 'codex', 2_000);

    const said = JSON.stringify(first.output ?? {});
    expect(said).toContain('windowTokens');
    expect(said.toLowerCase()).toMatch(/cannot|not watching|unknown/);

    // Once. A warning repeated every turn is a warning nobody reads.
    const second = executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: transcript(root),
    }, root, 'codex', 3_000);
    expect(JSON.stringify(second.output ?? {})).not.toContain('windowTokens');
  });

  // The message says "set `windowTokens` to enable the reminder", so setting it
  // must enable the reminder. Folding the admission into `nudgeEmitted` made that
  // sentence false: the latch it consumed is the one the threshold check reads,
  // and it only re-arms on clear or compact -- the very event the reminder exists
  // to precede. Two claims, two latches.
  it('enables the reminder when the window it asked for is configured', () => {
    const root = project();
    writeFileSync(checkpoint(root), '## Objective\n\nWindow arrives mid-session.\n');
    writeFileSync(transcript(root), `${usageLine(300)}\n`);
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'codex', 1_000);
    const admitted = executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: transcript(root),
    }, root, 'codex', 2_000);
    expect(JSON.stringify(admitted.output ?? {})).toContain('windowTokens');

    writeFileSync(
      join(root, '.void', 'config.json'),
      `${JSON.stringify({ context: { windowTokens: 1_000 } })}\n`,
    );
    appendFileSync(transcript(root), `${usageLine(900)}\n`);
    const nudged = executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: transcript(root),
    }, root, 'codex', 3_000);

    expect(nudged.output?.hookSpecificOutput.additionalContext).toMatch(/void-checkpoint/i);
    const parsed = mechanicalState(root);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid') return;
    expect(parsed.state.nudgeEmitted).toBe(true);
    expect(parsed.state.unwatchableNotified).toBe(true);
  });

  /**
   * The other way the watchdog goes silent, and the one nobody had a message for.
   *
   * `thresholdConfig` normalizes a `checkpointThresholdPercent` outside 40-60 to
   * 0, and the threshold check then refuses 0 — so a project that wrote 70
   * disarmed its own reminder permanently, and got the same `false` as a project
   * sitting at 10% of window. Worse than the window case: a window is absent and
   * can be noticed as absent, while this number is right there in the config and
   * looks configured.
   *
   * The two admissions must not be interchangeable. Telling this project to set
   * `windowTokens` sends it looking for a misconfiguration it does not have,
   * which is the detour #193 already charged an operator for.
   */
  it('admits a threshold it cannot apply, and names the threshold not the window', () => {
    const root = project();
    writeFileSync(checkpoint(root), '## Objective\n\nThreshold out of range.\n');
    writeFileSync(
      join(root, '.void', 'config.json'),
      `${JSON.stringify({ context: { windowTokens: 1_000, checkpointThresholdPercent: 70 } })}\n`,
    );
    writeFileSync(transcript(root), `${usageLine(730)}\n`);
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'codex', 1_000);

    const result = executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: transcript(root),
    }, root, 'codex', 2_000);

    const said = result.output?.hookSpecificOutput.additionalContext ?? '';
    expect(said).toContain('checkpointThresholdPercent');
    expect(said).toMatch(/40|60/);
    expect(said).not.toContain('windowTokens');
  });

  it('falls silent after admitting the threshold once', () => {
    const root = project();
    writeFileSync(checkpoint(root), '## Objective\n\nSaid once.\n');
    writeFileSync(
      join(root, '.void', 'config.json'),
      `${JSON.stringify({ context: { windowTokens: 1_000, checkpointThresholdPercent: 70 } })}\n`,
    );
    writeFileSync(transcript(root), `${usageLine(730)}\n`);
    executeContextContinuity({ hook_event_name: 'PreCompact' }, root, 'codex', 1_000);
    executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: transcript(root),
    }, root, 'codex', 2_000);

    appendFileSync(transcript(root), `${usageLine(800)}\n`);
    const again = executeContextContinuity({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: transcript(root),
    }, root, 'codex', 3_000);

    expect(again.output).toBe(undefined);
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

    // No percentage and no threshold reminder — neither is computable. The hook
    // does say it cannot watch (asserted above); what it must never do is invent
    // a number or claim a threshold was reached.
    expect(JSON.stringify(result.output ?? {})).not.toMatch(/reached the configured/);
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
    // The config was refused, so the window is unknown and no threshold can be
    // claimed. But refusing it must not cost the watch in silence: a project whose
    // config is rejected for safety is exactly the one that needs to be told.
    expect(JSON.stringify(symlinked.output ?? {})).not.toMatch(/reached the configured/);
    expect(JSON.stringify(symlinked.output ?? {})).toContain('windowTokens');

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
