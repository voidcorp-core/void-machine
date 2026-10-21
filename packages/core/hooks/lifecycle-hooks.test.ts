import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { adapterFor } from '../../cli/src/lib/runtime-adapters.js';
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

  it('projects verified orchestra metadata at each lifecycle boundary', () => {
    for (const event of ['SessionStart', 'Stop', 'SessionEnd']) {
      expect(commands(source, event).join('\n')).toContain('lifecycle herdr-metadata');
    }
  });

  it('seals mechanical state before compaction through the shared handler', () => {
    expect(commands(source, 'PreCompact').join('\n')).toContain('lifecycle context-continuity');
  });

  it('tracks the cumulative working set after tool use', () => {
    expect(commands(source, 'PostToolUse').join('\n')).toContain('lifecycle context-continuity');
  });

  it('reminds explicit closes at UserPromptSubmit without replacing the prompt', () => {
    const command = commands(source, 'UserPromptSubmit').join('\n');
    expect(command).toContain('lifecycle context-continuity');
    expect(command).toContain('lifecycle checkpoint-reminder');
  });

  it('audits at SessionEnd instead of synthesising a checkpoint', () => {
    const command = commands(source, 'SessionEnd').join('\n');
    expect(command).toContain('lifecycle checkpoint-audit');
    expect(command).not.toMatch(/write|generate|llm/i);
  });
});

describe('Claude Code delegation hooks', () => {
  it('records a delegated run\'s final message on Stop, beside the session telemetry', () => {
    const stop = commands(manifest('packages/core/.claude-plugin/plugin.json'), 'Stop').join('\n');
    expect(stop).toContain('lifecycle delegation-result claude');
    expect(stop).toContain('stop claude');
  });

  it('leaves short native Agent delegations unintercepted', () => {
    const capture = (manifest('packages/core/.claude-plugin/plugin.json').hooks.PreToolUse ?? [])
      .filter((entry) => entry.matcher === 'Agent').flatMap((entry) => entry.hooks.map((hook) => hook.command));
    expect(capture).toEqual([]);
  });
});

describe('distributed global Herdr guard', () => {
  it('keeps global relay out of both project manifests to avoid duplicate session publication', () => {
    for (const path of ['packages/core/codex/hooks.json', 'packages/core/.claude-plugin/plugin.json']) {
      expect(commands(manifest(path), 'SessionStart').join('\n')).not.toContain('herdr-session');
    }
  });

  it('ships the guarded byte-preserving native route without project telemetry', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'distributed-herdr-session-'));
    try {
      const bin = resolve(root, 'bin'); mkdirSync(bin);
      const codex = resolve(root, '.codex'); mkdirSync(codex);
      const capture = resolve(root, 'capture');
      writeFileSync(resolve(codex, 'herdr-agent-state.sh'), 'cat > "$RELAY_CAPTURE"\n');
      writeFileSync(resolve(bin, 'herdr'), `#!${process.execPath}\n`
        + 'process.stdout.write(JSON.stringify({result:{process_info:{pane_id:"w1:p1",'
        + 'foreground_processes:[{pid:process.ppid}]}}}));\n', { mode: 0o755 });
      const input = Buffer.from('{"hook_event_name":"SessionStart"}\n\n');
      const result = spawnSync(process.execPath, [resolve('packages/core/hooks/_void-hook.mjs'),
        'lifecycle', 'herdr-session', 'codex'], {
        cwd: root, input, timeout: 4000,
        env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root, HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1',
          HERDR_SOCKET_PATH: resolve(root, 'unused'), RELAY_CAPTURE: capture },
      });
      expect(result.status).toBe(0); expect(result.stderr.length).toBe(0);
      expect(existsSync(capture)).toBe(true);
      expect(readFileSync(capture)).toEqual(input);
      expect(existsSync(resolve(root, '.void'))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('distributed first-ticket host discovery', () => {
  it.each(['codex', 'claude'] as const)('emits host guidance from the installed %s SessionStart hook without central state', async runtime => {
    const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'distributed-herdr-bootstrap-')));
    const bin = resolve(root, 'bin'); mkdirSync(bin);
    const common = resolve(root, '.git'); mkdirSync(common);
    writeFileSync(resolve(bin, 'git'), `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(common)});\n`, { mode: 0o755 });
    writeFileSync(resolve(bin, 'herdr'), `#!${process.execPath}\n`
      + 'const args = process.argv.slice(2);\n'
      + 'const result = args[1] === "list" ? {panes:[{pane_id:"w1:p1",workspace_id:"w1",label:"ORCH",cwd:process.cwd()}]}'
      + ': args[1] === "process-info" ? {process_info:{pane_id:"w1:p1",foreground_processes:[{pid:process.ppid}]}} : undefined;\n'
      + 'if (!result) process.exit(1); process.stdout.write(JSON.stringify({result}));\n', { mode: 0o755 });
    await adapterFor(runtime).wire({ stageRoot: root, installRoot: root,
      sourceRoot: resolve('packages/cli/core-assets'), enabledPlugins: ['harness'], enabledPacks: [],
      source: 'local', marketplaceRepo: 'test/harness', pinVersion: '0.0.0' });
    const installedManifest = JSON.parse(readFileSync(resolve(root,
      runtime === 'codex' ? '.codex/hooks.json' : '.claude/settings.json'), 'utf8')) as HookManifest;
    const hook = commands(installedManifest, 'SessionStart').find(command => command.includes('herdr-metadata'));
    expect(hook).toBeDefined();
    const result = spawnSync('/bin/sh', ['-c', hook ?? 'exit 1'], {
      cwd: root, input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd: root }), timeout: 4000,
      env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: root, CLAUDE_PROJECT_DIR: root,
        HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HERDR_SOCKET_PATH: resolve(root, 'unused') },
    });
    expect(result.status).toBe(0);
    expect(result.stderr.toString()).toBe('');
    expect(result.stdout.toString()).toContain('void-orchestrate');
    expect(result.stdout.toString()).toContain('w1:p1');
    expect(existsSync(resolve(root, '.local/state/orchestra'))).toBe(false);
  });
});
