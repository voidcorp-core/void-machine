import {
  type AutopilotSubcommand,
  readsStdin,
  SUBCOMMANDS,
  subcommandWord,
  USAGE,
} from './autopilot-usage.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { agentsContext } from '@voidcorp/void-machine/agents';
import { isLoopSubcommand, judgmentCommand, type LoopCommandOutput, loopCommand } from './autopilot-loop.js';
import { reviewCommand } from './autopilot-review.js';

export { type AutopilotSubcommand, readsStdin, SUBCOMMANDS } from './autopilot-usage.js';

import { autopilotFailure, renderAutopilotFailure, toAutopilotFailure } from '../lib/autopilot/errors.js';
import { execGh, type GhRunner, type GitRunner, gitIn } from '../lib/autopilot/loop-observe.js';
import { PRODUCT_COMMAND, PRODUCT_IDENTITY } from '@voidcorp/hook-runner';

export interface AutopilotCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: 0 | 2;
}

export interface AutopilotCommandContext {
  /** Project root under which .void/machine/autopilot lives. */
  readonly root: string;
  /** ISO instant the command runs at; injected so the surface stays testable. */
  readonly now: string;
  /** How the loop reaches GitHub; the shell passes the real `gh`. */
  readonly gh?: GhRunner;
  /** How the loop reads the shared Git state of the checkout. */
  readonly git?: GitRunner;
}

function ok(stdout: string): AutopilotCommandResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function fail(stderr: string): AutopilotCommandResult {
  return { stdout: '', stderr, exitCode: 2 };
}

function emit(json: boolean, output: LoopCommandOutput): AutopilotCommandResult {
  return ok(json ? `${JSON.stringify(output.value, null, 2)}\n` : output.human);
}

/**
 * A name the table holds and nobody routed. The parameter is `never`, so the
 * compiler proves the routing exhaustive; at runtime it refuses rather than
 * falling through to an action nobody asked for.
 */
function unroutedSubcommand(subcommand: never): never {
  throw autopilotFailure(
    'AUTOPILOT_CONTRACT',
    'a subcommand this CLI declares is routed nowhere',
    `\`${String(subcommand)}\` is listed in SUBCOMMANDS and has no handler`,
    'route the subcommand in `runAutopilotCommand`, or drop it from SUBCOMMANDS',
  );
}

export function runAutopilotCommand(
  argv: readonly string[],
  stdin: string,
  context?: AutopilotCommandContext,
): AutopilotCommandResult {
  const json = argv.includes('--json');
  try {
    if (argv.includes('--auto-merge')) {
      // Consent to a machine merge is a durable declaration in the program, never
      // a switch someone can put on one invocation and forget.
      throw autopilotFailure(
        'AUTOPILOT_USAGE',
        'autopilot does not accept --auto-merge',
        'granting a merge is declared in the program, not passed to a run',
        'set `autopilot.mergeGate: union-reviewed` with a `deployBranch` in the program',
      );
    }
    if (argv.includes('--help') || argv.includes('-h')) return ok(USAGE);

    const word = subcommandWord(argv);
    if (word === undefined) {
      throw autopilotFailure(
        'AUTOPILOT_USAGE',
        'autopilot was invoked without a subcommand',
        'the command cannot infer what you meant to do',
        `run \`${PRODUCT_COMMAND} autopilot next\` with the tracker on stdin, or --help`,
      );
    }
    if (!Object.hasOwn(SUBCOMMANDS, word)) {
      throw autopilotFailure(
        'AUTOPILOT_USAGE',
        `autopilot has no '${word}' subcommand`,
        `known subcommands are ${Object.keys(SUBCOMMANDS).join(', ')}`,
        `run \`${PRODUCT_COMMAND} autopilot --help\` for the full contract`,
      );
    }
    const subcommand = word as AutopilotSubcommand;
    if (subcommand === 'judgment') return emit(json, judgmentCommand(argv, stdin));
    if (context === undefined) {
      throw autopilotFailure(
        'AUTOPILOT_CONTRACT',
        `\`${subcommand}\` needs a project root and a clock`,
        'the command was invoked without an execution context',
        'invoke autopilot through the CLI entry point rather than calling it directly',
      );
    }
    if (isLoopSubcommand(subcommand)) return emit(json, loopCommand(subcommand, argv, stdin, context));
    if (subcommand === 'review') {
      throw autopilotFailure(
        'AUTOPILOT_CONTRACT',
        '`review` waits on a delegated reviewer and runs only from the CLI entry point',
        'the synchronous surface cannot wait on an agent',
        `run \`${PRODUCT_COMMAND} autopilot review --ticket <id> --pr <n> --head <sha> --round <1|2>\``,
      );
    }
    return unroutedSubcommand(subcommand);
  } catch (error) {
    return fail(renderAutopilotFailure(toAutopilotFailure(error), json));
  }
}

/**
 * The imperative shell around the pure surface above: it reads the pipe and the
 * clock, writes what comes back, and propagates the exit code. stdin is read
 * only for the subcommands `SUBCOMMANDS` marks as reading it, so a command that
 * takes no pipe never hangs on a terminal waiting for input.
 */
export async function autopilot(argv: readonly string[]): Promise<void> {
  const root = process.cwd();
  if (subcommandWord(argv) === 'review' && !argv.includes('--help') && !argv.includes('-h')) {
    await autopilotReview(argv, root);
    return;
  }
  const stdin = readsStdin(argv) && !process.stdin.isTTY ? await readAllStdin() : '';
  const result = runAutopilotCommand(argv, stdin, {
    root,
    now: new Date().toISOString(),
    gh: execGh,
    git: gitIn(root),
  });
  if (result.stdout !== '') process.stdout.write(result.stdout);
  if (result.stderr !== '') process.stderr.write(result.stderr);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}

/**
 * `autopilot review` in the shell: the kernel's delegation composed for this
 * checkout, the durable worktree location, the real clock.
 */
async function autopilotReview(argv: readonly string[], root: string): Promise<void> {
  const json = argv.includes('--json');
  const env = process.env;
  const home = homedir();
  const agents = agentsContext({ cwd: root, env, home,
    updateCommand: `npx ${PRODUCT_IDENTITY.packageName} update` });
  try {
    if (!('store' in agents)) {
      throw autopilotFailure('AUTOPILOT_CONTRACT', 'the kernel delegation is unavailable here', agents.cause,
        agents.action);
    }
    const data = env['XDG_DATA_HOME'] ?? join(home, '.local', 'share');
    const worktrees = env['VOID_WORKTREES'] ?? join(data, 'git-worktrees');
    const output = await reviewCommand(argv, { root, gh: execGh, git: gitIn, agents, now: Date.now, worktrees });
    process.stdout.write(json ? `${JSON.stringify(output.value, null, 2)}\n` : output.human);
  } catch (error) {
    process.stderr.write(renderAutopilotFailure(toAutopilotFailure(error), json));
    process.exitCode = 2;
  }
}

function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}
