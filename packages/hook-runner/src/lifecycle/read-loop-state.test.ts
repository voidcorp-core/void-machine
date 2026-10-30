import { describe, expect, it } from 'vitest';
import { advanceReadLoop, observeRead, type ReadLoopState, readLoopState } from './read-loop.js';

function observation(session: string, invocation = session) {
  const value = observeRead({
    hook_event_name: 'PostToolUse', session_id: session, tool_use_id: invocation,
    tool_name: 'Read', tool_input: { file_path: 'private-path' },
    tool_response: { content: 'private-content' },
  }, 'claude');
  if (value === undefined) throw new Error('valid read observation was refused');
  return value;
}

describe('read-loop state bounds', () => {
  it('retains only the newest 32 sessions in a schema-valid bounded digest payload', () => {
    let state: ReadLoopState = { schemaVersion: 1, sessions: [] };
    const observations = Array.from({ length: 34 }, (_, index) => observation(`session-${index}`));
    for (const next of observations) state = advanceReadLoop(state, next, 1_000).state;
    expect(state.sessions.map(entry => entry.session))
      .toEqual(observations.slice(-32).map(entry => entry.session));
    expect(readLoopState.parse(state)).toEqual(state);
    const serialized = JSON.stringify(state);
    expect(Buffer.byteLength(serialized)).toBeLessThan(32 * 1024);
    for (const raw of ['session-', 'private-path', 'private-content']) {
      expect(serialized).not.toContain(raw);
    }
  });

  it('expires an observation at exactly one day and retains it immediately before', () => {
    const seenAt = 1_000;
    const first = observation('session');
    const second = observation('session', 'second');
    const prior = advanceReadLoop({ schemaVersion: 1, sessions: [] }, first, seenAt).state;
    const before = advanceReadLoop(prior, second, seenAt + 86_400_000 - 1);
    expect(before.state.sessions[0]?.count).toBe(2);
    const expired = advanceReadLoop(prior, second, seenAt + 86_400_000);
    expect(expired.state.sessions[0]?.count).toBe(1);
    expect(expired.warn).toBe(false);
  });
});
