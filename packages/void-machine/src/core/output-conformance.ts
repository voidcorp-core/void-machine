// tdd-cover: e2e packages/void-machine/test/output-conformance.test.ts
import { z } from 'zod';

/**
 * Whether a delegated agent's final message conforms to the output schema its run asked for.
 * Pure. The verdict is metadata beside an untrusted text: nothing reads a decision from it, and
 * what could not be checked is never called valid.
 */

/** An output schema is stored with its run and read back under this bound. */
export const MAX_OUTPUT_SCHEMA_BYTES = 65_536;

export type Conformance =
  | { readonly state: 'valid' | 'not-applicable' }
  | { readonly state: 'invalid' | 'unchecked'; readonly cause: string };

type Compiled = { readonly ok: true; readonly schema: z.ZodType } | { readonly ok: false; readonly cause: string };

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every `$ref` of the document, wherever it sits: a reference outside it names a remote resource. */
function remoteReference(value: unknown, depth = 0): string | undefined {
  if (depth > 64) return 'the schema nests deeper than 64 levels';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = remoteReference(item, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isObject(value)) return undefined;
  const reference = value['$ref'];
  if (typeof reference === 'string' && !reference.startsWith('#')) {
    return `the schema names a $ref outside itself (${reference.slice(0, 100)})`;
  }
  for (const child of Object.values(value)) {
    const found = remoteReference(child, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function compile(schema: Readonly<Record<string, unknown>>): Compiled {
  try {
    return { ok: true, schema: z.fromJSONSchema(schema) };
  } catch (error) {
    return { ok: false, cause: error instanceof Error ? error.message.slice(0, 300) : 'the schema did not compile' };
  }
}

/** Why an output schema cannot be admitted with a run, or undefined when it can. */
export function outputSchemaRefusal(schema: unknown): string | undefined {
  if (!isObject(schema)) return 'the output schema must be a JSON object';
  if (new TextEncoder().encode(JSON.stringify(schema)).byteLength > MAX_OUTPUT_SCHEMA_BYTES) {
    return `the output schema must hold at most ${String(MAX_OUTPUT_SCHEMA_BYTES / 1024)} KiB`;
  }
  const remote = remoteReference(schema);
  if (remote !== undefined) return remote;
  const compiled = compile(schema);
  return compiled.ok ? undefined : `the output schema cannot be checked: ${compiled.cause}`;
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return 'the final message does not match the schema';
  const path = issue.path.length === 0 ? 'the message' : issue.path.map(String).join('.');
  return `${path}: ${issue.message}`.slice(0, 300);
}

export function checkConformance(schema: unknown, text: string, truncated: boolean): Conformance {
  if (schema === undefined) return { state: 'not-applicable' };
  if (truncated) return { state: 'invalid', cause: 'the final message was truncated before it could be checked' };
  const compiled = isObject(schema) ? compile(schema) : { ok: false as const, cause: 'the schema is not an object' };
  if (!compiled.ok) return { state: 'unchecked', cause: `the recorded schema cannot be checked: ${compiled.cause}` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: 'invalid', cause: 'the final message is not JSON' };
  }
  const result = compiled.schema.safeParse(parsed);
  return result.success ? { state: 'valid' } : { state: 'invalid', cause: firstIssue(result.error) };
}
