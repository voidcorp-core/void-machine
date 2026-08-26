import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CheckResult } from '../prerequisites.js';
import { type AutopilotObservation, autopilotPreflight } from './preflight.js';

function observation(over: Partial<AutopilotObservation> = {}): AutopilotObservation {
  return {
    program: {
      status: 'executing',
      autopilot: { enabled: true, mergeGate: 'human', verifyCommands: [['pnpm', 'test']] },
    },
    adapters: ['claude'],
    trackerConnector: true,
    worktreesUsable: true,
    baseProtected: true,
    ...over,
  };
}

function named(results: readonly CheckResult[], name: string): CheckResult | undefined {
  return results.find((result) => result.name === name);
}

describe('autopilotPreflight', () => {
  it('passes a project that is actually ready', () => {
    expect(autopilotPreflight(observation()).every((check) => check.ok)).toBe(true);
  });

  it('every failing check says what to do about it', () => {
    const broken = autopilotPreflight(
      observation({
        program: undefined,
        adapters: [],
        trackerConnector: false,
        worktreesUsable: false,
        baseProtected: false,
      }),
    );

    for (const check of broken.filter((result) => !result.ok)) {
      expect(check.fix, check.name).toBeTruthy();
    }
  });
});

describe('the program', () => {
  it('reports an absent ACTIVE as unknown, not as a failure', () => {
    // Most projects have no program to drain. That is not a broken harness.
    expect(named(autopilotPreflight(observation({ program: undefined })), 'autopilot program')?.status).toBe(
      'unknown',
    );
  });

  it('fails a program that is not executing', () => {
    const results = autopilotPreflight(
      observation({ program: { status: 'completed', autopilot: { enabled: true } } }),
    );

    expect(named(results, 'autopilot program')?.status).toBe('fail');
  });

  it('fails when autopilot is not enabled, because nothing would resume', () => {
    const results = autopilotPreflight(
      observation({ program: { status: 'executing', autopilot: { enabled: false } } }),
    );

    expect(named(results, 'autopilot program')?.message).toMatch(/enabled/);
  });
});

describe('the provider-agnostic program boundary', () => {
  it('names the program contract without prescribing a tracker product', () => {
    const check = named(autopilotPreflight(observation({ program: undefined })), 'autopilot program');

    expect(check?.message).toMatch(/\.void\/program\.md/);
    expect(check?.message).not.toMatch(/Linear|ACTIVE/);
  });
});

describe('the merge gate', () => {
  it('accepts only a human gate', () => {
    const results = autopilotPreflight(
      observation({
        program: { status: 'executing', autopilot: { enabled: true, mergeGate: 'auto' } },
      }),
    );

    const check = named(results, 'autopilot merge');
    expect(check?.status).toBe('fail');
    expect(check?.fix).toMatch(/never merges/);
  });

  it('treats an absent gate as human rather than as a missing value', () => {
    const results = autopilotPreflight(
      observation({ program: { status: 'executing', autopilot: { enabled: true } } }),
    );

    expect(named(results, 'autopilot merge')?.ok).toBe(true);
  });
});

describe('the verify commands', () => {
  it('fails when there are none, because nothing would prove the branch', () => {
    const results = autopilotPreflight(
      observation({
        program: { status: 'executing', autopilot: { enabled: true, verifyCommands: [] } },
      }),
    );

    expect(named(results, 'autopilot verify')?.status).toBe('fail');
  });

  it('rejects a command that is not a usable argv array', () => {
    for (const command of [[], ['pnpm', ''], 'pnpm test' as unknown as string[]]) {
      const results = autopilotPreflight(
        observation({
          program: { status: 'executing', autopilot: { enabled: true, verifyCommands: [command] } },
        }),
      );

      expect(named(results, 'autopilot verify')?.status, JSON.stringify(command)).toBe('fail');
    }
  });

  it('says why argv rather than a string, in the fix', () => {
    const results = autopilotPreflight(
      observation({
        program: { status: 'executing', autopilot: { enabled: true, verifyCommands: [[]] } },
      }),
    );

    expect(named(results, 'autopilot verify')?.fix).toMatch(/shell:false/);
  });
});

describe('what could not be read is not what is false', () => {
  it('keeps unreadable branch protection apart from an unprotected branch', () => {
    const unreadable = named(autopilotPreflight(observation({ baseProtected: null })), 'autopilot base');
    const unprotected = named(autopilotPreflight(observation({ baseProtected: false })), 'autopilot base');

    expect(unreadable?.status).toBe('unknown');
    expect(unprotected?.status).toBe('fail');
    expect(unreadable?.message).not.toEqual(unprotected?.message);
  });

  it('keeps an unprobed tracker apart from an unreachable one', () => {
    expect(named(autopilotPreflight(observation({ trackerConnector: null })), 'autopilot tracker')?.status).toBe(
      'unknown',
    );
    expect(named(autopilotPreflight(observation({ trackerConnector: false })), 'autopilot tracker')?.status).toBe(
      'fail',
    );
  });

  it('keeps undetermined worktree support apart from unusable worktrees', () => {
    expect(named(autopilotPreflight(observation({ worktreesUsable: null })), 'autopilot worktrees')?.status).toBe(
      'unknown',
    );
    expect(named(autopilotPreflight(observation({ worktreesUsable: false })), 'autopilot worktrees')?.status).toBe(
      'fail',
    );
  });
});

// A caller that never asks is not a caller that failed to read. `doctor` is
// offline by contract, so its two remote-backed facts are unprobed on every
// project, forever — reported as "unknown" with a reconfiguration fix, they sent
// operators after a problem that was not theirs (#193).
describe('what nobody probed is not what could not be read', () => {
  it('reports an unprobed tracker as unprobed, with nothing to reconfigure', () => {
    const check = named(autopilotPreflight(observation({ trackerConnector: 'unprobed' })), 'autopilot tracker');

    expect(check?.status).toBe('unprobed');
    expect(check?.fix).toBeUndefined();
    expect(check?.message).toMatch(/preflight/);
  });

  it('reports an unprobed base as unprobed, with nothing to reconfigure', () => {
    const check = named(autopilotPreflight(observation({ baseProtected: 'unprobed' })), 'autopilot base');

    expect(check?.status).toBe('unprobed');
    expect(check?.fix).toBeUndefined();
    expect(check?.message).toMatch(/preflight/);
  });

  it('does not blame the token when protection was probed and refused', () => {
    // The observed 403 was "Upgrade to GitHub Pro or make this repository
    // public" on a token that already carried `repo`: a plan constraint, not a
    // scope one. Naming only the scope hid the constraint that mattered.
    const check = named(autopilotPreflight(observation({ baseProtected: null })), 'autopilot base');

    expect(check?.status).toBe('unknown');
    expect(check?.fix).toMatch(/private repository on a free plan/i);
  });

  it('does not report an unparsable ACTIVE as a missing one', () => {
    // "no plans/ACTIVE.md" in front of a file that is right there sends the
    // reader to author a program they already wrote (#193, same class).
    const results = autopilotPreflight(
      observation({
        program: { malformed: { problem: 'clusterSize is 9, above the maximum of 4', fix: 'set clusterSize to 4 or less' } },
      }),
    );
    const check = named(results, 'autopilot program');

    expect(check?.status).toBe('fail');
    expect(check?.message).not.toMatch(/no plans/);
    // The parser already knew what broke; re-deriving it by hand is the cost.
    expect(check?.message).toMatch(/could not be parsed: clusterSize is 9/);
    expect(check?.fix).toBe('set clusterSize to 4 or less');
  });

  it('judges no field of a file that did not parse', () => {
    // "human merge gate" ✓ and "no verifyCommands" ✗ off an unparsed file state
    // two things the file never said.
    const results = autopilotPreflight(
      observation({ program: { malformed: { problem: 'no frontmatter', fix: 'add a --- block' } } }),
    );

    expect(named(results, 'autopilot merge')?.status).toBe('unknown');
    expect(named(results, 'autopilot verify')?.status).toBe('unknown');
  });

  it('counts an unprobed check as neither a pass nor a blocker', () => {
    const results = autopilotPreflight(observation({ trackerConnector: 'unprobed', baseProtected: 'unprobed' }));

    expect(results.filter((result) => result.status === 'unprobed')).toHaveLength(2);
    expect(results.filter((result) => result.status === 'fail')).toHaveLength(0);
  });
});

describe('the runtime adapter', () => {
  it('fails when none is detected, because no worker could be spawned', () => {
    expect(named(autopilotPreflight(observation({ adapters: [] })), 'autopilot runtime')?.status).toBe('fail');
  });

  it('ignores an adapter it does not know rather than counting it', () => {
    expect(named(autopilotPreflight(observation({ adapters: ['hermes'] })), 'autopilot runtime')?.status).toBe(
      'fail',
    );
  });

  it('accepts either supported runtime', () => {
    for (const adapter of ['claude', 'codex']) {
      expect(named(autopilotPreflight(observation({ adapters: [adapter] })), 'autopilot runtime')?.ok).toBe(true);
    }
  });
});

describe('the doctor wiring', () => {
  const DOCTOR = readFileSync(new URL('../../commands/doctor.ts', import.meta.url), 'utf8');

  it('runs the preflight only for a project that declares a program', () => {
    // Seven extra checks on every project would be noise about a feature they
    // do not use, and would make `doctor` look broken where nothing is wrong.
    expect(DOCTOR).toMatch(/programPath\(root\).*checks\.push\(\.\.\.autopilotPreflight/s);
  });

  it('probes nothing remote, because --no-remote promises an offline run', () => {
    // Unprobed, not null: the offline contract is the same, but the reader is
    // told this run never asks instead of being sent to reconfigure (#193).
    const observer = DOCTOR.slice(DOCTOR.indexOf('function observeAutopilot'));
    expect(observer).toMatch(/trackerConnector: 'unprobed'/);
    expect(observer).toMatch(/baseProtected: 'unprobed'/);
  });

  it('reports a malformed ACTIVE as a failed check rather than crashing doctor', () => {
    const observer = DOCTOR.slice(DOCTOR.indexOf('function observeAutopilot'));
    expect(observer).toMatch(/catch \(error\)/);
    // And as malformed, not as absent: the catch used to collapse both into
    // null, printing "no plans/ACTIVE.md" over a file that was right there.
    expect(observer).toMatch(/\{ malformed \}/);
  });
});
