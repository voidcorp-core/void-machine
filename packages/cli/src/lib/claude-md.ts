// Idempotent patch of the project's agent-doc(s) with a delimited harness block.
// The block points the agent at .void/installed/PHILOSOPHY.md and .void/PROJECT-DOCTRINE.md
// plus a short reminder of how rules are captured.
//
// Two runtimes share one doctrine:
//   - Claude Code reads CLAUDE.md and supports `@path` imports.
//   - Codex reads AGENTS.md; it has no `@import`, so the block lists the files
//     with a "read at session start" instruction instead.
// Keeping both files in sync is the "sister doc" rule (scripts/sync-agent-docs.sh).

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MARKETPLACE_NAME, MARKETPLACE_REPO, type PackDescriptor } from './packs.js';
import type { Runtime } from './runtime.js';
import type { InstallSource } from './runtime-assets.js';

const BEGIN_MARKER = '<!-- void-harness:begin -->';
const END_MARKER = '<!-- void-harness:end -->';

export type { Runtime };

/** The delimiter that marks a doc as carrying the harness block (doctor reads this). */
export const HARNESS_BLOCK_MARKER = BEGIN_MARKER;

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
}

export function harnessBlock(input: ClaudeMdBlockInputs, runtime: Runtime = 'claude'): string {
  const packLines = input.enabledPacks.map((p) => `- \`${p.name}\` — ${p.description}`);
  const isClaude = runtime === 'claude';
  const runtimeName = isClaude ? 'Claude Code' : 'Codex';
  const doctrineLead = isClaude
    ? `### Doctrine — loaded into every session`
    : `### Doctrine — read at the start of every session`;
  const imports = isClaude
    ? [`@.void/installed/PHILOSOPHY.md`, `@.void/PROJECT-DOCTRINE.md`]
    : [`- \`.void/installed/PHILOSOPHY.md\``, `- \`.void/PROJECT-DOCTRINE.md\``];
  const captureLine = isClaude
    ? `To capture a new rule, just say it ("ajoute la règle…", "always X here", "never Y"). The \`void-learn\` skill auto-invokes, classifies project-specific vs universal, proposes the wording, waits for your confirmation, then writes. Never silent.`
    : `To capture a new rule, just say it ("ajoute la règle…", "always X here", "never Y"). The \`void-learn\` workflow classifies project-specific vs universal, proposes the wording, waits for your confirmation, then writes. Never silent.`;
  // The namespace belongs to the channel, never to the runtime.
  const prefixed = isClaude && input.channel === 'marketplace';
  const ticketRunner = prefixed ? '`harness:void-implement`' : '`void-implement`';
  const invocationLine = isClaude
    ? `Every skill is invoked by its name: \`${prefixed ? '/harness:void-implement' : '/void-implement'}\`, \`${prefixed ? '/harness:void-tdd' : '/void-tdd'}\`. A skill that composes another names it the same way; the syntax is the runtime's, the name is the skill's.`
    : `Every skill is invoked by its name: \`$void-implement\`, \`$void-tdd\`. A skill that composes another names it the same way; the syntax is the runtime's, the name is the skill's.`;
  return [
    BEGIN_MARKER,
    '',
    `## void-harness (managed by \`void-harness init\`)`,
    '',
    // Provenance, and only when it is true. The default path copies bundled
    // assets and never contacts a marketplace, so naming one there teaches the
    // model a channel that does not exist in this project -- the same class of
    // untruth that had skills invoked under a namespace nothing could resolve.
    input.channel === 'marketplace'
      ? `Marketplace: \`${MARKETPLACE_NAME}\` (https://github.com/${MARKETPLACE_REPO}). ${runtimeName} doctrine active in this project:`
      : `${runtimeName} doctrine active in this project:`,
    '',
    `- \`void\` — universal craftsman skills (TDD, TypeScript strict, hexagonal, DDD, ...)`,
    ...packLines,
    '',
    doctrineLead,
    '',
    ...imports,
    '',
    `\`PHILOSOPHY.md\` is the universal void-harness doctrine (managed — overwritten on init). \`PROJECT-DOCTRINE.md\` holds project-specific rules: context, ADRs, in-flight decisions (created once, never overwritten by init).`,
    '',
    captureLine,
    '',
    invocationLine,
    '',
    `### Program — when present`,
    '',
    `If \`.void/program.md\` exists with \`status: executing\`, read it and its linked plan/spec before choosing implementation work. The programme holds global context; the local checkpoint holds session residue, and \`ResumeBundle\` composes both with Git. On a continue/start/resume request without a named work unit, use the declared progress provider: recover the scoped unit if exactly one is started; if several are started, stop and surface the competing claims; otherwise select the first ready unit from the declared order and native blocker relations. Fetch the complete unit before running ${ticketRunner}. The declared progress provider owns mutable execution state; the program and checkpoint never store a current or next unit. If the provider or a required capability is unavailable, do not infer remote progress; stop the action that needs it. If no progress provider is declared, require a specific unit instead of selecting one. A specific user request overrides selection; human gates and merges remain human. The file's \`autopilot\` block carries consent to autonomous execution and is never inferred: \`enabled: false\`, an absent block, or an unreadable one forbids autonomous selection entirely.`,
    '',
    `Run \`void-harness doctor\` to verify the install.`,
    '',
    END_MARKER,
  ].join('\n');
}

function patchHarnessBlock(original: string, block: string): string {
  if (original.includes(BEGIN_MARKER) && original.includes(END_MARKER)) {
    const beginIdx = original.indexOf(BEGIN_MARKER);
    const endIdx = original.indexOf(END_MARKER) + END_MARKER.length;
    return original.slice(0, beginIdx) + block + original.slice(endIdx);
  }
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
  if (!existsSync(target)) {
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
  return original.includes(BEGIN_MARKER) ? 'updated' : 'patched';
}

/** Patch the doctrine doc a runtime owns (CLAUDE.md with @imports, AGENTS.md with pointers). */
export async function patchRuntimeDoc(
  projectRoot: string,
  runtime: Runtime,
  input: ClaudeMdBlockInputs,
): Promise<PatchResult> {
  const file = docFileFor(runtime);
  return patchDoc(join(projectRoot, file), file, harnessBlock(input, runtime));
}

/**
 * Refresh only the doctrine docs that already exist, never creating the absent
 * runtime's doc. Used by `add` / `remove`, which update the current plugin list
 * without changing which runtimes a project targets (that is `runtime add`'s
 * job). Returns the runtimes whose doc was patched.
 */
export async function patchExistingRuntimeDocs(
  projectRoot: string,
  input: ClaudeMdBlockInputs,
): Promise<Runtime[]> {
  const patched: Runtime[] = [];
  for (const runtime of ['claude', 'codex'] as const) {
    if (existsSync(join(projectRoot, docFileFor(runtime)))) {
      await patchRuntimeDoc(projectRoot, runtime, input);
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
