// One read boundary for Autopilot consent. Context remains in the programme
// during migration; it never fills missing fields in an explicit JSON grant.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configSchema } from '../config-schema.js';
import { type AutopilotConfig, type ProgressScope, HUMAN_WAIT_LABEL } from './config.js';
import { autopilotFailure } from './errors.js';
import { type ProgramDescriptor, programPath, readProgramDescriptor } from './program.js';

export const AUTHORITY_CONFIG_PATH = '.void/config.json';

export interface AutopilotAuthority {
  readonly source: string;
  readonly status: ProgramDescriptor['status'];
  readonly autopilot?: AutopilotConfig;
  readonly autopilotConsentWithheld: boolean;
  readonly progress?: ProgressScope;
  readonly humanGates: readonly string[];
}

function refuse(cause: string): never {
  throw autopilotFailure('AUTOPILOT_PROGRAM', 'the Autopilot authority could not be established', cause,
    'preserve both declarations and correct .void/config.json or the legacy programme; no autonomous operation was admitted');
}

function configDeclaration(root: string) {
  let text: string;
  try { text = readFileSync(join(root, AUTHORITY_CONFIG_PATH), 'utf8'); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    return refuse(`${AUTHORITY_CONFIG_PATH} could not be read`);
  }
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { return refuse(`${AUTHORITY_CONFIG_PATH} is not valid JSON`); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return refuse(`${AUTHORITY_CONFIG_PATH} must be an object`);
  }
  if (!('autopilot' in raw)) return undefined;
  // Other config fields belong to their own consumers; only this boundary may
  // grant Autopilot. A malformed unrelated pin is not a second consent policy.
  const parsed = configSchema.shape.autopilot.safeParse(raw.autopilot);
  if (!parsed.success) {
    return refuse(`${AUTHORITY_CONFIG_PATH}.autopilot: ${parsed.error.issues.map(issue =>
      `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }
  return parsed.data;
}

const orderedSet = (values: readonly string[]) => [...new Set(values)].sort();

/** Sets ignore spelling order; argv and verification command order keep their meaning. */
function comparable(authority: AutopilotAuthority): string {
  const settings = authority.autopilot;
  const progress = authority.progress;
  return JSON.stringify({
    enabled: !authority.autopilotConsentWithheld && settings !== undefined && authority.status === 'executing',
    ...(settings === undefined ? {} : {
      schemaVersion: settings.schemaVersion, clusterSize: settings.clusterSize,
      base: settings.base, deployBranch: settings.deployBranch,
      humanWaitLabel: settings.humanWaitLabel ?? HUMAN_WAIT_LABEL,
      protectedPaths: orderedSet(settings.protectedPaths), verifyCommands: settings.verifyCommands,
      ownership: { sequential: orderedSet(settings.ownership.sequential),
        reconcileOnly: orderedSet(settings.ownership.reconcileOnly) },
    }),
    ...(progress === undefined ? {} : { progress: { provider: progress.provider, scope: progress.scope,
      states: Object.fromEntries(Object.entries(progress.states).map(([role, states]) => [role, orderedSet(states)])) } }),
    humanGates: orderedSet(authority.humanGates),
  });
}

export function readAutopilotAuthority(root: string): AutopilotAuthority | undefined {
  const configured = configDeclaration(root);
  const legacy = readProgramDescriptor(root);
  if (configured === undefined) {
    return legacy === undefined ? undefined : { ...legacy, source: programPath(root) };
  }
  const { enabled, progress, humanGates, ...settings } = configured;
  const authority: AutopilotAuthority = {
    source: AUTHORITY_CONFIG_PATH, status: 'executing', progress, humanGates,
    autopilotConsentWithheld: !enabled, ...(enabled ? { autopilot: settings } : {}),
  };
  const legacyDeclared = legacy?.autopilot !== undefined || legacy?.autopilotConsentWithheld === true;
  if (legacy !== undefined && legacyDeclared) {
    // Two disabled declarations cannot grant any operation. Their restrictions
    // need equivalence only before admitting an enabled authority.
    if (!enabled && legacy.autopilotConsentWithheld) return authority;
    if (comparable(authority) !== comparable({ ...legacy, source: programPath(root) })) {
      refuse(`${AUTHORITY_CONFIG_PATH}.autopilot conflicts with ${programPath(root)} (consent, targets, scope or restrictions differ)`);
    }
  }
  return authority;
}

export function requireAutopilotAuthority(root: string): AutopilotAuthority {
  const authority = readAutopilotAuthority(root);
  if (authority === undefined) refuse('neither .void/config.json nor the legacy programme declares Autopilot');
  return authority;
}
