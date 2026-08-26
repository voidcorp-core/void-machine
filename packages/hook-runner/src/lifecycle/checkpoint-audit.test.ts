import { describe, expect, it } from 'vitest';
import { auditCheckpoint } from './checkpoint-audit.js';

const NOW = Date.parse('2026-08-26T12:00:00Z');

describe('auditCheckpoint', () => {
  it('reports a current checkpoint without claiming this session wrote it', () => {
    const result = auditCheckpoint({
      now: NOW,
      checkpoint: { branch: 'main', head: 'abc123', isEmpty: false },
      checkpointWrittenAt: NOW - 60_000,
      git: { branch: 'main', head: 'abc123' },
    });

    expect(result).toEqual({ status: 'ok', reasons: [] });
    expect(JSON.stringify(result)).not.toContain('written this session');
  });

  it.each([
    ['missing', { checkpoint: undefined }, 'checkpoint-absent'],
    ['empty', { checkpoint: { isEmpty: true } }, 'checkpoint-empty'],
    [
      'stale',
      { checkpoint: { isEmpty: false }, checkpointWrittenAt: NOW - 8 * 86_400_000 },
      'checkpoint-stale',
    ],
    [
      'other branch',
      { checkpoint: { branch: 'old', isEmpty: false }, git: { branch: 'main' } },
      'checkpoint-branch-moved',
    ],
    [
      'other head',
      { checkpoint: { head: 'old', isEmpty: false }, git: { head: 'new' } },
      'checkpoint-head-moved',
    ],
  ])('reports a %s checkpoint as advisory evidence', (_label, partial, reason) => {
    const result = auditCheckpoint({
      now: NOW,
      checkpoint: { branch: 'main', head: 'abc123', isEmpty: false },
      checkpointWrittenAt: NOW,
      git: { branch: 'main', head: 'abc123' },
      ...partial,
    });
    expect(result.status).toBe('degraded');
    expect(result.reasons).toContain(reason);
  });
});
