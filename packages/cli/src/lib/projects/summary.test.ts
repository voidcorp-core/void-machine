import { describe, expect, it } from 'vitest';
import { summarizeProject, type SummaryInput } from './summary.js';

/**
 * The projects view answers ONE question: where should I put my attention?
 *
 * So there is no health score. A percentage invites optimising the number;
 * what earns a place is a named reason a human can act on. Severity orders the
 * list, nothing aggregates it.
 */

const NOW = Date.parse('2026-08-17T12:00:00Z');

function input(over: Partial<SummaryInput> = {}): SummaryInput {
  return {
    ref: { name: 'alpha', path: '/p/alpha' },
    now: NOW,
    git: {
      available: true,
      branch: 'main',
      dirtyFiles: 0,
      unpushedCommits: 0,
      lastCommitAt: Date.parse('2026-08-17T09:00:00Z'),
      commitsToday: 3,
    },
    decisions: { format: 'per-file', count: 12, recent: [], liveMonolithEntries: 0 },
    planCount: 0,
    ...over,
  };
}

describe('summarizeProject', () => {
  it('carries the signals through without inventing any', () => {
    const summary = summarizeProject(input());

    expect(summary.name).toBe('alpha');
    expect(summary.branch).toBe('main');
    expect(summary.commitsToday).toBe(3);
    expect(summary.decisions.count).toBe(12);
  });

  it('reports a clean, current project as needing no attention', () => {
    expect(summarizeProject(input()).attention).toEqual([]);
  });

  it('flags uncommitted work', () => {
    const summary = summarizeProject(input({
      git: { ...input().git, dirtyFiles: 4 },
    }));

    expect(summary.attention.map((a) => a.reason)).toContain('uncommitted-changes');
    expect(summary.attention[0]?.detail).toContain('4');
  });

  it('flags commits that never left the machine', () => {
    const summary = summarizeProject(input({
      git: { ...input().git, unpushedCommits: 7 },
    }));

    expect(summary.attention.map((a) => a.reason)).toContain('unpushed-commits');
  });

  // Format drift is NOT attention, and the real park proved why: 5 of 8 projects
  // carry it, so counting it flagged 8 projects out of 8 and the view stopped
  // answering its one question. Attention is for what can be LOST; drift costs
  // nothing today and is repaired when convenient.
  it('reports a live monolith as conformance drift, not as attention', () => {
    const summary = summarizeProject(input({
      decisions: { format: 'live-monolith', count: 134, recent: [], liveMonolithEntries: 134 },
    }));

    expect(summary.attention).toEqual([]);
    expect(summary.conformance.map((item) => item.reason)).toContain('decisions-drift');
  });

  it('orders attention by severity, uncommitted work first', () => {
    const summary = summarizeProject(input({
      git: { ...input().git, dirtyFiles: 2, unpushedCommits: 5 },
      decisions: { format: 'live-monolith', count: 80, recent: [], liveMonolithEntries: 80 },
    }));

    expect(summary.attention.map((a) => a.reason)).toEqual([
      'uncommitted-changes',
      'unpushed-commits',
    ]);
    expect(summary.conformance).toHaveLength(1);
  });

  it('describes the age of the last activity in whole days', () => {
    const summary = summarizeProject(input({
      git: { ...input().git, lastCommitAt: Date.parse('2026-08-14T09:00:00Z'), commitsToday: 0 },
    }));

    expect(summary.idleDays).toBe(3);
  });

  it('reports zero idle days for a project touched today', () => {
    expect(summarizeProject(input()).idleDays).toBe(0);
  });

  // Not every directory carrying the marker is a git repository, and the view
  // must degrade rather than disappear.
  it('summarizes a project with no git at all', () => {
    const summary = summarizeProject(input({
      git: {
        available: false,
        branch: undefined,
        dirtyFiles: 0,
        unpushedCommits: 0,
        lastCommitAt: undefined,
        commitsToday: 0,
      },
    }));

    expect(summary.branch).toBeUndefined();
    expect(summary.idleDays).toBeUndefined();
    expect(summary.attention).toEqual([]);
  });

  it('surfaces the program when the project declares one', () => {
    const summary = summarizeProject(input({
      program: { program: 'knowledge-and-resume', provider: 'linear', unitCount: 11 },
    }));

    expect(summary.program?.program).toBe('knowledge-and-resume');
  });

  // Phase 1 ships before the session checkpoint exists. Its absence is a fact
  // to display, never an error, and never a reason to demand attention: most
  // projects will not have one on day one.
  it('reports a missing checkpoint without demanding attention for it', () => {
    // Absent rather than explicitly undefined: `exactOptionalPropertyTypes` makes
    // "the key is missing" and "the key holds undefined" different types, and the
    // real caller omits the key.
    const summary = summarizeProject(input());

    expect(summary.resumeLine).toBeUndefined();
    expect(summary.attention.map((a) => a.reason)).not.toContain('no-checkpoint');
  });

  it('surfaces the checkpoint resume line when one exists', () => {
    const summary = summarizeProject(input({
      checkpoint: { resumeLine: 'Evaluator integration remains', writtenAt: NOW - 840_000 },
    }));

    expect(summary.resumeLine).toBe('Evaluator integration remains');
  });

  it('never lets a future timestamp produce negative idle days', () => {
    const summary = summarizeProject(input({
      git: { ...input().git, lastCommitAt: NOW + 86_400_000 },
    }));

    expect(summary.idleDays).toBe(0);
  });
});
