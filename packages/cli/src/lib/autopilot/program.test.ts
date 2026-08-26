import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_PROGRAM_PATHS,
  PROGRAM_PATH,
  parseProgramDescriptor,
  programPath,
  readProgramDescriptor,
} from './program.js';

const VALID = `---
schemaVersion: 1
status: executing
program: void-harness-v3
plan: docs/plans/2026-07-24-plan.md
spec: docs/specs/2026-07-24-spec.md
progress:
  provider: linear
  scope: voidcorp/DEV/void harness
  order: [DEV-433, DEV-434]
  states:
    ready: [Backlog, Todo]
    started: [In Progress]
    review: [In Review]
    done: [Done]
humanGates: [DEV-433]
autopilot:
  schemaVersion: 1
  enabled: true
  clusterSize: 4
  base: auto
  mergeGate: human
  verifyCommands:
    - [pnpm, build]
    - [pnpm, test]
  ownership:
    sequential: [pnpm-lock.yaml]
    reconcileOnly: []
---

# Program
`;

const LEGACY = VALID
  .replace('schemaVersion: 1\n', '')
  .replace(
    `progress:
  provider: linear
  scope: voidcorp/DEV/void harness
  order: [DEV-433, DEV-434]
  states:
    ready: [Backlog, Todo]
    started: [In Progress]
    review: [In Review]
    done: [Done]`,
    `tracker:
  provider: linear
  scope: voidcorp/DEV/void harness
  issues: [DEV-433, DEV-434]
  readyStates: [Backlog, Todo]
  startedState: In Progress
  reviewState: In Review
  doneStates: [Done]`,
  );

function withAutopilot(block: string): string {
  return VALID.replace(/autopilot:\n(?:.*\n)*?---/, `${block}\n---`);
}

function withoutProgress(text: string): string {
  return text.replace(/progress:\n(?:.*\n)*?humanGates:/, 'humanGates:');
}

describe('parseProgramDescriptor', () => {
  it('reads a provider-agnostic program descriptor', () => {
    const descriptor = parseProgramDescriptor(VALID.replace('provider: linear', 'provider: jira'));

    expect(descriptor.schemaVersion).toBe(1);
    expect(descriptor.status).toBe('executing');
    expect(descriptor.program).toBe('void-harness-v3');
    expect(descriptor.progress).toEqual({
      provider: 'jira',
      scope: 'voidcorp/DEV/void harness',
      order: ['DEV-433', 'DEV-434'],
      states: {
        ready: ['Backlog', 'Todo'],
        started: ['In Progress'],
        review: ['In Review'],
        done: ['Done'],
      },
    });
    expect(descriptor.humanGates).toEqual(['DEV-433']);
    expect(descriptor.autopilot.enabled).toBe(true);
  });

  it('accepts no progress source when autonomous selection is disabled', () => {
    const descriptor = parseProgramDescriptor(
      withoutProgress(
        withAutopilot('autopilot:\n  schemaVersion: 1\n  enabled: false\n  mergeGate: human'),
      ),
    );

    expect(descriptor.progress).toBeUndefined();
    expect(descriptor.autopilot.enabled).toBe(false);
  });

  it('rejects autonomous selection without a progress source', () => {
    expect(() => parseProgramDescriptor(withoutProgress(VALID))).toThrow(/progress/);
  });

  it('requires the root schema version on a canonical descriptor', () => {
    expect(() => parseProgramDescriptor(VALID.replace('schemaVersion: 1\n', ''))).toThrow(
      /schemaVersion/,
    );
    expect(() => parseProgramDescriptor(VALID.replace('schemaVersion: 1', 'schemaVersion: 2'))).toThrow(
      /schemaVersion/,
    );
  });

  it('rejects a progress block with an empty provider or state role', () => {
    expect(() => parseProgramDescriptor(VALID.replace('provider: linear', 'provider: ""'))).toThrow(
      /provider/,
    );
    expect(() => parseProgramDescriptor(VALID.replace('ready: [Backlog, Todo]', 'ready: []'))).toThrow(
      /progress.states.ready/,
    );
  });

  it('rejects a progress block with an empty deterministic order', () => {
    expect(() => parseProgramDescriptor(VALID.replace('order: [DEV-433, DEV-434]', 'order: []'))).toThrow(
      /progress.order/,
    );
  });

  it('rejects a file with no frontmatter or invalid YAML', () => {
    expect(() => parseProgramDescriptor('# just a heading\n')).toThrow(/frontmatter/i);
    expect(() => parseProgramDescriptor('---\nstatus: [unclosed\n---\n')).toThrow(/YAML/i);
  });

  it('requires an explicit autopilot decision', () => {
    expect(() => parseProgramDescriptor(VALID.replace(/autopilot:\n(?:.*\n)*?---/, '---'))).toThrow(
      /autopilot/,
    );
  });

  it('rejects unsafe autopilot commands and paths', () => {
    const shellCommand =
      'autopilot:\n  schemaVersion: 1\n  enabled: true\n  mergeGate: human\n  verifyCommands:\n    - pnpm test';
    expect(() => parseProgramDescriptor(withAutopilot(shellCommand))).toThrow(/verifyCommands/);
    expect(() => parseProgramDescriptor(VALID.replace('docs/plans/2026-07-24-plan.md', '/etc/passwd'))).toThrow(
      /plan/,
    );
    expect(() =>
      parseProgramDescriptor(VALID.replace('sequential: [pnpm-lock.yaml]', 'sequential: [../../etc/hosts]')),
    ).toThrow(/ownership/);
  });

  it('rejects unknown status, merge gate and cluster size values', () => {
    expect(() => parseProgramDescriptor(VALID.replace('status: executing', 'status: paused'))).toThrow(
      /status/,
    );
    expect(() => parseProgramDescriptor(VALID.replace('mergeGate: human', 'mergeGate: auto'))).toThrow(
      /mergeGate/,
    );
    expect(() => parseProgramDescriptor(VALID.replace('clusterSize: 4', 'clusterSize: 5'))).toThrow(
      /clusterSize/,
    );
  });
});

describe('readProgramDescriptor', () => {
  function repo(): string {
    const root = mkdtempSync(join(tmpdir(), 'vh-program-'));
    mkdirSync(join(root, '.void'), { recursive: true });
    mkdirSync(join(root, 'plans'), { recursive: true });
    return root;
  }

  it('returns undefined and the canonical write path when no program exists', () => {
    const root = repo();

    expect(readProgramDescriptor(root)).toBeUndefined();
    expect(programPath(root)).toBe(PROGRAM_PATH);
  });

  it('reads the canonical program descriptor', () => {
    const root = repo();
    writeFileSync(join(root, PROGRAM_PATH), VALID);

    expect(readProgramDescriptor(root)?.program).toBe('void-harness-v3');
  });

  it.each(LEGACY_PROGRAM_PATHS)('reads and adapts the legacy schema from %s', (legacyPath) => {
    const root = repo();
    writeFileSync(join(root, legacyPath), LEGACY);

    const descriptor = readProgramDescriptor(root);

    expect(descriptor?.schemaVersion).toBe(1);
    expect(descriptor?.progress?.order).toEqual(['DEV-433', 'DEV-434']);
    expect(programPath(root)).toBe(legacyPath);
  });

  it('rejects a legacy schema at the canonical path', () => {
    const root = repo();
    writeFileSync(join(root, PROGRAM_PATH), LEGACY);

    expect(() => readProgramDescriptor(root)).toThrow(/schemaVersion/);
  });

  it('rejects every ambiguous combination instead of silently choosing one', () => {
    for (const pair of [
      [PROGRAM_PATH, LEGACY_PROGRAM_PATHS[0]],
      [PROGRAM_PATH, LEGACY_PROGRAM_PATHS[1]],
      [LEGACY_PROGRAM_PATHS[0], LEGACY_PROGRAM_PATHS[1]],
    ] as const) {
      const root = repo();
      for (const relativePath of pair) writeFileSync(join(root, relativePath), VALID);

      expect(() => programPath(root)).toThrow(/multiple|ambiguous/i);
      expect(() => readProgramDescriptor(root)).toThrow(/multiple|ambiguous/i);
    }
  });

  it('reads an explicitly named descriptor inside the repository', () => {
    const root = repo();
    writeFileSync(join(root, 'plans', 'OTHER.md'), VALID);

    expect(readProgramDescriptor(root, 'plans/OTHER.md')?.program).toBe('void-harness-v3');
  });

  it('refuses an explicit path outside the repository', () => {
    expect(() => readProgramDescriptor(repo(), '../program.md')).toThrow(/root/i);
    expect(() => readProgramDescriptor(repo(), '/etc/passwd')).toThrow(/root|absolute/i);
  });
});

describe("this repository's program", () => {
  it('satisfies the same canonical contract it ships', () => {
    const descriptor = readProgramDescriptor(new URL('../../../../..', import.meta.url).pathname);

    expect(descriptor?.status).toBe('executing');
    expect(descriptor?.progress?.provider).toBe('linear');
    expect(descriptor?.autopilot.mergeGate).toBe('human');
  });
});
