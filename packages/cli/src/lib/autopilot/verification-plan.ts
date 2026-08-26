// The local suite that must be green before anything is pushed.
//
// Every command runs as argv with `shell:false`. Not as a precaution: a verify
// command comes from the project's own programme descriptor, and a shell would turn a path
// with a space into two arguments and a semicolon into a second command. argv
// removes the class rather than escaping it.
//
// Output and duration are bounded. A test suite that loops does not get to
// consume the run's memory before someone notices, and a truncated tail is
// still enough to see which command hung.
//
// This module PLANS and JUDGES; it does not spawn. The skill executes and
// reports back, which keeps the decision testable without a process.

import { autopilotFailure } from './errors.js';

export interface VerificationCommand {
  readonly name: string;
  /** argv, executed with shell:false. */
  readonly command: readonly string[];
  /** Milliseconds before the command is killed. */
  readonly timeoutMs: number;
  /** Bytes of output retained; the rest is dropped with a marker. */
  readonly maxOutputBytes: number;
}

export interface VerificationPlan {
  readonly schemaVersion: 1;
  readonly integrationSha: string;
  readonly commands: readonly VerificationCommand[];
}

export interface CommandOutcome {
  readonly name: string;
  readonly command: readonly string[];
  readonly exitCode: number | null;
  /** True when the command was killed for exceeding its timeout. */
  readonly timedOut: boolean;
  readonly outputHash: string;
  readonly truncated: boolean;
}

export type VerdictReason = 'red' | 'timed-out' | 'unreported' | 'unexpected-command';

export interface VerificationVerdict {
  readonly green: boolean;
  readonly failures: readonly { readonly name: string; readonly reason: VerdictReason; readonly detail: string }[];
}

const DEFAULT_TIMEOUT_MS = 900_000;
const DEFAULT_MAX_OUTPUT = 1_000_000;
const SHA = /^[0-9a-f]{40}$/;

export interface PlanInput {
  readonly integrationSha: string;
  /** argv arrays from the active program's verifyCommands. */
  readonly commands: readonly (readonly string[])[];
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export function buildVerificationPlan(input: PlanInput): VerificationPlan {
  if (!SHA.test(input.integrationSha)) {
    throw autopilotFailure(
      'AUTOPILOT_CONTRACT',
      'the verification plan has no integration commit to bind proofs to',
      `\`integrationSha\` is ${JSON.stringify(input.integrationSha)}`,
      'resolve the integration branch to a full commit id before verifying',
    );
  }
  if (input.commands.length === 0) {
    throw autopilotFailure(
      'AUTOPILOT_CONTRACT',
      'the verification plan carries no command',
      'the active program declares no verifyCommands',
      'declare at least one verify command, for example `- [pnpm, test]`',
    );
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;

  return {
    schemaVersion: 1,
    integrationSha: input.integrationSha,
    commands: input.commands.map((command) => {
      if (command.length === 0 || command.some((word) => typeof word !== 'string' || word === '')) {
        throw autopilotFailure(
          'AUTOPILOT_CONTRACT',
          'a verify command is not a usable argv array',
          `\`${JSON.stringify(command)}\` has an empty or non-string element`,
          'write each command as a non-empty argv array, for example `- [pnpm, test]`',
        );
      }
      return { name: command.join(' '), command, timeoutMs, maxOutputBytes };
    }),
  };
}

/** Judge reported outcomes against the plan. Absent is never green. */
export function judgeVerification(
  plan: VerificationPlan,
  outcomes: readonly CommandOutcome[],
): VerificationVerdict {
  const failures: { name: string; reason: VerdictReason; detail: string }[] = [];
  const planned = new Set(plan.commands.map((command) => command.name));

  for (const outcome of outcomes) {
    if (!planned.has(outcome.name)) {
      // A result for something nobody asked to run cannot make the run green,
      // and its presence means the executor and the plan disagree.
      failures.push({
        name: outcome.name,
        reason: 'unexpected-command',
        detail: 'this command is not part of the verification plan',
      });
    }
  }

  for (const command of plan.commands) {
    const outcome = outcomes.find((result) => result.name === command.name);
    if (outcome === undefined) {
      failures.push({
        name: command.name,
        reason: 'unreported',
        detail: 'the command produced no outcome; a missing result is not a pass',
      });
      continue;
    }
    if (outcome.timedOut) {
      failures.push({
        name: command.name,
        reason: 'timed-out',
        detail: `killed after ${command.timeoutMs}ms`,
      });
      continue;
    }
    if (outcome.exitCode !== 0) {
      failures.push({
        name: command.name,
        reason: 'red',
        detail: `exited ${outcome.exitCode === null ? 'without a code' : String(outcome.exitCode)}`,
      });
    }
  }

  return { green: failures.length === 0, failures };
}
