import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adapterFor } from '../../cli/src/lib/runtime-adapters.js';

interface HookEntry {
  readonly matcher?: string;
  readonly hooks: readonly { readonly type: string; readonly command: string }[];
}
interface Manifest { readonly hooks: { readonly PreToolUse: readonly HookEntry[] } }

function runHooks(root: string, manifest: Manifest, tool: string, input: object): string[] {
  return manifest.hooks.PreToolUse
    .filter(entry => entry.matcher === '*' || new RegExp(entry.matcher ?? '.*').test(tool))
    .flatMap(entry => entry.hooks)
    .filter(hook => hook.command !== 'user-owned-hook')
    .flatMap(hook => {
      const result = spawnSync('/bin/sh', ['-c', hook.command], {
        cwd: root, input: JSON.stringify({ tool_name: tool, tool_input: input }),
        encoding: 'utf8', timeout: 5000,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, VOID_PROJECT_ROOT: root },
      });
      expect(result.error).toBeUndefined();
      expect([0, 2]).toContain(result.status);
      return result.status === 2 || result.stdout.includes('"permissionDecision":"deny"')
        ? [result.stderr + result.stdout] : [];
    });
}

describe.each(['claude', 'codex'] as const)('%s installed style-gate retirement', runtime => {
  it.each(['fresh', 'update'])('allows descriptive names and brand typography after %s wiring', async mode => {
    const root = mkdtempSync(join(tmpdir(), 'style-retirement-'));
    const settings = join(root, runtime === 'claude' ? '.claude/settings.json' : '.codex/hooks.json');
    const userHook = { matcher: 'Write', hooks: [{ type: 'command', command: 'user-owned-hook' }] };
    try {
      mkdirSync(dirname(settings), { recursive: true });
      if (mode === 'update') {
        const hooks = ['test-name', 'design-slop'].map(rule => ({ matcher: 'Write', hooks: [{
          type: 'command',
          command: `node "$CLAUDE_PROJECT_DIR/.void/hooks/_void-hook.mjs" enforce ${rule} ${runtime}`,
        }] }));
        // wire compiles a stage; only Claude settings are co-owned.
        const existing = runtime === 'claude' ? [userHook, ...hooks] : hooks;
        writeFileSync(settings, JSON.stringify({ hooks: { PreToolUse: existing } }));
      }
      await adapterFor(runtime).wire({ stageRoot: root, installRoot: root,
        sourceRoot: resolve('packages/cli/core-assets'), enabledPlugins: ['harness'], enabledPacks: [],
        source: 'local', marketplaceRepo: 'test/harness', pinVersion: '0.0.0' });
      const manifest = JSON.parse(readFileSync(settings, 'utf8')) as Manifest;
      const testPath = join(root, 'src/token.test.ts');
      const name = 'should reject an expired token';
      const content = `test(${JSON.stringify(name)}, () => { expect(expired).toBe(true); });`;
      expect.soft(runHooks(root, manifest, 'Write', { file_path: testPath, content })).toEqual([]);
      expect.soft(runHooks(root, manifest, 'Write', { file_path: join(root, 'src/theme.css'),
        content: 'body { font-family: Inter, sans-serif; color: #111; background: #fff; }',
      })).toEqual([]);
      const commands = manifest.hooks.PreToolUse.flatMap(entry => entry.hooks.map(hook => hook.command));
      expect(commands.join('\n')).not.toMatch(/enforce (test-name|design-slop)\b/);
      if (runtime === 'claude' && mode === 'update') expect(manifest.hooks.PreToolUse).toContainEqual(userHook);

      for (const modifier of ['only', 'skip']) {
        const refused = runHooks(root, manifest, 'Write', { file_path: testPath,
          content: `test.${modifier}("rejects expired tokens", () => {});` });
        expect(refused.join('\n')).toMatch(/FOCUSED|SKIPPED/);
      }
      expect(runHooks(root, manifest, 'Bash', { command: 'git push --force' }).join('\n'))
        .toContain('DANGEROUS');
      expect(runHooks(root, manifest, 'Write', { file_path: join(root, 'notes.txt'),
        content: `token = "ghp_${'a'.repeat(36)}"`,
      }).join('\n')).toContain('SECRET');
      const unknown = spawnSync(process.execPath, [join(root, '.void/hooks/_void-hook.mjs'),
        'enforce', 'unrecognized-rule', runtime], { cwd: root, input: '{}', encoding: 'utf8', timeout: 5000 });
      expect(unknown.stderr + unknown.stdout).toContain('UNKNOWN_ENFORCEMENT_RULE');
      if (runtime === 'codex') expect(unknown.stdout).toContain('"permissionDecision":"deny"');
      else expect(unknown.status).toBe(2);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
