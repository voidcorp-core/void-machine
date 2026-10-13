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
import { loopProgramOf } from './loop.js';

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
  schemaVersion: 2
  clusterSize: 4
  base: auto
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
    expect(descriptor.autopilot?.clusterSize).toBe(4);
  });

  // The loop labels a ticket it hands to a person and reads the label back after
  // a restart, so the name is one the project can choose and never two.
  it('reads the human-wait label when the programme names one', () => {
    expect(parseProgramDescriptor(VALID).autopilot?.humanWaitLabel).toBeUndefined();
    const named = VALID.replace('  clusterSize: 4', '  clusterSize: 4\n  humanWaitLabel: needs-human');
    expect(parseProgramDescriptor(named).autopilot?.humanWaitLabel).toBe('needs-human');
    for (const bad of ['""', '" padded"', '42', 'x'.repeat(51)]) {
      const text = VALID.replace('  clusterSize: 4', `  clusterSize: 4\n  humanWaitLabel: ${bad}`);
      expect(() => parseProgramDescriptor(text), bad).toThrow(/human-wait label/i);
    }
  });

  // The loop never merges a change to these paths itself. The programme can add
  // to the harness floor; it has no way to write a list that removes from it.
  it('reads the protected paths the programme adds, and refuses one that is not a path', () => {
    expect(parseProgramDescriptor(VALID).autopilot?.protectedPaths).toEqual([]);
    const declared = VALID.replace('  clusterSize: 4', '  clusterSize: 4\n  protectedPaths:\n    - infra/**');
    expect(parseProgramDescriptor(declared).autopilot?.protectedPaths).toEqual(['infra/**']);
    for (const bad of ['infra/**', '[""]', '["../outside"]']) {
      const text = VALID.replace('  clusterSize: 4', `  clusterSize: 4\n  protectedPaths: ${bad}`);
      expect(() => parseProgramDescriptor(text), bad).toThrow(/protectedPaths/);
    }
  });

  // Declaring the block IS the consent, so the opt-out is not writing one.
  // Nobody configures a feature in full in order to disable it.
  it('treats an absent autopilot block as the opt-out, and asks nothing more of it', () => {
    const descriptor = parseProgramDescriptor(withoutProgress(withAutopilot('')));

    expect(descriptor.autopilot).toBeUndefined();
    expect(descriptor.progress).toBeUndefined();
  });

  // `enabled: false` is how a project takes back a consent it once gave. Deleting
  // the block would do it too, at the cost of `base`, `mergeGate`, `verifyCommands`
  // and `ownership` -- fifteen lines to remove and restore by hand, which is where
  // the mistake gets made. So the field is read, and the block stays where it is.
  it('reads `enabled: false` as the consent taken back, and reports which one it was', () => {
    const descriptor = parseProgramDescriptor(
      VALID.replace('  clusterSize: 4', '  enabled: false\n  clusterSize: 4'),
    );

    expect(descriptor.autopilot).toBeUndefined();
    expect(descriptor.autopilotConsentWithheld).toBe(true);
  });

  it('keeps consent when `enabled` is absent, and when it is written true', () => {
    const implicit = parseProgramDescriptor(VALID);
    expect(implicit.autopilot?.clusterSize).toBe(4);
    expect(implicit.autopilotConsentWithheld).toBe(false);

    const explicit = parseProgramDescriptor(
      VALID.replace('  clusterSize: 4', '  enabled: true\n  clusterSize: 4'),
    );
    expect(explicit.autopilot?.clusterSize).toBe(4);
    expect(explicit.autopilotConsentWithheld).toBe(false);
  });

  // The direction of the failure decides this. Reading `"false"` as consent is a
  // run nobody authorised; refusing it costs one corrected line.
  it('refuses an `enabled` that is not a boolean rather than reading it as consent', () => {
    for (const bad of ['"false"', 'off', '0', '[]']) {
      expect(
        () => parseProgramDescriptor(VALID.replace('  clusterSize: 4', `  enabled: ${bad}\n  clusterSize: 4`)),
        bad,
      ).toThrow(/enabled/);
    }
  });

  // A block that is present but wrong is an error here as everywhere else. The
  // alternative is a descriptor that rots unread while it is disabled and fails
  // on the day someone turns it back on, which is the worst moment to find out.
  it('validates a disabled block instead of waving it through', () => {
    expect(() =>
      parseProgramDescriptor(
        VALID.replace('  clusterSize: 4', '  enabled: false\n  clusterSize: 9'),
      ),
    ).toThrow(/cluster size/i);
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

  it('reports failures through the provider-agnostic program error code', () => {
    let thrown: unknown;
    try {
      parseProgramDescriptor('# no frontmatter\n');
    } catch (error) {
      thrown = error;
    }

    expect((thrown as { failure: { code: string } }).failure.code).toBe('AUTOPILOT_PROGRAM');
  });

  it('never reads a declared progress provider as consent to autonomy', () => {
    // The inverse of the rule the mandatory-flag test used to protect, and the
    // one that actually matters: a project can wire its tracker for `resume`,
    // `status` and the lifecycle without ever asking for autonomous selection.
    // Inferring consent from a provider would hand it autonomy it never sought.
    const descriptor = parseProgramDescriptor(VALID.replace(/autopilot:\n(?:.*\n)*?---/, '---'));

    expect(descriptor?.autopilot).toBeUndefined();
    expect(descriptor?.progress?.provider).toBe('linear');
  });

  it('rejects unsafe autopilot commands and paths', () => {
    const shellCommand =
      'autopilot:\n  schemaVersion: 2\n  verifyCommands:\n    - pnpm test';
    expect(() => parseProgramDescriptor(withAutopilot(shellCommand))).toThrow(/verifyCommands/);
    expect(() => parseProgramDescriptor(VALID.replace('docs/plans/2026-07-24-plan.md', '/etc/passwd'))).toThrow(
      /plan/,
    );
    expect(() =>
      parseProgramDescriptor(VALID.replace('sequential: [pnpm-lock.yaml]', 'sequential: [../../etc/hosts]')),
    ).toThrow(/ownership/);
  });

  // One merge mode: a programme declares no gate, and the loop merges on its
  // own into the integration branch unless a person holds the merges.
  it('reads a programme that declares no merge gate, with no deploying branch required', () => {
    const descriptor = parseProgramDescriptor(VALID);

    expect(descriptor?.autopilot?.deployBranch).toBeUndefined();
    expect(descriptor?.autopilot?.legacyMergeGate).toBeUndefined();
    expect(loopProgramOf(descriptor).autopilot.base).toBe('auto');
  });

  it('reads the deploying branch when the programme names it', () => {
    const descriptor = parseProgramDescriptor(VALID.replace('base: auto', 'base: develop\n  deployBranch: main'));

    expect(descriptor?.autopilot?.deployBranch).toBe('main');
  });

  it('refuses a programme that integrates straight into the branch it says deploys', () => {
    expect(() => parseProgramDescriptor(VALID.replace('base: auto', 'base: main\n  deployBranch: main')))
      .toThrow(/deployBranch/);
  });

  // A 4.0 programme is autopilot schema 1 and carries `mergeGate`. Readers such
  // as resume and doctor keep working on it; the loop refuses it until it is
  // migrated, so a former human gate is never read as consent to merge.
  const legacy = (gate: string) =>
    VALID.replace('  schemaVersion: 2\n', '  schemaVersion: 1\n').replace('base: auto', `base: develop\n  ${gate}`);

  it('reads a 4.0 human gate and has the loop refuse it, holding the merges first', () => {
    const human = parseProgramDescriptor(legacy('mergeGate: human'));

    expect(human?.autopilot?.legacyMergeGate).toBe('human');
    expect(() => loopProgramOf(human)).toThrow(
      /mergeGate[\s\S]*first run `void-machine autopilot merges --by-human`[\s\S]*schemaVersion: 2/,
    );
  });

  it('reads a 4.0 granted gate and has the loop refuse it, naming the automatic default', () => {
    const granted = parseProgramDescriptor(legacy('mergeGate: union-reviewed\n  deployBranch: main'));

    expect(granted?.autopilot?.legacyMergeGate).toBe('union-reviewed');
    expect(granted?.autopilot?.deployBranch).toBe('main');
    expect(() => loopProgramOf(granted)).toThrow(
      /remove `mergeGate`[\s\S]*merges on its own into the integration branch[\s\S]*schemaVersion: 2/,
    );
  });

  it('refuses a mergeGate written into the current schema, which has none', () => {
    expect(() => parseProgramDescriptor(VALID.replace('base: auto', 'base: auto\n  mergeGate: human')))
      .toThrow(/mergeGate[\s\S]*autopilot merges --by-human/);
  });

  it('refuses an autopilot schema this CLI does not know', () => {
    expect(() => parseProgramDescriptor(VALID.replace('  schemaVersion: 2\n', '  schemaVersion: 3\n')))
      .toThrow(/autopilot schema/);
  });

  it('rejects unknown status and cluster size values', () => {
    expect(() => parseProgramDescriptor(VALID.replace('status: executing', 'status: paused'))).toThrow(
      /status/,
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

    // The status follows the programme's lifecycle; the contract is that it is one this CLI reads.
    expect(['executing', 'completed']).toContain(descriptor?.status);
    expect(descriptor?.progress?.provider).toBe('linear');
    // This repository integrates into develop and ships from main, and says so
    // rather than leaving the loop to read the default branch. The pair is
    // asserted rather than the value alone: a deploy branch equal to the base
    // would make every merge refuse, and the refusal would look like a bug.
    expect(descriptor?.autopilot?.legacyMergeGate).toBeUndefined();
    expect(descriptor?.autopilot?.deployBranch).toBe('main');
    expect(descriptor?.autopilot?.deployBranch).not.toBe(descriptor?.autopilot?.base);
  });
});
