import type { ProjectRoots } from '../project-roots.js';
import { computeProjectState, type ProjectState } from './project-state.js';
import { inspectMission } from './store.js';

/** The tree is hashed from `workRoot`; the journal is read from `installRoot`. */
export async function inspectCurrentMission(
  roots: ProjectRoots,
  missionId: string,
  secrets: readonly string[],
  options: { readonly quarantine?: boolean } = {},
): Promise<{
  readonly inspected: Awaited<ReturnType<typeof inspectMission>>;
  readonly project: ProjectState;
}> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await computeProjectState(roots.workRoot);
    const inspected = await inspectMission(
      roots.installRoot,
      missionId,
      { dependencies: { 'git:working-tree': before.diffHash } },
      { secrets, ...options },
    );
    const after = await computeProjectState(roots.workRoot);
    if (before.diffHash === after.diffHash) {
      return { inspected, project: after };
    }
  }
  throw new Error(
    'MISSION_PROJECT_CHANGED_DURING_INSPECT: retry after concurrent writes settle',
  );
}
