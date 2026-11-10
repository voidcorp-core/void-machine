// tdd-cover: e2e packages/cli/src/commands/autopilot-loop.test.ts
// Fingerprints, explicit human renewal and guarded publication share one owner.
// The original baseline is immutable. Each renewal links to its predecessor's
// bytes, so committing one complete record is the only recovery transition.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { sameBranch } from '../lib/autopilot/branch-identity.js';
import { autopilotFailure } from '../lib/autopilot/errors.js';
import { ticketIdSchema } from '../lib/autopilot/judgments.js';
import { loopProgramOf, protectedBranches } from '../lib/autopilot/loop.js';
import { type GitRunner, readDefaultBranch, readSharedState } from '../lib/autopilot/loop-observe.js';
import { readProgramDescriptor } from '../lib/autopilot/program.js';
import { admitFingerprint, changedParts, fingerprintOf, fingerprintSchema, retainedFingerprintSchema, type SharedFingerprint } from '../lib/autopilot/shared-state.js';
import type { LoopCommandOutput, LoopRunners } from './autopilot-loop.js';
import { flagValue } from './autopilot-usage.js';

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const headSchema = z.string().regex(/^[0-9a-f]{40}$/);
const explanation = z.string().trim().min(1).max(2000);
const historicalSchema = retainedFingerprintSchema;
const renewalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  priorRecordDigest: digest,
  previous: historicalSchema,
  fingerprint: fingerprintSchema,
  head: headSchema,
  branch: z.string().min(1).max(255),
  cause: explanation,
  decision: explanation,
});
type Renewal = z.infer<typeof renewalSchema>;
type Historical = z.infer<typeof historicalSchema>;
interface RecordState {
  readonly fingerprint: Historical;
  readonly recordDigest: string;
  readonly renewal?: Renewal;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const encode = (value: unknown) => `${JSON.stringify(value)}\n`;
const fingerprintDigest = (value: Historical) => hash(encode(value));

function refuse(cause: string): never {
  throw autopilotFailure('AUTOPILOT_CONTRACT', 'the unit may not be published', cause,
    'keep the evidence; inspect `autopilot fingerprint --record <ticket> --json` and obtain a human decision before --renew');
}

function pathOf(root: string, ticket: string): string {
  const parsed = ticketIdSchema.safeParse(ticket);
  if (!parsed.success) refuse('the ticket named is not a tracker identifier');
  return join(root, '.void/machine/autopilot/fingerprints', `${parsed.data}.json`);
}
const renewalPath = (path: string, prior: string) => join(path.replace(/\.json$/, '.renewals'), `${prior}.json`);

/** Link a fully written unique temporary file; an existing record is never overwritten. */
function writeOnce(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
  try { linkSync(temporary, path); } finally { unlinkSync(temporary); }
}

/** A crashed operation leaves a lock: only a human may establish it is abandoned. */
function locked<T>(path: string, action: () => T): T {
  const lock = path.replace(/\.json$/, '.lock');
  mkdirSync(dirname(lock), { recursive: true });
  try { mkdirSync(lock); } catch { refuse(`publication or renewal is already active, or its lock is unreadable: ${lock}`); }
  try { return action(); } finally { rmSync(lock, { recursive: true }); }
}

function recordAt(path: string): RecordState | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const text = readFileSync(path, 'utf8');
    const admitted = admitFingerprint(JSON.parse(text));
    if (!admitted.ok) refuse(admitted.reason);
    let state: RecordState = { fingerprint: admitted.value, recordDigest: hash(text) };
    for (let depth = 0; depth < 128; depth++) {
      const next = renewalPath(path, state.recordDigest);
      if (!existsSync(next)) return state;
      const bytes = readFileSync(next, 'utf8');
      const renewal = renewalSchema.parse(JSON.parse(bytes));
      if (renewal.priorRecordDigest !== state.recordDigest || encode(renewal.previous) !== encode(state.fingerprint)) {
        refuse('the renewal does not match its retained predecessor');
      }
      state = { fingerprint: renewal.fingerprint, recordDigest: hash(bytes), renewal };
    }
    refuse('the renewal history exceeds 128 records');
  } catch { return refuse('the retained fingerprint or renewal evidence is unreadable or incomplete'); }
}

export function recordedFingerprint(root: string, ticket: string): SharedFingerprint | undefined {
  const state = recordAt(pathOf(root, ticket));
  if (state === undefined) return undefined;
  return state.fingerprint;
}

function gitOf(context: LoopRunners): GitRunner {
  if (context.git === undefined) refuse('the shared Git state is indeterminate without a Git runner');
  return context.git;
}

function current(context: LoopRunners, kept?: readonly string[], schemaVersion: 3 | 4 = 4): SharedFingerprint {
  const descriptor = readProgramDescriptor(context.root);
  if (descriptor === undefined) refuse('the project has no programme');
  const branches = kept ?? protectedBranches(loopProgramOf(descriptor).autopilot);
  return fingerprintOf(readSharedState(gitOf(context), { bases: branches, schemaVersion }), branches, schemaVersion);
}

function guard(context: LoopRunners, ticket: string): SharedFingerprint {
  const recorded = recordedFingerprint(context.root, ticket);
  if (recorded === undefined) refuse('no fingerprint was recorded before the unit began');
  const changed = changedParts(recorded, current(context, recorded.protectedBranches, recorded.schemaVersion));
  if (changed.length > 0) refuse(`the shared Git state changed: ${changed.join(', ')}`);
  return recorded;
}

function required(argv: readonly string[], flag: string): string {
  const value = flagValue(argv, flag);
  if (value === undefined) refuse(`${flag} is required`);
  return value;
}
function exactHead(context: LoopRunners, head: string, branch: string): void {
  const git = gitOf(context);
  git(['check-ref-format', `refs/heads/${branch}`]);
  if (git(['rev-parse', '--verify', `refs/heads/${branch}^{commit}`]).trim() !== head) {
    refuse('the local branch differs from the explicitly named full commit SHA');
  }
}

function renew(argv: readonly string[], context: LoopRunners, ticket: string): LoopCommandOutput {
  const path = pathOf(context.root, ticket);
  const request = {
    head: headSchema.parse(required(argv, '--head')),
    branch: required(argv, '--branch'),
    priorRecordDigest: digest.parse(required(argv, '--previous')),
    expected: digest.parse(required(argv, '--expected')),
    cause: explanation.parse(required(argv, '--cause')),
    decision: explanation.parse(required(argv, '--decision')),
  };
  return locked(path, () => {
    const state = recordAt(path);
    if (state === undefined) refuse('human renewal requires the retained original baseline');
    exactHead(context, request.head, request.branch);
    const observed = current(context, state.fingerprint.protectedBranches);
    if (fingerprintDigest(observed) !== request.expected) refuse('the shared Git state changed since human inspection');
    const existing = state.renewal;
    const replay = existing?.priorRecordDigest === request.priorRecordDigest;
    if (state.recordDigest !== request.priorRecordDigest && !replay) refuse('the prior record digest is stale');
    const evidence: Renewal = {
      schemaVersion: 1, priorRecordDigest: request.priorRecordDigest,
      previous: replay ? existing.previous : state.fingerprint,
      fingerprint: fingerprintSchema.parse(observed), head: request.head, branch: request.branch, cause: request.cause, decision: request.decision,
    };
    if (replay && encode(evidence) !== encode(existing)) refuse('conflicting renewal replay');
    // Observe again immediately before committing. External Git writers do not take our lock.
    exactHead(context, request.head, request.branch);
    if (fingerprintDigest(current(context, observed.protectedBranches)) !== request.expected) refuse('the shared Git state changed during renewal');
    exactHead(context, request.head, request.branch);
    if (!replay) writeOnce(renewalPath(path, state.recordDigest), encode(evidence));
    return { value: evidence, human: `${ticket}: human renewal retained; merge authority unchanged\n` };
  });
}

export function fingerprintCommand(argv: readonly string[], context: LoopRunners): LoopCommandOutput {
  const modes = ['--before', '--after', '--record', '--renew'].filter((flag) => argv.includes(flag));
  if (modes.length > 1) refuse('fingerprint takes exactly one operation');
  const mode = modes[0];
  if (mode === undefined) {
    const value = current(context);
    return { value, human: encode(value) };
  }
  const ticket = required(argv, mode);
  const path = pathOf(context.root, ticket);
  if (mode === '--renew') return renew(argv, context, ticket);
  if (mode === '--record') {
    const state = recordAt(path);
    if (state === undefined) refuse('no fingerprint was recorded before the unit began');
    const observed = current(context, state.fingerprint.protectedBranches);
    const value = { ...state, current: observed, currentDigest: fingerprintDigest(observed) };
    return { value, human: encode(value) };
  }
  return locked(path, () => {
    if (mode === '--before') {
      if (existsSync(path)) refuse('a baseline is already recorded; --before never replaces evidence');
      const recorded = current(context);
      writeOnce(path, encode(recorded));
      return { value: { ticketId: ticket, recorded }, human: `recorded for ${ticket}\n` };
    }
    guard(context, ticket);
    return { value: { ticketId: ticket, unchanged: true }, human: `${ticket}: shared state unchanged\n` };
  });
}

export function publishCommand(argv: readonly string[], context: LoopRunners): LoopCommandOutput {
  const ticket = required(argv, '--ticket');
  const path = pathOf(context.root, ticket);
  const head = headSchema.parse(required(argv, '--head'));
  const remote = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).parse(required(argv, '--remote'));
  const branch = required(argv, '--branch');
  const git = gitOf(context);
  git(['check-ref-format', `refs/heads/${branch}`]);
  return locked(path, () => {
    exactHead(context, head, branch);
    const recorded = guard(context, ticket);
    if (recorded.protectedBranches.includes(branch)) refuse('publication cannot target a base or deploying branch');
    // Match merge/arm: an omitted deployment branch means the repository default.
    const descriptor = readProgramDescriptor(context.root);
    if (descriptor === undefined) refuse('the project has no programme');
    let deploying = loopProgramOf(descriptor).autopilot.deployBranch;
    if (deploying === undefined) {
      if (context.gh === undefined) refuse('the deploying branch is indeterminate without a GitHub runner');
      deploying = readDefaultBranch(context.gh);
    }
    if (sameBranch(branch, deploying) !== 'different') {
      refuse('publication targets the deploying branch, or cannot be told apart from it');
    }
    exactHead(context, head, branch);
    guard(context, ticket);
    exactHead(context, head, branch);
    try { git(['push', '--', remote, `${head}:refs/heads/${branch}`]); }
    catch {
      throw autopilotFailure('AUTOPILOT_CONTRACT', 'publication failed; remote outcome is unknown',
        'Git did not confirm completion; the remote may already contain the commit',
        'inspect the explicit remote branch before any deliberate retry; do not retry automatically');
    }
    return { value: { ticketId: ticket, head, remote, branch, published: true }, human: `${ticket}: published ${head} to ${remote}/${branch}\n` };
  });
}
