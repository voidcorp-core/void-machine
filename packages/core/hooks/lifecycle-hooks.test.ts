import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface CommandHook {
  readonly matcher?: string;
  readonly hooks: readonly { readonly command: string }[];
}

interface HookManifest {
  readonly hooks: Readonly<Record<string, readonly CommandHook[]>>;
}

function manifest(path: string): HookManifest {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as HookManifest;
}

function commands(source: HookManifest, event: string): readonly string[] {
  return (source.hooks[event] ?? []).flatMap((entry) => entry.hooks.map((hook) => hook.command));
}

describe.each([
  ['Claude Code', 'packages/core/.claude-plugin/plugin.json'],
  ['Codex', 'packages/core/codex/hooks.json'],
])('%s lifecycle hooks', (_runtime, path) => {
  const source = manifest(path);

  it('replays resume context for every documented SessionStart source', () => {
    expect(source.hooks.SessionStart?.[0]?.matcher).toBe('startup|resume|clear|compact');
    expect(commands(source, 'SessionStart').join('\n')).toContain('lifecycle context-continuity');
  });

  it('seals mechanical state before compaction through the shared handler', () => {
    expect(commands(source, 'PreCompact').join('\n')).toContain('lifecycle context-continuity');
  });

  it('reminds explicit closes at UserPromptSubmit without replacing the prompt', () => {
    expect(commands(source, 'UserPromptSubmit').join('\n')).toContain('lifecycle checkpoint-reminder');
  });

  it('audits at SessionEnd instead of synthesising a checkpoint', () => {
    const command = commands(source, 'SessionEnd').join('\n');
    expect(command).toContain('lifecycle checkpoint-audit');
    expect(command).not.toMatch(/write|generate|llm/i);
  });
});
