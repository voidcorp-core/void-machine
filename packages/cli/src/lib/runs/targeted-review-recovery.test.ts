import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { serializeEvent } from '@voidcorp/mission-engine';
import { stoppedTargetedReview } from '../../../../mission-engine/src/test/targeted-review.js';
import { createMission, eventLogPath, inspectMission } from './store.js';
import { parseMissionRecoveryRequest, recordStoppedMissionRecovery } from './mission-recovery.js';

it('accepts the exact targeted-context recovery request at the CLI boundary', () => {
  const { recovery } = stoppedTargetedReview();
  expect(parseMissionRecoveryRequest(recovery.request)).toEqual(recovery.request);
});
it('appends recovery once to an isolated synthetic journal and retains its exact prefix', async () => {
  const fixture = stoppedTargetedReview();
  const root = await mkdtemp(join(tmpdir(), 'targeted-review-cli-'));
  const missionId = fixture.subject.taskId;
  await createMission(root, { missionId, title: 'Synthetic targeted review', mode: 'team' });
  const path = await eventLogPath(root, missionId);
  const before = fixture.events.map(serializeEvent).join('\n') + '\n';
  await writeFile(path, before);
  const request = parseMissionRecoveryRequest(fixture.recovery.request);
  const result = await recordStoppedMissionRecovery(root, missionId, request, fixture.recovery.observation);
  expect(result.recorded).toBe(true);
  expect((await readFile(path, 'utf8')).startsWith(before)).toBe(true);
  expect((await inspectMission(root, missionId, { dependencies: {} })).stream.events).toHaveLength(fixture.events.length + 1);
  expect(await recordStoppedMissionRecovery(root, missionId, request, fixture.recovery.observation))
    .toEqual({ ...result, recorded: false });
});
