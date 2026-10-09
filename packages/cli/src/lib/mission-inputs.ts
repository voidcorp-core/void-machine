// tdd-cover: e2e packages/cli/src/commands/mission.test.ts
import { execFile as nodeExecFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { 
  type ContextArtifact, type ContextPackInput, canonicalJsonHash, citedPaths, compileMissionPlan, type MissionPlan,mergePolicies,
  type SpecialistInvocationStage } from '@voidcorp/mission-engine';
import { findCoreSource } from './paths.js';
import { loadProjectPolicies } from './policy-loader.js';
import { loadProfiles } from './profile-loader.js';
import { collectKnownSecrets, redactText } from './runs/redact.js';
import type { MissionControllerTicketBinding } from './runs/store.js';
import { readBoundedProjectFile } from './safe-read.js';
import { loadSpecialists } from './specialists/load.js';
import { detectProfileInput, detectStack } from './stack.js';

const execFile = promisify(nodeExecFile);
const MAX_TICKET_BYTES = 100_000;

export async function readTicket(root: string, ticketPath: string): Promise<{
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly path: string;
}> {
  const canonicalRoot = await realpath(resolve(root));
  const loaded = await readBoundedProjectFile({
    root: canonicalRoot,
    inputPath: ticketPath,
    maxBytes: MAX_TICKET_BYTES,
    pathEscapeMessage: 'MISSION_TICKET_PATH_ESCAPE: ticket resolves outside project root',
    invalidMessage: `MISSION_TICKET_INVALID: ticket must be a stable file under ${MAX_TICKET_BYTES} bytes`,
  });
  const canonicalTicket = loaded.resolvedPath;
  const body = loaded.body;
  if (body.trim() === '') throw new Error('MISSION_TICKET_INVALID: ticket is empty');
  const heading = body.split('\n').find((line) => /^#\s+\S/.test(line));
  const fallback = basename(canonicalTicket, extname(canonicalTicket));
  return Object.freeze({
    id: fallback.slice(0, 128),
    title: (heading?.replace(/^#\s+/, '').trim() ?? fallback).slice(0, 200),
    body,
    path: normalizeControllerTicketPath(relative(canonicalRoot, canonicalTicket)),
  });
}

export function normalizeControllerTicketPath(path: string): string {
  return path.replaceAll('\\', '/');
}

interface DetectedFiles {
  readonly files: readonly string[];
  readonly status: 'known' | 'unknown';
}

export async function gitFiles(root: string): Promise<DetectedFiles> {
  try {
    const options = { cwd: root, encoding: 'utf8' as const, maxBuffer: 1_000_000, timeout: 5_000 };
    const [changed, untracked] = await Promise.all([
      execFile('git', ['diff', '--name-only', '--relative', 'HEAD'], options),
      execFile('git', ['ls-files', '--others', '--exclude-standard'], options),
    ]);
    return Object.freeze({
      files: Object.freeze(
        [...new Set(`${changed.stdout}\n${untracked.stdout}`
          .split('\n')
          .filter((file) => file !== '' && !file.startsWith('.void/')))].sort(),
      ),
      status: 'known',
    });
  } catch {
    return Object.freeze({ files: Object.freeze([]), status: 'unknown' });
  }
}

interface MissionReviewSubject {
  readonly baseCommit?: string;
  readonly reviewedCommit?: string;
  readonly diff: string;
  readonly files: DetectedFiles;
  readonly hash: string;
}

export async function missionReviewBase(root: string): Promise<string> {
  try {
    const result = await execFile('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
      cwd: root, encoding: 'utf8', timeout: 5_000, maxBuffer: 1_000,
    });
    return result.stdout.trim();
  } catch {
    throw new Error('MISSION_REVIEW_BASE_INVALID: a committed Git baseline is required');
  }
}

/** Git 2.50: diff <commit> compares the complete worktree with a fixed commit.
 * https://git-scm.com/docs/git-diff/2.50.0 */
export async function captureMissionReviewSubject(
  root: string,
  baseCommit: string | undefined,
  committed = false,
): Promise<MissionReviewSubject> {
  if (baseCommit === undefined) {
    throw new Error(
      'MISSION_REVIEW_BASE_MISSING: legacy mission has no review baseline; preserve its history and start a new mission',
    );
  }
  const options = { cwd: root, encoding: 'utf8' as const, timeout: 10_000, maxBuffer: 4_000_000 };
  try {
    await execFile('git', ['merge-base', '--is-ancestor', baseCommit, 'HEAD'], options);
  } catch {
    throw new Error('MISSION_REVIEW_BASE_INVALID: baseline is missing or is not an ancestor of HEAD');
  }
  try {
    const paths = ['--', '.', ':(exclude).void/machine/**'];
    const reviewedCommit = committed ? await missionReviewBase(root) : undefined;
    if (committed) {
      const dirty = await execFile('git', ['diff', '--no-ext-diff', '--no-textconv',
        '--name-only', 'HEAD', ...paths], options);
      if (dirty.stdout !== '') {
        throw new Error('MISSION_REVIEW_UNCOMMITTED: commit the implementation before independent review');
      }
    }
    const range = reviewedCommit === undefined ? [baseCommit] : [baseCommit, reviewedCommit];
    const [patch, names, untracked] = await Promise.all([
      execFile('git', ['diff', '--no-ext-diff', '--no-textconv', '--binary', '--full-index',
        '--no-renames', '--relative', ...range, ...paths], options),
      execFile('git', ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z',
        '--no-renames', '--relative', ...range, ...paths], options),
      execFile('git', ['ls-files', '--others', '--exclude-standard', '-z', ...paths], options),
    ]);
    if (untracked.stdout !== '') {
      throw new Error(committed
        ? 'MISSION_REVIEW_UNTRACKED: commit new files before requesting independent review'
        : 'MISSION_REVIEW_UNTRACKED: stage new files before requesting implementation review');
    }
    if (/^GIT binary patch$/m.test(patch.stdout)) {
      throw new Error('MISSION_REVIEW_BINARY_UNSUPPORTED: encoded binary content cannot be safely reviewed');
    }
    const files = Object.freeze({
      files: Object.freeze(names.stdout.split('\0').filter(Boolean).sort()),
      status: 'known' as const,
    });
    if (reviewedCommit !== undefined && reviewedCommit !== await missionReviewBase(root)) {
      throw new Error('MISSION_REVIEW_CHANGED: HEAD changed while capturing the review subject');
    }
    return Object.freeze({
      ...(reviewedCommit === undefined ? {} : { baseCommit, reviewedCommit }),
      diff: patch.stdout,
      files,
      hash: canonicalJsonHash({ baseCommit, ...(reviewedCommit === undefined ? {} : { reviewedCommit }),
        diff: patch.stdout, files: files.files }),
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('MISSION_REVIEW_')) throw error;
    throw new Error('MISSION_REVIEW_CONTENT_UNAVAILABLE: bounded Git review capture failed');
  }
}

/** Token budget one specialist may spend reading, per the expert-team spec. */
const CONTEXT_PACK_BUDGET_TOKENS = 12_000;

/**
 * Compile what every convened specialist reads instead of exploring.
 *
 * Measured on 2026-08-30: `Grep` and `Glob` spawn a `rg` binary that is absent
 * wherever `rg` is only a shell function, so five specialists convened on a real
 * diff read nothing and answered anyway. Handing them the diff removes the
 * dependency rather than repairing it, and a diff git could not produce is named
 * in the pack rather than rendered as an empty one.
 */
const ANCHOR_MAX_BYTES = 200_000;

/** Read one repository file for the pack, or return nothing rather than fail the
 * dispatch: a missing anchor is named in the pack, never a reason to convene
 * nobody. */
async function packArtifact(
  root: string,
  path: string,
): Promise<ContextArtifact | undefined> {
  try {
    const loaded = await readBoundedProjectFile({
      root,
      inputPath: path,
      maxBytes: ANCHOR_MAX_BYTES,
      pathEscapeMessage: 'MISSION_PACK_PATH_ESCAPE: anchor resolves outside project root',
      invalidMessage: 'MISSION_PACK_INVALID: anchor must be a stable bounded file',
    });
    return { path, text: loaded.body };
  } catch {
    return undefined;
  }
}

/**
 * Compile what every convened specialist reads instead of exploring, for the
 * stage it is convened at.
 *
 * The two stages ask different questions and need different evidence. At
 * `post-implementation` the subject is the diff. At `pre-implementation` there
 * IS no diff -- nothing has been written, which is the entire point of briefing
 * first -- so the subject is the ticket and the code it names. The first version
 * of this shipped the diff at both stages, and the panel convened on eleven
 * tokens of empty fence while `omitted` claimed nothing had been left out. That
 * is the silent cap this module exists to refuse, in the stage that matters most.
 *
 * Measured on 2026-08-30 by running the cycle: six specialists convened at
 * `pre-implementation` with an empty pack. Unit tests, typecheck and eighteen
 * gates were all green on it.
 */
export async function compileDispatchContent(
  root: string,
  files: DetectedFiles,
  stage: SpecialistInvocationStage,
  ticketPath: string,
  reviewSubject: MissionReviewSubject | undefined,
  profiles: MissionPlan['profiles'],
): Promise<Omit<ContextPackInput, 'dispatch'>> {
  const unavailable = profiles.filter((profile) => profile.sourceReviewRequired)
    .map((profile) => `guidance ${profile.profileId} requires source review: ${profile.reasons.join(', ')}`);
  const secrets = collectKnownSecrets();

  let diff = '';
  if (stage === 'post-implementation') {
    if (reviewSubject === undefined) {
      throw new Error('MISSION_REVIEW_CONTENT_UNAVAILABLE: review subject is missing');
    }
    diff = reviewSubject.diff;
  } else {
    unavailable.push('diff (pre-implementation: nothing is written yet)');
  }

  // The completion path already refuses secret-bearing events. The pack reaches
  // a model runtime and whatever it persists, which is the wider blast radius of
  // the two, so an in-flight credential is masked here rather than forwarded.
  const redactedDiff = redactText(diff, secrets);
  if (redactedDiff !== diff) unavailable.push('diff (secrets redacted)');

  // Ticket first: it is the brief at both stages, and the compiler spends the
  // budget in the order artifacts arrive.
  const ticket = await packArtifact(root, ticketPath);
  if (ticket === undefined) unavailable.push(`${ticketPath} (unreadable)`);
  const anchors = ticket === undefined
    ? []
    : (await Promise.all(citedPaths(ticket.text).map((path) => packArtifact(root, path))));
  const artifacts = [ticket, ...anchors]
    .filter((item): item is ContextArtifact => item !== undefined)
    .map((item) => ({ path: item.path, text: redactText(item.text, secrets) }));

  return {
    diff: redactedDiff,
    touchedPaths: stage === 'post-implementation' ? files.files : [],
    artifacts,
    lens: 'full',
    budgetTokens: CONTEXT_PACK_BUDGET_TOKENS,
    unavailable,
  };
}

export function detectedStack(root: string, profileInput: ReturnType<typeof detectProfileInput>): {
  readonly technologies: readonly string[];
  readonly status: 'known' | 'unknown';
} {
  const markers = [
    'package.json',
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
  ];
  if (!markers.some((marker) => existsSync(join(root, marker)))) {
    return Object.freeze({ technologies: Object.freeze([]), status: 'unknown' });
  }
  const stack = detectStack(root);
  return Object.freeze({
    technologies: Object.freeze([...new Set([
      ...Object.values(stack),
      ...profileInput.projects.flatMap((project) =>
        project.technologies.map((technology) => technology.id)),
    ])].sort()),
    status: 'known',
  });
}

export async function planMission(
  root: string,
  ticketPath: string,
  generatedAt = new Date().toISOString(),
): Promise<MissionPlan> {
  return (await planBoundMission(root, ticketPath, generatedAt)).plan;
}

async function compileMission(
  root: string,
  ticket: Awaited<ReturnType<typeof readTicket>>,
  generatedAt: string,
  detectedFiles?: DetectedFiles,
  specialistCatalog?: Awaited<ReturnType<typeof loadSpecialists>>,
): Promise<MissionPlan> {
  const [coreRoot, diff] = await Promise.all([
    findCoreSource(),
    detectedFiles ?? gitFiles(root),
  ]);
  const [policies, profiles, specialists] = await Promise.all([
    loadProjectPolicies(root, join(coreRoot, 'policies')),
    loadProfiles(root, join(coreRoot, 'profiles')),
    specialistCatalog ?? loadSpecialists(coreRoot),
  ]);
  const profileInput = detectProfileInput(root, diff.files);
  const stack = detectedStack(root, profileInput);
  return compileMissionPlan({
    schemaVersion: 2,
    ticket: { id: ticket.id, title: ticket.title, body: ticket.body },
    diff,
    stack,
    policy: mergePolicies(policies, generatedAt),
    profiles: {
      catalog: profiles,
      input: profileInput,
    },
    specialists: { catalog: specialists },
  }, { generatedAt });
}

function controllerTicketBinding(
  ticket: Awaited<ReturnType<typeof readTicket>>,
): MissionControllerTicketBinding {
  return Object.freeze({
    path: ticket.path,
    contentHash: `sha256:${createHash('sha256').update(ticket.body).digest('hex')}`,
  });
}

export async function planBoundMission(
  root: string,
  ticketPath: string,
  generatedAt = new Date().toISOString(),
  detectedFiles?: DetectedFiles,
  specialistCatalog?: Awaited<ReturnType<typeof loadSpecialists>>,
): Promise<{
  readonly plan: MissionPlan;
  readonly ticket: MissionControllerTicketBinding;
}> {
  const ticket = await readTicket(root, ticketPath);
  const plan = await compileMission(root, ticket, generatedAt, detectedFiles, specialistCatalog);
  return Object.freeze({
    plan,
    ticket: controllerTicketBinding(ticket),
  });
}
