import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script, intentionally dependency-free
import {
  aggregateGateReports,
  GATES,
  parseArgs,
  parseNameStatus,
  selectGates,
} from '../../scripts/verify.mjs';

const SHA = '2b0e24dc054cf4b7bde36d2e346db341f31501a5';

interface Gate {
  readonly id: string;
  readonly label: string;
  readonly run: readonly string[];
  readonly tier: string;
  readonly resource: string;
  readonly required: boolean;
  readonly artifact?: boolean;
  readonly fix?: readonly string[];
}

interface GateReport {
  readonly schemaVersion: 1;
  readonly gateId: string;
  readonly sha: string;
  readonly argv: readonly string[];
  readonly status: 'passed' | 'failed';
  readonly exitCode: number;
  readonly startedAt: string;
  readonly durationMs: number;
}

const gates = GATES as readonly Gate[];
const requiredIds = gates.filter((gate) => gate.required).map((gate) => gate.id);

function report(gateId: string, over: Partial<GateReport> = {}): GateReport {
  const gate = gates.find((candidate) => candidate.id === gateId);
  if (gate === undefined) throw new Error(`unknown fixture gate ${gateId}`);
  return {
    schemaVersion: 1,
    gateId,
    sha: SHA,
    argv: gate.run,
    status: 'passed',
    exitCode: 0,
    startedAt: '2026-09-04T18:00:00.000Z',
    durationMs: 12,
    ...over,
  };
}

describe('gate catalogue', () => {
  it('defines one stable, shell-free authority for required and observational proof', () => {
    expect(gates.length).toBeGreaterThan(0);
    expect(new Set(gates.map((gate) => gate.id)).size).toBe(gates.length);
    for (const gate of gates) {
      expect(gate.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(gate.label).not.toBe('');
      expect(gate.run.length).toBeGreaterThan(0);
      expect(gate.run.join(' ')).not.toMatch(/[;&|><$`]/);
      expect(['pure', 'contract', 'consumer', 'system', 'certification']).toContain(gate.tier);
      expect(['cpu', 'filesystem', 'subprocess', 'network-browser', 'external-state']).toContain(
        gate.resource,
      );
    }
  });

  it('keeps build before every gate that consumes built package exports', () => {
    const ids = gates.map((gate) => gate.id);
    for (const dependent of ['self-host-sync', 'self-host-doctor', 'typecheck']) {
      expect(ids.indexOf('build')).toBeLessThan(ids.indexOf(dependent));
    }
  });

  it('gives every generated-artifact gate one explicit repair command', () => {
    for (const gate of gates.filter((candidate) => candidate.artifact === true)) {
      expect(gate.fix, gate.id).toBeDefined();
      expect(gate.fix?.length, gate.id).toBeGreaterThan(0);
    }
  });

  it('keeps shared, dependency, workflow and test setup changes conservative', () => {
    for (const path of [
      'packages/core/src/hooks/secret-in-content.sh',
      'pnpm-lock.yaml',
      '.github/workflows/ci.yml',
      'test/support/vitest-options.ts',
    ]) {
      expect(selectGates([{ path, status: 'modified' }]).map((gate: Gate) => gate.id), path)
        .toEqual(requiredIds);
    }
  });

  it('narrows a known leaf while retaining its semantic documentation gates', () => {
    expect(
      selectGates([{ path: 'docs/guides/consumer.md', status: 'modified' }]).map(
        (gate: Gate) => gate.id,
      ),
    ).toEqual(['skill-references']);
  });

  it.each([
    [[{ path: 'docs/old.md', previousPath: 'docs/new.md', status: 'renamed' }], 'rename'],
    [[{ path: 'packages/cli/src/removed.ts', status: 'deleted' }], 'deletion'],
    [[{ path: 'unknown-zone/file.xyz', status: 'modified' }], 'unknown path'],
    [[], 'missing diff'],
  ])('expands %s (%s) to every required gate', (changes) => {
    expect(selectGates(changes).map((gate: Gate) => gate.id)).toEqual(requiredIds);
  });
});

describe('gate evidence aggregation', () => {
  const scoped = requiredIds.slice(0, 2);
  const complete = scoped.map((id) => report(id));

  it('accepts exactly one green report per required gate on the exact SHA and argv', () => {
    expect(aggregateGateReports(scoped, complete, SHA)).toEqual({
      ok: true,
      gateIds: scoped,
      sha: SHA,
      errors: [],
    });
  });

  it.each([
    ['missing', complete.slice(0, 1), /missing/i],
    ['duplicate', [...complete, complete[0]], /duplicate/i],
    ['stale SHA', [complete[0], report(scoped[1] ?? '', { sha: 'a'.repeat(40) })], /stale/i],
    ['red result', [complete[0], report(scoped[1] ?? '', { status: 'failed', exitCode: 1 })], /failed/i],
    ['wrong argv', [complete[0], report(scoped[1] ?? '', { argv: ['pnpm', 'nonesuch'] })], /argv/i],
  ])('fails closed on a %s report set', (_case, reports, message) => {
    const result = aggregateGateReports(scoped, reports, SHA);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(message);
  });
});

describe('verify arguments', () => {
  it('defaults to every required gate', () => {
    expect(parseArgs([])).toMatchObject({
      artifactsOnly: false,
      fix: false,
      list: false,
      observations: false,
      gateId: null,
      aggregate: false,
      unknown: [],
    });
  });

  it('reads local, single-gate and aggregation modes without accepting unknown flags', () => {
    expect(parseArgs(['--artifacts']).artifactsOnly).toBe(true);
    expect(parseArgs(['--fix']).fix).toBe(true);
    expect(parseArgs(['--list']).list).toBe(true);
    expect(parseArgs(['--observations']).observations).toBe(true);
    expect(parseArgs(['--gate', 'lint']).gateId).toBe('lint');
    expect(parseArgs(['--aggregate']).aggregate).toBe(true);
    expect(parseArgs(['--artifact']).unknown).toEqual(['--artifact']);
  });
});

describe('changed-path input', () => {
  it('parses Git name-status records without losing rename or deletion semantics', () => {
    expect(
      parseNameStatus(
        [
          'M',
          'docs/guide.md',
          'D',
          'packages/cli/src/old.ts',
          'R100',
          'docs/old.md',
          'docs/new.md',
          '',
        ].join('\0'),
      ),
    ).toEqual([
      { path: 'docs/guide.md', status: 'modified' },
      { path: 'packages/cli/src/old.ts', status: 'deleted' },
      { path: 'docs/new.md', previousPath: 'docs/old.md', status: 'renamed' },
    ]);
  });

  it('fails closed to the conservative set when Git output is incomplete', () => {
    expect(parseNameStatus(['R100', 'docs/old.md'].join('\0'))).toEqual([]);
  });
});
