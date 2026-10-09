import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('native orchestration executable contract', () => {
  it('ships bounded launch, identity, continuity and proof instructions', () => {
    const text = readFileSync(new URL('../../packages/core/skills/void-orchestrate/SKILL.md', import.meta.url), 'utf8');
    expect(text.split('\n').length).toBeLessThanOrEqual(400);
    for (const token of ['label + worktree', '--no-daemon', '--add-dir', 'report.md', 'attempt',
      'resume_argv', '0.9.2', 'reviewedCommit', 'baseCommit', 'acceptanceCriteriaHash', 'atomic']) {
      expect(text).toContain(token);
    }
    expect(text).not.toContain('agents dispatch');
    expect(readFileSync(new URL('../../packages/core/skills/void-orchestrate/.source', import.meta.url), 'utf8')).toContain('https://');
  });
});
