import type { RuleName } from './runner.js';

/**
 * Which skill explains the rule a refusal just applied.
 *
 * A hook that refuses anonymously teaches nothing: the write is blocked, the
 * reason is one sentence, and the doctrine that would prevent the next one stays
 * unopened. The measured shape of that was 26,440 hook executions against 4 skill
 * activations in the same telemetry.
 *
 * Naming the skill costs one line and loads nothing. The model reads the name and
 * reaches for the skill only when the sentence is not enough, which is the
 * progressive disclosure the Agent Skills spec describes. It also works the same
 * on Claude and Codex, since both run this runner; `paths`, the Claude-only
 * frontmatter field, only ever *narrows* automatic activation and cannot make one
 * happen.
 *
 * The pairs are declared in `packages/harness-graph/relations.graph.yaml` as
 * `enforces` edges with their evidence. This table is the copy that ships inside
 * the compiled hook, and a test holds the two together so they cannot drift.
 */
const GOVERNING_SKILL = {
  'boundary-direction': 'void-hexagonal-architecture',
  // The remedy the refusal teaches -- build the byte rather than type it -- is a
  // fixture practice, and void-testing is the only skill that already carries it.
  'control-character': 'void-testing',
  'dangerous-command': 'void-security-guidance',
  'no-any': 'void-typescript-strict',
  'no-as-cast': 'void-typescript-strict',
  'no-console': 'void-observability',
  'no-focused-test': 'void-testing',
  'no-null': 'void-functional',
  'protected-file': 'void-security-guidance',
  'secret-content': 'void-security-guidance',
  'tdd-order': 'void-tdd',
} satisfies Record<RuleName, string>;

/**
 * Every rule this runner can evaluate, in a stable order. Written out rather than
 * derived from the table's keys, so the compiler proves the pair is exhaustive
 * instead of a cast asserting it.
 */
export const RULE_NAMES = [
  'boundary-direction',
  'control-character',
  'dangerous-command',
  'no-any',
  'no-as-cast',
  'no-console',
  'no-focused-test',
  'no-null',
  'protected-file',
  'secret-content',
  'tdd-order',
] as const satisfies readonly RuleName[];

/** The skill whose doctrine a refusal of `rule` comes from. */
export function governingSkill(rule: RuleName): string {
  return GOVERNING_SKILL[rule];
}

/**
 * A refusal message with its doctrine named. Kept to one clause: it is read at a
 * blocked keystroke, not studied.
 */
export function withGoverningSkill(rule: RuleName, message: string): string {
  return `${message} (doctrine: the ${governingSkill(rule)} skill)`;
}
