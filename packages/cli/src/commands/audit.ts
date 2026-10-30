// `void-machine audit` — the outbound self-evolution audit (issue #17 cluster C).
//
// Read canonical mission events plus legacy history and report which harness
// skills are active, stale or never observed. Graph relations, human-session
// evidence, outcomes, and cost decide whether that observation can become a
// bounded proposal. HITL: this reports, it never acts.
// Upstream-deprecation and decision-matrix-conflict detection are a documented
// follow-up (they need data sources beyond the usage log).

import * as p from '@clack/prompts';
import { PRODUCT_COMMAND, PRODUCT_IDENTITY } from '@voidcorp/hook-runner';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyzeSynergy,
  parseActivations,
  parseOutcomes,
  parseSpecialistLifecycle,
  type GraphModel,
  type SynergyProposal,
} from '@voidcorp/harness-graph';
import { type SkillAudit, auditSkills } from '../lib/audit.js';
import { loadCanonicalEventBody, loadSkillUsage } from '../lib/graph-io.js';
import { findCoreSource } from '../lib/paths.js';
import { checkGh } from '../lib/prerequisites.js';
import { discoverConfiguredProjects } from '../lib/projects/catalog.js';
import { banner, blank, c, footer, glyph, line } from '../lib/render.js';
import {
  findingToIssue,
  mergeCanonicalTelemetry,
  reconcileIssues,
  type IssueDraft,
  type RollupFinding,
} from '../lib/rollup.js';
import { resolveModel } from './graph.js';

const DEFAULT_STALE_DAYS = 30;

/** Where outbound harness feedback lands (doctrine tracker), per DECISIONS.md. */
const FEEDBACK_REPO = PRODUCT_IDENTITY.repositorySlug;

/** Harness skill names (`harness:<folder>`) discovered from the core tree. */
function harnessSkills(coreSource: string): string[] {
  const skillsDir = join(coreSource, 'skills');
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .filter((name) => existsSync(join(skillsDir, name, 'SKILL.md')))
    .map((name) => `harness:${name}`)
    .sort();
}

export function auditableHarnessSkills(
  allSkills: readonly string[],
  model: GraphModel,
): {
  readonly observable: readonly string[];
  readonly passive: readonly string[];
} {
  const passiveNames = new Set(model.nodes
    .filter((node) => node.type === 'skill' && node.activation === 'always')
    .map((node) => `harness:${node.name}`));
  return Object.freeze({
    observable: Object.freeze(allSkills.filter((skill) => !passiveNames.has(skill))),
    passive: Object.freeze(allSkills.filter((skill) => passiveNames.has(skill))),
  });
}

function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function audit(args: readonly string[]): Promise<void> {
  const root = process.cwd();
  const staleDays = Number.parseInt(flag(args, 'stale-days') ?? '', 10) || DEFAULT_STALE_DAYS;
  const push = args.includes('--push');
  // A push aggregates across every discovered project (a single repo's telemetry
  // is too thin to trust a "never fired" verdict); --all-projects opts in without pushing.
  const aggregate = push || args.includes('--all-projects');

  const coreSource = await findCoreSource();
  const allSkills = harnessSkills(coreSource);
  const model = await resolveModel(coreSource, undefined);
  const skillSurface = auditableHarnessSkills(allSkills, model);

  // Canonical mission events are authoritative; legacy logs preserve history.
  const discovery = aggregate ? discoverConfiguredProjects() : undefined;
  const projects = discovery?.projects.map((project) => project.path) ?? [root];
  const usage = (projects.length > 0 ? projects : [root]).flatMap((r) => loadSkillUsage(r));

  const report = auditSkills({
    allSkills: skillSurface.observable,
    usage,
    nowMs: Date.now(),
    staleDays,
  });
  const eventBody = aggregate
    ? mergeCanonicalTelemetry(projects.length > 0 ? projects : [root])
    : loadCanonicalEventBody(root);
  const synergy = analyzeSynergy(
    model,
    parseActivations(eventBody),
    parseOutcomes(eventBody),
    { lifecycle: parseSpecialistLifecycle(eventBody) },
  );

  banner('audit');
  blank();
  if (aggregate) {
    line(
      `${c.dim('scope')} ${projects.length} discovered project(s) `
      + `${c.dim(glyph.dot)} ${c.dim(`${discovery?.rootsSource ?? 'derived'} marker roots`)}`,
    );
  } else if (
    loadCanonicalEventBody(root) === ''
    && !existsSync(join(root, '.void', 'activations.jsonl'))
    && usage.length === 0
  ) {
    line(
      c.yellow('  no mission events yet - the activation hook populates .void/machine/runs/*/events.jsonl.'),
    );
  }
  line(
    `${c.dim('skills')} ${allSkills.length} ${c.dim(glyph.dot)} ${c.green(`${report.active.length} active`)} ${c.dim(glyph.dot)} ${c.yellow(`${report.stale.length} stale`)} ${c.dim(glyph.dot)} ${c.dim(`${report.never.length} never`)} ${c.dim(glyph.dot)} ${c.dim(`${skillSurface.passive.length} passive doctrine`)} ${c.dim(`(stale > ${staleDays}d)`)}`,
  );

  reportSection(
    synergy.sufficient
      ? 'stale (used, but not in the window)'
      : 'stale observations (insufficient window; no proposal)',
    report.stale,
  );
  reportSection(
    'not observed (absence alone does not establish non-use)',
    report.never,
  );
  blank();
  line(c.bold('  skill + agent + hook synergy'));
  line(
    `    ${synergy.stats.events} human events ${c.dim(glyph.dot)} ${synergy.stats.sessions} sessions ${c.dim(glyph.dot)} ${synergy.stats.excludedSessions} synthetic sessions excluded`,
  );
  if (!synergy.sufficient) {
    line(c.yellow('    evidence window is insufficient; no tuning or retirement proposal is safe.'));
  } else if (synergy.proposals.length === 0) {
    line(c.green('    no repair, wiring, tuning, fusion, or retirement proposal.'));
  } else {
    for (const proposal of synergy.proposals) {
      for (const outputLine of renderSynergyProposal(proposal).split('\n')) {
        line(`    ${outputLine}`);
      }
    }
  }

  blank();
  if (push) {
    const findings: RollupFinding[] = synergy.proposals.map((proposal) => ({
        type: proposal.kind,
        component: proposal.component,
        detail: proposal.evidence,
      }));
    await pushFindings(findings, args.includes('--dry-run'));
    return;
  }
  if (
    report.stale.length === 0
    && report.never.length === 0
    && synergy.proposals.length === 0
  ) {
    footer(c.dim('every harness skill has fired recently — nothing to propose.'));
  } else {
    footer(
      c.dim(
        `observations become HITL proposals only after their evidence gate. \`${PRODUCT_COMMAND} audit --push\` files eligible proposals as issues (dry-run by default).`,
      ),
    );
  }
}

export function renderSynergyProposal(proposal: SynergyProposal): string {
  return [
    `${proposal.kind} ${proposal.component}`,
    `  evidence: ${proposal.evidence}`,
    `  risk: ${proposal.risk}`,
    '  -> learn candidate (HITL)',
  ].join('\n');
}

/** gh issue titles already carrying our label, so a re-run updates instead of duplicating. */
function existingFeedbackTitles(repo: string): Set<string> {
  const raw = execFileSync(
    'gh',
    ['issue', 'list', '--repo', repo, '--label', 'harness-feedback', '--state', 'all', '--limit', '200', '--json', 'title'],
    { encoding: 'utf8' },
  );
  const parsed = JSON.parse(raw) as { title?: string }[];
  return new Set(parsed.map((i) => i.title ?? '').filter((t) => t !== ''));
}

/**
 * File the audit's deprecation-candidate findings as GitHub issues. HITL and safe
 * by construction: dry-run prints the plan and stops; a real push needs the human
 * to confirm the create/update plan first. A missing/unauthenticated gh fails LOUD
 * (never a silent no-op).
 */
async function pushFindings(
  findings: readonly RollupFinding[],
  forceDryRun: boolean,
): Promise<void> {
  const drafts = findings.map(findingToIssue);
  if (drafts.length === 0) {
    footer(c.dim('no stale/never skills — nothing to file.'));
    return;
  }
  const gh = checkGh();
  if (!gh.ok) {
    line(c.red(`  cannot push: ${gh.message}`));
    if (gh.fix) line(c.dim(`  fix: ${gh.fix}`));
    return;
  }
  const existing = existingFeedbackTitles(FEEDBACK_REPO);
  const { create, update } = reconcileIssues(drafts, existing);
  line(c.bold(`  push plan -> ${FEEDBACK_REPO}`));
  for (const d of create) line(`    ${c.green('+ create')}  ${d.title}`);
  for (const d of update) line(`    ${c.yellow('~ exists')}  ${d.title}`);
  blank();
  if (forceDryRun) {
    footer(c.dim('dry-run: nothing was pushed. Re-run `--push` without `--dry-run` to file (you will be asked to confirm).'));
    return;
  }
  const ok = await p.confirm({
    message: `File ${create.length} new issue(s) to ${FEEDBACK_REPO}? (${update.length} already exist, left untouched)`,
  });
  if (p.isCancel(ok) || !ok) {
    footer(c.dim('aborted — nothing pushed.'));
    return;
  }
  for (const d of create) createIssue(FEEDBACK_REPO, d);
  footer(c.dim(`filed ${create.length} issue(s). HITL: triage them on the tracker.`));
}

function createIssue(repo: string, d: IssueDraft): void {
  execFileSync(
    'gh',
    ['issue', 'create', '--repo', repo, '--title', d.title, '--body', d.body, ...d.labels.flatMap((l) => ['--label', l])],
    { stdio: 'ignore' },
  );
}

function reportSection(title: string, items: readonly SkillAudit[]): void {
  if (items.length === 0) return;
  blank();
  line(c.bold(`  ${title}`));
  for (const item of items) {
    const when = item.daysSince !== undefined ? c.dim(`${item.daysSince}d ago`) : c.dim('never');
    line(`    ${c.dim(glyph.dot)} ${item.skill.padEnd(40)} ${when}`);
  }
}
