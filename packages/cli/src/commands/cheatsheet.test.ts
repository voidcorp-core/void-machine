// @test-resource subprocess
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMAND_CATALOG } from '../lib/command-catalog.js';

const cli = resolve(__dirname, '../../bin/void-machine.mjs');
function run(args: string[]) {
  const cwd = mkdtempSync(join(tmpdir(), 'cheatsheet-'));
  const result = spawnSync(process.execPath, [cli, 'cheatsheet', ...args], {
    cwd, encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024,
  });
  expect(readdirSync(cwd)).toEqual([]);
  expect(result.stdout).not.toContain(cwd);
  expect(result.stderr).not.toContain(cwd);
  return result;
}

describe('cheatsheet CLI', () => {
  it('defaults to standalone HTML and supports explicit Markdown', () => {
    const html = run([]);
    expect(html.status).toBe(0);
    expect(html.stdout).toMatch(/^<!doctype html>/);
    expect(html.stderr).toBe('');
    const markdown = run(['--format', 'markdown']);
    expect(markdown.status).toBe(0);
    expect(markdown.stdout).toMatch(/^# void-machine cheat sheet/);
    expect(markdown.stderr).toBe('');
  });
  it('exports the full catalogue without installing or writing anything', () => {
    const result = run(['--format', 'json']);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const document = JSON.parse(result.stdout);
    expect(document.schemaVersion).toBe(1);
    expect(document.installation).toBe('absent');
    for (const type of ['skill', 'hook', 'agent', 'specialist', 'command']) {
      expect(document.entries.some((entry: { type: string }) => entry.type === type)).toBe(true);
    }
    expect(document.entries).toContainEqual(expect.objectContaining({ id: 'command:cheatsheet' }));
    const core = resolve(__dirname, '../../../core');
    const model = JSON.parse(readFileSync(join(core, 'data/model.json'), 'utf8'));
    const graphEntries = model.nodes.filter((entry: { type: string }) => ['skill', 'hook', 'agent'].includes(entry.type));
    const specialistIds = readdirSync(join(core, 'specialists')).filter(name => name.endsWith('.yaml'))
      .map(name => /^id: (.+)$/m.exec(readFileSync(join(core, 'specialists', name), 'utf8'))?.[1]);
    const expectedIds = [...graphEntries.map((entry: { id: string }) => entry.id), ...specialistIds,
      ...Object.keys(COMMAND_CATALOG).map(name => `command:${name}`)].sort();
    expect(document.entries.map((entry: { id: string }) => entry.id)).toEqual(expectedIds);
    for (const source of graphEntries) {
      expect(document.entries.find((entry: { id: string }) => entry.id === source.id).description).toBe(source.description);
    }
    for (const id of specialistIds) {
      const specialist = document.entries.find((entry: { id: string }) => entry.id === id);
      const agentId = `agent:${specialist.name}`;
      expect(specialist.relatedIds).toEqual([agentId]);
      expect(document.entries.find((entry: { id: string }) => entry.id === agentId).relatedIds).toEqual([id]);
      expect(specialist.invocations).not.toHaveLength(0);
    }
    // That HTML and Markdown carry every identity of the catalogue, in order, is
    // the renderer's projection: proven in process by lib/cheatsheet/render.test.ts,
    // and from the installed archive in every format by test/cli/cheatsheet.test.ts.
  });

  it.each([['--format'], ['--format', 'xml'], ['json'], ['--wat'], ['--format', 'json', '--format', 'json']])(
    'refuses invalid arguments without a partial document: %j', (...args) => {
      const result = run(args);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('Usage:');
    },
  );
});
