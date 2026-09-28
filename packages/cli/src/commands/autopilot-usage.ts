// `void-machine autopilot` -- the operator surface of the continuous delivery
// loop. `runAutopilotCommand` is a function of (argv, stdin, context) and returns
// what to print and with which exit code. The loop reads GitHub and git through
// runners the context injects, so every command stays testable on captured
// outputs; it never contacts the tracker. `review` is the one subcommand that
// delegates an agent, the reviewer, through the kernel's delegation.

import { autopilotFailure } from '../lib/autopilot/errors.js';
import { PRODUCT_COMMAND } from '@voidcorp/hook-runner';

export const USAGE = `
${PRODUCT_COMMAND} autopilot -- the deterministic kernel of the continuous delivery loop.

Invoked by the /void-autopilot skill, which reads the tracker and pipes it in.
The CLI decides; it never contacts Linear. It reaches GitHub through gh and the
shared Git state itself, because GitHub is the authority on a merge and the
shared state is what a unit must not have touched. The one agent it delegates
is the reviewer whose verdict a merge rests on.

Usage:
  echo '<LoopTracker>'           | ${PRODUCT_COMMAND} autopilot next [--json]
  ${PRODUCT_COMMAND} autopilot stop --drain | --now [--json]
  ${PRODUCT_COMMAND} autopilot fingerprint [--before <ticket> | --after <ticket>] [--json]
  ${PRODUCT_COMMAND} autopilot arm --ticket <id> --pr <number> --head <sha> [--json]
  ${PRODUCT_COMMAND} autopilot disarm --pr <number> [--json]
  ${PRODUCT_COMMAND} autopilot review --ticket <id> --pr <number> --head <sha> [--json]
  echo '<ConflictClass>'         | ${PRODUCT_COMMAND} autopilot judgment conflict-class

next reads .void/program.md, the Linear state on stdin, GitHub (gh) and the stop
signal, and prints the actions for each slot: assign, wait, hand-back-to-worker,
mark-human-wait, review, enable-auto-merge, disable-auto-merge, requeue, drain,
freeze, recap, with the humanWaitLabel a mark-human-wait sets
(autopilot.humanWaitLabel, default void:human-wait); humanWait on stdin is that
label's presence. It never acts on them. stop writes
.void/machine/autopilot/stop, read before every assignment; delete the file to
start again. fingerprint records (--before, once per ticket) or checks (--after)
the digests of the shared Git state around one unit: local config and its
includes, stash, tags, notes, remotes, the local base and deploy branches,
replace refs, hooks/ and info/. The upstream (remote, merge) of every branch but
those is left out, since units in flight set and remove their own. --after fails
when it moved, and a second --before is refused. review answers review: it
checks out the exact head in a detached worktree at the durable worktree
location, checks its HEAD before and after, delegates a fresh-context, read-only
independent-code-reviewer there, and records the verdict, bound to that head and
to the session the runtime listed, in
.void/machine/autopilot/reviews/<id>/<sha>.json. next merges on that record
alone; a verdict posted on GitHub is a copy nothing reads. arm answers
enable-auto-merge: it records the head in .void/machine/autopilot/armed/<id>.json,
arms on exactly that head, and reads GitHub back: armed is an auto-merge request
or, once the checks pass on a base with a merge queue, a queue entry; a head
already merged counts. disarm answers
disable-auto-merge, which next returns before any outcome that stops watching
an armed pull request: its head moved since arm recorded it, no clean local
verdict holds it, no arm recorded it, a worker or a person takes the ticket, or an
immediate stop; it turns the auto-merge off, dequeues, reads GitHub back and
fails while still armed. judgment admits a conflict class, bound to its
headSha, and prints the comment block to post; next reads the latest one back
from GitHub, so no session has to remember it.

stdin JSON (LoopTracker):
  { "schemaVersion": 1, "queue": <CuratorQueue judgment>,
    "tickets": [{ "id", "status", "humanWait", "pullRequest"?, "branch"?,
                  "footprint"?, "readiness"? }],
    "recent": [{ "ticketId", "outcome": "merged" }
             | { "ticketId", "outcome": "human-wait", "reason" }],
    "liveWorkers": ["<ticket id>"], "quota": "ok" | "low" }

There is no --auto-merge flag. A machine merge is declared once in the program
(autopilot.mergeGate: union-reviewed, plus deployBranch), and the loop arms one
only on a head a local verdict passed, never into the branch that deploys.
`.trimStart();

/**
 * Every subcommand this CLI answers, and whether it reads an observation.
 *
 * One table: the router refuses a name it does not hold, and the pipe is filled
 * for exactly the names it marks `reads-stdin`. A second, hand-kept list once
 * left a gate reading an empty string for as long as it existed.
 */
export const SUBCOMMANDS = Object.freeze({
  next: 'reads-stdin',
  stop: 'no-stdin',
  fingerprint: 'no-stdin',
  arm: 'no-stdin',
  disarm: 'no-stdin',
  review: 'no-stdin',
  judgment: 'reads-stdin',
} as const);

export type AutopilotSubcommand = keyof typeof SUBCOMMANDS;

/** The first bare word of argv: the subcommand, before any flag or its value. */
export function subcommandWord(argv: readonly string[]): string | undefined {
  return argv.find((arg) => !arg.startsWith('-'));
}

/** Whether this invocation waits on a pipe, resolved from the subcommand alone. */
export function readsStdin(argv: readonly string[]): boolean {
  if (argv.includes('--help') || argv.includes('-h')) return false;
  const word = subcommandWord(argv);
  if (word === undefined || !Object.hasOwn(SUBCOMMANDS, word)) return false;
  return SUBCOMMANDS[word as AutopilotSubcommand] === 'reads-stdin';
}

/** The value after `flag`, or undefined when the flag is absent. */
export function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('-')) {
    throw autopilotFailure(
      'AUTOPILOT_USAGE',
      `\`${flag}\` was given without a value`,
      'the flag consumed the next argument, which is another flag or missing',
      `pass a value after \`${flag}\`, or drop the flag entirely`,
    );
  }
  return value;
}
