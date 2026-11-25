/**
 * Tests for the core `doctrine-critic` agent (DEV-363, rescoped 3 -> 1).
 *
 * Per the official Claude Code plugin docs, agents are auto-discovered from the
 * plugin's `agents/` directory — there is NO agent-declaration field in
 * plugin.json. So "wiring" here means: the agent file exists with valid
 * read-only frontmatter, the core-assets mirror is byte-identical, and the
 * manifests/docs no longer advertise the three roadmap agents.
 *
 * Spec: plans/2026-06-01-doctrine-critic-agent.md
 * Decision: docs/DECISIONS.md "one doctrine-critic agent, not the three ...".
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const r = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');

const CORE_AGENT = 'packages/core/src/agents/doctrine-critic.md';
const MIRROR_AGENT = 'packages/cli/dist/core-assets/agents/doctrine-critic.md';
const DROPPED = ['senior-reviewer', 'security-reviewer', 'architect-critic'];

/** Parse a leading `--- ... ---` YAML-ish frontmatter block into key/value pairs. */
function frontmatter(md: string): Record<string, string> {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error('no frontmatter block');
  const out: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

describe('doctrine-critic agent', () => {
  const md = r(CORE_AGENT);
  const fm = frontmatter(md);

  it('declares the doctrine-critic name', () => {
    expect(fm.name).toBe('doctrine-critic');
  });

  it('has a description within the 250-char editorial target', () => {
    expect(fm.description.length).toBeGreaterThan(0);
    expect(fm.description.length).toBeLessThanOrEqual(250);
  });

  it('is read-only: tools exclude every mutating tool', () => {
    const tools = fm.tools.split(',').map((t) => t.trim());
    for (const writeTool of ['Edit', 'Write', 'NotebookEdit']) {
      expect(tools).not.toContain(writeTool);
    }
    for (const readTool of ['Read', 'Grep', 'Glob', 'Bash']) {
      expect(tools).toContain(readTool);
    }
  });

  it('routes (does not re-implement) security and bug review', () => {
    // Security routes to the vendored harness:security-audit skill (was gstack /cso
    // before the de-gstackification, epic DEV-383 / DEV-387).
    expect(md).toMatch(/void-security-audit/);
    expect(md).toMatch(/\/void-code-review/);
  });

  it('is mirrored byte-identically into core-assets', () => {
    expect(r(MIRROR_AGENT)).toBe(md);
  });
});

describe('manifests and docs no longer advertise the three roadmap agents', () => {
  // The marketplace catalog moved to voidcorp-core/void-plugins; only the
  // plugin manifests of this repo advertise agents now.
  const manifests = [
    'packages/core/src/.claude-plugin/plugin.json',
    'packages/cli/dist/core-assets/.claude-plugin/plugin.json',
  ];
  const docs = ['README.md', 'docs/ARCHITECTURE.md'];

  it('manifests drop the "roadmap" wording and the dropped agent names', () => {
    for (const f of manifests) {
      const text = r(f);
      expect(text.toLowerCase()).not.toContain('roadmap');
      for (const name of DROPPED) expect(text).not.toContain(name);
    }
  });

  it('manifests mention the shipped doctrine-critic agent', () => {
    for (const f of manifests) expect(r(f)).toContain('doctrine-critic');
  });

  it('docs trees replace "planned" agents with doctrine-critic', () => {
    for (const f of docs) {
      const text = r(f);
      for (const name of DROPPED) expect(text).not.toContain(name);
      expect(text).toContain('doctrine-critic');
    }
  });
});
