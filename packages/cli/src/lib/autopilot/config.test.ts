import { describe, expect, it } from 'vitest';
import { autopilotAuthoritySchema } from './config.js';

const declaration = {
  schemaVersion: 3, enabled: true,
  progress: { provider: 'native', scope: 'project/milestone',
    states: { ready: ['Todo'], started: ['Doing'], review: ['Review'], done: ['Done'] } },
};

describe('persisted Autopilot restrictions', () => {
  it.each([2, 3])('preserves version %s without promoting general configuration reads', schemaVersion => {
    const settings = autopilotAuthoritySchema.parse({ ...declaration, schemaVersion });
    expect(settings).toMatchObject({ schemaVersion, enabled: true, clusterSize: 4, base: 'auto',
      protectedPaths: [], verifyCommands: [], ownership: { sequential: [], reconcileOnly: [] }, humanGates: [] });
    expect(settings.progress).toEqual(declaration.progress);
  });

  it.each([
    { clusterSize: 0 }, { clusterSize: 5 }, { clusterSize: 1.5 },
    { base: '' }, { deployBranch: '' }, { base: 'shipping', deployBranch: 'shipping' },
    { humanWaitLabel: '' }, { humanWaitLabel: 'x'.repeat(51) }, { humanWaitLabel: ' trailing ' },
    { protectedPaths: ['/outside'] }, { protectedPaths: ['../outside'] },
    { protectedPaths: [42] }, { ownership: { sequential: ['../outside'] } },
    { ownership: { reconcileOnly: ['../outside'] } }, { ownership: { extra: [] } },
    { verifyCommands: ['pnpm test'] }, { verifyCommands: [[]] }, { verifyCommands: [[' ']] },
    { humanGates: [' '] }, { progress: { ...declaration.progress, provider: '' } },
    { progress: { ...declaration.progress, scope: '' } },
    { progress: { ...declaration.progress, states: { ...declaration.progress.states, ready: [] } } },
  ])('validates restrictions even when disabled: %j', patch => {
    expect(autopilotAuthoritySchema.safeParse({ ...declaration, ...patch, enabled: false }).success).toBe(false);
  });

  it('preserves configured argv, state roles and protected/owned paths exactly', () => {
    const input = { ...declaration, clusterSize: 1, base: 'integration', deployBranch: 'production',
      humanWaitLabel: 'needs-human', protectedPaths: ['infra/**'], verifyCommands: [['node', '-e', '1']],
      ownership: { sequential: ['lockfile'], reconcileOnly: ['generated/**'] }, humanGates: ['A-1'] };
    expect(autopilotAuthoritySchema.parse(input)).toEqual(input);
  });
});
