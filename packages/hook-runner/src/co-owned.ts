// tdd-cover: e2e packages/hook-runner/src/rules/protected-file.test.ts
// Installation, manifest verification and pre-write enforcement share this pure
// policy. Co-owned files carry project edits; exclusive assets belong to the
// harness. This classification does not enforce managed blocks or approval.

/** The harness seeds project doctrine once; the project owns subsequent edits. */
export const PROJECT_DOCTRINE_PATH = '.void/PROJECT-DOCTRINE.md';

/** Exact project paths the harness reconciles or seeds instead of owning outright. */
export const CO_OWNED_FILES = [
  '.gitignore',
  '.void/config.json',
  PROJECT_DOCTRINE_PATH,
  '.claude/settings.json',
  'CLAUDE.md',
  'AGENTS.md',
] as const;

const CO_OWNED = new Set<string>(CO_OWNED_FILES);

/** Callers supply a normalized, project-relative, slash-separated path. */
export function isCoOwned(path: string): boolean {
  return CO_OWNED.has(path);
}
