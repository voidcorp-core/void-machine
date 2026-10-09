import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { journalFingerprint, readMissionJournals } from './journal.js';
import { recordRuntimeEvent } from './record.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cachedInvocationAlert,
  installedSkillNames,
  invocationAlert,
  livenessVerdict,
  refreshInvocationVerdict,
  replacementFor,
  resolutionVerdict,
} from './invocation.js';

// A harness cannot see its own refused invocations: a Skill call under an
// unknown name is rejected before the first hook and writes no event at all
// (measured 2026-08-19). What it CAN see is a name it did record which no longer
// resolves -- the shape the 3.0 rename left behind, where every recorded
// activation named `ticket-writer` or `brainstorming` for a month.
const roots: string[] = [];

function project(skills: readonly string[] = [], agentSkills: readonly string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'void-invocation-'));
  roots.push(root);
  for (const [dir, names] of [['.claude', skills], ['.agents', agentSkills]] as const) {
    for (const name of names) {
      mkdirSync(join(root, dir, 'skills', name), { recursive: true });
      writeFileSync(join(root, dir, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
    }
  }
  return root;
}

// Carries a missionId, like every event the runner actually writes. A fixture that
// omits it reads as one anonymous run, which is exactly the shape that hid the
// difference between "called in the current run" and "called weeks ago".
function activation(name: string, ts = '2026-08-19T10:00:00.000Z', missionId = 'mis_now'): string {
  return JSON.stringify({
    kind: 'runtime.tool.started',
    source: 'runtime:claude',
    subject: `skill:${name}`,
    ts,
    missionId,
    payload: { category: 'skill', tool: 'Skill' },
  });
}

const toolCall = JSON.stringify({
  kind: 'runtime.tool.started',
  subject: 'tool:Bash',
  ts: '2026-08-19T10:00:00.000Z',
  payload: { category: 'tool', tool: 'Bash' },
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('installedSkillNames', () => {
  it('reads both runtimes, since a project can carry either or both', () => {
    const names = installedSkillNames(project(['void-tdd'], ['void-verify']));
    expect([...names].sort()).toEqual(['void-tdd', 'void-verify']);
  });

  it('counts a skill directory only when it actually holds a SKILL.md', () => {
    const root = project(['void-tdd']);
    mkdirSync(join(root, '.claude', 'skills', 'empty'), { recursive: true });
    expect(installedSkillNames(root).has('empty')).toBe(false);
  });

  it('returns nothing for a project with no skills installed', () => {
    expect(installedSkillNames(project()).size).toBe(0);
  });
});

describe('resolutionVerdict judges the present, not the history', () => {
  // `doctor` reports the state of the project right now. A rename that happened
  // weeks ago and that nothing calls any more is not a fault: it is history, and
  // there is no action that would clear it. A red verdict nobody can satisfy is a
  // red verdict everybody learns to skip past — the same defect DEV-644 closed,
  // wearing a different coat.
  const old = `${activation('ticket-writer', '2026-07-01T10:00:00.000Z', 'mis_old')}`;
  const recent = `${activation('void-tdd', '2026-08-19T10:00:00.000Z', 'mis_now')}`;

  it('passes when the newest run calls nothing retired', () => {
    const verdict = resolutionVerdict(`${old}\n${recent}`, new Set(['void-tdd', 'void-ticket']));

    expect(verdict.ok).toBe(true);
    expect(verdict.unresolved).toEqual([]);
  });

  it('still remembers the rename, so the message can say so', () => {
    const verdict = resolutionVerdict(`${old}\n${recent}`, new Set(['void-tdd', 'void-ticket']));

    expect(verdict.retired).toEqual(['ticket-writer']);
  });

  it('fails when the newest run is the one calling a retired name', () => {
    const calling = activation('ticket-writer', '2026-08-19T11:00:00.000Z', 'mis_now');
    const verdict = resolutionVerdict(`${old}\n${recent}\n${calling}`, new Set(['void-tdd', 'void-ticket']));

    expect(verdict.ok).toBe(false);
    expect(verdict.unresolved).toEqual(['ticket-writer']);
  });
});

describe('resolutionVerdict, on names the harness never shipped', () => {
  it('leaves a name from another provider out of the verdict', () => {
    // `defuddle` and `artifact-capabilities` resolve perfectly -- elsewhere. The
    // remedy the check prints (reinstall the harness) cannot make them appear
    // under .claude/skills, and a red verdict nobody can extinguish is a red
    // verdict everybody learns to skip past.
    const body = `${activation('defuddle')}\n${activation('artifact-capabilities')}`;

    expect(resolutionVerdict(body, new Set(['void-tdd'])).unresolved).toEqual([]);
  });

  it('still names a skill the harness itself retired', () => {
    const body = `${activation('session-handoff')}\n${activation('defuddle')}`;

    expect(resolutionVerdict(body, new Set(['void-checkpoint'])).unresolved).toEqual(['session-handoff']);
  });

  it('says what took a retired name over, since that is the actual remedy', () => {
    expect(replacementFor('session-handoff')).toBe('void-checkpoint');
    expect(replacementFor('ticket-runner')).toBe('void-implement');
    expect(replacementFor('void-tdd')).toBeUndefined();
  });
});

describe('resolutionVerdict', () => {
  it('passes when every recorded activation names an installed skill', () => {
    const verdict = resolutionVerdict(`${activation('void-tdd')}\n${activation('void-verify')}`, new Set(['void-tdd', 'void-verify']));
    expect(verdict.ok).toBe(true);
    expect(verdict.unresolved).toEqual([]);
  });

  it('names the recorded skill that no longer exists', () => {
    const verdict = resolutionVerdict(activation('ticket-writer'), new Set(['void-ticket']));
    expect(verdict.ok).toBe(false);
    expect(verdict.unresolved).toEqual(['ticket-writer']);
  });

  it('reports each missing name once, however often it fired', () => {
    const body = [activation('brainstorming'), activation('brainstorming'), activation('ticket-writer')].join('\n');
    expect(resolutionVerdict(body, new Set()).unresolved).toEqual(['brainstorming', 'ticket-writer']);
  });

  it('ignores everything that is not a skill activation', () => {
    expect(resolutionVerdict(`${toolCall}\n${toolCall}`, new Set()).ok).toBe(true);
  });

  it('survives a truncated or unreadable line rather than failing the session', () => {
    const body = `{"kind":"runtime.tool.st\n${activation('void-tdd')}\nnot json at all`;
    expect(resolutionVerdict(body, new Set(['void-tdd'])).ok).toBe(true);
  });

  it('passes on an empty journal: nothing recorded proves nothing broken', () => {
    expect(resolutionVerdict('', new Set()).ok).toBe(true);
  });

  // A rename is legitimate, and the journal keeps the old name forever: it
  // records what happened. Judging the whole history would make the alert
  // permanent for a defect already fixed, and an alert nobody can extinguish is
  // an alert they disable. Only recent activations are judged, so the alert goes
  // out by itself once nothing invokes the retired name any more.
  it('ignores an activation older than the window, so a fixed rename stops shouting', () => {
    const old = activation('ticket-writer', '2026-06-01T10:00:00.000Z');
    const verdict = resolutionVerdict(old, new Set(['void-ticket']), { nowMs: Date.parse('2026-08-19T10:00:00.000Z') });
    expect(verdict.ok).toBe(true);
  });

  it('still fails on a recent activation of the retired name, which is the live defect', () => {
    const recent = activation('ticket-writer', '2026-08-18T10:00:00.000Z');
    const verdict = resolutionVerdict(recent, new Set(['void-ticket']), { nowMs: Date.parse('2026-08-19T10:00:00.000Z') });
    expect(verdict.unresolved).toEqual(['ticket-writer']);
  });

  it('judges the whole journal when no window is given, which is what doctor wants', () => {
    const old = activation('ticket-writer', '2026-01-01T10:00:00.000Z');
    expect(resolutionVerdict(old, new Set(['void-ticket'])).unresolved).toEqual(['ticket-writer']);
  });

  it('keeps an activation whose timestamp is unreadable rather than silently dropping it', () => {
    const broken = JSON.stringify({
      kind: 'runtime.tool.started',
    source: 'runtime:claude',
      subject: 'skill:ticket-writer',
      ts: 'pas une date',
      payload: { category: 'skill', tool: 'Skill' },
    });
    const verdict = resolutionVerdict(broken, new Set(['void-ticket']), { nowMs: Date.parse('2026-08-19T10:00:00.000Z') });
    expect(verdict.unresolved).toEqual(['ticket-writer']);
  });

  it('reads through a namespaced subject, which is how the defect was recorded', () => {
    expect(resolutionVerdict(activation('harness:void-tdd'), new Set(['void-tdd'])).ok).toBe(true);
  });
});

const ALIVE = { ok: true, missions: 3, toolCalls: 300, skillCalls: 6, unobservable: [] } as const;
const RESOLVES = { ok: true, unresolved: [], retired: [] } as const;

describe('invocationAlert', () => {
  it('says nothing when both verdicts pass, so a healthy session gains no noise', () => {
    expect(invocationAlert(RESOLVES, ALIVE)).toBeUndefined();
  });

  it('names the unresolved skills, because the name is what someone has to go fix', () => {
    const alert = invocationAlert({ ok: false, unresolved: ['brainstorming', 'ticket-writer'], retired: ['brainstorming', 'ticket-writer'] }, ALIVE);
    expect(alert).toContain('brainstorming');
    expect(alert).toContain('ticket-writer');
  });

  it('reports the silence with the evidence that the missions actually worked', () => {
    const alert = invocationAlert(RESOLVES, { ok: false, missions: 3, toolCalls: 1464, skillCalls: 0, unobservable: [] }) ?? '';
    expect(alert).toContain('3');
    expect(alert).toContain('1464');
  });

  it('carries both findings in one block rather than two banners', () => {
    const alert = invocationAlert({ ok: false, unresolved: ['ticket-writer'], retired: ['ticket-writer'] }, { ok: false, missions: 3, toolCalls: 900, skillCalls: 0, unobservable: [] }) ?? '';
    expect(alert.split('\n')).toHaveLength(4);
    expect(alert).toContain('ticket-writer');
    expect(alert).toContain('900');
  });

  it('breaks into a titled block, so the alert reads as one thing and not as a run-on sentence', () => {
    const alert = invocationAlert({ ok: false, unresolved: ['brainstorming'], retired: ['brainstorming'] }, ALIVE) ?? '';
    const lines = alert.split('\n');
    expect(lines[0]).toContain('invocation surface');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('void-machine doctor');
  });

  it('names the successor, because that is what ends the search', () => {
    // "check that the skill exists, then reinstall" is precisely what a renamed
    // skill does not need: the file is not missing, the name moved.
    const alert = invocationAlert({ ok: false, unresolved: ['session-handoff'], retired: ['session-handoff'] }, ALIVE) ?? '';

    expect(alert).toContain('session-handoff');
    expect(alert).toContain('void-checkpoint');
  });

  it('stays bounded however many names there are, since it is read at a session opening', () => {
    const many = Array.from({ length: 30 }, (_, i) => `skill-${i}`);
    const alert = invocationAlert({ ok: false, unresolved: many, retired: many }, ALIVE) ?? '';
    expect(alert.split('\n')).toHaveLength(3);
    expect(alert.length).toBeLessThan(300);
  });
});

// The second verdict answers what the first cannot: the harness cannot see a
// refused call, so a surface that stops being reachable leaves no trace at all,
// only a silence. A silence means nothing on its own -- a session spent reading
// code legitimately fires no skill -- so it is only read against missions that
// demonstrably worked, counted in tool calls. Never in hooks: hooks belong to
// enforcement, and borrowing their count would make this verdict drift the day
// the floor changes.

function event(mission: string, kind: string, category: string, ts: string): string {
  return JSON.stringify({
    kind,
    source: 'runtime:claude',
    missionId: mission,
    subject: category === 'skill' ? 'skill:void-tdd' : 'tool:Bash',
    ts,
    payload: { category, tool: category === 'skill' ? 'Skill' : 'Bash' },
  });
}

function mission(id: string, toolCalls: number, skillCalls = 0, day = '01'): string {
  const lines: string[] = [];
  for (let i = 0; i < toolCalls; i += 1) {
    lines.push(event(id, 'runtime.tool.started', 'tool', `2026-08-${day}T10:00:${String(i % 60).padStart(2, '0')}.000Z`));
  }
  for (let i = 0; i < skillCalls; i += 1) {
    lines.push(event(id, 'runtime.tool.started', 'skill', `2026-08-${day}T11:00:00.000Z`));
  }
  return lines.join('\n');
}

describe('livenessVerdict', () => {
  it('fails when the last three working missions fired no skill at all', () => {
    const body = [mission('mis_1', 30, 0, '01'), mission('mis_2', 30, 0, '02'), mission('mis_3', 30, 0, '03')].join('\n');
    const verdict = livenessVerdict(body);
    expect(verdict.ok).toBe(false);
    expect(verdict.missions).toBe(3);
    expect(verdict.toolCalls).toBe(90);
  });

  it('collects Codex SKILL.md reads without inventing native skill activations', async () => {
    const root = project();
    for (let session = 0; session < 3; session += 1) {
      for (let call = 0; call < 20; call += 1) {
        await recordRuntimeEvent({
          root, runtime: 'codex', phase: 'activation',
          rawInput: {
            session_id: `codex-${session}`, hook_event_name: 'PreToolUse', tool_name: 'Bash',
            tool_input: { command: 'cat .agents/skills/void-tdd/SKILL.md' },
          },
        });
      }
    }
    const journal = readMissionJournals(root);
    expect(journal.match(/runtime.tool.started/g)).toHaveLength(60);
    expect(journal).not.toContain('skill:void-tdd');
    const verdict = livenessVerdict(journal);
    expect(verdict.unobservable).toEqual([{ source: 'runtime:codex', toolCalls: 60 }]);
    expect(verdict.missions).toBe(0);
    refreshInvocationVerdict(root);
    expect(cachedInvocationAlert(root)).toContain('not observable for runtime:codex');
    expect(cachedInvocationAlert(root)).not.toContain('no skill fired');
  });

  it('does not diagnose unobservable Codex or unknown sources as silent skills', () => {
    for (const source of ['runtime:codex', 'runtime:unknown', '']) {
      const body = ['01', '02', '03'].map((day) =>
        mission(`mis_${day}`, 30, 0, day).replaceAll('runtime:claude', source),
      ).join('\n');
      const verdict = livenessVerdict(body);
      expect(invocationAlert({ ok: true, unresolved: [], retired: [] }, verdict)).toContain('not observable');
      expect(verdict.missions).toBe(0);
      expect(verdict.skillCalls).toBe(0);
    }
  });

  it('keeps Claude silence visible even beside newer Codex activity', () => {
    const claude = ['01', '02', '03'].map((day) => mission(`mis_${day}`, 30, 0, day));
    const codex = mission('mis_codex', 90, 1, '04').replaceAll('runtime:claude', 'runtime:codex');
    const verdict = livenessVerdict([...claude, codex].join('\n'));
    expect(verdict.ok).toBe(false);
    expect(verdict.toolCalls).toBe(90);
    expect(verdict.skillCalls).toBe(0);
  });

  it('never combines runtimes sharing a mission id to reach the working threshold', () => {
    const body = ['01', '02', '03'].flatMap((day) => [
      mission(`mis_${day}`, 19, 0, day),
      mission(`mis_${day}`, 30, 0, day).replaceAll('runtime:claude', 'runtime:codex'),
    ]).join('\n');
    expect(livenessVerdict(body).missions).toBe(0);
  });

  it('passes as soon as one of those missions fired a skill', () => {
    const body = [mission('mis_1', 30, 0, '01'), mission('mis_2', 30, 1, '02'), mission('mis_3', 30, 0, '03')].join('\n');
    expect(livenessVerdict(body).ok).toBe(true);
  });

  it('stays silent under three working missions, since two prove nothing', () => {
    const body = [mission('mis_1', 30, 0, '01'), mission('mis_2', 30, 0, '02')].join('\n');
    const verdict = livenessVerdict(body);
    expect(verdict.ok).toBe(true);
    expect(verdict.missions).toBe(2);
  });

  it('ignores a mission too small to prove anything, which is 146 of the 152 recorded here', () => {
    const body = [
      mission('mis_1', 30, 0, '01'),
      mission('mis_2', 30, 0, '02'),
      mission('mis_3', 1, 0, '03'),
      mission('mis_4', 1, 0, '04'),
    ].join('\n');
    expect(livenessVerdict(body).ok).toBe(true);
  });

  it('counts tool calls, never hooks, which belong to enforcement', () => {
    const hooks = Array.from({ length: 500 }, () =>
      JSON.stringify({ kind: 'hook.completed', missionId: 'mis_1', ts: `2026-08-01T10:00:00.000Z`, payload: { status: 'ok' } }),
    ).join('\n');
    const verdict = livenessVerdict(`${hooks}\n${mission('mis_1', 2, 0, '01')}`);
    expect(verdict.ok).toBe(true);
    expect(verdict.missions).toBe(0);
  });

  it('judges the most recent working missions, not the whole history', () => {
    const body = [
      mission('mis_old', 30, 5, '01'),
      mission('mis_a', 30, 0, '05'),
      mission('mis_b', 30, 0, '06'),
      mission('mis_c', 30, 0, '07'),
    ].join('\n');
    expect(livenessVerdict(body).ok).toBe(false);
  });

  it('passes on an empty journal rather than calling a fresh project dead', () => {
    expect(livenessVerdict('').ok).toBe(true);
  });

  it('reports the activations it did count, which doctor shows as context and never judges on', () => {
    const body = [mission('mis_1', 30, 2, '01'), mission('mis_2', 30, 0, '02'), mission('mis_3', 30, 0, '03')].join('\n');
    expect(livenessVerdict(body).skillCalls).toBe(2);
  });
});

// The banner reads a cached verdict and recomputes after stdout, exactly like
// the version freshness check: a session start must never wait on work whose
// answer can be one session old without anyone being worse off.
describe('the cached verdict', () => {
  function recorded(root: string, name: string): void {
    const dir = join(root, '.void', 'machine', 'runs', 'mis_aaaaaaaaaaaaaaaa');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'events.jsonl'), `${activation(name, new Date().toISOString())}\n`);
  }

  it('says nothing at all before anything has been computed', () => {
    expect(cachedInvocationAlert(project())).toBeUndefined();
  });

  it('returns what the last refresh found, without reading the journals again', () => {
    const root = project(['void-ticket']);
    recorded(root, 'ticket-writer');
    refreshInvocationVerdict(root);
    expect(cachedInvocationAlert(root)).toContain('ticket-writer');
  });

  it('caches the silence too, so a healthy project keeps recomputing nothing', () => {
    const root = project(['void-ticket']);
    recorded(root, 'void-ticket');
    refreshInvocationVerdict(root);
    expect(cachedInvocationAlert(root)).toBeUndefined();
  });

  it('clears a stale alert once the project is fixed', () => {
    const root = project(['void-ticket']);
    recorded(root, 'ticket-writer');
    refreshInvocationVerdict(root);
    expect(cachedInvocationAlert(root)).toBeDefined();
    recorded(root, 'void-ticket');
    refreshInvocationVerdict(root);
    expect(cachedInvocationAlert(root)).toBeUndefined();
  });

  it('recomputes a legacy cache even when journals have not changed', () => {
    const root = project(['void-ticket']);
    recorded(root, 'ticket-writer');
    const path = join(root, '.void', 'machine', 'invocation.json');
    writeFileSync(path, JSON.stringify({ fingerprint: journalFingerprint(root), alert: 'obsolete verdict' }));
    expect(cachedInvocationAlert(root)).toBeUndefined();
    refreshInvocationVerdict(root);
    expect(cachedInvocationAlert(root)).toContain('ticket-writer');
    expect(readFileSync(path, 'utf8')).not.toContain('obsolete verdict');
  });

  it('survives a corrupted cache rather than failing the session that reads it', () => {
    const root = project();
    mkdirSync(join(root, '.void', 'machine'), { recursive: true });
    writeFileSync(join(root, '.void', 'machine', 'invocation.json'), 'not json');
    expect(cachedInvocationAlert(root)).toBeUndefined();
  });
});
