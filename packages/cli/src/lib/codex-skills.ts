// Stage the harness skills into a consumer project for Codex. Claude Code
// auto-discovers the plugin's skills from the marketplace; for Codex we use its
// directory-convention discovery, scanning `.agents/skills` from the cwd up to
// the repo root (per the official Codex skills docs) — universal, reproducible,
// account-free. (Codex also has a native plugin channel; adding it alongside was
// evaluated and declined — decision log, `codex-plugin-channel-declined`.)
// Without this, a Codex-wired project got the doctrine via AGENTS.md
// but NONE of the invocable skills — the multi-runtime promise was unmet (#125).
//
// Scope: core skills + the skills of every activated pack (both ship in the CLI
// tarball via core-assets/skills and core-assets/packs).
// Pack skills are not bundled in the CLI yet — a separate bundling step is needed
// before they can be staged for Codex.
//
// This module owns the Codex-skills domain: the pure filters (frontmatter parse,
// eligibility) and the imperative staging (wire) + the health read `doctor` uses.

import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { PRODUCT_COMMAND } from '@voidcorp/hook-runner';

// Directory Codex scans for project-local skills. Relative to the project root;
// Codex resolves it from the cwd up to the repo root.
export const CODEX_SKILLS_DIR = '.agents/skills';

async function readOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** Narrow an unknown YAML value to a plain object without a cast or a null literal. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Recover just `runtimes` from a frontmatter block that strict YAML rejects.
 * Several skills carry an unquoted `:` in their `description` (e.g. "Iron Law:
 * ..."), which is technically-invalid YAML the rest of the repo's tolerant
 * parsers accept. The `runtimes:` line is its own inline list, unaffected by that
 * — so we can still read eligibility rather than silently dropping the skill.
 */
function runtimesFallback(body: string): Record<string, unknown> {
  const line = body.match(/^runtimes:\s*\[([^\]]*)\]/m);
  if (!line) return {};
  const runtimes = (line[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return { runtimes };
}

/**
 * Parse the leading YAML frontmatter block of a SKILL.md. Prefers a strict YAML
 * parse; on failure (a malformed-but-tolerated frontmatter) falls back to
 * recovering `runtimes` by scan, so an unquoted description never silently
 * excludes a skill from the Codex surface. Returns {} only when there is truly
 * no frontmatter. Never throws.
 */
export function parseFrontmatter(md: string): Record<string, unknown> {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};
  const body = match[1] ?? '';
  try {
    const parsed: unknown = parseYaml(body);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Strict YAML failed — fall through to the tolerant recovery below.
  }
  return runtimesFallback(body);
}

/**
 * The co-located `harness.yaml` for a skill directory, parsed. This is where the
 * fields this harness invented live: a SKILL.md carries only what the Agent
 * Skills specification defines, so it stays portable and passes the official
 * validator, and nothing a consumer receives mentions this repository.
 */
export async function readHarnessMeta(skillDir: string): Promise<Record<string, unknown>> {
  const text = await readOrUndefined(join(skillDir, 'harness.yaml'));
  if (text === undefined) return {};
  try {
    const parsed: unknown = parseYaml(text);
    if (isRecord(parsed)) return parsed;
  } catch {
    // A malformed sidecar means "not eligible" rather than a crashed install:
    // the skill simply does not opt in, and doctor reports the drift.
  }
  return {};
}

/**
 * True when the skill opts into Codex via its `runtimes` list. Opt-in by design:
 * a skill with no `runtimes` field (or one that omits `codex`) is NOT staged, so
 * a Claude-only skill never leaks into the Codex surface.
 */
export function isCodexEligible(meta: Record<string, unknown>): boolean {
  const runtimes = meta.runtimes;
  return Array.isArray(runtimes) && runtimes.includes('codex');
}

/**
 * The Codex-eligible core skill names under `<sourceRoot>/skills`, sorted. Reads
 * each skill's `harness.yaml`; a directory without a readable SKILL.md, or one
 * not opting into `codex`, is skipped. `sourceRoot` is findCoreSource().
 */
export async function listCodexSkills(sourceRoot: string): Promise<string[]> {
  const skillsDir = join(sourceRoot, 'skills');
  if (!existsSync(skillsDir)) return [];
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const eligible: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(skillsDir, entry.name);
    const md = await readOrUndefined(join(skillDir, 'SKILL.md'));
    if (md !== undefined && isCodexEligible(await readHarnessMeta(skillDir))) eligible.push(entry.name);
  }
  return eligible.sort();
}

/**
 * Locate a pack's skills directory relative to the resolved core source. In the
 * published tarball the packs are bundled at `<sourceRoot>/packs/<dir>/skills`;
 * in the dev monorepo `sourceRoot` is `packages/core/dist`, with each pack at
 * `packages/packs/<dir>/dist/skills`. Returns undefined when the pack ships no skills.
 */
export function packSkillsDir(sourceRoot: string, packDir: string): string | undefined {
  const candidates = [
    join(sourceRoot, 'packs', packDir, 'skills'),
    resolve(sourceRoot, '../..', 'packs', packDir, 'dist', 'skills'),
  ];
  return candidates.find((c) => existsSync(c));
}

/**
 * Stage every Codex-eligible skill directory found under `skillsDir` into
 * `<dst>/<name>/`, copying the WHOLE skill folder (SKILL.md + scripts/references/
 * assets) — not just SKILL.md — since Codex treats a skill as its full directory.
 * The void-internal `.source` sidecar and test files are excluded. Returns the count.
 */
async function stageEligibleSkills(skillsDir: string, dst: string): Promise<number> {
  if (!existsSync(skillsDir)) return 0;
  const entries = await readdir(skillsDir, { withFileTypes: true });
  let staged = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(skillsDir, entry.name);
    const md = await readOrUndefined(join(skillDir, 'SKILL.md'));
    if (md === undefined || !isCodexEligible(await readHarnessMeta(skillDir))) continue;
    // `harness.yaml` stays behind with `.source`: Codex receives a SKILL.md that
    // carries only the six fields the Agent Skills spec defines.
    await cp(skillDir, join(dst, entry.name), {
      recursive: true,
      filter: (src) =>
        !src.endsWith('.test.ts')
        && !src.endsWith(`${sep}.source`)
        && !src.endsWith(`${sep}harness.yaml`),
    });
    staged += 1;
  }
  return staged;
}

/**
 * Stage the Codex-eligible skills into <project>/.agents/skills — the core skills
 * plus the skills of every activated pack (`packDirs`, e.g. ['pack-nextjs']).
 * Copies each skill as a full directory. Idempotent. Returns how many skills were
 * staged so the caller phrases its own status line.
 */
export async function wireCodexSkills(
  projectRoot: string,
  sourceRoot: string,
  packDirs: readonly string[] = [],
): Promise<number> {
  const dst = join(projectRoot, CODEX_SKILLS_DIR);
  await mkdir(dst, { recursive: true });
  let staged = await stageEligibleSkills(join(sourceRoot, 'skills'), dst);
  for (const packDir of packDirs) {
    const dir = packSkillsDir(sourceRoot, packDir);
    if (dir) staged += await stageEligibleSkills(dir, dst);
  }
  return staged;
}

export interface CodexSkillsHealth {
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * Health of the staged Codex skills, for `doctor`. Never throws. Verifies the
 * skills are actually discoverable by Codex (present under `.agents/skills/<name>/
 * SKILL.md`), not merely that the directory exists.
 */
export async function codexSkillsHealth(projectRoot: string): Promise<CodexSkillsHealth> {
  const dir = join(projectRoot, CODEX_SKILLS_DIR);
  if (!existsSync(dir)) {
    return { ok: false, detail: `${CODEX_SKILLS_DIR} missing — no Codex skills wired (run ${PRODUCT_COMMAND} init)` };
  }
  const entries = await readdir(dir, { withFileTypes: true });
  let discoverable = 0;
  for (const entry of entries) {
    if (entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md'))) discoverable += 1;
  }
  if (discoverable === 0) {
    return { ok: false, detail: `${CODEX_SKILLS_DIR} present but no SKILL.md staged` };
  }
  return { ok: true, detail: `${discoverable} skill(s) discoverable in ${CODEX_SKILLS_DIR}/` };
}
