import { governingSkill, RULE_NAMES, withGoverningSkill } from './enforcement/governing-skill.js';
import {
  discoverProjectRoot,
  evaluateRule,
  MAX_HOOK_INPUT_BYTES,
  parseHookPayload,
  parseHookText,
  type RuleName,
} from './enforcement/runner.js';
import { readFreshnessCache } from './freshness/cache.js';
import { compareFreshness } from './freshness/compare.js';
import { freshnessNotice, resolveFreshness } from './freshness/notice.js';
import { cachedInvocationAlert, refreshInvocationVerdict } from './invocation.js';
import { auditCheckpoint } from './lifecycle/checkpoint-audit.js';
import { sessionStartOutput } from './lifecycle/context.js';
import { executeContextContinuity } from './lifecycle/context-continuity-executor.js';
import { resolveInstall } from './lifecycle/context-executor.js';
import { type LifecycleExecution, record } from './lifecycle/executor-shared.js';
import { executeFormat } from './lifecycle/format-executor.js';
import { executeLargeChange } from './lifecycle/large-change-executor.js';
import { observeResume } from './lifecycle/resume-observer.js';
import { checkpointReminderOutput } from './lifecycle/session-close-intent.js';
import { executeTrim } from './lifecycle/trim-executor.js';
import { executeTypecheck } from './lifecycle/typecheck-executor.js';
import {
  recordHookEvent,
  recordRuntimeEventFromCli,
} from './record.js';
import type { AgentRuntime } from './runtime-input.js';

// One inventory of the rules, shared with the table that names each rule's
// doctrine. A second list here would drift from that one, silently, and a rule
// missing from either side fails open.
const RULES = new Set<string>(RULE_NAMES);

function isRuleName(value: string | undefined): value is RuleName {
  return value !== undefined && RULES.has(value);
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const raw of process.stdin) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
    bytes += chunk.byteLength;
    if (bytes > MAX_HOOK_INPUT_BYTES) throw new Error('HOOK_INPUT_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function writeVerdict(
  rule: RuleName,
  verdict: ReturnType<typeof evaluateRule>,
  write: (message: string) => void,
): void {
  if (verdict.code === 'ALLOW' || verdict.code === 'OVERRIDE') return;
  const evidence = verdict.evidence.length === 0
    ? ''
    : `\n${verdict.evidence.map((item) => `- ${item}`).join('\n')}`;
  // Name the doctrine, do not load it. A refusal that only states the rule
  // leaves the skill that explains it unopened, which is how this harness ran
  // 26,440 hook executions against 4 skill activations.
  write(`${verdict.code}: ${withGoverningSkill(rule, verdict.message)}${evidence}\n`);
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

async function observeHook(
  hook: string,
  execution: Omit<LifecycleExecution, 'status'> & {
    readonly status: LifecycleExecution['status'] | 'blocked';
  },
  rawInput: unknown,
  agentRuntime: AgentRuntime,
  root: string,
): Promise<void> {
  await recordHookEvent({
    root,
    runtime: agentRuntime,
    hook,
    status: execution.status,
    rawInput,
    details: execution.details,
    ...(process.env['VOID_GLOBAL_DIR'] === undefined
      ? {}
      : { globalDir: process.env['VOID_GLOBAL_DIR'] }),
    ...(process.env['VOID_MISSION_ID'] === undefined
      ? {}
      : { missionId: process.env['VOID_MISSION_ID'] }),
  }).catch(() => {
    // Observability is advisory and must never alter hook behavior.
  });
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
    const notice =
      cached === undefined
        ? undefined
        : freshnessNotice(compareFreshness(install.version, cached.latest), install.source);
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
            diagnostic: `void-harness SessionEnd audit: ${audit.reasons.join(', ')}\n`,
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
        : undefined;
  if (execution === undefined) return;
  if (execution.diagnostic !== undefined) process.stderr.write(execution.diagnostic);
  if ('output' in execution && execution.output !== undefined) {
    process.stdout.write(`${JSON.stringify(execution.output)}\n`);
  }
  await observeHook(hook, execution, rawInput, agentRuntime, root);
}

async function main(): Promise<void> {
  const input = await readStdin();
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
    } catch {
      // Telemetry is advisory and must never block a runtime tool call.
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
            content: parseHookText(input),
          },
        }
      : parseHookPayload(input);
    const verdict = evaluateRule(
      rule,
      rawInput,
      {
        root: projectRoot(),
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
    writeVerdict(rule, verdict, (message) => process.stderr.write(message));
    if (!verdict.allow) process.exitCode = 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ENFORCEMENT_ERROR';
    process.stderr.write(`HOOK_INPUT_REJECTED: ${message}\n`);
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ENFORCEMENT_ERROR';
  process.stderr.write(`HOOK_RUNNER_FAILED: ${message}\n`);
  process.exitCode = process.argv[2] === 'enforce' ? 2 : 0;
});
