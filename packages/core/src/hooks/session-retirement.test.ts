// @test-resource subprocess
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adapterFor } from '../../../cli/src/lib/runtime-adapters.js';

type Entry = { matcher?: string; hooks: { type: string; command: string }[] };
const retired = ['format', 'trim', 'typecheck', 'large-change', 'context-continuity',
  'checkpoint-reminder', 'checkpoint-audit'];

describe.each(['claude', 'codex'] as const)('%s manual session continuity', runtime => {
  it.each(['fresh', 'update'])('keeps resume injection and user hooks without automatic tracking after %s', async mode => {
    const root = mkdtempSync(join(tmpdir(), 'session-retirement-'));
    const settings = join(root, runtime === 'claude' ? '.claude/settings.json' : '.codex/hooks.json');
    const user = { hooks: [{ type: 'command', command: 'user-session-hook' }] };
    const checkpoint = '## Objective\n\nFinish the requested change.\n\n## Next action\n\nRun the focused tests.\n';
    try {
      mkdirSync(dirname(settings), { recursive: true });
      if (mode === 'update') writeFileSync(settings, JSON.stringify({ hooks: { SessionStart: [
        ...(runtime === 'claude' ? [user] : []),
        ...retired.map(name => ({ hooks: [{ type: 'command',
          command: `node "$CLAUDE_PROJECT_DIR/.void/hooks/_void-hook.mjs" lifecycle ${name} ${runtime}` }] })),
      ] } }));
      mkdirSync(join(root, '.void/machine'), { recursive: true });
      writeFileSync(join(root, '.void/machine/checkpoint.md'), checkpoint);
      await adapterFor(runtime).wire({ stageRoot: root, installRoot: root,
        sourceRoot: resolve('packages/cli/dist/core-assets'), enabledPlugins: ['harness'], enabledPacks: [],
        source: 'local', marketplaceRepo: 'test/harness', pinVersion: '0.0.0' });
      const manifest: { hooks: Record<string, Entry[]> } = JSON.parse(readFileSync(settings, 'utf8'));
      const commands = Object.values(manifest.hooks).flatMap(entries => entries.flatMap(entry => entry.hooks.map(hook => hook.command)));
      for (const name of retired) expect(commands.join('\n')).not.toMatch(new RegExp(`lifecycle ${name}(?: |$)`));
      if (runtime === 'claude' && mode === 'update') expect(manifest.hooks['SessionStart']).toContainEqual(user);
      const resume = manifest.hooks['SessionStart']?.flatMap(entry => entry.hooks)
        .find(hook => hook.command.includes('lifecycle context '));
      expect(resume).toBeDefined();
      for (const source of ['startup', 'resume', 'clear', 'compact']) {
        const result = spawnSync('/bin/sh', ['-c', resume?.command ?? ''], {
          cwd: root, encoding: 'utf8', timeout: 5000,
          input: JSON.stringify({ hook_event_name: 'SessionStart', source }),
          env: { ...process.env, CLAUDE_PROJECT_DIR: root, VOID_PROJECT_ROOT: root, HERDR_ENV: '' },
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Finish the requested change.');
        expect(result.stdout).not.toMatch(/mechanical context|Reconstruct context before any mutation/);
      }
      expect(readFileSync(join(root, '.void/machine/checkpoint.md'), 'utf8')).toBe(checkpoint);
      expect(readdirSync(join(root, '.void/machine')).filter(name => name.startsWith('checkpoint'))).toEqual(['checkpoint.md']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
