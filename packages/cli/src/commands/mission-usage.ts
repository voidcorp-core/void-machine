// tdd-cover: e2e test/cli/mission-usage.test.ts
import { PRODUCT_COMMAND } from '@voidcorp/hook-runner';
import { changeUsageSession } from '../lib/runs/usage-sessions.js';
import { recordUsageAdvisory } from '../lib/runs/usage-advisory.js';

export type UsageMissionArgs =
  | { readonly kind: 'usage-bind'; readonly missionId: string; readonly sourceMissionId: string; readonly json: boolean }
  | { readonly kind: 'usage-unbind'; readonly missionId: string; readonly sourceMissionId: string; readonly json: boolean }
  | { readonly kind: 'advisory-start'; readonly missionId: string; readonly specialistId: string;
      readonly runtime: 'claude' | 'codex'; readonly contextId: string; readonly json: boolean };
interface InvalidUsageArgs {
  readonly kind: 'invalid'; readonly code: 'MISSION_USAGE'; readonly problem: string; readonly fix: string;
}
const MISSION_ID = /^mis_[A-Za-z0-9_-]{8,100}$/;

/** Reuse the mission parser's established validation and diagnostics without adding an argv framework. */
export function parseUsageCommand(
  input: { readonly subcommand: string | undefined; readonly options: readonly string[]; readonly divider: number },
  helpers: {
    readonly invalid: (problem: string, fix: string) => InvalidUsageArgs;
    readonly valueAfter: (args: readonly string[], option: string) => string | undefined;
    readonly missionIdFrom: (args: readonly string[]) => string | InvalidUsageArgs;
    readonly validateOptions: (args: readonly string[], values: readonly string[], flags: readonly string[]) => string | undefined;
  },
): UsageMissionArgs | InvalidUsageArgs | undefined {
  const { subcommand, options, divider } = input;
  const { invalid, valueAfter, missionIdFrom, validateOptions } = helpers;
  if (subcommand === 'usage-bind' || subcommand === 'usage-unbind' || subcommand === 'advisory-start') {
    if (divider !== -1) return invalid('usage commands do not accept a command', 'remove --');
    const names = options.filter(value => value.startsWith('--'));
    if (new Set(names).size !== names.length) return invalid('duplicate usage option', 'provide each option once');
    const error = validateOptions(options, subcommand === 'advisory-start'
      ? ['--id', '--specialist', '--runtime', '--context'] : ['--id', '--source'], ['--json']);
    if (error !== undefined) return invalid(error, `${PRODUCT_COMMAND} mission --help`);
    const missionId = missionIdFrom(options);
    if (typeof missionId !== 'string') return missionId;
    if (subcommand !== 'advisory-start') {
      const sourceMissionId = valueAfter(options, '--source');
      if (sourceMissionId === undefined || !MISSION_ID.test(sourceMissionId)) return invalid('invalid source ID', 'pass --source mis_<exact-session-journal>');
      return { kind: subcommand, missionId, sourceMissionId, json: options.includes('--json') };
    }
    const specialistId = valueAfter(options, '--specialist');
    const runtime = valueAfter(options, '--runtime');
    const contextId = valueAfter(options, '--context');
    if (specialistId === undefined || !/^core:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(specialistId)
      || (runtime !== 'claude' && runtime !== 'codex') || contextId === undefined || contextId.trim() === '') {
      return invalid('advisory start needs a role, runtime and actual native context', 'pass --specialist core:<role> --runtime claude|codex --context <successful-native-context>');
    }
    return { kind: 'advisory-start', missionId, specialistId, runtime, contextId, json: options.includes('--json') };
  }
  return undefined;
}

export async function runUsageCommand(parsed: UsageMissionArgs, journal: string): Promise<string> {
  if (parsed.kind === 'usage-bind' || parsed.kind === 'usage-unbind') {
    const result = await changeUsageSession({ root: journal, missionId: parsed.missionId,
      sourceMissionId: parsed.sourceMissionId, action: parsed.kind === 'usage-bind' ? 'bind' : 'unbind' });
    return parsed.json ? `${JSON.stringify(result)}\n` : `${result.sourceMissionId}: ${result.status}\n`;
  }
  const result = await recordUsageAdvisory({ root: journal, missionId: parsed.missionId,
    specialistId: parsed.specialistId, runtime: parsed.runtime, contextId: parsed.contextId });
  return parsed.json ? `${JSON.stringify(result)}\n` : `${result.eventId}: coordinator-observed advisory start\n`;
}
