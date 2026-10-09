import {
  installedSkillNames,
  type LivenessVerdict,
  livenessVerdict,
  readMissionJournals,
  type ResolutionVerdict,
  resolutionVerdict,
  withSuccessor,
} from '@voidcorp/hook-runner';
import type { CheckResult } from './prerequisites.js';

/**
 * What `doctor` reports about the invocation surface.
 *
 * The session banner has room for one name list; this has room for the evidence
 * behind it. The ratio of activations to tool calls is shown here and judged
 * nowhere: four values observed across the whole corpus (0 %, 0.25 %, 0.7 %, 2 %)
 * define no normal, and a threshold invented on top of them would cry wrong and
 * then be turned off.
 */
export interface InvocationObservation {
  readonly resolution: ResolutionVerdict;
  readonly liveness: LivenessVerdict;
  readonly installedSkills: number;
}

const NAME = 'invocation surface';

/** Read the project's journals and installed skills. Touches the filesystem. */
export function observeInvocation(root: string): InvocationObservation {
  const journals = readMissionJournals(root);
  const installed = installedSkillNames(root);
  return {
    // Same window as the banner: a rename repaired last month must not keep this
    // check red for ever, or nobody reads doctor's output either.
    resolution: resolutionVerdict(journals, installed, { nowMs: Date.now() }),
    liveness: livenessVerdict(journals),
    installedSkills: installed.size,
  };
}

function ratio(liveness: LivenessVerdict): string {
  if (liveness.toolCalls === 0) return '0 %';
  return `${((liveness.skillCalls / liveness.toolCalls) * 100).toFixed(1)} %`;
}

/**
 * Renames the journal remembers and nothing calls any more.
 *
 * Said in the message rather than in the status: `doctor` reports the present,
 * and a rename already dealt with is history. Reporting it as a fault — red, or
 * even advisory — asks for an action that does not exist, and a verdict nobody
 * can satisfy is a verdict everybody learns to skip past.
 */
function settledRenames(resolution: ResolutionVerdict): string {
  const settled = resolution.retired.filter((name) => !resolution.unresolved.includes(name));
  if (settled.length === 0) return '';
  return `; ${String(settled.length)} settled rename(s): ${settled.map(withSuccessor).join(', ')}`;
}

function evidence(observation: InvocationObservation): string {
  const { liveness } = observation;
  const unseen = liveness.unobservable.map(({ source, toolCalls }) =>
    `skill usage not observable for ${source} (${toolCalls} tool calls); activation count unknown`,
  ).join('; ');
  if (liveness.missions === 0 && unseen !== '') {
    return `${observation.installedSkills} skill(s) installed; ${unseen}`;
  }
  if (liveness.missions === 0) {
    return `${observation.installedSkills} skill(s) installed, no working mission recorded yet`;
  }
  return (
    `${observation.installedSkills} skill(s) installed, ${liveness.skillCalls} activation(s) `
    + `across ${liveness.toolCalls} tool calls (${ratio(liveness)}) over ${liveness.missions} observable Claude working mission(s)`
    + (unseen === '' ? '' : `; ${unseen}`)
  );
}

/** The `doctor` line for the invocation surface. Pure. */
export function judgeInvocation(observation: InvocationObservation): CheckResult {
  const faults: string[] = [];
  if (!observation.resolution.ok) {
    faults.push(
      `${observation.resolution.unresolved.length} retired name(s) recorded: `
      + observation.resolution.unresolved.map(withSuccessor).join(', '),
    );
  }
  if (!observation.liveness.ok) {
    faults.push(
      `no skill fired across ${observation.liveness.missions} working mission(s) `
      + `and ${observation.liveness.toolCalls} tool calls (runtime:claude)`,
    );
  }
  if (faults.length === 0) {
    return {
      name: NAME,
      ok: observation.liveness.unobservable.length === 0,
      status: observation.liveness.unobservable.length === 0 ? 'pass' : 'unknown',
      message: `${evidence(observation)}${settledRenames(observation.resolution)}`,
    };
  }
  return {
    name: NAME,
    ok: false,
    status: 'fail',
    // Both faults, never the first alone: they have different causes, and fixing
    // one would otherwise reveal the other only on the next run.
    message: `${faults.join('; ')}; ${evidence(observation)}`,
    // Never "reinstall": the file is not missing, the name moved. What the reader
    // has to change is whatever still calls the old name -- a saved command, a
    // habit, another skill's text.
    fix: !observation.resolution.ok
      ? 'invoke each successor named above instead, and update whatever still calls the old name'
      : 'inspect the Claude Skill invocation path and activation collector for the silent missions',
  };
}
