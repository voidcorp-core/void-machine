import { createHash } from 'node:crypto';
import * as z from 'zod/mini';
import type { AgentRuntime } from '../runtime-input.js';
import { record } from './executor-shared.js';

const digest = z.string().check(z.regex(/^[a-f0-9]{64}$/));
export const readLoopState = z.strictObject({ schemaVersion: z.literal(1), sessions: z.array(z.strictObject({
  session: digest, fingerprint: digest, invocation: digest,
  count: z.number().check(z.int(), z.minimum(1), z.maximum(4)),
  at: z.number().check(z.int(), z.minimum(0)),
})).check(z.maxLength(32)) });
export type ReadLoopState = z.infer<typeof readLoopState>;
export type ReadObservation = { readonly session: string } & (
  | { readonly kind: 'reset' }
  | { readonly kind: 'read'; readonly fingerprint: string; readonly invocation: string }
);
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const identity = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= 256
  && [...value].every(char => (char.codePointAt(0) ?? 0) >= 32 && char.codePointAt(0) !== 127);

// Only object key order is normalized. No path, flag, string or array equivalence is guessed.
function canonical(value: unknown): string | undefined {
  let remaining = 4096;
  function visit(item: unknown, depth: number): unknown {
    if (--remaining < 0 || depth > 32) throw new Error('bounded-json');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(child => visit(child, depth + 1));
    const object = record(item);
    if (object === undefined) throw new Error('invalid-json');
    return Object.fromEntries(Object.keys(object).sort().map(key => [key, visit(object[key], depth + 1)]));
  }
  try {
    const serialized = JSON.stringify(visit(value, 0));
    return serialized !== undefined && Buffer.byteLength(serialized) <= 262_144 ? serialized : undefined;
  } catch { return undefined; }
}

export function observeRead(rawInput: unknown, runtime: AgentRuntime): ReadObservation | undefined {
  const raw = record(rawInput);
  if (raw === undefined || runtime === 'unknown' || !identity(raw['session_id'])) return undefined;
  const session = hash(`${runtime}\0${raw['session_id']}`);
  const reset = { kind: 'reset', session } as const;
  // Claude's successful PostToolUse and explicit error markers are observed, not inferred from text.
  if (raw['hook_event_name'] !== 'PostToolUse' || !['Read', 'Grep', 'Glob'].includes(String(raw['tool_name']))) return reset;
  const response = raw['tool_response'];
  const result = record(response);
  if (response === undefined || response === null
    || (result !== undefined && (Object.keys(result).length === 0 || result['is_error'] === true
      || result['isError'] === true || result['success'] === false || result['error'] !== undefined
      || result['interrupted'] === true || (typeof result['exit_code'] === 'number' && result['exit_code'] !== 0)))) return reset;
  if (!identity(raw['tool_use_id']) || record(raw['tool_input']) === undefined) return reset;
  const args = canonical(raw['tool_input']);
  const output = canonical(response);
  if (args === undefined || output === undefined) return reset;
  return { kind: 'read', session, invocation: hash(raw['tool_use_id']),
    fingerprint: hash(`${raw['tool_name']}\0${args}\0${output}`) };
}

export function advanceReadLoop(state: ReadLoopState, observation: ReadObservation, now: number): {
  readonly state: ReadLoopState; readonly warn: boolean;
} {
  const fresh = state.sessions.filter(entry => entry.at <= now && now - entry.at < 86_400_000);
  const previous = fresh.find(entry => entry.session === observation.session);
  const others = fresh.filter(entry => entry.session !== observation.session);
  if (observation.kind === 'reset') return { state: { schemaVersion: 1, sessions: others }, warn: false };
  if (previous?.invocation === observation.invocation) return { state: { schemaVersion: 1, sessions: fresh }, warn: false };
  const count = previous?.fingerprint === observation.fingerprint ? Math.min(previous.count + 1, 4) : 1;
  return { state: { schemaVersion: 1, sessions: [...others.slice(-31), {
    session: observation.session, fingerprint: observation.fingerprint,
    invocation: observation.invocation, count, at: now,
  }] }, warn: count === 4 && previous?.count === 3 };
}
