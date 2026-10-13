import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('native orchestration executable contract', () => {
  it('ships bounded launch, identity, continuity and proof instructions', () => {
    const text = readFileSync(new URL('../../packages/core/skills/void-orchestrate/SKILL.md', import.meta.url), 'utf8');
    expect(text.split('\n').length).toBeLessThanOrEqual(400);
    for (const token of ['label + worktree', '--no-daemon', '--add-dir', 'report.md', 'attempt',
      'orchestra-selection.json', '4096', 'strict\nJSON', 'never falls back',
      'resume_argv', '0.9.2', 'reviewedCommit', 'baseCommit', 'acceptanceCriteriaHash', 'atomic']) {
      expect(text).toContain(token);
    }
    expect(text).not.toContain('agents dispatch');
    expect(readFileSync(new URL('../../packages/core/skills/void-orchestrate/.source', import.meta.url), 'utf8')).toContain('https://');
  });

  it('separates portable delegation choices from the optional Herdr adapter', () => {
    const text = readFileSync(new URL('../../packages/core/skills/void-orchestrate/SKILL.md', import.meta.url), 'utf8');
    const portable = text.split('## Herdr adapter: recovery')[0];
    for (const rule of ['tiny targeted change', 'independent research', 'already assigned the unit',
      'No native agent capability', 'mandatory independent review', 'serialize',
      'saved work', 'live session', 'retained result', 'delivered result']) {
      expect(portable).toContain(rule);
    }
    expect(portable).not.toContain('herdr pane list');
    expect(portable).not.toContain('~/.local/state/orchestra');
    expect(portable).toContain('do not invent specialist events');
    expect(portable).toContain('completion events');
    expect(portable).toContain('observed available runtime slots');
    const selection = portable.replace(/\s+/g, ' ');
    expect(selection).toContain('not discretionary inside a validated Herdr session');
    expect(selection).toContain('use its adapter below for durable terminal workers and mission visibility');
    expect(selection).toContain('Short agents remain native');
    expect(selection).toContain('never duplicate an agent to give it a pane');
    expect(selection).toContain('capabilities and ownership can be verified');
    expect(selection).toContain('adds no tmux transport');
    expect(selection).toContain('Without supported presentation, retain native delegation');
    expect(selection).toContain('Failed or ambiguous host discovery blocks the affected host action');
    expect(selection).not.toContain('only when available and useful');
  });

  it.each(['void-brainstorm', 'void-plan', 'void-implement', 'void-autopilot', 'void-context'])(
    '%s composes the single delegation policy', (skill) => {
      const text = readFileSync(new URL(`../../packages/core/skills/${skill}/SKILL.md`, import.meta.url), 'utf8');
      expect(text).toContain('void-orchestrate');
      expect(text).not.toContain('superpowers:dispatching-parallel-agents');
      expect(text).not.toContain('superpowers:subagent-driven-development');
    },
  );

  it('delegates substantial implementation once while preserving the canonical writer', () => {
    const text = readFileSync(new URL('../../packages/core/skills/void-implement/SKILL.md', import.meta.url), 'utf8');
    expect(text).toContain('already assigned the unit');
    expect(text).toContain('never delegate this complete workflow again');
    expect(text).toContain('leadWriterId');
    expect(text).toContain('panel.provider: orchestrator');
  });

});
