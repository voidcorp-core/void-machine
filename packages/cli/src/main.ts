import { cheatsheet } from './commands/cheatsheet.js';
import { commandName, type CommandName } from './lib/command-catalog.js';
// CLI entry — dispatches to init / add / remove / list / doctor / help.

import { install } from './commands/install.js';
import { init } from './commands/init.js';
import { runtime } from './commands/runtime.js';
import { add } from './commands/add.js';
import { remove } from './commands/remove.js';
import { list } from './commands/list.js';
import { doctor } from './commands/doctor.js';
import { hydrate } from './commands/hydrate.js';
import { check } from './commands/check.js';
import { update } from './commands/update.js';
import { autopilot } from './commands/autopilot.js';
import { why } from './commands/why.js';
import { graph } from './commands/graph.js';
import { audit } from './commands/audit.js';
import { status } from './commands/status.js';
import { projects } from './commands/projects.js';
import { ui } from './commands/ui.js';
import { resume } from './commands/resume.js';
import { adoption } from './commands/adoption.js';
import { decisions } from './commands/decisions.js';
import { mission } from './commands/mission.js';
import { agents } from './commands/agents.js';
import { security } from './commands/security.js';
import { selfHost } from './commands/self-host.js';
import { printHelp } from './commands/help.js';
import { version } from '../package.json';
import { PRODUCT_IDENTITY } from '@voidcorp/hook-runner';

/**
 * Commands that print their own, more specific help.
 *
 * Everything else gets the global reference. The list is explicit because the
 * failure it prevents is silent: a command missing from it does not lose its
 * help, it MUTATES the project when asked to explain itself.
 */
const SELF_DOCUMENTING = new Set(['autopilot', 'decisions', 'mission', 'security']);

/** Did the caller ask for help rather than for the command to run? */
export function asksForHelp(cmd: string | undefined, rest: readonly string[]): boolean {
  if (cmd === undefined || SELF_DOCUMENTING.has(cmd)) return false;
  return rest.includes('--help') || rest.includes('-h');
}

/**
 * The one-line stderr notice for a command name that still works but is on its way out, or
 * nothing for a current one. Stderr only: a script reading stdout must see no difference.
 */
export function deprecationNotice(invokedAs: string): string | undefined {
  const { primary, aliases, deprecated } = PRODUCT_IDENTITY.commands;
  if (!deprecated.includes(invokedAs)) return undefined;
  const shorter = aliases.length === 0 ? '' : ` (alias ${aliases.join(', ')})`;
  return `${invokedAs} is deprecated and will be removed; run ${primary}${shorter} instead.\n`;
}

/** Entry for the installed bin files, each of which passes the command name it is installed as. */
export async function run(invokedAs: string, argv: readonly string[]): Promise<void> {
  const notice = deprecationNotice(invokedAs);
  if (notice !== undefined) process.stderr.write(notice);
  await main(argv);
}

export async function main(argv: readonly string[]): Promise<void> {
  const [cmd, ...rest] = argv;

  // `--help` explains; it never acts. Before this, `init --help` installed 135
  // files into the current directory — a command asked to describe itself
  // instead rewrote the project, which is the least forgivable thing a CLI can
  // do. Intercepting once here rather than in each command means the next
  // command added cannot reintroduce it by omission.
  if (asksForHelp(cmd, rest)) {
    printHelp();
    return;
  }

  const name = commandName(cmd);
  if (name === undefined) {
    process.stderr.write(`unknown command: ${cmd}\n\n`);
    printHelp();
    process.exitCode = 2;
    return;
  }
  await HANDLERS[name](rest);
}

const HANDLERS = {
  'init': init,
  'runtime': runtime,
  'add': add,
  'remove': remove,
  'list': list,
  'status': status,
  'doctor': doctor,
  'update': update,
  'hydrate': hydrate,
  'check': check,
  'graph': graph,
  'why': why,
  'autopilot': autopilot,
  'audit': audit,
  'projects': projects,
  'resume': resume,
  'ui': ui,
  'adoption': adoption,
  'decisions': decisions,
  'mission': mission,
  'agents': agents,
  'security': security,
  'self-host': selfHost,
  'install': install,
  'cheatsheet': cheatsheet,
  'version': () => { process.stdout.write(`${version}\n`); },
  'help': () => printHelp(),
} satisfies Record<CommandName, (args: readonly string[]) => void | Promise<void>>;
