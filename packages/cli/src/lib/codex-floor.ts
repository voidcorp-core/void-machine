// Compile the Codex-side safety floor into a consumer project. Claude Code gets
// its floor auto-wired through .claude/settings.json (the marketplace plugin's
// PreToolUse hooks); Codex's equivalent is a project-local .codex/hooks.json
// pointing at resolvable hook scripts. `init` stages the scripts under
// .void/hooks/ and writes .codex/hooks.json compiled from the shipped template
// (packages/core/codex/hooks.json), so the former manual three-step opt-in
// (docs/CODEX.md) is now automatic and symmetric with the Claude path.
//
// This module owns the whole Codex-floor domain: the pure transforms
// (compile/reference/drift), the imperative staging (wire), and the two
// decision functions the adapter/commands read (health for doctor, refresh for
// update). Keeping them here means init/doctor/update never re-implement floor
// logic — they format results this module returns.

import { chmod, cp, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { syntaxWorkerHealth } from './syntax-worker-health.js';
import { PRODUCT_COMMAND } from '@voidcorp/hook-runner';

async function readOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    return ((await stat(path)).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

// Codex stages the Node runner and its isolated TypeScript worker. Shell adapters stay
// in the source package for older installs, but native manifests never reference
// or copy them into a consumer project.
export const CODEX_FLOOR_SCRIPTS = [
  '_void-hook.mjs',
  '_syntax-worker.cjs',
] as const;

// Project-relative directory the scripts are staged into on disk (mkdir/cp/chmod
// target). Kept relative so it composes with any root.
export const CODEX_HOOKS_DIR = '.void/hooks';

// biome-ignore lint/suspicious/noTemplateCurlyInString: this IS the literal placeholder token, matched verbatim.
const PLACEHOLDER = '${VOID_HOOKS_DIR}';

// The only command shape the template may use: Node running one staged asset.
const RUNNER_COMMAND = /^node "\$\{VOID_HOOKS_DIR\}\/([A-Za-z0-9._-]+\.mjs)"(?= |$)/;

// Bounds the upward walk. Deeper than any real checkout, shallow enough to stay free.
const LOOKUP_DEPTH_MAX = 64;

/**
 * The inline program that finds and runs a staged hook asset. `.codex/hooks.json`
 * is versioned, so it cannot carry the path of the checkout that ran `init`
 * (DEV-918). Codex runs a hook in the session cwd, through the session shell:
 * sh, bash or zsh on POSIX, PowerShell or cmd.exe on Windows. No path syntax
 * and no command substitution means the same thing in all five, so Node itself
 * walks up from the cwd to the nearest `.void/hooks/<asset>`. The program uses
 * no `$`, `%`, backtick, backslash, `!` or double quote, which those shells
 * would expand or end the argument on.
 *
 * A missing or unloadable runner fails closed on `enforce` and open elsewhere,
 * like the runner itself. Closed means the runner's Codex refusal: exit 0 with a
 * PreToolUse denial on stdout, since PowerShell turns any other exit into 1 and
 * Codex lets a call through on 1. The denial carries a fixed ASCII reason; the
 * detail, which may hold a non-ASCII path, goes to stderr.
 */
export function codexHookBootstrap(asset: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(asset)) throw new Error(`unsafe hook asset name: ${asset}`);
  return [
    "const f=require('fs'),p=require('path'),u=require('url'),m=process.argv[1],",
    'l=String.fromCharCode(10),',
    'x=function(r,t){process.stderr.write(r+t+l);',
    "if(m==='enforce')process.stdout.write(JSON.stringify({hookSpecificOutput:",
    "{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:r}})+l)};",
    `let d=process.cwd(),h='',i=${LOOKUP_DEPTH_MAX};`,
    `while(i--){const c=p.join(d,'.void','hooks','${asset}');`,
    'if(f.existsSync(c)){h=c;break}const n=p.dirname(d);if(n===d)break;d=n}',
    'if(h){process.argv.splice(1,0,h);import(u.pathToFileURL(h).href).catch(function(e){',
    `x('HOOK_RUNNER_FAILED: cannot load .void/hooks/${asset}',': '+String(e))})}`,
    `else{x('HOOK_RUNNER_MISSING: .void/hooks/${asset} not found above the session directory',`,
    "' '+process.cwd())}",
  ].join('');
}

function compileCommand(command: string): string {
  if (!command.includes(PLACEHOLDER)) return command;
  const match = RUNNER_COMMAND.exec(command) ?? undefined;
  const asset = match?.[1];
  if (match === undefined || asset === undefined || command.split(PLACEHOLDER).length !== 2) {
    throw new Error(`unsupported hook command in codex template: ${command}`);
  }
  return `node -e "${codexHookBootstrap(asset)}"${command.slice(match[0].length)}`;
}

function compileCommands(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compileCommands);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === 'command' && typeof child === 'string'
        ? compileCommand(child)
        : compileCommands(child),
    ]),
  );
}

/**
 * Compile the shipped Codex hooks template into the manifest written to
 * <project>/.codex/hooks.json: every `node "${VOID_HOOKS_DIR}/<asset>"` becomes
 * `node -e "<bootstrap>"`, which finds the staged asset from the session cwd.
 * The output depends on the template alone, never on the machine or checkout
 * that compiles it. The template's `description`, a manual install guide, is
 * rewritten. Throws on a template that isn't a JSON object or that uses the
 * placeholder in any other shape: a corrupt shipped asset must fail loudly at
 * wire time, never write a garbage manifest.
 */
export function compileCodexHooksManifest(template: string): string {
  const parsed: unknown = JSON.parse(template);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('codex hooks template is not a JSON object');
  }
  const manifest: Record<string, unknown> = { ...parsed };
  manifest.hooks = compileCommands(manifest.hooks);
  manifest.description =
    `Generated by \`${PRODUCT_COMMAND} init\` — the Codex-side safety floor, mirror of the ` +
    `Claude Code PreToolUse hooks. Each command finds ${CODEX_HOOKS_DIR}/ from the session ` +
    `directory, so the file holds no machine path; re-run \`${PRODUCT_COMMAND} init\` to refresh. See docs/CODEX.md.`;
  return JSON.stringify(manifest, null, 2);
}

/**
 * Every hook asset basename the manifest invokes. Accepts the raw template (with the
 * ${VOID_HOOKS_DIR} placeholder), a compiled manifest (the asset quoted inside
 * its bootstrap), or an older absolute-path one. Commands may invoke a shell adapter or
 * pass a bundled `.mjs` file to Node. A malformed (non-object) manifest
 * yields `[]` rather than throwing. Drift guard: the result must be a subset of
 * CODEX_FLOOR_SCRIPTS, else a hook would be wired-but-absent after `init`.
 */
export function referencedScripts(manifest: string): string[] {
  const found = new Set<string>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest);
  } catch {
    return [];
  }
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'command' && typeof child === 'string') {
        for (const match of child.matchAll(/([A-Za-z0-9._-]+\.(?:sh|mjs))(?=["'\s]|$)/g)) {
          if (match[1] !== undefined) found.add(match[1]);
        }
      } else {
        visit(child);
      }
    }
  };
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    visit(parsed);
  }
  return [...found];
}

/**
 * Stage the Codex safety floor into a consumer project (imperative shell): copy
 * the floor assets into <project>/.void/hooks/ and compile
 * <project>/.codex/hooks.json from the shipped template. Shared by `init` (first
 * wire) and `update` (refresh to the running CLI's version), so the two can
 * never drift in how the floor is materialized. Idempotent: re-running
 * overwrites the managed scripts + manifest in place. `sourceRoot` is the
 * located `packages/core` tree (findCoreSource). Returns how many scripts were
 * staged so the caller can phrase the status line itself.
 *
 * The manifest is written via a temp-file rename so a reader never observes a
 * half-written .codex/hooks.json.
 */
export async function wireCodexFloor(stageRoot: string, sourceRoot: string): Promise<number> {
  const hooksSrc = join(sourceRoot, 'hooks');
  const hooksDst = join(stageRoot, CODEX_HOOKS_DIR);
  await mkdir(hooksDst, { recursive: true });
  for (const script of CODEX_FLOOR_SCRIPTS) {
    await cp(join(hooksSrc, script), join(hooksDst, script));
  }

  const template = await readFile(join(sourceRoot, 'codex', 'hooks.json'), 'utf8');
  // Shell assets would require an executable bit after npm packing. The native
  // manifest passes `.mjs` assets to Node, so their mode is deliberately irrelevant.
  for (const hook of referencedScripts(template)) {
    if (hook.endsWith('.sh')) await chmod(join(hooksDst, hook), 0o755);
  }

  const manifest = compileCodexHooksManifest(template);
  const codexDir = join(stageRoot, '.codex');
  await mkdir(codexDir, { recursive: true });
  const manifestPath = join(codexDir, 'hooks.json');
  const tmpPath = `${manifestPath}.tmp`;
  await writeFile(tmpPath, manifest.endsWith('\n') ? manifest : `${manifest}\n`);
  await rename(tmpPath, manifestPath);

  return CODEX_FLOOR_SCRIPTS.length;
}

/**
 * Which floor files staged in the project differ from what the running CLI would
 * write (`sourceRoot` = findCoreSource). Empty ⇒ the staged floor is already at
 * the CLI's version. Lets `update` refresh only on real drift and report
 * fresh/refreshed honestly instead of rewriting identical files every run.
 * Trailing-newline differences are ignored (wireCodexFloor appends one).
 */
export async function codexFloorDrift(projectRoot: string, sourceRoot: string): Promise<string[]> {
  const drift: string[] = [];
  const hooksSrc = join(sourceRoot, 'hooks');
  const hooksDst = join(projectRoot, CODEX_HOOKS_DIR);
  for (const script of CODEX_FLOOR_SCRIPTS) {
    const [src, dst] = await Promise.all([
      readOrUndefined(join(hooksSrc, script)),
      readOrUndefined(join(hooksDst, script)),
    ]);
    if (src !== dst) drift.push(script);
  }

  const template = await readOrUndefined(join(sourceRoot, 'codex', 'hooks.json'));
  const expected = template === undefined
    ? undefined
    : compileCodexHooksManifest(template);
  const actual = await readOrUndefined(join(projectRoot, '.codex', 'hooks.json'));
  const trimEnd = (s: string | undefined): string => (s ?? '').replace(/\n+$/, '');
  if (trimEnd(actual) !== trimEnd(expected)) drift.push('hooks.json');
  return drift;
}

export interface CodexFloorHealth {
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * Health of the staged Codex floor, for `doctor`. Never throws (all fs +
 * parse failures map to an `ok: false` detail), so a corrupt manifest reports a
 * red line instead of crashing the whole health check. Verifies the floor is
 * actually live, not merely present:
 *   - manifest exists, is valid JSON, and is an object;
 *   - it references at least one staged command;
 *   - every floor asset is staged;
 *   - a referenced shell adapter is executable (Node assets need only exist).
 */
export async function codexFloorHealth(projectRoot: string): Promise<CodexFloorHealth> {
  const manifest = await readOrUndefined(join(projectRoot, '.codex', 'hooks.json'));
  if (manifest === undefined) return { ok: false, detail: '.codex/ present but hooks.json missing' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest);
  } catch {
    return { ok: false, detail: '.codex/hooks.json is not valid JSON' };
  }
  // allow-null: JSON.parse returns the null literal for a "null" manifest.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, detail: '.codex/hooks.json is not a JSON object' };
  }

  const entryHooks = referencedScripts(manifest);
  if (entryHooks.length === 0) return { ok: false, detail: '.codex/hooks.json references no staged scripts' };

  const hooksDir = join(projectRoot, CODEX_HOOKS_DIR);
  const missing: string[] = [];
  for (const script of CODEX_FLOOR_SCRIPTS) {
    if ((await readOrUndefined(join(hooksDir, script))) === undefined) missing.push(script);
  }
  if (missing.length > 0) return { ok: false, detail: `staged scripts missing: ${missing.join(', ')}` };

  const notExecutable: string[] = [];
  for (const hook of entryHooks) {
    if (hook.endsWith('.sh') && !(await isExecutable(join(hooksDir, hook)))) {
      notExecutable.push(hook);
    }
  }
  if (notExecutable.length > 0) {
    return { ok: false, detail: `staged hooks not executable: ${notExecutable.join(', ')}` };
  }

  const syntaxIssue = syntaxWorkerHealth(hooksDir);
  if (syntaxIssue !== undefined) return { ok: false, detail: syntaxIssue };

  return {
    ok: true,
    detail: `wired: ${CODEX_FLOOR_SCRIPTS.length} runtime assets staged in ${CODEX_HOOKS_DIR}/`,
  };
}

export type CodexFloorRefresh =
  | { readonly status: 'fresh'; readonly drift: readonly string[] }
  | { readonly status: 'would-refresh'; readonly drift: readonly string[] }
  | { readonly status: 'refreshed'; readonly drift: readonly string[] };

/**
 * Bring the staged floor to the running CLI's version, for `update`. Re-stages
 * only on real content drift so a no-op update stays a no-op; the status is
 * honest about whether files were actually written (`refreshed`) versus a
 * dry-run preview (`would-refresh`). Assumes the caller already established that
 * Codex is wired and located `sourceRoot`.
 */
export async function refreshCodexFloor(
  projectRoot: string,
  sourceRoot: string,
  dryRun: boolean,
): Promise<CodexFloorRefresh> {
  const drift = await codexFloorDrift(projectRoot, sourceRoot);
  if (drift.length === 0) return { status: 'fresh', drift };
  if (dryRun) return { status: 'would-refresh', drift };
  await wireCodexFloor(projectRoot, sourceRoot);
  return { status: 'refreshed', drift };
}
