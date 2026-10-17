import { expect, it } from 'vitest';
import { mergeHoldRecord, MERGE_HOLD_PATH } from './merge-hold.js';
import { parseProgramDescriptor } from './program.js';

const before = `---
schemaVersion: 1
status: executing
program: "preserve quotes" # project comment
plan: docs/plan.md
spec: docs/spec.md
progress:
  provider: linear
  scope: fixture
  order: [DEV-1022]
  states:
    ready: [Todo]
    started: [Doing]
    review: [Review]
    done: [Done]
autopilot:
  schemaVersion: 1 # old contract
  enabled: true
  mergeGate: human # merges stay mine
  base: develop
  deployBranch: main
  verifyCommands: [[pnpm, test]]
---

# Authored body
Keep exactly this text.
`;
const now = '2026-10-13T18:00:00.000Z';

it.each([true, false])('preserves consent %s and publishes a human hold before removing its old gate', async enabled => {
  const { planProgramMigration } = await import('./program-migration.js');
  const input = before.replace('enabled: true', `enabled: ${enabled}`);
  const mutations = planProgramMigration(input, undefined, now);
  expect(mutations.map(mutation => mutation.path)).toEqual([MERGE_HOLD_PATH, '.void/program.md']);
  expect(Buffer.from(mutations[0]?.content ?? []).toString()).toBe(mergeHoldRecord(now));
  const migrated = Buffer.from(mutations[1]?.content ?? []).toString();
  expect(migrated).toBe(input.replace('schemaVersion: 1 # old contract', 'schemaVersion: 2 # old contract').replace('mergeGate: human', ''));
  const descriptor = parseProgramDescriptor(migrated);
  expect(descriptor.schemaVersion).toBe(1);
  expect(descriptor.autopilotConsentWithheld).toBe(!enabled);
});

it('retains an existing valid human hold byte for byte', async () => {
  const { planProgramMigration } = await import('./program-migration.js');
  const existing = mergeHoldRecord('2026-09-01T00:00:00.000Z');
  expect(planProgramMigration(before, existing, now).map(mutation => mutation.path)).toEqual(['.void/program.md']);
});

it.each(['union-reviewed', 'unknown', 'missing', 'damaged-hold', 'future-root', 'future-autopilot'])(
  'refuses %s rather than guessing policy equivalence', async kind => {
    const { planProgramMigration } = await import('./program-migration.js');
    let program = before;
    if (kind === 'union-reviewed') program = program.replace('mergeGate: human', 'mergeGate: union-reviewed');
    if (kind === 'unknown') program = program.replace('mergeGate: human', 'mergeGate: automatic');
    if (kind === 'missing') program = program.replace('  mergeGate: human # merges stay mine\n', '');
    if (kind === 'future-root') program = program.replace('schemaVersion: 1\n', 'schemaVersion: 99\n');
    if (kind === 'future-autopilot') program = program.replace('schemaVersion: 1 # old contract', 'schemaVersion: 99 # old contract');
    expect(() => planProgramMigration(program, kind === 'damaged-hold' ? '{}' : undefined, now)).toThrow();
  },
);

it('leaves an already supported programme unchanged', async () => {
  const { planProgramMigration } = await import('./program-migration.js');
  const supported = before.replace('schemaVersion: 1 # old contract', 'schemaVersion: 2 # old contract').replace('  mergeGate: human # merges stay mine\n', '');
  expect(planProgramMigration(supported, undefined, now)).toEqual([]);
});
