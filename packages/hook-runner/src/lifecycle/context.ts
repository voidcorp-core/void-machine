import { PRODUCT_COMMAND } from '../identity.js';
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
 */
export function sessionStartOutput(
  version: string,
  notice?: string,
  resumeContext?: string,
): SessionStartOutput {
  const installed = version.trim() === '' ? 'unknown' : version.trim();
  const base =
    `${PRODUCT_COMMAND} ${installed} is active. Non-negotiable floor: ` +
    'external credential operations require explicit bounded user authorization and ' +
    'verified opaque or direct external transfer under void-security-guidance; ' +
    'never expose secret values to the model; ' +
    'local file/content guards and runtime restrictions remain binding; ' +
    'never hand-edit lockfiles; regenerate them via the package manager for requested dependency changes; ' +
    'never run destructive shell commands; tests and fresh evidence gate "done". ' +
    `Capture durable project rules explicitly. Run \`${PRODUCT_COMMAND} doctor\` if runtime health is uncertain.`;
  const suffix = notice === undefined || notice.trim() === '' ? '' : ` ${notice.trim()}`;
  const resume =
    resumeContext === undefined || resumeContext.trim() === '' ? '' : `\n${resumeContext.trimEnd()}`;
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `${base}${suffix}${resume}`,
    },
  };
}
