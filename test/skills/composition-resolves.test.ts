import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(new URL(path, new URL('../../', import.meta.url)), 'utf8');
}

const IMPLEMENT = read('packages/core/skills/void-implement/SKILL.md');
/** Every `harness:<name>` still written in a body, which no local install resolves. */
function prefixedReferences(body: string): string[] {
  return [...new Set([...body.matchAll(/(?<!void-)\bharness:([a-z0-9]+(?:-[a-z0-9]+)*)/g)].map((m) => m[1] ?? ''))].sort();
}

describe('implement reaches what it composes', () => {
  it('cites no name carrying the plugin prefix, which a local install cannot resolve', () => {
    expect(prefixedReferences(IMPLEMENT)).toEqual([]);
  });

  it('dispatches the canonical plan instead of naming a fixed specialist trio or missing workflow', () => {
    const orchestration = IMPLEMENT.slice(
      IMPLEMENT.indexOf('## Canonical team orchestration'),
      IMPLEMENT.indexOf('## When to invoke'),
    );

    expect(orchestration).toContain('mission dispatch');
    expect(orchestration).toContain('mission specialist-event');
    expect(orchestration).not.toContain('workflows/implement.workflow.yaml');
    expect(orchestration).not.toMatch(/solution-architect.*security-engineer.*test-qa-engineer/s);
  });
});
