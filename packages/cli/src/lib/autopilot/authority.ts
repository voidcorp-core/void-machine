// The sole read boundary for Autopilot consent. Historical files grant nothing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configSchema } from '../config-schema.js';
import type { AutopilotConfig, ProgressScope } from './config.js';
import { autopilotFailure } from './errors.js';

export const AUTHORITY_CONFIG_PATH = '.void/config.json';

export interface AutopilotAuthority {
  readonly source: string;
  readonly status: 'executing';
  readonly autopilot?: AutopilotConfig;
  readonly autopilotConsentWithheld: boolean;
  readonly progress?: ProgressScope;
  readonly humanGates: readonly string[];
}

function refuse(cause: string): never {
  throw autopilotFailure('AUTOPILOT_PROGRAM', 'the Autopilot authority could not be established', cause,
    'explicitly reconcile prior consent and restrictions, then declare config.autopilot schemaVersion: 3; preserve historical files; no autonomous operation was admitted');
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
  const value = raw.autopilot;
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value) || value.schemaVersion !== 3) {
    return refuse('explicit migration required: config.autopilot.schemaVersion must be 3; older declarations cannot admit autonomous work');
  }
  // Other config fields belong to their own consumers; only this boundary may
  // grant Autopilot. A malformed unrelated pin is not a second consent policy.
  const parsed = configSchema.shape.autopilot.safeParse(raw.autopilot);
  if (!parsed.success) {
    return refuse(`${AUTHORITY_CONFIG_PATH}.autopilot: ${parsed.error.issues.map(issue =>
      `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }
  return parsed.data;
}

export function readAutopilotAuthority(root: string): AutopilotAuthority | undefined {
  const configured = configDeclaration(root);
  if (configured === undefined) return undefined;
  const { enabled, progress, humanGates, ...settings } = configured;
  return {
    source: AUTHORITY_CONFIG_PATH, status: 'executing', progress, humanGates,
    autopilotConsentWithheld: !enabled, ...(enabled ? { autopilot: settings } : {}),
  };
}

export function requireAutopilotAuthority(root: string): AutopilotAuthority {
  const authority = readAutopilotAuthority(root);
  if (authority === undefined) refuse('config.autopilot is absent; historical programmes do not declare authority');
  return authority;
}
