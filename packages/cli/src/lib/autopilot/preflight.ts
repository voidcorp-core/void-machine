// What autopilot needs before it claims anything, judged from an observation.
//
// The failure this prevents is specific and expensive: a capability discovered
// missing halfway through leaves a cluster leased in the tracker, worktrees on
// disk and no one working them. Every check below therefore runs BEFORE the
// lease, and every one of them is non-mutating — doctor must be safe to run on
// a project mid-flight, which means it may not touch Linear, GitHub or git refs.
//
// Pure. The caller observes; this judges. That split is what lets the whole
// preflight be tested without a tracker, a network or a repository, and it is
// the same shape the rest of this bounded context uses.
//
// `unknown` is a first-class answer. "I could not read the branch protection"
// is not "the branch is unprotected", and collapsing the two either blocks a
// healthy project or green-lights an unprotected base.
//
// `unprobed` is the third answer, and it is not a weaker `unknown`: it means
// this caller never asks. `doctor` is offline by contract, so it reports the two
// remote-backed facts unprobed on every project, forever. Told they were
// "unknown" with a fix to reconfigure something, operators went hunting for a
// misconfiguration that did not exist (#193).

import type { CheckResult } from '../prerequisites.js';

export interface ParsedProgram {
  readonly status?: string;
  readonly autopilot?: {
    readonly enabled?: boolean;
    readonly clusterSize?: number;
    readonly mergeGate?: string;
    readonly verifyCommands?: readonly (readonly string[])[];
  };
}

/** A program descriptor that exists and did not parse, with its own verdict. */
export interface MalformedProgram {
  readonly malformed: {
    readonly problem: string;
    readonly fix: string;
  };
}

function malformedProgram(observation: AutopilotObservation): MalformedProgram['malformed'] | undefined {
  const program = observation.program;
  return program !== undefined && 'malformed' in program ? program.malformed : undefined;
}

/** The frontmatter, or undefined when there is none to read (absent or malformed). */
function parsedProgram(observation: AutopilotObservation): ParsedProgram | undefined {
  const program = observation.program;
  return program === undefined || 'malformed' in program ? undefined : program;
}

export interface AutopilotObservation {
  /**
   * Parsed `.void/program.md` frontmatter; undefined when the file is absent, and a
   * `malformed` record when it exists but could not be parsed — two different
   * things to tell a reader, and only one of them means "author a program".
   * The parser already produces a problem and a fix; carrying them here is what
   * saves the reader from re-deriving the parse error by hand.
   */
  readonly program: ParsedProgram | MalformedProgram | undefined;
  /** Runtime adapters detected in the project, e.g. `['claude']`. */
  readonly adapters: readonly string[];
  /**
   * Tracker connector reachability; null when a probe failed, `'unprobed'` when
   * the caller does not probe at all.
   */
  readonly trackerConnector: boolean | 'unprobed' | null;
  /** Whether git worktrees can be created here, or null when unknown. */
  readonly worktreesUsable: boolean | null;
  /**
   * Base-branch protection; null when it could not be read, `'unprobed'` when
   * the caller does not probe at all.
   */
  readonly baseProtected: boolean | 'unprobed' | null;
}

const RUNTIME_ADAPTERS = ['claude', 'codex'];

function pass(name: string, message: string): CheckResult {
  return { name, ok: true, status: 'pass', message };
}

function fail(name: string, message: string, fix: string): CheckResult {
  return { name, ok: false, status: 'fail', message, fix };
}

/** Not a failure and not a pass: something the run could not read. */
function unknown(name: string, message: string, fix: string): CheckResult {
  return { name, ok: false, status: 'unknown', message, fix };
}

/**
 * Not a failure, not a pass, and not unknown: something this caller never asks.
 * Carries no fix on purpose — there is no configuration the reader could change
 * that would make this run answer it.
 */
function unprobed(name: string, message: string): CheckResult {
  return { name, ok: false, status: 'unprobed', message };
}

function programCheck(observation: AutopilotObservation): CheckResult {
  const name = 'autopilot program';
  const broken = malformedProgram(observation);
  if (broken !== undefined) {
    return fail(name, `.void/program.md could not be parsed: ${broken.problem}`, broken.fix);
  }
  const program = parsedProgram(observation);
  if (program === undefined) {
    return unknown(
      name,
      'no .void/program.md, so there is no program to drain',
      'author one with void-ticket, or ignore autopilot in this project',
    );
  }
  if (program.status !== 'executing') {
    return fail(
      name,
      `status is ${JSON.stringify(program.status ?? 'absent')}, not "executing"`,
      'set status: executing once the plan and its ticket pool are approved',
    );
  }
  if (program.autopilot?.enabled !== true) {
    return fail(
      name,
      'autopilot.enabled is not true, so nothing resumes automatically',
      'set autopilot.enabled: true in the program frontmatter',
    );
  }
  return pass(name, 'executing, autopilot enabled');
}

// A file that did not parse has no fields to judge. Passing "human merge gate"
// and failing "no verifyCommands" off an unparsed file states two things the
// file never said — the same misattribution this preflight exists to avoid.
const UNPARSED = 'not judged: .void/program.md could not be parsed';
const UNPARSED_FIX = 'fix the frontmatter reported by the program check above, then run doctor again';

function mergeGateCheck(observation: AutopilotObservation): CheckResult {
  const name = 'autopilot merge';
  if (malformedProgram(observation) !== undefined) return unknown(name, UNPARSED, UNPARSED_FIX);
  const gate = parsedProgram(observation)?.autopilot?.mergeGate;
  // The only accepted value. A project cannot opt into automation here: the
  // human merge is the contract the whole design rests on.
  if (gate !== undefined && gate !== 'human') {
    return fail(
      name,
      `mergeGate is ${JSON.stringify(gate)}; the only accepted value is "human"`,
      'set mergeGate: human — autopilot never merges, and no flag changes that',
    );
  }
  return pass(name, 'human merge gate');
}

function verifyCommandsCheck(observation: AutopilotObservation): CheckResult {
  const name = 'autopilot verify';
  if (malformedProgram(observation) !== undefined) return unknown(name, UNPARSED, UNPARSED_FIX);
  const commands = parsedProgram(observation)?.autopilot?.verifyCommands ?? [];
  if (commands.length === 0) {
    return fail(
      name,
      'no verifyCommands, so nothing would prove the integration branch',
      'declare the suite that mirrors CI, for example `- [pnpm, test]`',
    );
  }
  const malformed = commands.find(
    (command) => !Array.isArray(command) || command.length === 0 || command.some((word) => typeof word !== 'string' || word === ''),
  );
  if (malformed !== undefined) {
    return fail(
      name,
      `${JSON.stringify(malformed)} is not a usable argv array`,
      'write each command as an argv array; it runs with shell:false, never through a shell',
    );
  }
  return pass(name, `${commands.length} verify command(s)`);
}

function adapterCheck(observation: AutopilotObservation): CheckResult {
  const name = 'autopilot runtime';
  const usable = observation.adapters.filter((adapter) => RUNTIME_ADAPTERS.includes(adapter));
  if (usable.length === 0) {
    return fail(
      name,
      'no runtime adapter detected, so no worker could be spawned',
      'wire a runtime with `void-harness runtime add claude` or `codex`',
    );
  }
  return pass(name, `${usable.join(', ')} adapter(s)`);
}

function connectorCheck(observation: AutopilotObservation): CheckResult {
  const name = 'autopilot tracker';
  if (observation.trackerConnector === 'unprobed') {
    return unprobed(name, 'not probed here; autopilot proves the connector at preflight, before it claims a lease');
  }
  if (observation.trackerConnector === null) {
    return unknown(
      name,
      'the tracker connector was probed and did not answer',
      'restore the connector for this runtime and retry; autopilot will not claim on an unknown tracker',
    );
  }
  return observation.trackerConnector
    ? pass(name, 'connector reachable')
    : fail(
        name,
        'no reachable tracker connector, so no ticket could be claimed or closed',
        'configure the tracker connector for this runtime before enabling autopilot',
      );
}

function worktreeCheck(observation: AutopilotObservation): CheckResult {
  const name = 'autopilot worktrees';
  if (observation.worktreesUsable === null) {
    return unknown(name, 'worktree support could not be determined', 'run this inside the git repository autopilot would work in');
  }
  return observation.worktreesUsable
    ? pass(name, 'worktrees usable')
    : fail(
        name,
        'worktrees cannot be created here, and a worker never works in the main checkout',
        'run autopilot from a git repository where `git worktree add` succeeds',
      );
}

function protectionCheck(observation: AutopilotObservation): CheckResult {
  const name = 'autopilot base';
  if (observation.baseProtected === 'unprobed') {
    return unprobed(name, 'not probed here; autopilot proves protection at preflight and refuses to start without it');
  }
  if (observation.baseProtected === null) {
    // The first suspect used to be the token scope, which was usually already
    // correct: GitHub answers 403 "Upgrade to GitHub Pro or make this repository
    // public" on both /protection and /rulesets for a private repo on a free
    // plan. That is a plan constraint, and it means no server-side gate exists
    // to find — the human merge gate is then a harness contract and nothing
    // else (#193).
    return unknown(
      name,
      'branch protection could not be read',
      'read the API error first: a 403 on a private repository on a free plan means protection cannot exist at all (make it public, upgrade, or accept that the human merge gate is enforced by contract only) — otherwise grant the token repository read access',
    );
  }
  return observation.baseProtected
    ? pass(name, 'base branch protected')
    : fail(
        name,
        'the base branch is unprotected, so nothing server-side stops a bad merge',
        'require status checks on the base branch; autopilot relies on it as its last line',
      );
}

/**
 * Every autopilot precondition, in the order a run would hit them.
 *
 * Returns results rather than throwing, and mutates nothing: doctor reports, it
 * does not repair, and it must stay safe to run while a cluster is in flight.
 */
export function autopilotPreflight(observation: AutopilotObservation): readonly CheckResult[] {
  return Object.freeze([
    programCheck(observation),
    mergeGateCheck(observation),
    verifyCommandsCheck(observation),
    adapterCheck(observation),
    connectorCheck(observation),
    worktreeCheck(observation),
    protectionCheck(observation),
  ]);
}
