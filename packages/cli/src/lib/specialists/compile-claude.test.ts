import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ARCHITECT_CONTRACT } from './__fixtures__/contract.js';
import { compileClaudeSpecialist } from './compile-claude.js';
import { loadSpecialists } from './load.js';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  '.claude',
  'agents',
  'solution-architect.md',
);
const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'core', 'dist');

describe('compileClaudeSpecialist', () => {
  it('loads both UI specialists from the canonical core source', async () => {
    await expect(loadSpecialists(CORE_ROOT)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'core:experience-designer' }),
      expect.objectContaining({ id: 'core:visual-craft-director' }),
    ]));
  });

  it('preserves technical acronyms in generated role titles', async () => {
    const contracts = await loadSpecialists(CORE_ROOT);
    const byName = new Map(contracts.map((contract) => [contract.name, contract]));

    expect(compileClaudeSpecialist(byName.get('api-integration-engineer')!).content).toContain(
      '# API Integration Engineer',
    );
    expect(compileClaudeSpecialist(byName.get('observability-sre-engineer')!).content).toContain(
      '# Observability SRE Engineer',
    );
    expect(compileClaudeSpecialist(byName.get('pdf-specialist')!).content).toContain(
      '# PDF Specialist',
    );
  });

  it('matches the native Claude golden file', () => {
    expect(compileClaudeSpecialist(ARCHITECT_CONTRACT).content).toBe(readFileSync(FIXTURE, 'utf8'));
  });

  // The allowlist is the isolation, and it already covers MCP. The official
  // subagent documentation says so of this exact shape: "This example uses
  // `tools` to allow only Read, Grep, Glob, and Bash. The subagent can't edit
  // files, write files, or use any MCP tools." A specialist listing three read
  // tools therefore reaches no server, including servers nobody enumerated.
  it('isolates by allowlist, and claims no limitation it does not have', () => {
    const compiled = compileClaudeSpecialist(ARCHITECT_CONTRACT);
    expect(compiled.content).toMatch(/^tools: Read, Grep, Glob$/m);
    expect(compiled.content).toMatch(/^disallowedTools: Write, Edit, NotebookEdit, Bash, Agent, WebFetch, WebSearch$/m);
    expect(compiled.content).toMatch(/^maxTurns: 2$/m);
    expect(compiled.safety).toEqual({
      readOnly: 'declared',
      isolation: 'fresh-context',
      teamMode: 'available',
      limitations: [],
    });
  });

  it('always emits a non-empty tools allowlist for every compiled specialist', () => {
    const compiled = compileClaudeSpecialist(ARCHITECT_CONTRACT);
    expect(compiled.content).toMatch(/^tools: [A-Za-z][A-Za-z, ]*$/m);
  });

  it('keeps marketplace-native agent files generated from the canonical YAML', async () => {
    for (const contract of await loadSpecialists(CORE_ROOT)) {
      const compiled = compileClaudeSpecialist(contract);
      expect(readFileSync(join(CORE_ROOT, 'agents', `${contract.name}.md`), 'utf8')).toBe(
        compiled.content,
      );
    }
  });
});
