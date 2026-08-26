import { describe, expect, it } from 'vitest';
import { sessionStartOutput } from './context.js';

describe('sessionStartOutput', () => {
  it('emits valid compact runtime context without depending on jq', () => {
    expect(sessionStartOutput('3.0.0')).toEqual({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: expect.stringContaining('void-harness 3.0.0 is active'),
      },
    });
  });

  it('uses an explicit unknown version instead of throwing', () => {
    expect(
      sessionStartOutput('').hookSpecificOutput.additionalContext,
    ).toContain('void-harness unknown');
  });

  it('appends the upgrade notice when one is given', () => {
    const context = sessionStartOutput(
      '0.17.0',
      'void-harness 0.17.0 is installed; 2.1.0 is published.',
    ).hookSpecificOutput.additionalContext;
    expect(context).toContain('void-harness 0.17.0 is active');
    expect(context).toContain('2.1.0 is published');
  });

  it('is unchanged when there is no notice, so a current install gains no noise', () => {
    expect(sessionStartOutput('2.1.0').hookSpecificOutput.additionalContext).toBe(
      sessionStartOutput('2.1.0', undefined).hookSpecificOutput.additionalContext,
    );
  });

  it('carries the invocation alert, which is the only place it can be read', () => {
    const context = sessionStartOutput(
      '3.0.0',
      undefined,
      'void-harness: 2 recorded skill(s) no longer resolve: brainstorming, ticket-writer.',
    ).hookSpecificOutput.additionalContext;
    expect(context).toContain('no longer resolve');
    expect(context).toContain('ticket-writer');
  });

  it('starts the alert on its own line, so it does not trail off the end of the floor', () => {
    const context = sessionStartOutput('3.0.0', undefined, 'ALERT-MARKER').hookSpecificOutput.additionalContext;
    expect(context).toContain('\nALERT-MARKER');
  });

  it('adds nothing at all when the invocation surface is healthy', () => {
    expect(sessionStartOutput('3.0.0', undefined, undefined).hookSpecificOutput.additionalContext).toBe(
      sessionStartOutput('3.0.0').hookSpecificOutput.additionalContext,
    );
  });

  it('keeps the non-negotiable floor ahead of the notice', () => {
    const context = sessionStartOutput('0.17.0', 'UPGRADE-MARKER').hookSpecificOutput.additionalContext;
    expect(context.indexOf('Non-negotiable floor')).toBeLessThan(context.indexOf('UPGRADE-MARKER'));
  });

  it('appends the ResumeBundle context after the safety floor', () => {
    const context = sessionStartOutput(
      '3.4.0',
      undefined,
      undefined,
      '[void-harness resume]\nProgram: portable-resume\n',
    ).hookSpecificOutput.additionalContext;

    expect(context).toContain('[void-harness resume]');
    expect(context.indexOf('Non-negotiable floor')).toBeLessThan(
      context.indexOf('[void-harness resume]'),
    );
  });
});
