import { isAbsolute } from 'node:path';
import { isAlias, isNode, parseDocument, visit } from 'yaml';
import * as z from 'zod/mini';

const identifier = z.string().check(z.regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/));
const text = z.string().check(z.minLength(1), z.maxLength(4096), z.refine(value =>
  [...value].every(char => char.charCodeAt(0) >= 32 && !(char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159))));
const path = text.check(z.refine(value => isAbsolute(value) && !value.split(/[\\/]/).includes('..')));
const instant = z.iso.datetime();
const status = z.enum(['planned', 'running', 'blocked', 'done', 'failed']);
const workerSchema = z.strictObject({
  label: identifier, pane_id: z.optional(text), agent: z.enum(['claude', 'codex']),
  worktree: path, branch: text, ticket: identifier, status, attempt: identifier,
  session: z.optional(text),
});
const missionSchema = z.strictObject({
  schema: z.literal(1), mission: identifier, project: identifier, status,
  updated_at: instant, repository: path,
  coordinator: z.strictObject({ label: identifier, worktree: path, workspace: z.optional(text) }),
  workers: z.array(workerSchema).check(z.maxLength(4)),
}).check(z.refine(value => new Set(value.workers.map(worker => worker.label)).size === value.workers.length
  && !value.workers.some(worker => worker.label === value.coordinator.label), 'ambiguous labels'));
const reportSchema = z.strictObject({
  schema: z.literal(1), mission: identifier, attempt: identifier,
  status: z.enum(['running', 'blocked', 'done', 'failed']), worker: identifier, branch: text,
  commits: z.array(z.string().check(z.regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/))).check(z.maxLength(64)),
  tests: z.enum(['passed', 'failed', 'not_run']), updated_at: instant,
});
export type OrchestraMission = z.infer<typeof missionSchema>;
const briefSchema = z.strictObject({ schema: z.literal(1), mission: identifier, attempt: identifier, worker: identifier });
export type OrchestraWorker = z.infer<typeof workerSchema>;
export type OrchestraReport = z.infer<typeof reportSchema>;
export interface OrchestraPane {
  readonly pane_id: string;
  readonly workspace_id: string;
  readonly label: string;
  readonly cwd: string;
  readonly tokens?: Readonly<Record<string, string>>;
}

/** YAML 2 AST validation rejects tags and anchors, including unused anchors. */
function frontmatter(input: string, limit: number): unknown {
  if (Buffer.byteLength(input) > limit) throw Error('orchestra document exceeds byte limit');
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(input);
  if (match?.[1] === undefined || /^---(?:\r?\n|$)/.test(match[2] ?? '')) {
    throw Error('orchestra document requires one delimited frontmatter');
  }
  const document = parseDocument(match[1], {
    strict: true, stringKeys: true, uniqueKeys: true, version: '1.2',
  });
  if (document.errors.length || document.warnings.length) throw Error('invalid orchestra YAML');
  visit(document, (_key, node) => {
    if (isAlias(node) || (isNode(node) && ('tag' in node && node.tag !== undefined
      || 'anchor' in node && node.anchor !== undefined))) throw Error('YAML aliases/tags refused');
  });
  return document.toJS({ maxAliasCount: 0 });
}

export function parseMission(input: string): OrchestraMission {
  return missionSchema.parse(frontmatter(input, 65_536));
}
export function parseReport(input: string): OrchestraReport {
  return reportSchema.parse(frontmatter(input, 65_536));
}
export function parseBrief(input: string): z.infer<typeof briefSchema> {
  return briefSchema.parse(frontmatter(input, 262_144));
}
export function matchReport(
  mission: OrchestraMission, label: string, report: OrchestraReport,
): OrchestraReport {
  const worker = mission.workers.find(item => item.label === label);
  if (worker === undefined || report.worker !== label || report.mission !== mission.mission
    || report.attempt !== worker.attempt || report.branch !== worker.branch) {
    throw Error('foreign or stale orchestra report');
  }
  return report;
}

/** Inputs are canonicalized at the I/O boundary. Hints deliberately never select a pane. */
export function resolvePane(
  identity: { readonly label: string; readonly worktree: string }, panes: readonly OrchestraPane[],
): OrchestraPane {
  const matching = panes.filter(pane => pane.label === identity.label && pane.cwd === identity.worktree);
  const pane = matching[0];
  if (matching.length !== 1 || pane === undefined) throw Error('absent or ambiguous orchestra pane identity');
  return pane;
}
