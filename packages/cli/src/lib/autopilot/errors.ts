// One error shape for the whole autopilot bounded context: a code, what broke,
// why, and the single action that fixes it. Operators and agents both read these
// — an agent that cannot tell "your input is malformed" from "the tracker said
// no" will retry the wrong thing forever.
//
// Mirrors the `CODE: problem / Cause: / Fix:` rendering already used by the
// mission command, so the CLI speaks one dialect.

export type AutopilotErrorCode =
  | 'AUTOPILOT_USAGE'
  | 'AUTOPILOT_INPUT'
  | 'AUTOPILOT_PROGRAM'
  | 'AUTOPILOT_CONTRACT';

export interface AutopilotFailure {
  readonly code: AutopilotErrorCode;
  readonly problem: string;
  readonly cause: string;
  readonly fix: string;
}

export class AutopilotError extends Error {
  readonly failure: AutopilotFailure;

  constructor(failure: AutopilotFailure) {
    // The message carries the whole failure, not just the headline: wherever it
    // surfaces — a log line, a stack trace, an agent's transcript — the reader
    // gets the field that broke and the one action that fixes it.
    super(`${failure.code}: ${failure.problem}\nCause: ${failure.cause}\nFix: ${failure.fix}`);
    this.name = 'AutopilotError';
    this.failure = Object.freeze({ ...failure });
  }
}

export function autopilotFailure(
  code: AutopilotErrorCode,
  problem: string,
  cause: string,
  fix: string,
): AutopilotError {
  return new AutopilotError({ code, problem, cause, fix });
}

/**
 * Coerce anything thrown inside the bounded context into the canonical shape.
 * A plain Error keeps its message as the cause rather than being flattened into
 * a generic one — the whole point is that the reader learns what actually broke.
 */
export function toAutopilotFailure(error: unknown): AutopilotFailure {
  if (error instanceof AutopilotError) return error.failure;
  return {
    code: 'AUTOPILOT_CONTRACT',
    problem: 'the autopilot command could not complete',
    cause: error instanceof Error ? error.message : String(error),
    fix: 'correct the reported input and run the command again',
  };
}

export function renderAutopilotFailure(failure: AutopilotFailure, json: boolean): string {
  if (json) return `${JSON.stringify({ error: failure })}\n`;
  return `${failure.code}: ${failure.problem}\nCause: ${failure.cause}\nFix: ${failure.fix}\n`;
}
