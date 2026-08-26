export interface UserPromptSubmitOutput {
  readonly hookSpecificOutput: {
    readonly hookEventName: 'UserPromptSubmit';
    readonly additionalContext: string;
  };
}

const MAX_PROMPT_CHARS = 8_000;

function searchablePrompt(prompt: string): string {
  return prompt
    .slice(0, MAX_PROMPT_CHARS)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[’'_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NEGATED_CLOSE = [
  /\b(?:do not|don t|dont|never) stop here\b/,
  /\bne (?:nous )?arretons? pas ici\b/,
];

const EXPLICIT_CLOSE = [
  /\bon s arrete ici\b/,
  /\bon reprend (?:demain|plus tard)\b/,
  /\bje reprends? demain\b/,
  /\bfin de journee\b/,
  /\bstop here(?: for today)?\b/,
  /\b(?:let us |we will )?resume tomorrow\b/,
  /\b(?:fais|faire|make|create|write) (?:un |a )?checkpoint\b/,
  /\bcheckpoint\b.*\b(?:end|close|finish|finir|termine?r?)\b.*\b(?:session|journee|today)\b/,
  /\b(?:end|close) the session\b/,
];

export function detectsSessionCloseIntent(prompt: string): boolean {
  const searchable = searchablePrompt(prompt);
  if (NEGATED_CLOSE.some((pattern) => pattern.test(searchable))) return false;
  return EXPLICIT_CLOSE.some((pattern) => pattern.test(searchable));
}

export function checkpointReminderOutput(prompt: string): UserPromptSubmitOutput | undefined {
  if (!detectsSessionCloseIntent(prompt)) return undefined;
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext:
        'Explicit session-close intent detected. Invoke `void-checkpoint` before the closing response. ' +
        'Route durable facts to their owner, show any shared write before applying it, and do not mark ' +
        'the current work unit complete merely because the session ends.',
    },
  };
}
