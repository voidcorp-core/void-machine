import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { harnessBlock, hasHarnessBlock, patchClaudeMd, patchAgentsMd, patchExistingRuntimeDocs } from './claude-md.js';

const input = { enabledPlugins: ['harness'], enabledPacks: [] as never[] };

describe('harnessBlock', () => {
  it.each(['claude', 'codex'] as const)(
    'includes bounded local follow-through in merge consent for %s',
    (runtime) => {
      const block = harnessBlock(input, runtime);
      expect(block).toContain('An authorized merge includes routine local synchronization');
      expect(block).toContain('without asking for confirmation again');
      expect(block).toContain('clean local target branch');
      expect(block).toContain('verified merged commit');
      expect(block).toContain('git merge --ff-only');
      expect(block).toContain('local changes, divergence, or an unexpected remote tip');
      expect(block).toContain('Runtime sandbox and approval controls still apply');
    },
  );

  it('routes native short agents and durable workers without interception', () => {
    for (const runtime of ['claude', 'codex'] as const) {
      const block = harnessBlock(input, runtime);
      expect(block).toContain('void-orchestrate');
      expect(block).toContain('native');
      expect(block).not.toContain('refuses the native call');
      expect(block).not.toContain('agents dispatch');
    }
  });

  it('uses @imports for the Claude runtime', () => {
    const block = harnessBlock(input, 'claude');
    expect(block).toContain('@.void/installed/PHILOSOPHY.md');
    expect(block).toContain('Claude Code doctrine active');
  });

  it('uses read-at-start file pointers (no @import) for the Codex runtime', () => {
    const block = harnessBlock(input, 'codex');
    expect(block).not.toContain('@.void/installed/PHILOSOPHY.md');
    expect(block).toContain('`.void/installed/PHILOSOPHY.md`');
    expect(block).toContain('Codex doctrine active');
    expect(block).toContain('read at the start');
  });

  it.each(['claude', 'codex'] as const)('installs the provider-agnostic program bootstrap for %s', (runtime) => {
    const block = harnessBlock(input, runtime);
    const runner = '`void-implement`';
    expect(block).toContain('`.void/program.md`');
    expect(block).toContain('`status: executing`');
    expect(block).toContain('declared progress provider owns mutable execution state');
    expect(block).toContain(runner);
    expect(block).toContain('competing claims');
    expect(block).toContain('do not infer remote progress');
    expect(block).toContain('current or next unit');
    expect(block).toContain('checkpoint');
    // Consent is never inferred from silence: without an enabled autopilot
    // block, no autonomous selection may happen at all.
    expect(block).toContain('autopilot');
    expect(block).toContain('enabled: false');
  });

  /**
   * A skill name is only prefixed under a marketplace plugin install. Getting
   * this from the runtime rather than from the channel is what put `harness:tdd`
   * into every locally installed skill, where it resolves to nothing.
   */
  it.each(['claude', 'codex'] as const)('names skills bare on a local install (%s)', (runtime) => {
    const block = harnessBlock({ ...input, channel: 'local' }, runtime);
    expect(block).toContain('`void-implement`');
    expect(block).not.toMatch(/(?<!void-)\bharness:[a-z]/);
  });

  it('keeps the plugin prefix on a marketplace install of Claude Code', () => {
    const block = harnessBlock({ ...input, channel: 'marketplace' }, 'claude');
    expect(block).toContain('`harness:void-implement`');
  });

  it('never prefixes for Codex, which has no marketplace at all', () => {
    const block = harnessBlock({ ...input, channel: 'marketplace' }, 'codex');
    expect(block).toContain('`void-implement`');
    expect(block).not.toMatch(/(?<!void-)\bharness:[a-z]/);
  });

  it.each(['claude', 'codex'] as const)('states how a named skill is invoked (%s)', (runtime) => {
    // Skills name each other by their own name; the invocation syntax differs
    // per runtime, so the doc that knows the runtime is the one that says it.
    const block = harnessBlock(input, runtime);
    expect(block).toMatch(/invoke|invocation/i);
    expect(block).toContain('by its name');
  });
});

describe('patchClaudeMd / patchAgentsMd', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'void-cmd-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates CLAUDE.md and AGENTS.md when absent', async () => {
    expect(await patchClaudeMd(dir, input)).toBe('created');
    expect(await patchAgentsMd(dir, input)).toBe('created');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain('# CLAUDE.md');
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain('# AGENTS.md');
  });

  it('is idempotent on a second run (unchanged)', async () => {
    await patchAgentsMd(dir, input);
    expect(await patchAgentsMd(dir, input)).toBe('unchanged');
  });

  it('patches an existing AGENTS.md without clobbering user content', async () => {
    writeFileSync(join(dir, 'AGENTS.md'), '# AGENTS.md\n\n## My rules\nkeep me\n');
    expect(await patchAgentsMd(dir, input)).toBe('patched');
    const out = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    expect(out).toContain('keep me');
    expect(out).toContain('Void Machine (managed by `void-machine init`)');
  });

  // Every project installed by 3.x carries the block under the former name. The update after the
  // rename must replace it where it stands; appending a second block would leave the old one,
  // never refreshed again, telling the agent to run a deprecated command forever.
  it.each(['CLAUDE.md', 'AGENTS.md'] as const)('takes over the 3.x block of %s in place', async (file) => {
    const legacy = [
      `# ${file}`, '', 'Before.', '',
      '<!-- void-harness:begin -->', '', '## void-harness (managed by `void-harness init`)', '',
      'Run `void-harness doctor` to verify the install.', '', '<!-- void-harness:end -->', '',
      '## My rules', 'keep me', '',
    ].join('\n');
    writeFileSync(join(dir, file), legacy);
    const patch = file === 'CLAUDE.md' ? patchClaudeMd : patchAgentsMd;
    expect(await patch(dir, input)).toBe('updated');
    const out = readFileSync(join(dir, file), 'utf8');
    expect(out).not.toContain('void-harness');
    expect(out.match(/<!-- void-machine:begin -->/g)).toHaveLength(1);
    expect(out.indexOf('Before.')).toBeLessThan(out.indexOf('<!-- void-machine:begin -->'));
    expect(out.indexOf('<!-- void-machine:end -->')).toBeLessThan(out.indexOf('## My rules\nkeep me'));
    expect(await patch(dir, input)).toBe('unchanged');
  });
});

describe('hasHarnessBlock', () => {
  it('recognizes the block under the current and the former name', () => {
    expect(hasHarnessBlock('<!-- void-machine:begin -->\nx\n<!-- void-machine:end -->')).toBe(true);
    expect(hasHarnessBlock('<!-- void-harness:begin -->\nx\n<!-- void-harness:end -->')).toBe(true);
    expect(hasHarnessBlock('# nothing here')).toBe(false);
  });
});

describe('patchExistingRuntimeDocs (per-runtime, add/remove)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'void-existing-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('refreshes only the docs that exist and never resurrects the absent one', async () => {
    // A Codex-only project: AGENTS.md present, CLAUDE.md absent.
    await patchAgentsMd(dir, input);
    const patched = await patchExistingRuntimeDocs(dir, input);
    expect(patched).toEqual(['codex']);
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false); // not resurrected
  });

  it('refreshes both when both exist', async () => {
    await patchClaudeMd(dir, input);
    await patchAgentsMd(dir, input);
    expect(await patchExistingRuntimeDocs(dir, input)).toEqual(['claude', 'codex']);
  });

  it('is a no-op on a project with no doctrine docs', async () => {
    expect(await patchExistingRuntimeDocs(dir, input)).toEqual([]);
  });
});

// The block is read by the model at every session, in every consuming project.
// A line naming a marketplace is a fact about how the harness got there, and on
// the default path it did not: `npx <package> init` copies bundled assets and
// never contacts a marketplace. Stating it anyway teaches the model a channel
// that does not exist here, which is how a skill ends up invoked under a
// namespace that cannot resolve.
describe('the provenance line', () => {
  const inputs = { enabledPlugins: ['harness'], enabledPacks: [] } as const;

  it('names the marketplace only when the install came from it', () => {
    const block = harnessBlock({ ...inputs, channel: 'marketplace' }, 'claude');
    expect(block).toContain('Marketplace:');
  });

  it('says nothing about a marketplace on the default local install', () => {
    const block = harnessBlock({ ...inputs, channel: 'local' }, 'claude');
    expect(block).not.toContain('Marketplace:');
    expect(block).not.toContain('marketplace');
  });

  it('still announces the doctrine on the local install, which is the load-bearing half', () => {
    const block = harnessBlock({ ...inputs, channel: 'local' }, 'claude');
    expect(block).toContain('doctrine active in this project');
  });

  it('keeps the codex block free of a marketplace it never used either', () => {
    expect(harnessBlock({ ...inputs, channel: 'local' }, 'codex')).not.toContain('Marketplace:');
  });
});
