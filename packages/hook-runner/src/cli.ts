import { RULE_NAMES, withGoverningSkill } from './enforcement/governing-skill.js';
import {
  discoverProjectRoot,
  evaluateRule,
  MAX_CI_CONTENT_BYTES,
  MAX_HOOK_INPUT_BYTES,
  parseCiContent,
  parseHookPayload,
  type RuleName,
} from './enforcement/runner.js';
import { readFreshnessCache } from './freshness/cache.js';
import { compareFreshness } from './freshness/compare.js';
import { freshnessRelay, resolveFreshness } from './freshness/notice.js';
import { cachedInvocationAlert, refreshInvocationVerdict } from './invocation.js';
import { auditCheckpoint } from './lifecycle/checkpoint-audit.js';
import { sessionStartOutput } from './lifecycle/context.js';
import { executeContextContinuity } from './lifecycle/context-continuity-executor.js';
import { executeHerdrMetadata } from './lifecycle/herdr-metadata-executor.js';
import { executeDelegationResult } from './lifecycle/delegation-result.js';
import { resolveInstall } from './lifecycle/context-executor.js';
import { type LifecycleExecution, record } from './lifecycle/executor-shared.js';
import { executeFormat } from './lifecycle/format-executor.js';
import { executeLargeChange } from './lifecycle/large-change-executor.js';
import { observeResume } from './lifecycle/resume-observer.js';
import { checkpointReminderOutput } from './lifecycle/session-close-intent.js';
import { executeTrim } from './lifecycle/trim-executor.js';
import { executeTypecheck } from './lifecycle/typecheck-executor.js';
import { resolveTelemetryRoot, type TelemetryRoot } from './project-roots.js';
import {
  recordHookEvent,
  recordRuntimeEventFromCli,
} from './record.js';
import type { AgentRuntime } from './runtime-input.js';
import { PRODUCT_COMMAND } from './identity.js';

// One inventory of the rules, shared with the table that names each rule's
// doctrine. A second list here would drift from that one, silently, and a rule
// missing from either side fails open.
const RULES = new Set<string>(RULE_NAMES);

function isRuleName(value: string | undefined): value is RuleName {
  return value !== undefined && RULES.has(value);
}

async function readStdin(ciContent: boolean): Promise<Buffer> {
  const limit = ciContent ? MAX_CI_CONTENT_BYTES : MAX_HOOK_INPUT_BYTES;
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const raw of process.stdin) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
    bytes += chunk.byteLength;
    if (bytes > limit) {
      throw new Error(ciContent ? 'CI_CONTENT_TOO_LARGE' : 'HOOK_INPUT_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function verdictMessage(rule: RuleName, verdict: ReturnType<typeof evaluateRule>): string {
  const evidence = verdict.evidence.length === 0
    ? ''
    : `\n${verdict.evidence.map((item) => `- ${item}`).join('\n')}`;
  // Name the doctrine, do not load it. A refusal that only states the rule
  // leaves the skill that explains it unopened, which is how this harness ran
  // 26,440 hook executions against 4 skill activations.
  return `${verdict.code}: ${withGoverningSkill(rule, verdict.message)}${evidence}\n`;
}

/**
 * Refuse the tool call in the channel the runtime reads. Claude Code takes exit
 * 2 with the reason on stderr. Codex runs a hook through the session shell, and
 * PowerShell, its default on Windows, turns any non-zero native exit into 1,
 * which Codex treats as a failed hook and lets the call through. Exit 0 is the
 * only status every shell carries, so Codex gets its documented PreToolUse
 * denial on stdout instead, escaped to ASCII so no console code page can
 * corrupt it on the way.
 */
function refuse(agentRuntime: AgentRuntime, reason: string): void {
  if (agentRuntime !== 'codex') {
    process.stderr.write(reason);
    process.exitCode = 2;
    return;
  }
  const denial = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason.trimEnd(),
    },
  }).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  process.stdout.write(`${denial}\n`);
  process.exitCode = 0;
}

function enforcementRuntime(): AgentRuntime {
  return process.argv[2] === 'enforce'
    ? runtime(process.argv[4] ?? process.env['VOID_AGENT_RUNTIME'])
    : 'unknown';
}

function runtime(value: string | undefined): AgentRuntime {
  return value === 'claude' || value === 'codex' ? value : 'unknown';
}

function projectRoot(): string {
  return process.env['VOID_PROJECT_ROOT']
    ?? process.env['CLAUDE_PROJECT_DIR']
    ?? discoverProjectRoot(process.cwd());
}

function optionalPayload(input: Uint8Array): unknown {
  if (input.byteLength === 0) return {};
  try {
    return parseHookPayload(input);
  } catch {
    return undefined;
  }
}

/**
 * Refresh the cached published version for the NEXT session.
 *
 * Called after stdout is written, so it can never delay a launch beyond its own
 * short timeout, and only reaches the network when the cache has actually expired.
 * Advisory like `observeHook`: every failure is swallowed, because a version check
 * must never be able to break a session.
 */
async function refreshFreshnessInBackground(installed: string): Promise<void> {
  try {
    await resolveFreshness({
      installed,
      env: process.env,
      now: Date.now(),
      timeoutMs: 1_000,
    });
  } catch {
    // Freshness is advisory and must never alter hook behavior.
  }
}

let telemetryDestination: TelemetryRoot | undefined;

function reportTelemetryFailure(error: unknown): void {
  const unresolved = error instanceof Error && error.message === 'TELEMETRY_ROOT_UNRESOLVED';
  process.stderr.write(unresolved
    ? 'TELEMETRY_ROOT_UNRESOLVED: cannot verify journal destination; check Git worktree metadata and Git availability.\n'
    : 'TELEMETRY_WRITE_FAILED: journal was not recorded; check journal access and storage.\n');
}

async function observeHook(
  hook: string,
  execution: Omit<LifecycleExecution, 'status'> & {
    readonly status: LifecycleExecution['status'] | 'blocked';
  },
  rawInput: unknown,
  agentRuntime: AgentRuntime,
  root: string,
): Promise<void> {
  try {
    const explicitRoot = process.env['VOID_PROJECT_ROOT'] ?? process.env['CLAUDE_PROJECT_DIR'];
    telemetryDestination ??= explicitRoot === undefined
      ? resolveTelemetryRoot(root)
      : { kind: 'resolved', root: explicitRoot };
    if (telemetryDestination.kind === 'unavailable') throw new Error(telemetryDestination.code);
    await recordHookEvent({
      root: telemetryDestination.root,
      runtime: agentRuntime,
      hook,
      status: execution.status,
      rawInput,
      details: execution.details,
      ...(process.env['VOID_MISSION_ID'] === undefined
        ? {}
        : { missionId: process.env['VOID_MISSION_ID'] }),
    });
  } catch (error) {
    // Report loss without changing the enforcement verdict or stdout protocol.
    reportTelemetryFailure(error);
  }
}

async function runLifecycle(input: Uint8Array): Promise<void> {
  const hook = process.argv[3] ?? '';
  const agentRuntime = runtime(process.argv[4] ?? process.env['VOID_AGENT_RUNTIME']);
  const root = projectRoot();
  const rawInput = optionalPayload(input);
  if (hook === 'context' || hook === 'context-continuity') {
    const inputRecord = record(rawInput);
    const event = inputRecord?.['hook_event_name'];
    if (hook === 'context-continuity' && event !== 'SessionStart') {
      const execution = executeContextContinuity(rawInput ?? {}, root, agentRuntime, Date.now());
      if (execution.output !== undefined) {
        process.stdout.write(`${JSON.stringify(execution.output)}\n`);
      }
      await observeHook(hook, execution, rawInput ?? {}, agentRuntime, root);
      return;
    }
    const install = resolveInstall(root, process.env);
    // Read the cache only: session start must never wait on a network round-trip.
    // The refresh below happens after stdout is written, so a slow or dead registry
    // costs the next session a stale answer, never this one a slow launch.
    const cached = readFreshnessCache(process.env, Date.now());
    // The relay wording, not the terminal one: nothing this hook can emit reaches
    // the user, so the line has to ask the agent to pass it on.
    const notice =
      cached === undefined
        ? undefined
        : freshnessRelay(compareFreshness(install.version, cached.latest), install.source);
    // The harness cannot see an invocation the runtime refused, so what it reads
    // here is the trace one leaves: a name it recorded that no longer resolves.
    // Read, never compute: judging the journals costs 49 ms here, and a session
    // start must not wait on an answer that can be one session old without
    // anyone being worse off. The recompute happens below, after stdout.
    const alert = cachedInvocationAlert(root);
    if (event === 'SessionStart' || hook === 'context') {
      const source = inputRecord?.['source'];
      const resume = observeResume(root, Date.now(), {
        ...(source === 'startup' || source === 'resume' || source === 'clear'
          || source === 'compact' || source === 'fork'
          ? { source }
          : {}),
      });
      process.stdout.write(
        `${JSON.stringify(sessionStartOutput(install.version, notice, alert, resume.context))}\n`,
      );
    }
    const execution = hook === 'context-continuity'
      ? executeContextContinuity(rawInput ?? {}, root, agentRuntime, Date.now())
      : { status: 'ok', details: {} } satisfies LifecycleExecution;
    await refreshFreshnessInBackground(install.version);
    refreshInvocationVerdict(root);
    await observeHook(hook, execution, rawInput ?? {}, agentRuntime, root);
    return;
  }
  if (rawInput === undefined) {
    await observeHook(
      hook || 'unknown',
      { status: 'degraded', details: { reason: 'invalid-hook-input' } },
      {},
      agentRuntime,
      root,
    );
    return;
  }
  if (hook === 'checkpoint-reminder') {
    const prompt = record(rawInput)?.['prompt'];
    const output = typeof prompt === 'string' ? checkpointReminderOutput(prompt) : undefined;
    const execution: LifecycleExecution = {
      status: output === undefined ? 'skipped' : 'ok',
      details: { reminded: output !== undefined },
    };
    if (output !== undefined) process.stdout.write(`${JSON.stringify(output)}\n`);
    await observeHook(hook, execution, rawInput, agentRuntime, root);
    return;
  }
  if (hook === 'checkpoint-audit') {
    const now = Date.now();
    const observed = observeResume(root, now);
    const audit = auditCheckpoint({
      now,
      checkpoint: observed.bundle.checkpoint,
      ...(observed.checkpointWrittenAt === undefined
        ? {}
        : { checkpointWrittenAt: observed.checkpointWrittenAt }),
      git: observed.bundle.git,
    });
    const execution: LifecycleExecution = {
      status: audit.status,
      details: { reasons: [...audit.reasons] },
      ...(audit.reasons.length === 0
        ? {}
        : {
            diagnostic: `${PRODUCT_COMMAND} SessionEnd audit: ${audit.reasons.join(', ')}\n`,
          }),
    };
    if (execution.diagnostic !== undefined) process.stderr.write(execution.diagnostic);
    await observeHook(hook, execution, rawInput, agentRuntime, root);
    return;
  }
  const execution = hook === 'format'
    ? executeFormat(rawInput, root, process.env)
    : hook === 'trim'
      ? executeTrim(rawInput, root, process.env)
      : hook === 'typecheck'
        ? executeTypecheck(root, process.env)
        : hook === 'large-change'
          ? executeLargeChange(root, process.env)
        : hook === 'delegation-result'
          ? executeDelegationResult(rawInput, Date.now())
        : hook === 'herdr-metadata'
          ? executeHerdrMetadata(rawInput, root, process.env, agentRuntime)
        : undefined;
  if (execution === undefined) return;
  if (execution.diagnostic !== undefined) process.stderr.write(execution.diagnostic);
  if ('output' in execution && execution.output !== undefined) {
    process.stdout.write(`${JSON.stringify(execution.output)}\n`);
  }
  await observeHook(hook, execution, rawInput, agentRuntime, root);
}

async function main(): Promise<void> {
  const input = await readStdin(process.argv[2] === 'enforce-ci');
  if (process.argv[2] === 'lifecycle') {
    await runLifecycle(input);
    return;
  }
  if (process.argv[2] !== 'enforce' && process.argv[2] !== 'enforce-ci') {
    try {
      await recordRuntimeEventFromCli(
        parseHookPayload(input),
        process.argv,
        process.env,
      );
    } catch (error) {
      reportTelemetryFailure(error);
    }
    return;
  }

  try {
    const requested = process.argv[3];
    if (!isRuleName(requested)) throw new Error('UNKNOWN_ENFORCEMENT_RULE');
    const rule = requested;
    const rawInput = process.argv[2] === 'enforce-ci'
      ? {
          tool_name: 'Write',
          tool_input: {
            file_path: process.argv[4] ?? '',
            content: parseCiContent(input),
          },
        }
      : parseHookPayload(input);
    const verdict = evaluateRule(
      rule,
      rawInput,
      {
        root: projectRoot(),
        source: process.argv[2] === 'enforce-ci' ? 'checked-out' : 'tool-input',
        env: process.env,
      },
    );
    if (process.argv[2] === 'enforce') {
      await observeHook(
        rule as RuleName,
        {
          status: verdict.allow ? 'ok' : 'blocked',
          details: {
            code: verdict.code,
            evidenceCount: verdict.evidence.length,
          },
        },
        rawInput,
        runtime(process.argv[4] ?? process.env['VOID_AGENT_RUNTIME']),
        projectRoot(),
      );
    }
    if (verdict.allow) {
      // An allowed verdict that still carries a finding is advice, never a decision.
      if (verdict.code !== 'ALLOW' && verdict.code !== 'OVERRIDE') {
        process.stderr.write(verdictMessage(rule, verdict));
      }
      return;
    }
    refuse(enforcementRuntime(), verdictMessage(rule, verdict));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ENFORCEMENT_ERROR';
    refuse(enforcementRuntime(), `HOOK_INPUT_REJECTED: ${message}\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ENFORCEMENT_ERROR';
  if (process.argv[2] === 'enforce' || process.argv[2] === 'enforce-ci') {
    refuse(enforcementRuntime(), `HOOK_RUNNER_FAILED: ${message}\n`);
    return;
  }
  process.stderr.write(`HOOK_RUNNER_FAILED: ${message}\n`);
  process.exitCode = 0;
});
