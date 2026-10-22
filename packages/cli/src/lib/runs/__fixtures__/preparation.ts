import { createSpecialistDispatch, type MissionSpecialistPlan } from '@voidcorp/mission-engine';
import { recordSpecialistRequests } from '../specialist-lifecycle.js';

/** Historical canonical transport, independent of today's writer-first policy. */
export async function historicalPreparation(
  root: string, missionId: string, plan: MissionSpecialistPlan,
  artifact: { readonly path: string; readonly text: string },
) {
  const action = { kind: 'invoke-specialists' as const, stage: 'pre-implementation' as const,
    reviewRound: 1, specialistIds: plan.specialists.filter(value => value.state === 'applicable'
      && value.stages.includes('pre-implementation')).map(value => value.specialistId) };
  const currentInputHashes = Object.fromEntries(plan.specialists.map(value => {
    if (value.inputHash === undefined) throw new Error('Historical input hash required');
    return [value.specialistId, value.inputHash];
  }));
  const envelopes = createSpecialistDispatch({ missionId, runtime: 'codex', plan, action,
    currentInputHashes, contextContent: { diff: '', touchedPaths: [], artifacts: [artifact],
      lens: 'full', budgetTokens: 6000 } });
  await recordSpecialistRequests(root, missionId, envelopes, plan.planHash);
  return { action, envelopes };
}
