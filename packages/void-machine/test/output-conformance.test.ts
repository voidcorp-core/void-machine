import { describe, expect, it } from 'vitest';
import { MAX_OUTPUT_SCHEMA_BYTES, checkConformance, outputSchemaRefusal } from '../src/core/output-conformance.js';

const verdict = {
  type: 'object',
  properties: { verdict: { type: 'string', enum: ['pass', 'fail'] }, summary: { type: 'string' } },
  required: ['verdict', 'summary'],
  additionalProperties: false,
};

describe('admitting an output schema', () => {
  it('accepts a JSON Schema object that compiles', () => {
    expect(outputSchemaRefusal(verdict)).toBeUndefined();
  });

  it('refuses what is not a schema object', () => {
    for (const value of [undefined, [], 'object', 42, true]) {
      expect(outputSchemaRefusal(value)).toMatch(/JSON object/);
    }
  });

  it('refuses a reference outside the document, which would name a remote resource', () => {
    const remote = { type: 'object', properties: { a: { $ref: 'https://example.com/schema.json' } } };
    expect(outputSchemaRefusal(remote)).toMatch(/\$ref/);
  });

  it('refuses a construct the checker cannot evaluate, rather than never checking it', () => {
    expect(outputSchemaRefusal({ if: { type: 'string' }, then: { minLength: 1 } })).toMatch(/cannot be checked/);
  });

  it('refuses a schema larger than the bound it is stored under', () => {
    const large = { type: 'object', description: 'x'.repeat(MAX_OUTPUT_SCHEMA_BYTES) };
    expect(outputSchemaRefusal(large)).toMatch(/KiB/);
  });
});

describe('checking a final message against its schema', () => {
  it('says not applicable when the run asked for no schema', () => {
    expect(checkConformance(undefined, 'free text', false)).toEqual({ state: 'not-applicable' });
  });

  it('marks a conforming JSON answer valid', () => {
    expect(checkConformance(verdict, '{"verdict":"pass","summary":"Hello."}', false)).toEqual({ state: 'valid' });
  });

  it('keeps a JSON answer that breaks the schema invalid, with the reason', () => {
    const outcome = checkConformance(verdict, '{"verdict":"maybe","summary":"x"}', false);
    expect(outcome.state).toBe('invalid');
    expect(outcome.state === 'invalid' ? outcome.cause : '').toMatch(/verdict/);
  });

  it('marks text that is not JSON invalid', () => {
    expect(checkConformance(verdict, 'I think it passes.', false))
      .toEqual({ state: 'invalid', cause: 'the final message is not JSON' });
  });

  it('never checks a truncated answer as partial JSON', () => {
    expect(checkConformance(verdict, '{"verdict":"pass","summary":"Hello."}', true))
      .toEqual({ state: 'invalid', cause: 'the final message was truncated before it could be checked' });
  });

  it('never calls unchecked output valid when the recorded schema no longer compiles', () => {
    expect(checkConformance({ if: {}, then: {} }, '{}', false).state).toBe('unchecked');
  });
});
