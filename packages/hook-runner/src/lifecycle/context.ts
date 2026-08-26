export interface SessionStartOutput {
  readonly hookSpecificOutput: {
    readonly hookEventName: 'SessionStart';
    readonly additionalContext: string;
  };
}

/**
 * @param notice Optional upgrade line, appended after the floor. Absent whenever
 *   the install is current, undetermined, or not updatable by this CLI — a session
 *   banner must never carry a guess.
 * @param invocationAlert Optional line naming skills this project recorded but can
 *   no longer resolve. Absent whenever the surface is healthy: the harness cannot
 *   observe its own refused calls, so this banner is the only place the trace they
 *   leave gets read.
 */
export function sessionStartOutput(
  version: string,
  notice?: string,
  invocationAlert?: string,
  resumeContext?: string,
): SessionStartOutput {
  const installed = version.trim() === '' ? 'unknown' : version.trim();
  const base =
    `void-harness ${installed} is active. Non-negotiable floor: never edit secrets, keys or lockfiles; ` +
    'never run destructive shell commands; tests and fresh evidence gate "done". ' +
    'Capture durable project rules explicitly. Run `void-harness doctor` if runtime health is uncertain.';
  const suffix = notice === undefined || notice.trim() === '' ? '' : ` ${notice.trim()}`;
  // On its own line: the floor already runs long, and an alert trailing off its
  // end is read as more of the same sentence rather than as a separate warning.
  const alert =
    invocationAlert === undefined || invocationAlert.trim() === '' ? '' : `\n${invocationAlert.trim()}`;
  const resume =
    resumeContext === undefined || resumeContext.trim() === '' ? '' : `\n${resumeContext.trimEnd()}`;
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `${base}${suffix}${alert}${resume}`,
    },
  };
}
