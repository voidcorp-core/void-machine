import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  compileClaudeHooks,
  wireClaudeLocalAssets,
} from './runtime-assets.js';

const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'core');
const CLAUDE_PLUGIN_ROOT = '$' + '{CLAUDE_PLUGIN_ROOT}';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'void-claude-assets-'));
}

describe('compileClaudeHooks', () => {
  it('rewrites plugin roots to the account-free project-local hook directory', () => {
    const hooks = compileClaudeHooks({
      PreToolUse: [{
        matcher: '*',
        hooks: [{
          type: 'command',
          command: `VOID_AGENT_RUNTIME=claude ${CLAUDE_PLUGIN_ROOT}/hooks/activation-meter.sh`,
        }],
      }],
    });

    expect(JSON.stringify(hooks)).toContain('$CLAUDE_PROJECT_DIR/.void/hooks/activation-meter.sh');
    expect(JSON.stringify(hooks)).not.toContain('CLAUDE_PLUGIN_ROOT');
  });

  it('compiles the native Node floor with one quoted path on every platform', () => {
    const hooks = compileClaudeHooks({
      PreToolUse: [{
        matcher: 'Edit|Write',
        hooks: [{
          type: 'command',
          command: `node "${CLAUDE_PLUGIN_ROOT}/hooks/_void-hook.mjs" enforce protected-file`,
        }],
      }],
    });

    expect(JSON.stringify(hooks)).toContain(
      'node \\"$CLAUDE_PROJECT_DIR/.void/hooks/_void-hook.mjs\\" enforce protected-file',
    );
    expect(JSON.stringify(hooks)).not.toContain('node \\"\\"');
  });
});

describe('wireClaudeLocalAssets', () => {
  it('stages native Claude surfaces from the bundled source only', async () => {
    const root = scratch();

    const result = await wireClaudeLocalAssets(root, CORE_ROOT, []);

    expect(result.skills).toBeGreaterThan(20);
    expect(result.agents).toBe(21);
    expect(existsSync(join(root, '.claude/skills/void-tdd/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.claude/agents/doctrine-critic.md'))).toBe(true);
    expect(existsSync(join(root, '.claude/agents/solution-architect.md'))).toBe(true);
    expect(existsSync(join(root, '.claude/agents/experience-designer.md'))).toBe(true);
    expect(existsSync(join(root, '.claude/agents/visual-craft-director.md'))).toBe(true);
    // void-doctor is a skill now, and no `.claude/commands/` is written at all:
    // the command format is Claude-only, and this harness targets three runtimes.
    expect(existsSync(join(root, '.claude/skills/void-doctor/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.claude/commands'))).toBe(false);
    expect(existsSync(join(root, '.void/hooks/_void-hook.mjs'))).toBe(true);
    expect(existsSync(join(root, '.void/hooks/_hooklib.sh'))).toBe(false);
    expect(result.hooks).toBe(2);
    // The installed skill carries only the spec's fields; `runtimes` is harness
    // metadata and stays in the source tree with `.source`.
    const installed = readFileSync(join(root, '.claude/skills/void-tdd/SKILL.md'), 'utf8');
    expect(installed).toContain('name: void-tdd');
    expect(installed).not.toContain('runtimes:');
    expect(existsSync(join(root, '.claude/skills/void-tdd/harness.yaml'))).toBe(false);
  });

  it('treats Windows CRLF in a generated agent as the same canonical doctrine', async () => {
    const fixture = scratch();
    const source = join(fixture, 'core');
    cpSync(CORE_ROOT, source, { recursive: true });
    const generated = join(source, 'agents', 'security-engineer.md');
    writeFileSync(generated, readFileSync(generated, 'utf8').replaceAll('\n', '\r\n'));

    const project = scratch();
    await expect(wireClaudeLocalAssets(project, source, [])).resolves.toMatchObject({ agents: 21 });
    expect(readFileSync(join(project, '.claude', 'agents', 'security-engineer.md'), 'utf8')).not.toContain('\r\n');
  });
});


describe('compiled shell-write protection', () => {
  for (const [runtime, tool] of [['claude', 'Bash'], ['codex', 'Bash'], ['codex', 'shell']] as const) {
    for (const [destination, blocked] of [['pnpm-lock.yaml', true], ['.env.production', true], ['notes.txt', false]] as const) {
      it(`${runtime}/${tool} ${blocked ? 'refuses' : 'allows'} the recognized shell destination ${destination}`, () => {
        const manifestPath = runtime === 'claude'
          ? join(CORE_ROOT, '.claude-plugin/plugin.json')
          : join(CORE_ROOT, 'codex/hooks.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        const hooks = runtime === 'claude' ? compileClaudeHooks(manifest.hooks) : manifest.hooks;
        const commands: string[] = hooks.PreToolUse
          .filter((entry: { matcher: string }) => entry.matcher === '*' || new RegExp(`^(?:${entry.matcher})$`).test(tool))
          .flatMap((entry: { hooks: { command: string }[] }) => entry.hooks.map((hook) => hook.command))
          .filter((command: string) => command.includes('enforce protected-file'));
        expect(commands).toHaveLength(1);
        // Execute the selected manifest command, not a second hand-authored route.
        const command = commands[0]?.replace('$CLAUDE_PROJECT_DIR/.void/hooks', join(CORE_ROOT, 'hooks'))
          .replace('$' + '{VOID_HOOKS_DIR}', join(CORE_ROOT, 'hooks'));
        const parsed = /^node "([^"]+)" (.+)$/.exec(command ?? '');
        expect(parsed).not.toBeNull();
        const result = spawnSync(process.execPath, [parsed?.[1] ?? '', ...(parsed?.[2] ?? '').split(' ')], {
          input: JSON.stringify({ tool_name: tool, tool_input: { command: `printf harmless > ${destination}` } }),
          encoding: 'utf8',
        });
        if (runtime === 'claude') expect(result.status).toBe(blocked ? 2 : 0);
        else {
          expect(result.status).toBe(0);
          expect(result.stdout.includes('"permissionDecision":"deny"')).toBe(blocked);
        }
      });
    }
  }
});
