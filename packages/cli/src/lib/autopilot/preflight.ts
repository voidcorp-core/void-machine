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
import { PRODUCT_COMMAND } from '@voidcorp/hook-runner';

export interface ParsedProgram {
  readonly status?: string;
  /**
   * True when a block was written and then took its consent back. Carried
   * separately from `autopilot` because the config is gone by then, and the
   * reader still needs to be told which of the two silences this is.
   */
  readonly autopilotConsentWithheld?: boolean;
  readonly autopilot?: {
    readonly clusterSize?: number;
    /** The `mergeGate` of a 4.0 programme, which the loop refuses until migrated. */
    readonly legacyMergeGate?: string;
    /**
     * The branch that deploys, or absent for the repository default branch.
     * Carried so the merge check can say where the loop never merges.
     */
    readonly deployBranch?: string;
    readonly base?: string;
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
  // Two silences, and only one of them means "author a block". Someone who wrote
  // `enabled: false` can see their block sitting there, and being told it is
  // absent sends them looking for a file problem they do not have.
  if (program.autopilotConsentWithheld === true) {
    return fail(
      name,
      'the program declares `enabled: false`, so it has taken back its consent to run unattended',
      'set `autopilot.enabled: true`, or leave the field out; the block itself stays as it is',
    );
  }
  // Declaring the block is the consent. A program without one has not withheld a
  // flag, it never asked for the feature.
  if (program.autopilot === undefined) {
    return fail(
      name,
      'the program declares no autopilot block, so nothing resumes automatically',
      'add an autopilot block to the program frontmatter; declaring it is the consent',
    );
  }
  return pass(name, 'executing, autopilot declared');
}

// A file that did not parse has no fields to judge. Reporting a merge mode
// and failing "no verifyCommands" off an unparsed file states two things the
// file never said — the same misattribution this preflight exists to avoid.
const UNPARSED = 'not judged: .void/program.md could not be parsed';
const UNPARSED_FIX = 'fix the frontmatter reported by the program check above, then run doctor again';

/**
 * Who merges, as the loop will read it. There is one mode: the loop merges on
 * its own into the integration branch, never into the branch that deploys, and
 * a person takes the merges with `autopilot merges --by-human`. A 4.0 programme
 * still declaring `mergeGate` is refused by the loop, so it fails here with the
 * migration rather than surfacing on the first tick.
 */
function mergeModeCheck(observation: AutopilotObservation): CheckResult {
  const name = 'autopilot merge';
  if (malformedProgram(observation) !== undefined) return unknown(name, UNPARSED, UNPARSED_FIX);
  const block = parsedProgram(observation)?.autopilot;
  const gate = block?.legacyMergeGate;
  if (gate !== undefined) {
    return fail(
      name,
      `the programme still declares \`mergeGate: ${gate}\`, which the loop refuses since the single merge mode`,
      gate === 'union-reviewed'
        ? 'remove `mergeGate` and set `autopilot.schemaVersion: 2`; the loop merges on its own by default'
        : `run \`${PRODUCT_COMMAND} autopilot merges --by-human\` first to keep every merge yours, then remove \`mergeGate\` and set \`autopilot.schemaVersion: 2\``,
    );
  }
  const base = block?.base ?? 'auto';
  const deploying = block?.deployBranch ?? 'the repository default branch';
  return pass(
    name,
    `the loop merges into ${base} on a clean local verdict, never into ${deploying}; `
      + `\`${PRODUCT_COMMAND} autopilot merges --by-human\` hands every reviewed pull request to a person`,
  );
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
      `wire a runtime with \`${PRODUCT_COMMAND} runtime add claude\` or \`codex\``,
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
    return unprobed(
      name,
      'not probed by this preflight; the loop needs no protection, and required checks on the base are one more gate GitHub enforces',
    );
  }
  if (observation.baseProtected === null) {
    // The first suspect used to be the token scope, which was usually already
    // correct: GitHub answers 403 "Upgrade to GitHub Pro or make this repository
    // public" on both /protection and /rulesets for a private repo on a free
    // plan. That is a plan constraint, and it means no server-side gate exists
    // to find — the local verdict is then the only gate before a merge
    // (#193).
    return unknown(
      name,
      'branch protection could not be read',
      'read the API error first: a 403 on a private repository on a free plan means protection cannot exist at all (make it public, upgrade, or accept that the local verdict is the only gate) — otherwise grant the token repository read access',
    );
  }
  if (observation.baseProtected) return pass(name, 'base branch protected');
  // Optional since the single merge mode: the loop merges on its local verdict,
  // and a consumer sets up nothing on GitHub. Required checks add a gate GitHub
  // enforces at merge time, which a repository that cannot accept the local
  // verdict's residual risk wants.
  return {
    name,
    ok: true,
    status: 'advisory',
    message: 'the base branch is unprotected: the local verdict is the only gate before a merge',
    fix: 'require status checks on the base branch to add a gate GitHub enforces at merge time',
  };
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
    mergeModeCheck(observation),
    verifyCommandsCheck(observation),
    adapterCheck(observation),
    connectorCheck(observation),
    worktreeCheck(observation),
    protectionCheck(observation),
  ]);
}
