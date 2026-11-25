// Which agent runtimes a project targets. The harness compiles one doctrine to
// several runtimes (Claude Code via CLAUDE.md + the marketplace plugin, Codex
// via AGENTS.md + a .codex/ hooks floor). `init` detects what is already wired,
// lets a flag override, and gates each runtime's active wiring on the result so
// a Codex-only project is never nagged about the Claude marketplace, and vice
// versa. Detection reads native footprints and the Claude import.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Runtime = 'claude' | 'codex';

export const ALL_RUNTIMES: readonly Runtime[] = ['claude', 'codex'] as const;

function isRuntime(value: string): value is Runtime {
  return value === 'claude' || value === 'codex';
}

/**
 * Which runtimes already show a footprint in the project. `.claude/` or
 * `CLAUDE.md` ⇒ Claude Code; `.codex/` or an independent `AGENTS.md` ⇒ Codex. A greenfield
 * project matches neither — the caller decides the default (both).
 */
export function detectRuntimes(projectRoot: string): Set<Runtime> {
  const found = new Set<Runtime>();
  if (existsSync(join(projectRoot, '.claude')) || existsSync(join(projectRoot, 'CLAUDE.md'))) found.add('claude');
  const claudeDoc = join(projectRoot, 'CLAUDE.md');
  const importsCommon = existsSync(claudeDoc) && /^@AGENTS\.md\s*$/m.test(readFileSync(claudeDoc, 'utf8'));
  if (existsSync(join(projectRoot, '.codex'))
    || (existsSync(join(projectRoot, 'AGENTS.md')) && !importsCommon)) found.add('codex');
  return found;
}

/**
 * Parse a `--runtime` value: `claude`, `codex`, `both`/`all`, or a comma list
 * (`claude,codex`). Unknown tokens are dropped. Always returns in canonical
 * order and deduplicated.
 */
export function parseRuntimeArg(value: string): Runtime[] {
  if (value === 'both' || value === 'all') return [...ALL_RUNTIMES];
  const requested = new Set(value.split(',').map((s) => s.trim()).filter(isRuntime));
  return ALL_RUNTIMES.filter((r) => requested.has(r));
}

/**
 * Resolve which runtimes `init` should wire. Precedence: an explicit `--runtime`
 * selection wins; otherwise the detected footprint; otherwise (greenfield: no
 * footprint at all) both, since the harness targets both and the doctrine docs
 * are cheap to emit. Always canonical order, never empty.
 */
export function resolveRuntimes(explicit: readonly Runtime[], detected: ReadonlySet<Runtime>): Runtime[] {
  if (explicit.length > 0) return ALL_RUNTIMES.filter((r) => explicit.includes(r));
  if (detected.size > 0) return ALL_RUNTIMES.filter((r) => detected.has(r));
  return [...ALL_RUNTIMES];
}
