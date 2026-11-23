import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hookWiring, loadCatalog } from './load.js';

const manifest = (command: string) => [{ runtime: 'claude' as const, value: {
  hooks: { PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command }] }] },
} }];
describe('hook owner wiring discovery', () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: exact shipped shell interpolation fixture.
  const wired = manifest('node "${CLAUDE_PLUGIN_ROOT}/hooks/_void-hook.mjs" enforce secret-content claude');
  const call = 'exec "$NODE_BIN" "$HOOK_DIR/_void-hook.mjs" enforce secret-content "$RUNTIME"';
  it('derives events and matchers from the actual owner invocation', () => {
    expect(hookWiring('tdd-guard', call, wired)).toEqual([
      { name: 'tdd-guard', runtime: 'claude', trigger: 'PreToolUse (Edit|Write)' },
    ]);
    expect(hookWiring('another-hook', 'echo nothing', wired)).toEqual([]);
  });
  it('does not turn a comment or echoed command into an invocation', () => {
    expect(hookWiring('tdd-guard', `# ${call}`, wired)).toEqual([]);
    expect(hookWiring('tdd-guard', `echo '${call}'`, wired)).toEqual([]);
    expect(hookWiring('tdd-guard', call, manifest(`echo '${wired[0]?.value.hooks.PreToolUse[0]?.hooks[0]?.command}'`))).toEqual([]);
  });
});

describe('required shipped catalogue sources', () => {
  it('refuses a missing specialist directory instead of exporting a truncated catalogue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cheatsheet-missing-source-'));
    await mkdir(join(root, 'data'));
    await mkdir(join(root, '.claude-plugin'));
    await mkdir(join(root, 'codex'));
    await writeFile(join(root, 'data/model.json'), JSON.stringify({ version: 1, nodes: [], edges: [] }));
    for (const path of ['.claude-plugin/plugin.json', 'codex/hooks.json']) {
      await writeFile(join(root, path), JSON.stringify({ hooks: {} }));
    }
    await expect(loadCatalog(root)).rejects.toThrow();
  });
});
