// Shared AGENTS instructions; CLAUDE imports that owner through its native loader.

import { existsSync } from 'node:fs';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hasManagedBlock, PRODUCT_IDENTITY, replaceManagedBlock } from '@voidcorp/hook-runner';
import { MARKETPLACE_NAME, MARKETPLACE_REPO, type PackDescriptor } from './packs.js';
import type { Runtime } from './runtime.js';
import type { InstallSource } from './runtime-assets.js';

// Written under the current name; a block from before a rename is still found and replaced.
const MARKERS = PRODUCT_IDENTITY.markers.agentDoc;
const COMMAND = PRODUCT_IDENTITY.commands.primary;

export type { Runtime };

/** True when the doc carries the harness block, under the current or a former name (doctor). */
export function hasHarnessBlock(text: string): boolean {
  return hasManagedBlock(text, MARKERS);
}

/** The doctrine doc a runtime owns: Claude Code reads CLAUDE.md, Codex reads AGENTS.md. */
export function docFileFor(runtime: Runtime): string {
  return runtime === 'codex' ? 'AGENTS.md' : 'CLAUDE.md';
}

export interface ClaudeMdBlockInputs {
  readonly enabledPlugins: readonly string[];
  readonly enabledPacks: readonly PackDescriptor[];
  /**
   * How the harness was installed, which is what decides whether a skill name
   * carries a namespace. Only a Claude Code marketplace plugin prefixes one; a
   * local install lands every skill flat in `.claude/skills/` and answers to the
   * bare name, and Codex has no marketplace at all. Reading this off the runtime
   * instead is what shipped `harness:tdd` into locally installed skills, where
   * the call returns Unknown skill. Defaults to the primary channel.
   */
  readonly channel?: InstallSource;
  /** Partial commands retain the published location until init/update migrates it. */
  readonly philosophyPath?: '.void/PHILOSOPHY.md' | '.void/installed/PHILOSOPHY.md';
}

export function harnessBlock(input: ClaudeMdBlockInputs, runtime: Runtime = 'claude'): string {
  const packLines = input.enabledPacks.map((p) => `- \`${p.name}\` — ${p.description}`);
  if (runtime === 'claude') return [MARKERS.current.begin, '', '@AGENTS.md', '', MARKERS.current.end].join('\n');
  const doctrineLead = '### Doctrine — read at the start of every session';
  const imports = [`@${input.philosophyPath ?? '.void/PHILOSOPHY.md'}`, '@.void/PROJECT-DOCTRINE.md'];
  const captureLine = 'To capture a new rule, just say it ("ajoute la règle…", "always X here", "never Y"). The `void-learn` workflow classifies project-specific vs universal, proposes the wording, waits for your confirmation, then writes. Never silent.';
  const ticketRunner = '`void-implement`';
  const invocationLine = 'Every skill is invoked by its name. Codex uses `$void-implement`, `$void-tdd`. Claude Code uses `/void-implement`, `/void-tdd` for local installs; marketplace plugins use `/harness:void-implement`, `/harness:void-tdd`. A skill that composes another names it the same way; use the syntax of the active runtime and installation channel.';
  const delegationLine = 'Use `void-orchestrate` to delegate independent research and substantial implementation when native capabilities permit. Keep intent and decisions with the coordinator; an already delegated writer executes its unit once. Publish observed worker lifecycle events for external presentation tools. Preserve existing permissions, independent review and real invocation evidence.';
  return [
    MARKERS.current.begin,
    '',
    `## Void Machine (managed by \`${COMMAND} init\`)`,
    '',
    // Provenance, and only when it is true. The default path copies bundled
    // assets and never contacts a marketplace, so naming one there teaches the
    // model a channel that does not exist in this project -- the same class of
    // untruth that had skills invoked under a namespace nothing could resolve.
    input.channel === 'marketplace'
      ? `Marketplace: \`${MARKETPLACE_NAME}\` (https://github.com/${MARKETPLACE_REPO}). Shared doctrine active in this project:`
      : `Shared doctrine active in this project:`,
    '',
    `- \`void\` — universal craftsman skills (TDD, TypeScript strict, hexagonal, DDD, ...)`,
    ...packLines,
    '',
    doctrineLead,
    '',
    ...imports,
    '',
    `\`PHILOSOPHY.md\` is the universal Void Machine doctrine (managed — overwritten on init). \`PROJECT-DOCTRINE.md\` holds project-specific rules: context, ADRs, in-flight decisions (yours; init never overwrites what you have written in it).`,
    '',
    captureLine,
    '',
    invocationLine,
    '',
    '### Resume and autonomous selection',
    '',
    `Autonomous selection requires an explicit \`.void/config.json\` \`autopilot\` declaration with \`schemaVersion: 3\` and boolean \`enabled\`. \`enabled: false\`, an absent block, an older version, invalid or unreadable config refuses dependent autonomous actions. Historical programmes and checkpoint intentions grant no authority; never migrate consent automatically. On continue/start/resume, read the complete checkpoint and the approved plan linked by the native milestone located through \`progress.provider/scope/states\`. The scope is an opaque native project-and-milestone locator. Verify actual ticket membership, full criteria, blockers and human holds before selection. Reconcile all engaged tickets, PRs, Git and native workers; do not duplicate uncertain workers or stop independent authorized work merely because several tickets are engaged. Refresh affected observations and use the mutable planned list as intent within the authorized scope, preserving human priorities and assignments. The declared progress provider owns mutable execution state. If provider, scope or plan is unavailable, do not infer remote progress; stop only dependent selection. A specific user request governs its named unit. Human holds, protected paths and deployment promotion remain human. Fetch the complete unit before running ${ticketRunner}. \`ResumeBundle\` composes checkpoint and Git offline; references and intentions are not authorization or fresh proof.`,
    '',
    'An authorized merge includes routine local synchronization by the coordinator without asking for confirmation again. '
      + 'Verify the branch, remote, and verified merged commit, then fetch and advance the clean local target branch '
      + 'with `git merge --ff-only` to that commit. Stop on local changes, divergence, or an unexpected remote tip; '
      + 'preserve the work. This does not authorize another remote merge, deployment, history rewrite, or changes '
      + 'to shared Git state by commit-only workers. Runtime sandbox and approval controls still apply; never bypass them.',
    '',
    delegationLine,
    '',
    `Run \`${COMMAND} doctor\` to verify the install.`,
    '',
    MARKERS.current.end,
  ].join('\n');
}

function patchHarnessBlock(original: string, block: string): string {
  const replaced = replaceManagedBlock(original, MARKERS, block);
  if (replaced !== undefined) return replaced;
  const lines = original.split('\n');
  const headerIdx = lines.findIndex((l) => l.startsWith('# '));
  if (headerIdx >= 0) {
    const before = lines.slice(0, headerIdx + 1).join('\n');
    const after = lines.slice(headerIdx + 1).join('\n');
    return `${before}\n\n${block}\n${after.startsWith('\n') ? after : `\n${after}`}`;
  }
  return `${block}\n\n${original}`;
}

type PatchResult = 'created' | 'patched' | 'updated' | 'unchanged';

async function patchDoc(
  target: string,
  title: string,
  block: string,
): Promise<PatchResult> {
  const info = await lstat(target).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (info?.isSymbolicLink()) throw new Error(`instruction document is a symbolic link: ${target}`);
  if (info === undefined) {
    const fresh = [
      `# ${title}`,
      '',
      block,
      '',
      '<!-- Your project-specific guidance goes below. -->',
      '',
    ].join('\n');
    await writeFile(target, fresh);
    return 'created';
  }
  const original = await readFile(target, 'utf8');
  const patched = patchHarnessBlock(original, block);
  if (patched === original) return 'unchanged';
  await writeFile(target, patched);
  return hasHarnessBlock(original) ? 'updated' : 'patched';
}

/** Patch common instructions and, for Claude, the native import of that owner. */
export async function patchRuntimeDoc(
  projectRoot: string,
  runtime: Runtime,
  input: ClaudeMdBlockInputs,
): Promise<PatchResult> {
  const file = docFileFor(runtime);
  const common = await patchDoc(join(projectRoot, 'AGENTS.md'), 'AGENTS.md', harnessBlock(input, 'codex'));
  if (runtime === 'codex') return common;
  return patchDoc(join(projectRoot, file), file, harnessBlock(input, 'claude'));
}

/** Preserve a known published reference; partial commands do not publish doctrine. */
export async function publishedPhilosophyPath(projectRoot: string): Promise<NonNullable<ClaudeMdBlockInputs['philosophyPath']>> {
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const text = await readFile(join(projectRoot, file), 'utf8').catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
      throw error;
    });
    // Read only delivered paths inside a recognized managed block. User prose
    // outside the block neither changes the active doctrine nor claims ownership.
    for (const pair of MARKERS.recognized) {
      const start = text.indexOf(pair.begin);
      const end = text.indexOf(pair.end, start + pair.begin.length);
      if (start < 0 || end < 0) continue;
      const block = text.slice(start, end);
      for (const match of block.matchAll(/^(?:@|- `)(\.void\/(?:installed\/)?PHILOSOPHY\.md)(?:`|\s*$)/gm)) {
        const path = match[1];
        if ((path === '.void/PHILOSOPHY.md' || path === '.void/installed/PHILOSOPHY.md')
          && existsSync(join(projectRoot, path))) return path;
      }
    }
  }
  return !existsSync(join(projectRoot, '.void/PHILOSOPHY.md'))
    && existsSync(join(projectRoot, '.void/installed/PHILOSOPHY.md'))
    ? '.void/installed/PHILOSOPHY.md' : '.void/PHILOSOPHY.md';
}

/**
 * Refresh existing runtime documents and their common AGENTS owner. Never create
 * CLAUDE.md in a Codex-only project. Used by `add` / `remove`, which update the current plugin list
 * without changing which runtimes a project targets (that is `runtime add`'s
 * job). Returns the runtimes whose doc was patched.
 */
export async function patchExistingRuntimeDocs(
  projectRoot: string,
  input: ClaudeMdBlockInputs,
): Promise<Runtime[]> {
  const patched: Runtime[] = [];
  const publishedInput = { ...input, philosophyPath: input.philosophyPath ?? await publishedPhilosophyPath(projectRoot) };
  for (const runtime of ['claude', 'codex'] as const) {
    if (existsSync(join(projectRoot, docFileFor(runtime)))) {
      await patchRuntimeDoc(projectRoot, runtime, publishedInput);
      patched.push(runtime);
    }
  }
  return patched;
}

export async function patchClaudeMd(
  projectRoot: string,
  input: ClaudeMdBlockInputs,
): Promise<PatchResult> {
  return patchRuntimeDoc(projectRoot, 'claude', input);
}

export async function patchAgentsMd(
  projectRoot: string,
  input: ClaudeMdBlockInputs,
): Promise<PatchResult> {
  return patchRuntimeDoc(projectRoot, 'codex', input);
}
