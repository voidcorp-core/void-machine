import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  accessSync,
  constants,
  existsSync,
  statSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { voidMachinePath, voidReadPath } from '@voidcorp/hook-runner';
import { replayEventLog } from '@voidcorp/mission-engine/events';
import type { Runtime } from '../runtime.js';
import { adaptersFor } from '../runtime-adapters.js';
import { hashSelfHostSource } from './compile.js';
import {
  readSelfHostReceipt,
  type SelfHostMode,
  selfHostReceiptDrift,
} from './receipt.js';

export type SelfHostState =
  | 'not-installed'
  | 'stale'
  | 'drifted'
  | 'degraded'
  | 'healthy';

export interface SelfHostCheck {
  readonly id: string;
  readonly status: 'ok' | 'degraded' | 'failed';
  readonly detail: string;
}

export interface SelfHostDiagnosis {
  readonly state: SelfHostState;
  readonly blocking: boolean;
  readonly mode: SelfHostMode;
  readonly sourceHash?: string;
  readonly artifactRoot: string;
  readonly checks: readonly SelfHostCheck[];
}

export interface EventReplayProbe {
  readonly ok: boolean;
  readonly detail: string;
}

export interface DiagnoseSelfHostOptions {
  readonly generatedRoot?: string;
  readonly computeSourceHash?: (root: string) => Promise<string>;
  readonly runtimeAvailable?: (runtime: Runtime) => boolean;
  readonly probeEventReplay?: (
    root: string,
    artifactRoot: string,
  ) => Promise<EventReplayProbe>;
  readonly mode?: SelfHostMode;
}

const SAFE_CHILD_ENVIRONMENT = [
  'COMSPEC',
  'FORCE_COLOR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NO_COLOR',
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'WINDIR',
] as const;

export function selfHostChildEnvironment(
  ambient: Readonly<NodeJS.ProcessEnv>,
  overrides: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of SAFE_CHILD_ENVIRONMENT) {
    const value = ambient[key];
    if (value !== undefined) result[key] = value;
  }
  return { ...result, ...overrides };
}

function commandAvailable(command: Runtime): boolean {
  const suffixes = process.platform === 'win32'
    ? ['', '.exe', '.cmd', '.bat']
    : [''];
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (directory === '') continue;
    for (const suffix of suffixes) {
      const candidate = join(directory, `${command}${suffix}`);
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(
          candidate,
          process.platform === 'win32' ? constants.F_OK : constants.X_OK,
        );
        const smoke = spawnSync(candidate, ['--version'], {
          encoding: 'utf8',
          env: selfHostChildEnvironment(process.env),
          shell: false,
          timeout: 5_000,
          maxBuffer: 1024 * 1024,
        });
        if (smoke.status === 0 && smoke.error === undefined) return true;
      } catch {
        // Continue searching PATH.
      }
    }
  }
  return false;
}

function discoveryCheck(artifactRoot: string): SelfHostCheck {
  const required = [
    '.claude/settings.json',
    '.claude/skills/void-tdd/SKILL.md',
    '.claude/agents/doctrine-critic.md',
    '.claude/agents/solution-architect.md',
    '.claude/agents/experience-designer.md',
    '.claude/agents/visual-craft-director.md',
    '.codex/hooks.json',
    '.agents/skills/void-tdd/SKILL.md',
    '.codex/agents/doctrine-critic.toml',
    '.codex/agents/solution-architect.toml',
    '.codex/agents/experience-designer.toml',
    '.codex/agents/visual-craft-director.toml',
    '.void/hooks/_void-hook.mjs',
  ];
  const missing = required.filter((path) =>
    !existsSync(join(artifactRoot, ...path.split('/'))),
  );
  return missing.length === 0
    ? {
        id: 'discovery',
        status: 'ok',
        detail: 'Claude and Codex skills, specialists and manifests are discoverable',
      }
    : {
        id: 'discovery',
        status: 'failed',
        detail: `missing compiled surfaces: ${missing.join(', ')}`,
      };
}

async function probeRuntimeEvent(
  root: string,
  artifactRoot: string,
  runtime: Runtime,
): Promise<EventReplayProbe> {
  const missionId = `mis_selfhost_${randomUUID().replaceAll('-', '')}`;
  const runner = join(artifactRoot, '.void', 'hooks', '_void-hook.mjs');
  const result = spawnSync(
    process.execPath,
    [runner, 'activation', runtime],
    {
      cwd: root,
      env: selfHostChildEnvironment(process.env, {
        VOID_PROJECT_ROOT: root,
        VOID_GLOBAL_DIR: voidMachinePath(root, 'generated', '.global'),
        VOID_AGENT_RUNTIME: runtime,
        VOID_MISSION_ID: missionId,
      }),
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: `self-host-${runtime}`,
        tool_name: 'Read',
        tool_input: { file_path: join(root, 'README.md') },
      }),
      encoding: 'utf8',
      shell: false,
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.status !== 0 || result.error !== undefined) {
    return {
      ok: false,
      detail: `${runtime} hook probe failed or timed out`,
    };
  }
  const log = join(voidReadPath(root, 'runs'), missionId, 'events.jsonl');
  let body: string;
  try {
    body = await readFile(log, 'utf8');
  } catch {
    return { ok: false, detail: `${runtime} hook emitted no canonical journal` };
  }
  const replay = replayEventLog(body);
  const observed = replay.events.some((event) =>
    event.missionId === missionId
    && event.source === `runtime:${runtime}`
    && event.kind === 'runtime.tool.started'
    && event.subject === 'tool:Read',
  );
  return observed && replay.invalidLines === 0
    ? { ok: true, detail: `${runtime} event accepted by canonical replay` }
    : { ok: false, detail: `${runtime} event was not accepted by canonical replay` };
}

async function defaultEventProbe(
  root: string,
  artifactRoot: string,
): Promise<EventReplayProbe> {
  const results = await Promise.all(
    (['claude', 'codex'] as const).map((runtime) =>
      probeRuntimeEvent(root, artifactRoot, runtime),
    ),
  );
  const failed = results.filter((result) => !result.ok);
  return failed.length === 0
    ? {
        ok: true,
        detail: results.map((result) => result.detail).join('; '),
      }
    : {
        ok: false,
        detail: failed.map((result) => result.detail).join('; '),
      };
}

function blockingDiagnosis(
  state: Extract<SelfHostState, 'not-installed' | 'stale' | 'drifted'>,
  mode: SelfHostMode,
  artifactRoot: string,
  checks: readonly SelfHostCheck[],
  sourceHash?: string,
): SelfHostDiagnosis {
  return {
    state,
    blocking: true,
    mode,
    artifactRoot,
    checks,
    ...(sourceHash === undefined ? {} : { sourceHash }),
  };
}

export async function diagnoseSelfHost(
  root: string,
  options: DiagnoseSelfHostOptions = {},
): Promise<SelfHostDiagnosis> {
  const canonicalRoot = resolve(root);
  const artifactRoot = join(
    resolve(options.generatedRoot ?? voidMachinePath(canonicalRoot, 'generated')),
    'current',
  );
  const receipt = await readSelfHostReceipt(artifactRoot);
  const mode = options.mode ?? receipt?.mode ?? 'shadow';
  if (receipt === undefined) {
    return blockingDiagnosis('not-installed', mode, artifactRoot, [{
      id: 'receipt',
      status: 'failed',
      detail: 'self-host receipt is missing or invalid',
    }]);
  }
  if (options.mode !== undefined && receipt.mode !== options.mode) {
    return blockingDiagnosis('stale', mode, artifactRoot, [{
      id: 'rollout-mode',
      status: 'failed',
      detail: `receipt mode is ${receipt.mode}, requested ${options.mode}`,
    }]);
  }
  const computeSourceHash = options.computeSourceHash ?? hashSelfHostSource;
  let sourceHash: string;
  try {
    sourceHash = await computeSourceHash(canonicalRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown source hash error';
    return blockingDiagnosis('stale', mode, artifactRoot, [{
      id: 'source-hash',
      status: 'failed',
      detail: message,
    }]);
  }
  if (sourceHash !== receipt.sourceHash) {
    return blockingDiagnosis('stale', mode, artifactRoot, [{
      id: 'source-hash',
      status: 'failed',
      detail: 'current sources differ from the compiled self-host receipt',
    }], sourceHash);
  }
  const drift = await selfHostReceiptDrift(artifactRoot, receipt);
  if (drift.length > 0) {
    return blockingDiagnosis('drifted', mode, artifactRoot, [{
      id: 'receipt',
      status: 'failed',
      detail: `owned artifact drift: ${drift.slice(0, 10).join(', ')}`,
    }], sourceHash);
  }

  const checks: SelfHostCheck[] = [{
    id: 'receipt',
    status: 'ok',
    detail: `${receipt.files.length} owned files match source ${sourceHash.slice(0, 12)}`,
  }];
  checks.push(discoveryCheck(artifactRoot));
  for (const adapter of adaptersFor(['claude', 'codex'])) {
    const inspection = await adapter.inspect(artifactRoot);
    checks.push({
      id: `hook-${adapter.id}`,
      status: inspection.evidence.installed === true
        && inspection.evidence.wired === true
        && inspection.evidence.fired === true
        ? 'ok'
        : 'failed',
      detail: [
        `installed=${inspection.evidence.installed === true}`,
        `wired=${inspection.evidence.wired === true}`,
        `fired=${inspection.evidence.fired === true}`,
      ].join(' '),
    });
  }
  const probe = await (options.probeEventReplay ?? defaultEventProbe)(
    canonicalRoot,
    artifactRoot,
  );
  checks.push({
    id: 'event-replay',
    status: probe.ok ? 'ok' : 'failed',
    detail: probe.detail,
  });
  const runtimeAvailable = options.runtimeAvailable ?? commandAvailable;
  for (const runtime of ['claude', 'codex'] as const) {
    const available = runtimeAvailable(runtime);
    checks.push({
      id: `runtime-${runtime}`,
      status: available ? 'ok' : 'degraded',
      detail: available
        ? `${runtime} version smoke and compiled adapter smoke passed`
        : `${runtime} executable unavailable; native end-to-end smoke is deferred`,
    });
  }

  if (checks.some((check) => check.status === 'failed')) {
    return blockingDiagnosis('drifted', mode, artifactRoot, checks, sourceHash);
  }
  const degraded = checks.some((check) => check.status === 'degraded');
  return {
    state: degraded ? 'degraded' : 'healthy',
    blocking: false,
    mode,
    sourceHash,
    artifactRoot,
    checks,
  };
}
