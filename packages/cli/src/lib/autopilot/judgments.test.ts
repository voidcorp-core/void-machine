import { describe, expect, it } from 'vitest';
import {
  admitConflictClass,
  admitCuratorQueue,
  admitLocalReview,
  admitReviewCompletion,
  admitReviewVerdict,
  admitTicketReadiness,
  BLOCKING_MAX,
  CURATOR_QUEUE_MAX,
  JUSTIFICATION_MAX,
  REASON_MAX,
  type Admission,
} from './judgments.js';

// Every judgment an agent returns crosses this boundary before the loop acts on
// it. The refusals matter as much as the admissions: a malformed answer must
// stop the loop with the name of the field at fault, never become a default.

function refusal<T>(admission: Admission<T>): string {
  if (admission.ok) throw new Error('expected a refusal, got an admission');
  return admission.reason;
}

function admitted<T>(admission: Admission<T>): T {
  if (!admission.ok) throw new Error(`expected an admission, got: ${admission.reason}`);
  return admission.value;
}

const entry = (ticketId: string) => ({
  ticketId,
  justification: 'Unblocks the loop kernel, which every later slice needs.',
  footprint: ['packages/cli/src/lib/autopilot/loop.ts'],
});

const blocking = {
  location: 'packages/cli/src/lib/autopilot/loop.ts:42',
  scenario: 'Two tickets with nested areas both receive a slot and edit the same file.',
  correction: 'Sequence the pair when their reaches nest.',
};

describe('admitTicketReadiness', () => {
  it.each(['ready', 'needs-enrichment', 'ambiguous'] as const)('admits %s', (verdict) => {
    const value = admitted(admitTicketReadiness({ verdict, reason: 'Acceptance criteria named.' }));
    expect(value).toEqual({ verdict, reason: 'Acceptance criteria named.' });
  });

  it('refuses a verdict outside the enumeration, naming the field', () => {
    expect(refusal(admitTicketReadiness({ verdict: 'maybe', reason: 'x' }))).toContain('verdict');
  });

  it('refuses a missing reason, naming the field', () => {
    expect(refusal(admitTicketReadiness({ verdict: 'ready' }))).toContain('reason');
  });

  it.each(['', '   '])('refuses a blank reason %j', (reason) => {
    expect(refusal(admitTicketReadiness({ verdict: 'ready', reason }))).toContain('reason');
  });

  it('refuses a reason over the bound', () => {
    const reason = 'x'.repeat(REASON_MAX + 1);
    expect(refusal(admitTicketReadiness({ verdict: 'ready', reason }))).toContain('reason');
  });

  it('refuses an unknown field rather than ignoring it', () => {
    const judgment = { verdict: 'ready', reason: 'Clear.', confidence: 0.9 };
    expect(refusal(admitTicketReadiness(judgment))).toContain('confidence');
  });

  it.each([undefined, 'ready', 7, []])('refuses a non-object answer %j', (value) => {
    expect(admitTicketReadiness(value).ok).toBe(false);
  });
});

describe('admitCuratorQueue', () => {
  it('admits an ordered queue and keeps its order', () => {
    const value = admitted(admitCuratorQueue({ entries: [entry('DEV-2'), entry('DEV-1')] }));
    expect(value.entries.map((queued) => queued.ticketId)).toEqual(['DEV-2', 'DEV-1']);
  });

  it('admits an empty queue, which is how the curator says nothing is ready', () => {
    expect(admitted(admitCuratorQueue({ entries: [] })).entries).toEqual([]);
  });

  it('admits a queue at the bound', () => {
    const entries = Array.from({ length: CURATOR_QUEUE_MAX }, (_, index) => entry(`DEV-${index}`));
    expect(admitted(admitCuratorQueue({ entries })).entries).toHaveLength(CURATOR_QUEUE_MAX);
  });

  it('reads each footprint area the way footprint-area reads it', () => {
    const queued = { ...entry('DEV-1'), footprint: ['./packages/core/templates/'] };
    const value = admitted(admitCuratorQueue({ entries: [queued] }));
    expect(value.entries[0]?.footprint).toEqual(['packages/core/templates']);
  });

  it('refuses a queue over the bound', () => {
    const entries = Array.from({ length: CURATOR_QUEUE_MAX + 1 }, (_, i) => entry(`DEV-${i}`));
    expect(refusal(admitCuratorQueue({ entries }))).toContain('entries');
  });

  it('refuses a ticket queued twice, naming the second place', () => {
    const reason = refusal(admitCuratorQueue({ entries: [entry('DEV-1'), entry('DEV-1')] }));
    expect(reason).toContain('entries.1.ticketId');
  });

  it('refuses a missing ticket id, naming the field', () => {
    const { ticketId: _dropped, ...rest } = entry('DEV-1');
    expect(refusal(admitCuratorQueue({ entries: [rest] }))).toContain('entries.0.ticketId');
  });

  it.each(['', 'DEV 1', 'dev/1', '-DEV-1'])('refuses the ticket id %j', (ticketId) => {
    expect(refusal(admitCuratorQueue({ entries: [entry(ticketId)] }))).toContain('ticketId');
  });

  it.each(['', '  ', 'x'.repeat(JUSTIFICATION_MAX + 1)])(
    'refuses the justification %j',
    (justification) => {
      const queued = { ...entry('DEV-1'), justification };
      const reason = refusal(admitCuratorQueue({ entries: [queued] }));
      expect(reason).toContain('entries.0.justification');
    },
  );

  it('refuses an entry without a declared footprint', () => {
    const queued = { ...entry('DEV-1'), footprint: [] };
    expect(refusal(admitCuratorQueue({ entries: [queued] }))).toContain('entries.0.footprint');
  });

  it.each(['', './', '/abs/path', 'packages//core', '../outside'])(
    'refuses the area %j, which claims nothing',
    (area) => {
      const queued = { ...entry('DEV-1'), footprint: [area] };
      const reason = refusal(admitCuratorQueue({ entries: [queued] }));
      expect(reason).toContain('entries.0.footprint.0');
    },
  );

  it('refuses a missing entries list', () => {
    expect(refusal(admitCuratorQueue({}))).toContain('entries');
  });
});

const CONFLICT_HEAD = '7d71b1da4f406f9559b1c174553a17282cb3704c';

describe('admitConflictClass', () => {
  it('binds the class to the head whose conflict it describes', () => {
    const unbound = { class: 'mechanical', reason: 'Both sides appended to one list.' };
    expect(refusal(admitConflictClass(unbound))).toContain('headSha');
  });

  it.each(['mechanical', 'semantic'] as const)('admits %s', (conflict) => {
    const judgment = { headSha: CONFLICT_HEAD, class: conflict, reason: 'Both sides reordered the same import block.' };
    expect(admitted(admitConflictClass(judgment))).toEqual(judgment);
  });

  it('refuses a class outside the enumeration, naming the field', () => {
    expect(refusal(admitConflictClass({ headSha: CONFLICT_HEAD, class: 'trivial', reason: 'x' }))).toContain('class');
  });

  it('refuses a missing class', () => {
    expect(refusal(admitConflictClass({ headSha: CONFLICT_HEAD, reason: 'x' }))).toContain('class');
  });

  it.each(['', '\n', 'x'.repeat(REASON_MAX + 1)])('refuses the reason %j', (reason) => {
    expect(refusal(admitConflictClass({ headSha: CONFLICT_HEAD, class: 'mechanical', reason }))).toContain('reason');
  });
});

const HEAD = 'ca7fdc0008c5b597224c37b195e2a0ba0cd58e63';

describe('admitReviewVerdict', () => {
  it('binds the verdict to the full head SHA it read', () => {
    expect(refusal(admitReviewVerdict({ round: 1, blocking: [], advisory: [] }))).toContain('headSha');
    const short = { headSha: 'ca7fdc0', round: 1, blocking: [], advisory: [] };
    expect(refusal(admitReviewVerdict(short))).toContain('headSha');
  });

  it('admits a first round with a blocking finding and an advisory', () => {
    const judgment = {
      headSha: HEAD,
      round: 1,
      blocking: [blocking],
      advisory: [{ note: 'The helper name could say what it measures.' }],
    };
    expect(admitted(admitReviewVerdict(judgment))).toEqual(judgment);
  });

  it('admits a clean second round', () => {
    const judgment = { headSha: HEAD, round: 2, blocking: [], advisory: [] };
    expect(admitted(admitReviewVerdict(judgment))).toEqual(judgment);
  });

  it('admits an advisory anchored to a location', () => {
    const advisory = [{ location: 'docs/x.md:3', note: 'A sentence runs long.' }];
    const judgment = { headSha: HEAD, round: 1, blocking: [], advisory };
    expect(admitted(admitReviewVerdict(judgment)).advisory).toEqual(advisory);
  });

  it.each([0, 3, 1.5, '1'])('refuses the round %j', (round) => {
    const reason = refusal(admitReviewVerdict({ headSha: HEAD, round, blocking: [], advisory: [] }));
    expect(reason).toContain('round');
  });

  it.each(['location', 'scenario', 'correction'] as const)(
    'refuses a blocking finding without its %s',
    (field) => {
      const { [field]: _dropped, ...rest } = blocking;
      const reason = refusal(admitReviewVerdict({ headSha: HEAD, round: 1, blocking: [rest], advisory: [] }));
      expect(reason).toContain(`blocking.0.${field}`);
    },
  );

  it.each(['', '   '])('refuses a blocking finding with the blank scenario %j', (scenario) => {
    const finding = { ...blocking, scenario };
    const reason = refusal(admitReviewVerdict({ headSha: HEAD, round: 1, blocking: [finding], advisory: [] }));
    expect(reason).toContain('blocking.0.scenario');
  });

  it.each(['loop.ts', 'loop.ts:0', 'loop.ts:x', ':12', 'a b.ts:3'])(
    'refuses the location %j, which is not file:line',
    (location) => {
      const finding = { ...blocking, location };
      const reason = refusal(admitReviewVerdict({ headSha: HEAD, round: 1, blocking: [finding], advisory: [] }));
      expect(reason).toContain('blocking.0.location');
    },
  );

  it('refuses a missing advisory list rather than defaulting it', () => {
    expect(refusal(admitReviewVerdict({ headSha: HEAD, round: 1, blocking: [] }))).toContain('advisory');
  });

  it('refuses an advisory with a blank note', () => {
    const judgment = { headSha: HEAD, round: 1, blocking: [], advisory: [{ note: '' }] };
    const reason = refusal(admitReviewVerdict(judgment));
    expect(reason).toContain('advisory.0.note');
  });

  it('refuses too many blocking findings', () => {
    const findings = Array.from({ length: BLOCKING_MAX + 1 }, () => blocking);
    const reason = refusal(admitReviewVerdict({ headSha: HEAD, round: 1, blocking: findings, advisory: [] }));
    expect(reason).toContain('blocking');
  });
});

const RUN = 'run_00000000-0000-4000-8000-000000000001';
const SESSION = '6d5ea8bb-764f-4463-b733-8b94509eb25e';

/** The completion the independent-code-reviewer contract asks its final message to be. */
function completion(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    specialistId: 'core:independent-code-reviewer',
    contractVersion: 1,
    completionId: 'review-0001',
    verdict: 'pass',
    findings: [],
    evidenceRequests: [],
    limitations: [],
    ...extra,
  };
}

const blockingFinding = {
  id: 'nested-areas-collide',
  severity: 'high',
  summary: 'Two tickets with nested areas both receive a slot.',
  evidence: [{ path: 'packages/cli/src/lib/autopilot/loop.ts', line: 42, detail: 'claimsCollide ignores nesting' }],
  recommendation: 'Sequence the pair.',
  classification: 'blocking',
  criterion: 'Colliding footprints run in sequence.',
  consequence: 'Both workers edit the same file.',
  resolutionCondition: 'Nested areas are sequenced.',
  basis: 'initial-scope-defect',
};

const advisoryFinding = {
  id: 'name-could-be-clearer',
  severity: 'low',
  summary: 'The helper name hides what it compares.',
  evidence: [{ path: 'packages/cli/src/lib/autopilot/loop.ts', line: 7, detail: 'claimsCollide' }],
  recommendation: 'Rename it.',
  classification: 'advisory',
};

describe('admitReviewCompletion', () => {
  const admit = (value: unknown, round: 1 | 2 = 1) =>
    admitReviewCompletion(typeof value === 'string' ? value : JSON.stringify(value), HEAD, round);

  it('binds a clean completion to the head and round the kernel names, never to one the reviewer states', () => {
    expect(admitted(admit(completion({ findings: [advisoryFinding] }), 2))).toEqual({
      headSha: HEAD,
      round: 2,
      blocking: [],
      advisory: [{
        location: 'packages/cli/src/lib/autopilot/loop.ts:7',
        note: 'The helper name hides what it compares. Rename it.',
      }],
    });
  });

  it('turns each blocking finding into a location, a scenario and a correction', () => {
    const verdict = admitted(admit(completion({ verdict: 'changes-requested', findings: [blockingFinding] })));
    expect(verdict.blocking).toEqual([{
      location: 'packages/cli/src/lib/autopilot/loop.ts:42',
      scenario: 'Two tickets with nested areas both receive a slot. Both workers edit the same file.',
      correction: 'Nested areas are sequenced.',
    }]);
  });

  it('clips a long text to the bound a recap reads, rather than refusing a real finding', () => {
    const long = 'x'.repeat(REASON_MAX * 2);
    const finding = { ...blockingFinding, resolutionCondition: long };
    const verdict = admitted(admit(completion({ verdict: 'blocked', limitations: ['none'], findings: [finding] })));
    expect(verdict.blocking[0]?.correction).toHaveLength(REASON_MAX);
  });

  it.each([
    ['text that is not JSON', 'Looks good to me.'],
    ['a completion another specialist signed', completion({ specialistId: 'core:security-engineer' })],
    ['a reviewer that could not judge', completion({ verdict: 'degraded', limitations: ['diff omitted'] })],
    ['a pass that carries a blocking finding', completion({ findings: [blockingFinding] })],
    ['a verdict that blocks on nothing', completion({ verdict: 'changes-requested' })],
    ['a blocking finding without a location', completion({
      verdict: 'changes-requested', findings: [{ ...blockingFinding, evidence: [] }],
    })],
    ['a completion outside the contract', { verdict: 'pass' }],
  ])('refuses %s: it never becomes a clean verdict', (_case, value) => {
    expect(refusal(admit(value))).toMatch(/review completion refused/);
  });
});

describe('admitLocalReview', () => {
  const verdict = { headSha: HEAD, round: 1, blocking: [], advisory: [] };
  const record = (extra: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    ticketId: 'DEV-1',
    pullRequest: 12,
    headSha: HEAD,
    attempts: [{ runId: RUN, startedAt: 1_000, endedAt: 2_000 }],
    verdict: { runId: RUN, sessionId: SESSION, recordedAt: 2_000, verdict },
    ...extra,
  });

  it('admits the record the kernel wrote: attempts, and the verdict bound to its run and session', () => {
    expect(admitted(admitLocalReview(record()))).toMatchObject({ headSha: HEAD, verdict: { sessionId: SESSION } });
    const { verdict: _none, ...pending } = record();
    expect(admitted(admitLocalReview(pending))).not.toHaveProperty('verdict');
  });

  it.each([
    ['a verdict judged on another head', record({ verdict: { runId: RUN, sessionId: SESSION, recordedAt: 2_000,
      verdict: { ...verdict, headSha: 'b'.repeat(40) } } })],
    ['a verdict no session is bound to', record({ verdict: { runId: RUN, recordedAt: 2_000, verdict } })],
    ['a verdict from a run no attempt started', record({ attempts: [] })],
    ['an unknown field', record({ approved: true })],
    ['text', 'approved'],
  ])('refuses %s', (_case, value) => {
    expect(refusal(admitLocalReview(value))).toMatch(/local review refused/);
  });
});
