import { describe, expect, it } from 'vitest';
import {
  checkpointReminderOutput,
  detectsSessionCloseIntent,
} from './session-close-intent.js';

describe('detectsSessionCloseIntent', () => {
  it.each([
    'on s arrete ici',
    'on reprend demain',
    'je reprends demain matin',
    'fin de journee, merci',
    'fais un checkpoint avant de finir',
    'on reprend plus tard',
    'stop here for today',
    'let us resume tomorrow',
    'make a checkpoint and end the session',
  ])('recognises an explicit session close: %s', (prompt) => {
    expect(detectsSessionCloseIntent(prompt)).toBe(true);
  });

  it.each([
    'arrete le serveur',
    'stop the process',
    'termine la boucle',
    'the checkpoint file parser is broken',
    'const checkpoint = await loadCheckpoint()',
    'do not stop here',
    "don't stop here",
    'ne nous arretons pas ici',
  ])('does not confuse task language with a session close: %s', (prompt) => {
    expect(detectsSessionCloseIntent(prompt)).toBe(false);
  });

  it('bounds pathological input before matching', () => {
    expect(detectsSessionCloseIntent(`${'x'.repeat(100_000)} stop here`)).toBe(false);
  });
});

describe('checkpointReminderOutput', () => {
  it('adds advisory context without blocking or writing anything', () => {
    expect(checkpointReminderOutput('on reprend demain')).toEqual({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: expect.stringMatching(/void-checkpoint.*before.*closing response/i),
      },
    });
  });

  it('is silent when the prompt does not close the session', () => {
    expect(checkpointReminderOutput('stop the process')).toBeUndefined();
  });
});
