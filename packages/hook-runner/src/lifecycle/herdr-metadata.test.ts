import { describe, expect, it } from 'vitest';
import { metadataCommands, metadataSequence } from './herdr-metadata.js';

const worker = { label: 'WORK-1', agent: 'codex' as const, worktree: '/repo/work',
  branch: 'feature', ticket: 'DEV-1016', status: 'blocked' as const, attempt: 'attempt-1' };
const mission = { schema: 1 as const, mission: 'mission-1', project: 'project-1',
  repository: '/repo/.git', updated_at: '2026-10-08T10:00:00.000Z', status: 'running' as const,
  coordinator: { label: 'ORCH', worktree: '/repo/main' }, workers: [worker] };
const snapshot = { directory: '/state/project-1/mission-1', mission, worker, workers: [worker],
  coordinator: false, pane: { pane_id: 'wA:p3', workspace_id: 'wA', label: 'WORK-1', cwd: '/repo/work',
    tokens: { mission: 'mission-1' } } };
const seq = 1_791_475_200_123_456_789n;
const contains = (command: readonly string[], text: string) => command.includes(text);

describe('Herdr projection uses only file status and verified ownership', () => {
  it('uses one epoch clock for nanoseconds across millisecond boundaries without rounding the epoch', () => {
    const origin = 1_791_475_200_123.25;
    const earlier = metadataSequence(origin, 0.749999);
    const later = metadataSequence(origin, 0.750001);
    expect(earlier).toBe(1_791_475_200_123_999_999n);
    expect(later).toBe(1_791_475_200_124_000_001n);
    expect(later).toBeGreaterThan(earlier);
  });
  it('preserves final state under equality, old snapshots and per-key TTL after clear/republish', () => {
    // Herdr 0.9.0 contract: strict seq per source/resource, TTL per touched key.
    let accepted = 0n;
    const tokens = new Map<string, { value: string; expires: number }>([['ctx', { value: '90%', expires: 999 }]]);
    const apply = (args: readonly string[], now: number) => {
      const sequence = BigInt(args[args.indexOf('--seq') + 1] ?? '0');
      if (sequence <= accepted) return;
      accepted = sequence;
      const ttl = Number(args[args.indexOf('--ttl-ms') + 1]);
      for (let index = 0; index < args.length; index++) {
        const value = args[index + 1] ?? '';
        if (args[index] === '--clear-token') tokens.delete(value);
        if (args[index] === '--token') {
          const separator = value.indexOf('=');
          tokens.set(value.slice(0, separator), { value: value.slice(separator + 1), expires: now + ttl });
        }
      }
    };
    const commands = metadataCommands(snapshot, { hook_event_name: 'SessionStart', source: 'clear' }, seq, 12);
    for (const args of commands) apply(args, 100);
    for (const args of commands) apply(args, 200); // equal/reordered delivery cannot renew TTL or clear ctx
    for (const args of metadataCommands({ ...snapshot, mission: { ...mission, status: 'done' } },
      { hook_event_name: 'SessionEnd' }, seq - 100n)) apply(args, 300);
    expect(tokens.get('ctx')).toEqual({ value: '12%', expires: 7_200_100 });
    expect(tokens.get('mission')).toEqual({ value: 'mission-1', expires: 86_400_100 });
    expect(tokens.get('wstatus')?.value).toBe('blocked');
  });
  it.each(['startup', 'resume', 'clear', 'compact'])('republishes worker status on %s', (source) => {
    const commands = metadataCommands(snapshot, { hook_event_name: 'SessionStart', source }, seq);
    const state = commands.find(command => contains(command, 'mission=mission-1'));
    expect(state).toContain('wA:p3');
    expect(state).toContain('worker=WORK-1');
    expect(state).toContain('wstatus=blocked');
    expect(state).toContain('ticket=DEV-1016');
    expect(state).toContain('86400000');
    expect(state).toContain('void-machine');
    expect(commands.every(command => command[0] === 'pane')).toBe(true);
    expect(commands.flat()).not.toContain('--state');
  });
  it('clears ctx before a fresh measurement and preserves nanoseconds exactly', () => {
    const commands = metadataCommands(snapshot, { hook_event_name: 'SessionStart', source: 'clear' }, seq, 42);
    expect(commands[0]).toContain('--clear-token');
    expect(commands[0]).toContain('ctx');
    const measured = commands.find(command => command.includes('ctx=42%'));
    expect(measured).toContain('7200000');
    const sequences = commands.map(command => BigInt(command[command.indexOf('--seq') + 1] ?? '0'));
    expect(sequences[0]).toBe(seq);
    expect(sequences.every((value, index) => index === 0 || value > (sequences[index - 1] ?? 0n))).toBe(true);
  });
  it('does not invent context on Stop and keeps effective report status', () => {
    const commands = metadataCommands(snapshot, { hook_event_name: 'Stop' }, seq);
    expect(commands.flat()).toContain('wstatus=blocked');
    expect(commands.flat().some(arg => arg.startsWith('ctx='))).toBe(false);
  });
  it('publishes aggregate workspace counts only for the resolved coordinator', () => {
    const commands = metadataCommands({ ...snapshot, coordinator: true, worker: undefined },
      { hook_event_name: 'SessionStart', source: 'resume' }, seq, undefined, 'mission-1');
    const workspace = commands.find(command => command[0] === 'workspace');
    expect(workspace).toContain('wA');
    expect(workspace).toContain('workers=0 active, 1 blocked');
  });
  it('never clears workspace from a worker SessionEnd or another mission', () => {
    const terminal = { ...snapshot, mission: { ...mission, status: 'done' as const } };
    const commands = metadataCommands(terminal, { hook_event_name: 'SessionEnd' }, seq);
    expect(commands.flat()).toContain('--clear-token');
    expect(commands.every(command => command[0] === 'pane')).toBe(true);
    const foreign = metadataCommands({ ...terminal, coordinator: true, worker: undefined },
      { hook_event_name: 'SessionEnd' }, seq, undefined, 'foreign');
    expect(foreign.every(command => command[0] === 'pane')).toBe(true);
  });
  it('clears all owned keys on terminal mission only when displayed mission still matches', () => {
    const terminal = { ...snapshot, coordinator: true, worker: undefined,
      mission: { ...mission, status: 'done' as const } };
    const commands = metadataCommands(terminal, { hook_event_name: 'SessionEnd' }, seq, undefined, 'mission-1');
    expect(commands.find(command => command[0] === 'pane')).toEqual(expect.arrayContaining([
      '--clear-token', 'mission', 'worker', 'ticket', 'wstatus', 'ctx',
    ]));
    expect(commands.find(command => command[0] === 'workspace')).toEqual(expect.arrayContaining([
      '--clear-token', 'mission', 'wstatus', 'workers',
    ]));
    expect(metadataCommands({ ...terminal, pane: { ...terminal.pane, tokens: { mission: 'other' } } },
      { hook_event_name: 'SessionEnd' }, seq, undefined, 'other')).toEqual([]);
  });
  it('clears completed worker panes from coordinator closure while preserving a reused pane', () => {
    const terminal = { ...snapshot, coordinator: true, worker: undefined,
      mission: { ...mission, status: 'done' as const }, ownedPanes: [snapshot.pane,
        { ...snapshot.pane, pane_id: 'wA:p4', label: 'WORK-2' },
        { ...snapshot.pane, pane_id: 'wA:p5', label: 'WORK-3', tokens: { mission: 'newer' } },
      ] };
    const commands = metadataCommands(terminal, { hook_event_name: 'Stop' }, seq, undefined, 'mission-1');
    expect(commands.map(args => args[2])).toEqual(['wA:p3', 'wA:p4', 'wA']);
  });
});
