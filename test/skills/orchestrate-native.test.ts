import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('native orchestration executable contract', () => {
  it('ships bounded launch, identity, continuity and proof instructions', () => {
    const text = readFileSync(new URL('../../packages/core/skills/void-orchestrate/SKILL.md', import.meta.url), 'utf8');
    expect(text.split('\n').length).toBeLessThanOrEqual(400);
    for (const token of ['verified absolute `worktree`', 'attachCommand', 'unknown',
      'worker.dispatched', 'worker.state', 'worker.finished', 'observationId',
      'reviewedCommit', 'baseCommit', 'acceptanceCriteriaHash', 'Publish the initial running state']) {
      expect(text).toContain(token);
    }
    expect(text).not.toContain('agents dispatch');
    expect(readFileSync(new URL('../../packages/core/skills/void-orchestrate/.source', import.meta.url), 'utf8')).toContain('https://');
  });

  it('keeps delegation independent of presentation without weakening its guarantees', () => {
    const text = readFileSync(new URL('../../packages/core/skills/void-orchestrate/SKILL.md', import.meta.url), 'utf8');
    const portable = text;
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
    expect(selection).toContain('external plugins own windows, tabs and panes');
    expect(selection).toContain('Never discover or call a multiplexer to delegate');
    expect(selection).toContain('never duplicate an agent to make it visible');
    expect(selection).toContain('An absent display cannot change execution permissions');
    expect(selection).toContain('A publication error is visible');
    expect(selection).toContain('never authorizes another launch');
    expect(selection).toContain('Partial coverage is explicit and exits nonzero');
    expect(selection).not.toContain('herdr agent start');
    expect(selection).not.toContain('herdr pane list');
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
