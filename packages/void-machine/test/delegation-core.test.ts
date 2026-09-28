import { describe, expect, it } from 'vitest';
import {
  DELEGATION_LIMITS, type RunObservation, type RunState, type RunTransition, acceptRun, admitRun,
  describeRun, observeRun, recordDispatch, retireRun, runView, sendRun, stopRun,
} from '../src/core/delegation.js';

const T0 = 1_000_000;
const WINDOW = DELEGATION_LIMITS.reconcileWindowMs;
const GRACE = DELEGATION_LIMITS.resultGraceMs;

/** A transition log that ends in `state`, with the turn started at T0. */
function history(state: RunState, at = T0): RunTransition[] {
  const log: RunTransition[] = [
    { seq: 1, at: T0, to: 'admitted', event: 'admitted', cause: 'admitted', action: 'wait' },
  ];
  if (state !== 'admitted') {
    log.push({ seq: 2, at, from: 'admitted', to: state, event: 'observed', cause: 'c', action: 'a' });
  }
  return log;
}
const present = (state: 'working' | 'blocked' | 'done' | 'failed' | 'stopped',
  waitingFor?: string): RunObservation => ({ kind: 'present', state,
  ...(waitingFor === undefined ? {} : { waitingFor }) });
const absent: RunObservation = { kind: 'absent' };
const unreadable: RunObservation = { kind: 'unreadable', cause: 'claude agents exited 1' };

function observe(state: RunState, observation: RunObservation, now: number,
  extra: { resultAt?: number; doneSince?: number; at?: number } = {}) {
  return observeRun(runView(history(state, extra.at)), {
    observation, now,
    ...(extra.resultAt === undefined ? {} : { result: { recordedAt: extra.resultAt } }),
    ...(extra.doneSince === undefined ? {} : { doneSince: extra.doneSince }),
  });
}

describe('admission', () => {
  it('admits a run below the mission cap and refuses at the cap', () => {
    expect(admitRun(DELEGATION_LIMITS.activeRunsPerMission - 1, T0))
      .toMatchObject({ ok: true, transition: { seq: 1, to: 'admitted', at: T0 } });
    expect(admitRun(DELEGATION_LIMITS.activeRunsPerMission, T0)).toMatchObject({
      ok: false, cause: expect.stringContaining('4'), action: expect.stringContaining('stop'),
    });
  });
});

describe('dispatch outcome', () => {
  it('moves an admitted run to dispatched on an acknowledged launch', () => {
    expect(recordDispatch(runView(history('admitted')), { kind: 'acknowledged' }, T0 + 1))
      .toMatchObject({ ok: true, transition: { from: 'admitted', to: 'dispatched', seq: 2 } });
  });

  it('reconciles a lost acknowledgement instead of relaunching', () => {
    expect(recordDispatch(runView(history('admitted')), { kind: 'lost', cause: 'no ack line' }, T0 + 1))
      .toMatchObject({ ok: true, transition: { to: 'reconciling', event: 'lost' } });
  });

  it('fails a refused launch with its cause and repair', () => {
    const refused = recordDispatch(runView(history('admitted')),
      { kind: 'refused', cause: 'Workspace not trusted', action: 'open claude once in /w' }, T0 + 1);
    expect(refused).toMatchObject({ ok: true, transition: { to: 'failed',
      cause: 'Workspace not trusted', action: 'open claude once in /w' } });
  });
});

describe('observation', () => {
  it.each<[RunState, RunObservation, RunState | undefined]>([
    ['dispatched', present('working'), 'working'],
    ['working', present('working'), undefined],
    ['reconciling', present('working'), 'working'],
    ['waiting-human', present('working'), 'working'],
    ['dispatched', present('blocked', 'permission prompt'), 'waiting-human'],
    ['working', present('failed'), 'failed'],
    ['working', present('stopped'), 'stopped'],
    ['working', absent, 'reconciling'],
    ['turn-ended', absent, 'reconciling'],
    ['working', unreadable, undefined],
    ['accepted', present('failed'), undefined],
    ['retired', absent, undefined],
    ['stopped', present('working'), undefined],
  ])('%s observed as %j becomes %s', (state, observation, expected) => {
    expect(observe(state, observation, T0 + 5_000).transition?.to).toBe(expected);
  });

  it('carries what a waiting session waits for, and the only place it can be answered', () => {
    const { transition } = observe('working', present('blocked', 'permission prompt'), T0 + 1);
    expect(transition).toMatchObject({ to: 'waiting-human', waitingFor: 'permission prompt',
      action: expect.stringContaining('attach') });
  });

  it('ends the turn of an agent that ended it with a question, so the coordinator can answer', () => {
    // Observed on 2.1.283: a turn ending on a question reads blocked, and its Stop hook still ran.
    expect(observe('working', present('blocked'), T0 + 10, { resultAt: T0 + 5 }).transition)
      .toMatchObject({ to: 'turn-ended', event: 'turn-ended', action: expect.stringContaining('send') });
    expect(observe('waiting-human', present('blocked', 'input needed'), T0 + 10, { resultAt: T0 + 5 })
      .transition).toMatchObject({ to: 'turn-ended' });
    expect(observe('working', present('blocked', 'permission prompt'), T0 + 10, { resultAt: T0 - 1 })
      .transition).toMatchObject({ to: 'waiting-human' });
  });

  it('ends the turn once the result of this turn is recorded', () => {
    expect(observe('working', present('done'), T0 + 10, { resultAt: T0 + 5 }).transition)
      .toMatchObject({ to: 'turn-ended', event: 'turn-ended' });
  });

  it('never ends a turn on a result older than the turn start', () => {
    const early = observe('working', present('done'), T0 + 10, { resultAt: T0 - 1 });
    expect(early.transition).toBeUndefined();
    expect(early.doneSince).toBe(T0 + 10);
  });

  it('ends the turn as result-missing only after the grace, measured from the first done seen', () => {
    const since = T0 + 100;
    expect(observe('working', present('done'), since + GRACE - 1, { doneSince: since }).transition)
      .toBeUndefined();
    expect(observe('working', present('done'), since + GRACE, { doneSince: since }).transition)
      .toMatchObject({ to: 'turn-ended', event: 'result-missing', action: expect.stringContaining('send') });
  });

  it('measures the reconciliation window from entry into reconciling, not from dispatch', () => {
    const entered = T0 + 600_000;
    expect(observe('reconciling', absent, entered + WINDOW - 1, { at: entered }).transition)
      .toBeUndefined();
    expect(observe('reconciling', absent, entered + WINDOW, { at: entered }).transition)
      .toMatchObject({ to: 'failed', action: expect.not.stringContaining('dispatch again') });
  });

  it('never fails a reconciling run on an unreadable observation', () => {
    expect(observe('reconciling', unreadable, T0 + WINDOW * 10).transition).toBeUndefined();
  });

  it('fails an admitted run whose launch never surfaced within the window', () => {
    expect(observe('admitted', absent, T0 + WINDOW - 1).transition).toBeUndefined();
    expect(observe('admitted', absent, T0 + WINDOW).transition).toMatchObject({ to: 'failed' });
  });

  it('numbers each transition after the last recorded one and names its origin', () => {
    expect(observe('working', present('failed'), T0 + 1).transition)
      .toMatchObject({ seq: 3, from: 'working', to: 'failed', at: T0 + 1 });
  });
});

describe('commands', () => {
  const ended = runView(history('turn-ended'));

  it('sends only to a run whose turn ended, and starts a new turn', () => {
    expect(sendRun(ended, T0 + 50)).toMatchObject({ ok: true,
      transition: { to: 'working', event: 'sent', at: T0 + 50 } });
    expect(runView([...history('turn-ended'), { seq: 3, at: T0 + 50, from: 'turn-ended',
      to: 'working', event: 'sent', cause: 'c', action: 'a' }]).turnStartedAt).toBe(T0 + 50);
    expect(sendRun(runView(history('working')), T0 + 50)).toMatchObject({ ok: false });
  });

  it('accepts only a turn-ended run with a result collected for its current turn', () => {
    expect(acceptRun(ended, { recordedAt: T0 + 1 }, T0 + 60))
      .toMatchObject({ ok: true, transition: { to: 'accepted' } });
    expect(acceptRun(ended, undefined, T0 + 60)).toMatchObject({ ok: false,
      action: expect.stringContaining('send') });
    expect(acceptRun(ended, { recordedAt: T0 - 1 }, T0 + 60)).toMatchObject({ ok: false });
    expect(acceptRun(runView(history('working')), { recordedAt: T0 + 1 }, T0 + 60))
      .toMatchObject({ ok: false });
  });

  it('retires only an accepted run', () => {
    expect(retireRun(runView(history('accepted')), T0 + 70))
      .toMatchObject({ ok: true, transition: { to: 'retired' } });
    expect(retireRun(ended, T0 + 70)).toMatchObject({ ok: false });
  });

  it('stops any open run and refuses a closed one', () => {
    for (const state of ['admitted', 'dispatched', 'working', 'turn-ended', 'waiting-human',
      'reconciling'] as const) {
      expect(stopRun(runView(history(state)), T0 + 80), state)
        .toMatchObject({ ok: true, transition: { to: 'stopped' } });
    }
    for (const state of ['accepted', 'retired', 'failed', 'stopped'] as const) {
      expect(stopRun(runView(history(state)), T0 + 80), state).toMatchObject({ ok: false });
    }
  });
});

describe('status', () => {
  it('gives the state, its cause and the next action for every state', () => {
    for (const state of ['admitted', 'dispatched', 'working', 'turn-ended', 'waiting-human',
      'accepted', 'retired', 'failed', 'stopped', 'reconciling'] as const) {
      const status = describeRun(runView(history(state)), { resultCollected: false });
      expect(status.state).toBe(state);
      expect(status.cause.length).toBeGreaterThan(0);
      expect(status.action.length).toBeGreaterThan(0);
    }
  });

  it('points a turn-ended run at accept once its result is collected, at send otherwise', () => {
    expect(describeRun(runView(history('turn-ended')), { resultCollected: true }).action)
      .toContain('accept');
    expect(describeRun(runView(history('turn-ended')), { resultCollected: false }).action)
      .toContain('send');
  });

  it('refuses an empty or out-of-order history', () => {
    expect(() => runView([])).toThrow();
    const log = history('working');
    expect(() => runView([log[0] as RunTransition, { ...(log[1] as RunTransition), seq: 5 }])).toThrow();
  });
});
