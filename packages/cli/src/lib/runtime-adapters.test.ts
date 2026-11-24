import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveProjectRoots } from './project-roots.js';
import {
  ADAPTERS,
  adapterFor,
  adaptersFor,
  detectedAdapters,
  specialistCapabilityFor,
  type RuntimeWireContext,
} from './runtime-adapters.js';

const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'core', 'dist');

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'void-adapters-'));
}

function ctxFor(projectRoot: string, pinVersion: string | undefined = '0.17.0'): RuntimeWireContext {
  return {
    stageRoot: projectRoot,
    installRoot: projectRoot,
    sourceRoot: CORE_ROOT,
    enabledPlugins: ['harness'],
    enabledPacks: [],
    source: 'local',
    // A fork, deliberately: what this field still exists for is that add,
    // remove, check and update never silently re-pin someone's fork or private
    // mirror onto the default repo. Naming the retired catalog here described a
    // repository that no longer exists.
    marketplaceRepo: 'acme/void-machine-fork',
    pinVersion,
  };
}

describe('registry lookup', () => {
  it('has one adapter per known runtime, in canonical order', () => {
    expect(ADAPTERS.map((a) => a.id)).toEqual(['claude', 'codex']);
  });

  it('adapterFor resolves by id and throws on an unknown runtime', () => {
    expect(adapterFor('codex').label).toBe('Codex');
    // @ts-expect-error — exercising the runtime guard with an invalid id
    expect(() => adapterFor('hermes')).toThrow(/no adapter/);
  });

  it('adaptersFor filters to the selected set in registry order', () => {
    expect(adaptersFor(['codex', 'claude']).map((a) => a.id)).toEqual(['claude', 'codex']);
    expect(adaptersFor(['codex']).map((a) => a.id)).toEqual(['codex']);
  });
});

describe('detection', () => {
  it('detectedAdapters returns only the runtimes with a footprint', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'AGENTS.md'), '# x');
    expect(detectedAdapters(dir).map((a) => a.id)).toEqual(['codex']);
  });
});

describe('codex adapter', () => {
  it('wire stages the floor and writes AGENTS.md but NOT CLAUDE.md (doc is per-runtime)', async () => {
    const dir = scratch();
    const outcome = await adapterFor('codex').wire(ctxFor(dir));
    expect(existsSync(join(dir, '.codex', 'hooks.json'))).toBe(true);
    expect(existsSync(join(dir, '.codex', 'agents', 'solution-architect.toml'))).toBe(true);
    expect(existsSync(join(dir, '.codex', 'agents', 'experience-designer.toml'))).toBe(true);
    expect(existsSync(join(dir, '.codex', 'agents', 'visual-craft-director.toml'))).toBe(true);
    expect(existsSync(join(dir, '.agents', 'skills', 'doctrine-critic', 'SKILL.md'))).toBe(false);
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false);
    expect(outcome.nextSteps.join(' ')).toContain('.codex/ layer');
    expect(outcome.nextSteps.join(' ')).not.toContain('restart Claude');
  });

  it('has no extra prerequisites', () => {
    expect(adapterFor('codex').prerequisites('repo')).toEqual([]);
  });

  it('doctorChecks flags a healthy floor green and a missing AGENTS block red', async () => {
    const dir = scratch();
    await adapterFor('codex').wire(ctxFor(dir));
    const checks = await adapterFor('codex').doctorChecks(dir);
    expect(checks.find((c) => c.name === 'codex floor')?.ok).toBe(true);
    expect(checks.find((c) => c.name === 'codex agents')?.status).toBe('advisory');
    expect(checks.find((c) => c.name === 'codex agents')?.message).toMatch(/team degraded/i);
    expect(checks.find((c) => c.name === 'AGENTS.md')?.ok).toBe(true);
  });

  it('proves installed, wired and fired by executing the installed hook', async () => {
    const dir = scratch();
    await adapterFor('codex').wire(ctxFor(dir));

    const inspection = await adapterFor('codex').inspect(dir);

    expect(inspection.evidence, JSON.stringify(inspection, null, 2)).toMatchObject({
      installed: true,
      wired: true,
      fired: true,
      observed: false,
    });
    expect(inspection.specialistCapability).toMatchObject({
      status: 'degraded',
      limitations: expect.arrayContaining([expect.stringContaining('parent runtime overrides')]),
    });
    expect(inspection.checks.find((check) => check.name === 'codex hook smoke')?.ok).toBe(true);
    await expect(specialistCapabilityFor(dir, 'codex')).resolves.toMatchObject({
      status: 'degraded',
    });
  });

  it('keeps a Node runner live when its executable bit is absent', async () => {
    const dir = scratch();
    await adapterFor('codex').wire(ctxFor(dir));
    chmodSync(join(dir, '.void', 'hooks', '_void-hook.mjs'), 0o644);

    const inspection = await adapterFor('codex').inspect(dir);

    expect(inspection.evidence.installed).toBe(true);
    expect(inspection.evidence.wired).toBe(true);
    expect(inspection.evidence.fired).toBe(true);
  });

  it('does not call a manifest alone an installed runtime', async () => {
    const dir = scratch();
    writeFileSync(join(dir, 'AGENTS.md'), '# AGENTS.md\n<!-- void-harness:begin -->\n<!-- void-harness:end -->\n');
    const codexDir = join(dir, '.codex');
    const voidHooks = join(dir, '.void', 'hooks');
    mkdirSync(codexDir, { recursive: true });
    mkdirSync(voidHooks, { recursive: true });
    writeFileSync(join(codexDir, 'hooks.json'), JSON.stringify({ hooks: {} }));

    const inspection = await adapterFor('codex').inspect(dir);

    expect(inspection.evidence.installed).toBe(false);
    expect(inspection.evidence.wired).toBe(false);
    expect(inspection.evidence.fired).toBe(false);
  });
});

describe('claude adapter', () => {
  it('materializes local skills, agents and hooks without a marketplace account', async () => {
    const dir = scratch();
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(
      join(dir, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'user-hook' }] }] } }),
    );
    const outcome = await adapterFor('claude').wire(ctxFor(dir));
    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(true);
    expect(existsSync(join(dir, '.claude', 'skills', 'void-tdd', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude', 'agents', 'doctrine-critic.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude', 'agents', 'security-engineer.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude', 'agents', 'experience-designer.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude', 'agents', 'visual-craft-director.md'))).toBe(true);
    expect(existsSync(join(dir, '.void', 'hooks', '_void-hook.mjs'))).toBe(true);
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain('@AGENTS.md');
    expect(adapterFor('codex').detect(dir)).toBe(false);
    const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8')) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> };
      extraKnownMarketplaces?: unknown;
    };
    expect(settings.hooks.Stop.some((entry) => entry.hooks.some((hook) => hook.command === 'user-hook'))).toBe(true);
    expect(JSON.stringify(settings.hooks)).toContain('$CLAUDE_PROJECT_DIR/.void/hooks/');
    expect(settings.extraKnownMarketplaces).toBeUndefined();
    expect(outcome.nextSteps.join(' ')).toContain('restart Claude Code');
    const checks = await adapterFor('claude').doctorChecks(dir);
    // No advisory: the compiled specialists list an explicit `tools` allowlist,
    // and the official documentation says that shape reaches no MCP tool. The
    // degradation this used to report never existed.
    expect(checks.find((c) => c.name === 'claude agents')?.status).toBeUndefined();
    expect(checks.find((c) => c.name === 'claude agents')?.message).toMatch(/isolated by their tools allowlist/i);
    await expect(specialistCapabilityFor(dir, 'claude')).resolves.toMatchObject({
      status: 'available',
    });
  });

  it('reports a stale Claude specialist contract version as unhealthy', async () => {
    const dir = scratch();
    await adapterFor('claude').wire(ctxFor(dir));
    const security = join(dir, '.claude', 'agents', 'security-engineer.md');
    writeFileSync(
      security,
      readFileSync(security, 'utf8').replace(
        'Canonical contract: `core:security-engineer` v2.',
        'Canonical contract: `core:security-engineer` v1.',
      ),
    );

    const checks = await adapterFor('claude').doctorChecks(dir);
    expect(checks.find((check) => check.name === 'claude agents')).toMatchObject({
      ok: false,
      message: expect.stringContaining('security-engineer (installed v1, this CLI carries v2)'),
    });
    // The capability is what `mission dispatch` stops on: the repair travels with it.
    const capability = await specialistCapabilityFor(dir, 'claude');
    expect(capability.limitations.join(' ')).toContain('`void-machine runtime add claude`');
  });

  it('keeps the marketplace behind an explicit adapter mode', async () => {
    const dir = scratch();
    const marketplace = { ...ctxFor(dir), source: 'marketplace' as const, pinVersion: undefined };
    const outcome = await adapterFor('claude').wire(marketplace);
    const settings = readFileSync(join(dir, '.claude', 'settings.json'), 'utf8');
    expect(settings).toContain('extraKnownMarketplaces');
    expect(existsSync(join(dir, '.claude', 'skills', 'void-tdd', 'SKILL.md'))).toBe(false);
    expect(outcome.nextSteps.some((s) => s.startsWith('FAILED:') && s.includes('core version could not be resolved'))).toBe(true);
  });

  it('has no account, gh or jq prerequisite in local mode', () => {
    expect(adapterFor('claude').prerequisites('repo', 'local')).toEqual([]);
  });

  it('doctor rejects a Claude import whose common instruction owner is missing', async () => {
    const dir = scratch();
    await adapterFor('claude').wire(ctxFor(dir));
    const { unlinkSync } = await import('node:fs');
    unlinkSync(join(dir, 'AGENTS.md'));
    const checks = await adapterFor('claude').doctorChecks(dir);
    expect(checks.find((check) => check.name === 'CLAUDE.md')?.ok).toBe(false);
  });

  it('doctorChecks reds a missing settings.json', async () => {
    const dir = scratch();
    const checks = await adapterFor('claude').doctorChecks(dir);
    expect(checks.find((c) => c.name === 'settings.json')?.ok).toBe(false);
  });

  it('proves a local Claude install by executing its staged hook', async () => {
    const dir = scratch();
    await adapterFor('claude').wire(ctxFor(dir));

    const inspection = await adapterFor('claude').inspect(dir);

    expect(inspection.evidence, JSON.stringify(inspection, null, 2)).toMatchObject({
      installed: true,
      wired: true,
      fired: true,
      observed: false,
    });
    // Available, and the MCP claim is gone. Other limitations are unrelated and
    // stay: what this pins is that no limitation is declared about inherited MCP
    // tools, because the allowlist already denies them.
    expect(inspection.specialistCapability.status).toBe('available');
    expect(inspection.specialistCapability.limitations.join(' ')).not.toMatch(/MCP/i);
  });


});

describe('specialists from a linked worktree', () => {
  function git(cwd: string, ...args: string[]): void {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  }

  // The install lives in the main checkout and is hidden from git on purpose
  // (`.git/info/exclude`), so `git worktree add` carries none of it. Measured
  // on 2026-09-02: a worker asked for its panel from its worktree and was told
  // no specialist was installed. The panel is the same one, read from the
  // installation root the worktree belongs to.
  it('reads the same specialists from a worktree as from the main checkout', async () => {
    const main = scratch();
    git(main, 'init', '--quiet');
    await adapterFor('claude').wire(ctxFor(main));
    writeFileSync(join(main, 'README.md'), '# fixture\n');
    git(main, 'add', 'README.md');
    git(
      main,
      '-c', 'user.name=Void Test',
      '-c', 'user.email=void@example.test',
      'commit', '--quiet', '-m', 'test: seed',
    );
    const linked = join(scratch(), 'DEV-000');
    git(main, 'worktree', 'add', '--quiet', linked, '-b', 'worker/DEV-000');
    expect(existsSync(join(linked, '.claude', 'agents'))).toBe(false);
    // No plugin cache to fall back on: the answer must come from the install.
    const noCache = { claudeCacheRoot: join(scratch(), 'absent') };

    const fromMain = await specialistCapabilityFor(main, 'claude', noCache);
    const fromWorktree = await specialistCapabilityFor(
      resolveProjectRoots(linked).installRoot,
      'claude',
      noCache,
    );

    expect(fromMain.status).toBe('available');
    expect(fromWorktree).toEqual(fromMain);
    // And the defect, kept as the reason this resolution exists: the worktree
    // path alone holds no panel.
    await expect(specialistCapabilityFor(linked, 'claude', noCache)).resolves.toMatchObject({
      status: 'unavailable',
    });
  });
});

describe('runtime add is frictionless (a-posteriori wire touches only the added runtime)', () => {
  it('adding codex to a wired-claude project leaves the Claude layer intact', async () => {
    const dir = scratch();
    await adapterFor('claude').wire(ctxFor(dir));
    const settingsBefore = readFileSync(join(dir, '.claude', 'settings.json'), 'utf8');

    await adapterFor('codex').wire(ctxFor(dir));

    // Codex now wired...
    expect(existsSync(join(dir, '.codex', 'hooks.json'))).toBe(true);
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
    // ...and the Claude layer is byte-for-byte untouched.
    expect(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8')).toBe(settingsBefore);
  });
});
