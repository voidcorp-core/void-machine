import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CODEX_AGENTS_DIR,
  compileAgentToToml,
  codexSpecialistsHealth,
  wireCodexAgents,
} from './codex-agents.js';
import { loadSpecialists } from './specialists/load.js';

const here = dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = resolve(here, '..', '..', '..', 'core', 'dist'); // the real agents source

const tmps: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmps.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const AGENT_MD = [
  '---',
  'name: doctrine-critic',
  'description: Judges a diff against doctrine. Read-only.',
  'tools: Read, Grep, Glob, Bash',
  'model: sonnet',
  'color: purple',
  '---',
  '',
  '# doctrine-critic',
  '',
  'You are the doctrine-critic.',
  '',
].join('\n');

/** A source tree shaped like packages/core, holding the given agent files. */
function fakeSource(agents: Record<string, string>): string {
  const root = tmp('void-codex-agentsrc-');
  mkdirSync(join(root, 'agents'), { recursive: true });
  for (const [file, body] of Object.entries(agents)) {
    writeFileSync(join(root, 'agents', file), body);
  }
  return root;
}

describe('compileAgentToToml', () => {
  it('keeps the name and description so Codex can discover it', () => {
    const out = compileAgentToToml(AGENT_MD);
    expect(out?.name).toBe('doctrine-critic');
    expect(out?.content).toMatch(/^name = "doctrine-critic"$/m);
    expect(out?.content).toMatch(/^description = "Judges a diff against doctrine\. Read-only\."$/m);
  });

  it('quotes the description, so a colon-carrying one stays valid YAML (#130)', () => {
    const md = AGENT_MD.replace(
      'description: Judges a diff against doctrine. Read-only.',
      'description: Judges what hooks miss: weak tests, over-abstraction.',
    );
    expect(compileAgentToToml(md)?.content).toMatch(
      /^description = "Judges what hooks miss: weak tests, over-abstraction\."$/m,
    );
  });

  it('uses the native read-only Codex agent sandbox', () => {
    expect(compileAgentToToml(AGENT_MD)?.content).toMatch(/^sandbox_mode = "read-only"$/m);
  });

  it('drops the Claude-only subagent keys while disabling network surfaces', () => {
    const content = compileAgentToToml(AGENT_MD)?.content ?? '';
    expect(content).not.toMatch(/^tools:/m);
    expect(content).not.toMatch(/^model:/m);
    expect(content).not.toMatch(/^color:/m);
    expect(content).toMatch(/^web_search = "disabled"$/m);
    expect(content).toMatch(/^mcp_servers = \{\}$/m);
  });

  it('preserves the agent body verbatim', () => {
    expect(compileAgentToToml(AGENT_MD)?.instructions).toContain('You are the doctrine-critic.');
  });

  it('states the compiled origin, so nobody hand-edits the generated copy', () => {
    expect(compileAgentToToml(AGENT_MD)?.instructions).toMatch(/compiled/i);
  });

  it('returns undefined when the file carries no usable frontmatter name', () => {
    expect(compileAgentToToml('no frontmatter at all')).toBeUndefined();
    expect(compileAgentToToml('---\ndescription: nameless\n---\nbody')).toBeUndefined();
  });
});

describe('wireCodexAgents', () => {
  it('stages one native TOML file per authored agent', async () => {
    const src = fakeSource({ 'doctrine-critic.md': AGENT_MD });
    const project = tmp('void-codex-agentproj-');
    const staged = await wireCodexAgents(project, src);
    expect(staged).toBe(1);
    expect(existsSync(join(project, CODEX_AGENTS_DIR, 'doctrine-critic.toml'))).toBe(true);
    expect(existsSync(join(project, '.agents', 'skills', 'doctrine-critic', 'SKILL.md'))).toBe(false);
  });

  it('ignores the .source sidecars that sit next to the agent definitions', async () => {
    const src = fakeSource({ 'doctrine-critic.md': AGENT_MD });
    writeFileSync(join(src, 'agents', 'doctrine-critic.source'), 'inspiration: x');
    expect(await wireCodexAgents(tmp('void-codex-agentproj-'), src)).toBe(1);
  });

  it('is idempotent — re-wiring overwrites in place rather than failing', async () => {
    const src = fakeSource({ 'doctrine-critic.md': AGENT_MD });
    const proj = tmp('void-codex-agentproj-');
    await wireCodexAgents(proj, src);
    await wireCodexAgents(proj, src);
    const toml = readFileSync(join(proj, CODEX_AGENTS_DIR, 'doctrine-critic.toml'), 'utf8');
    expect(toml.match(/^name = "doctrine-critic"$/gm)).toHaveLength(1);
  });

  it('returns 0 when the source tree ships no agents', async () => {
    expect(await wireCodexAgents(tmp('void-codex-agentproj-'), tmp('void-empty-'))).toBe(0);
  });

  // Integration against the REAL packages/core tree: the colon-carrying
  // descriptions live there, so a strict-YAML regression would stage nothing
  // while every synthetic fixture above still passed.
  it('compiles every authored agent plus every canonical specialist this repo ships', async () => {
    const proj = tmp('void-codex-agentproj-');
    const staged = await wireCodexAgents(proj, CORE_ROOT);
    expect(staged).toBe(21);
    const contracts = await loadSpecialists(CORE_ROOT);
    const specialistNames = contracts.map((contract) => contract.name);
    for (const name of [
      'doctrine-critic',
      'silent-failure-hunter',
      'type-design-analyzer',
      'code-explorer',
      'migration-planner',
      ...specialistNames,
    ]) {
      const toml = readFileSync(join(proj, CODEX_AGENTS_DIR, `${name}.toml`), 'utf8');
      expect(toml).toMatch(new RegExp(`^name = "${name}"$`, 'm'));
      expect(toml).toMatch(/^sandbox_mode = "read-only"$/m);
    }
  });

  it('rejects a discovered specialist that is stale or lost its safety floor', async () => {
    const project = tmp('void-codex-agenthealth-');
    await wireCodexAgents(project, CORE_ROOT);
    await expect(codexSpecialistsHealth(project, CORE_ROOT)).resolves.toMatchObject({ ok: true });

    const security = join(project, CODEX_AGENTS_DIR, 'security-engineer.toml');
    writeFileSync(
      security,
      readFileSync(security, 'utf8').replace(
        'Canonical contract: `core:security-engineer` v2.',
        'Canonical contract: `core:security-engineer` v1.',
      ),
    );
    await expect(codexSpecialistsHealth(project, CORE_ROOT)).resolves.toMatchObject({
      ok: false,
      detail: expect.stringContaining('security-engineer (installed v1, this CLI carries v2)'),
    });
    const older = await codexSpecialistsHealth(project, CORE_ROOT);
    expect(older.detail).toContain('reinstall them with this CLI: `void-machine runtime add codex`');

    writeFileSync(
      security,
      'name = "security-engineer"\nsandbox_mode = "read-only"\n',
    );
    await expect(codexSpecialistsHealth(project, CORE_ROOT)).resolves.toMatchObject({
      ok: false,
      detail: expect.stringContaining('security-engineer (invalid)'),
    });
    rmSync(security);
    await expect(codexSpecialistsHealth(project, CORE_ROOT)).resolves.toMatchObject({
      ok: false,
      detail: expect.stringContaining('security-engineer (missing)'),
    });
  });

  it('calls a file broken beyond its contract line invalid, not merely on another version', async () => {
    const project = tmp('void-codex-agenthealth-');
    await wireCodexAgents(project, CORE_ROOT);
    const security = join(project, CODEX_AGENTS_DIR, 'security-engineer.toml');
    const original = readFileSync(security, 'utf8');
    const line = 'Canonical contract: `core:security-engineer` v2.';
    writeFileSync(
      security,
      original.replace(line, 'Canonical contract: `core:security-engineer` v3.')
        .replace('sandbox_mode = "read-only"', 'sandbox_mode = "workspace-write"'),
    );
    await expect(codexSpecialistsHealth(project, CORE_ROOT)).resolves.toMatchObject({
      detail: expect.stringContaining('security-engineer (invalid)'),
    });
    writeFileSync(security, original.replace(line, `${line}\nCanonical contract: \`core:security-engineer\` v3.`));
    await expect(codexSpecialistsHealth(project, CORE_ROOT)).resolves.toMatchObject({
      ok: false,
      detail: expect.stringContaining('security-engineer (invalid)'),
    });
  });

  it('says the CLI is the stale side when the install carries a newer contract', async () => {
    // A project installed by a newer CLI release, then read by an older CLI:
    // reinstalling with the older CLI is one repair, upgrading the CLI the other.
    const project = tmp('void-codex-agenthealth-');
    await wireCodexAgents(project, CORE_ROOT);
    const security = join(project, CODEX_AGENTS_DIR, 'security-engineer.toml');
    writeFileSync(
      security,
      readFileSync(security, 'utf8').replace(
        'Canonical contract: `core:security-engineer` v2.',
        'Canonical contract: `core:security-engineer` v3.',
      ),
    );
    const health = await codexSpecialistsHealth(project, CORE_ROOT);
    expect(health.ok).toBe(false);
    expect(health.detail).toContain('security-engineer (installed v3, this CLI carries v2)');
    expect(health.detail).toContain('this CLI is older than the install');
    expect(health.detail).toContain('`void-machine runtime add codex`');
  });

  it('fails health when the canonical catalog is empty', async () => {
    await expect(codexSpecialistsHealth(
      tmp('void-codex-agenthealth-'),
      tmp('void-empty-specialist-catalog-'),
    )).resolves.toMatchObject({
      ok: false,
      detail: expect.stringContaining('catalog is empty'),
    });
  });
});
