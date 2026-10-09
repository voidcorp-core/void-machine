import { livenessVerdict } from '@voidcorp/hook-runner';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { judgeInvocation, observeInvocation } from './invocation-health.js';

// `doctor` is where the verdicts get their detail: the banner has room for one
// name list, this has room for the evidence behind it. The ratio of activations
// to tool calls is shown here and judged nowhere -- four observed values across
// the whole corpus define no normal.
const ALIVE = { ok: true, missions: 3, toolCalls: 1312, skillCalls: 8, unobservable: [] } as const;
const RESOLVES = { ok: true, unresolved: [], retired: [] } as const;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('judgeInvocation', () => {
  it('names the successor of a retired skill instead of sending the reader to reinstall', () => {
    // The remedy printed here has to be one that works. A renamed skill is not a
    // missing file, and `update` will never bring the old name back.
    const check = judgeInvocation({
      resolution: { ok: false, unresolved: ['session-handoff', 'ticket-runner'], retired: ['session-handoff', 'ticket-runner'] },
      liveness: ALIVE,
      installedSkills: 41,
    });

    expect(check.message).toContain('session-handoff -> void-checkpoint');
    expect(check.message).toContain('ticket-runner -> void-implement');
  });


  it('passes with the evidence, so a green line still says what was measured', () => {
    const check = judgeInvocation({ resolution: RESOLVES, liveness: ALIVE, installedSkills: 37 });
    expect(check.ok).toBe(true);
    expect(check.message).toContain('37');
    expect(check.message).toContain('1312');
  });

  it('shows the activation ratio as context, and never fails on it', () => {
    const thin = { ok: true, missions: 3, toolCalls: 1000, skillCalls: 1, unobservable: [] } as const;
    const check = judgeInvocation({ resolution: RESOLVES, liveness: thin, installedSkills: 37 });
    expect(check.ok).toBe(true);
    expect(check.message).toMatch(/0\.1\s?%/);
  });

  it('fails naming every skill that no longer resolves, not just the first', () => {
    const check = judgeInvocation({
      resolution: { ok: false, unresolved: ['brainstorming', 'ticket-writer'], retired: ['brainstorming', 'ticket-writer'] },
      liveness: ALIVE,
      installedSkills: 37,
    });
    expect(check.ok).toBe(false);
    expect(check.message).toContain('brainstorming');
    expect(check.message).toContain('ticket-writer');
    expect(check.fix).toBeDefined();
  });

  it('fails on a silence, with the work that proves the missions were not idle', () => {
    const check = judgeInvocation({
      resolution: RESOLVES,
      liveness: { ok: false, missions: 3, toolCalls: 1464, skillCalls: 0, unobservable: [] },
      installedSkills: 37,
    });
    expect(check.ok).toBe(false);
    expect(check.message).toContain('1464');
  });

  it('reports both failures at once rather than hiding the second behind the first', () => {
    const check = judgeInvocation({
      resolution: { ok: false, unresolved: ['ticket-writer'], retired: ['ticket-writer'] },
      liveness: { ok: false, missions: 3, toolCalls: 900, skillCalls: 0, unobservable: [] },
      installedSkills: 37,
    });
    expect(check.message).toContain('ticket-writer');
    expect(check.message).toContain('900');
  });

  it('stays honest about a project that has recorded nothing yet', () => {
    const check = judgeInvocation({
      resolution: RESOLVES,
      liveness: { ok: true, missions: 0, toolCalls: 0, skillCalls: 0, unobservable: [] },
      installedSkills: 37,
    });
    expect(check.ok).toBe(true);
    expect(check.message).toContain('no working mission');
  });
});

describe('observeInvocation', () => {
  it('reports collected Codex activity as unknown, never a passing zero', () => {
    const journal = Array.from({ length: 60 }, (_, call) => JSON.stringify({
      kind: 'runtime.tool.started', source: 'runtime:codex',
      missionId: `mis_${Math.floor(call / 20)}`, subject: 'tool:Bash',
      ts: '2026-10-09T08:00:00.000Z', payload: { category: 'tool', tool: 'Bash' },
    })).join('\n');
    const liveness = livenessVerdict(journal);
    const check = judgeInvocation({ resolution: RESOLVES, liveness, installedSkills: 37 });
    expect(check.status).toBe('unknown');
    expect(check.ok).toBe(false);
    expect(check.message).toContain('not observable');
    expect(check.message).toContain('runtime:codex');
    expect(check.message).toContain('60 tool calls');
    expect(check.message).not.toContain('0 activation');
    expect(check.message).not.toContain('no skill fired');
    expect(check.fix).toBeUndefined();
    // An unknown measurement must never hide a separate, observed fault.
    const retired = judgeInvocation({
      resolution: { ok: false, unresolved: ['ticket-writer'], retired: ['ticket-writer'] },
      liveness, installedSkills: 37,
    });
    expect(retired.status).toBe('fail');
    expect(retired.message).toContain('ticket-writer');
  });

  it('reads the project on disk, both journal locations and both runtimes', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-doctor-invocation-'));
    roots.push(root);
    mkdirSync(join(root, '.claude', 'skills', 'void-tdd'), { recursive: true });
    writeFileSync(join(root, '.claude', 'skills', 'void-tdd', 'SKILL.md'), '---\n---\n');
    const mission = join(root, '.void', 'runs', 'mis_aaaaaaaaaaaaaaaa');
    mkdirSync(mission, { recursive: true });
    writeFileSync(
      join(mission, 'events.jsonl'),
      `${JSON.stringify({
        kind: 'runtime.tool.started',
        missionId: 'mis_aaaaaaaaaaaaaaaa',
        subject: 'skill:ticket-writer',
        ts: new Date().toISOString(),
        payload: { category: 'skill', tool: 'Skill' },
      })}\n`,
    );
    const observation = observeInvocation(root);
    expect(observation.installedSkills).toBe(1);
    expect(observation.resolution.unresolved).toEqual(['ticket-writer']);
  });
});

// `doctor` reports the present. A rename that happened weeks ago and that nothing
// calls any more is history: there is no action that clears it, so a red — or even
// an advisory — is a verdict nobody can satisfy. It passes, and says so.
describe('judgeInvocation, on a rename nothing calls any more', () => {
  it('passes, and still names what was renamed', () => {
    const check = judgeInvocation({
      resolution: { ok: true, unresolved: [], retired: ['ticket-writer', 'session-handoff'] },
      liveness: ALIVE,
      installedSkills: 65,
    });

    expect(check.ok).toBe(true);
    expect(check.status).toBe('pass');
    expect(check.message).toContain('ticket-writer -> void-ticket');
    expect(check.message).toContain('session-handoff -> void-checkpoint');
  });

  it('offers no remedy for something already resolved', () => {
    const check = judgeInvocation({
      resolution: { ok: true, unresolved: [], retired: ['ticket-writer'] },
      liveness: ALIVE,
      installedSkills: 65,
    });

    expect(check.fix).toBeUndefined();
  });
});
