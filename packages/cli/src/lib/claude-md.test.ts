import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { harnessBlock, hasHarnessBlock, patchClaudeMd, patchAgentsMd, patchExistingRuntimeDocs } from './claude-md.js';

const input = { enabledPlugins: ['harness'], enabledPacks: [] as never[] };

describe('harnessBlock', () => {
  it('keeps Claude as a native import of the common instruction owner', () => {
    expect(harnessBlock(input, 'claude')).toBe('<!-- void-machine:begin -->\n\n@AGENTS.md\n\n<!-- void-machine:end -->');
  });

  it('keeps doctrine, authorization and native invocation instructions in the common owner', () => {
    const common = harnessBlock(input, 'codex');
    expect(common).toContain('@.void/PHILOSOPHY.md');
    expect(common).toContain('@.void/PROJECT-DOCTRINE.md');
    expect(common).toContain('read at the start');
    expect(common).toContain('$void-implement');
    expect(common).toContain('/void-implement');
    expect(common).toContain('/harness:void-implement');
    expect(common).toContain('An authorized merge includes routine local synchronization');
    expect(common).toContain('git merge --ff-only');
    expect(common).toContain('Runtime sandbox and approval controls still apply');
    expect(common).toContain('Publish observed worker lifecycle events');
    expect(common).toContain('already delegated writer');
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

  it('refuses a linked common instruction file before a Claude patch can alter its target', async () => {
    writeFileSync(join(dir, 'user.md'), 'KEEP');
    symlinkSync(join(dir, 'user.md'), join(dir, 'AGENTS.md'));
    await expect(patchClaudeMd(dir, input)).rejects.toThrow('symbolic link');
    expect(readFileSync(join(dir, 'user.md'), 'utf8')).toBe('KEEP');
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false);
  });

  it('creates common instructions for Claude alone and keeps one doctrine after adding Codex', async () => {
    await patchClaudeMd(dir, input);
    const common = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    const claude = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('@AGENTS.md');
    expect(claude).not.toContain('### Doctrine');
    expect(common).toContain('.void/PHILOSOPHY.md');
    await patchAgentsMd(dir, input);
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(common);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(claude);
  });

  it('creates CLAUDE.md and AGENTS.md when absent', async () => {
    expect(await patchClaudeMd(dir, input)).toBe('created');
    expect(await patchAgentsMd(dir, input)).toBe('unchanged');
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
    const block = harnessBlock({ ...inputs, channel: 'marketplace' }, 'codex');
    expect(block).toContain('Marketplace:');
  });

  it('says nothing about a marketplace on the default local install', () => {
    const block = harnessBlock({ ...inputs, channel: 'local' }, 'codex');
    expect(block).not.toContain('Marketplace:');
  });

  it('still announces the doctrine on the local install, which is the load-bearing half', () => {
    const block = harnessBlock({ ...inputs, channel: 'local' }, 'codex');
    expect(block).toContain('doctrine active in this project');
  });

  it('keeps the codex block free of a marketplace it never used either', () => {
    expect(harnessBlock({ ...inputs, channel: 'local' }, 'codex')).not.toContain('Marketplace:');
  });
});
