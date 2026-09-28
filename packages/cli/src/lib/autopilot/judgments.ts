// The narrow, typed judgments an agent returns at each decision point of the loop.
//
// The model keeps its freedom over the work itself; at a decision point its answer
// is closed and admitted here before anything acts on it. An answer that does not
// fit is refused with the field at fault, never read charitably: no default fills a
// missing field, an unknown field is not ignored, and a blank text is not a reason.
// Policy (slots, collisions, review rounds, merges) stays in the code that consumes
// these values; this module only decides whether an answer is well-formed.
//
// Zod 4 strict objects refuse unknown keys: https://zod.dev/api#zstrictobject.

import { parseSpecialistCompletionValue, type SpecialistFinding } from '@voidcorp/mission-engine';
import { z } from 'zod';
import { normaliseArea } from './footprint-area.js';

/** A reason is one or two sentences a human reads in a recap or a Linear comment. */
export const REASON_MAX = 500;

/** The spec asks the curator for one or two sentences per moved ticket. */
export const JUSTIFICATION_MAX = 280;

/**
 * Four slots at most, and the curator re-ranks after every merge, so the queue is
 * only read until the next re-ranking. Its head can still be skipped for a
 * collision, so four candidates per slot keep every slot fed without letting a
 * curator hand the loop an unbounded backlog dump.
 */
export const CURATOR_QUEUE_MAX = 16;

/** A footprint names the ground a ticket touches, not an inventory of files. */
export const FOOTPRINT_AREAS_MAX = 64;
const AREA_MAX = 512;

/** A review that finds more than this has not been bounded to what is wrong. */
export const BLOCKING_MAX = 32;
export const ADVISORY_MAX = 64;

export type Admission<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

function boundedText(maximum: number) {
  return z
    .string()
    .max(maximum)
    .refine((value) => value.trim().length > 0, { error: 'must not be blank' });
}

const reason = boundedText(REASON_MAX);

const ticketId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, { error: 'must be a tracker identifier' })
  .brand<'TicketId'>();
export type TicketId = z.infer<typeof ticketId>;

// `normaliseArea` is the one reading every footprint consumer shares, so the queue
// stores its spelling; an area it refuses claims nothing and is refused here too.
const area = z
  .string()
  .max(AREA_MAX)
  .transform((value, context) => {
    try {
      return normaliseArea(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'claims no file git reports' });
      return z.NEVER;
    }
  });

// `path:line`, line from 1, no whitespace: the form a reader can open directly.
const location = z
  .string()
  .max(AREA_MAX)
  .regex(/^[^\s:]+:[1-9][0-9]*$/, { error: 'must be file:line' });

const ticketReadinessSchema = z.strictObject({
  verdict: z.enum(['ready', 'needs-enrichment', 'ambiguous']),
  reason,
});
export type TicketReadiness = z.infer<typeof ticketReadinessSchema>;

const queueEntrySchema = z.strictObject({
  ticketId,
  justification: boundedText(JUSTIFICATION_MAX),
  footprint: z.array(area).min(1).max(FOOTPRINT_AREAS_MAX),
});

const curatorQueueSchema = z
  .strictObject({ entries: z.array(queueEntrySchema).max(CURATOR_QUEUE_MAX) })
  .superRefine((queue, context) => {
    const seen = new Set<string>();
    queue.entries.forEach((queued, index) => {
      if (seen.has(queued.ticketId)) {
        context.addIssue({
          code: 'custom',
          path: ['entries', index, 'ticketId'],
          message: `queues ${queued.ticketId} a second time`,
        });
      }
      seen.add(queued.ticketId);
    });
  });
export type CuratorQueue = z.infer<typeof curatorQueueSchema>;
export type CuratorQueueEntry = CuratorQueue['entries'][number];

/** A full commit SHA: a judgment binds to exactly the head it read, never a prefix. */
const commitSha = z.string().regex(/^[0-9a-f]{40}$/, { error: 'must be a full commit SHA' });

// Bound to the head whose conflict it classifies: once the worker pushes its
// resolution, a new conflict is a new question.
const conflictClassSchema = z.strictObject({
  headSha: commitSha,
  class: z.enum(['mechanical', 'semantic']),
  reason,
});
export type ConflictClass = z.infer<typeof conflictClassSchema>;

// A blocking finding without a concrete scenario is an opinion, and an opinion
// does not hold a ticket back: every field is required and must say something.
const blockingFindingSchema = z.strictObject({
  location,
  scenario: boundedText(REASON_MAX),
  correction: boundedText(REASON_MAX),
});

const advisoryFindingSchema = z.strictObject({
  location: location.optional(),
  note: boundedText(REASON_MAX),
});

const reviewVerdictSchema = z.strictObject({
  headSha: commitSha,
  round: z.literal([1, 2]),
  blocking: z.array(blockingFindingSchema).max(BLOCKING_MAX),
  advisory: z.array(advisoryFindingSchema).max(ADVISORY_MAX),
});
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;
export type BlockingFinding = ReviewVerdict['blocking'][number];

/** How many review attempts one head keeps on record; the kernel stops far below. */
export const REVIEW_ATTEMPTS_RECORDED_MAX = 8;

const runId = z.string().regex(/^run_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, {
  error: 'must be a delegated run id',
});
const sessionId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, {
  error: 'must be a native session id',
});
const instant = z.int().nonnegative();

// One delegated review of a head: when it started, and why it ended without a
// verdict. An attempt with no end is running, or was interrupted.
const reviewAttemptSchema = z.strictObject({
  runId: runId.optional(),
  startedAt: instant,
  endedAt: instant.optional(),
  failure: reason.optional(),
});

// The verdict and what binds it: the run the kernel dispatched and the native
// session the runtime listed under it when the kernel accepted the result.
const recordedVerdictSchema = z.strictObject({
  runId,
  sessionId,
  recordedAt: instant,
  verdict: reviewVerdictSchema,
});

/**
 * What `autopilot review` records for one head of one pull request. It lives
 * where any agent on the machine can write, so it is admitted like any other
 * judgment, and a verdict must name a run one of its attempts started and the
 * head the record is for.
 */
const localReviewSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    ticketId,
    pullRequest: z.int().positive().max(2_147_483_647),
    headSha: commitSha,
    attempts: z.array(reviewAttemptSchema).max(REVIEW_ATTEMPTS_RECORDED_MAX),
    verdict: recordedVerdictSchema.optional(),
  })
  .superRefine((review, context) => {
    if (review.verdict === undefined) return;
    if (review.verdict.verdict.headSha !== review.headSha) {
      context.addIssue({ code: 'custom', path: ['verdict', 'verdict', 'headSha'],
        message: `judges another head than ${review.headSha}` });
    }
    const run = review.verdict.runId;
    if (!review.attempts.some((attempt) => attempt.runId === run)) {
      context.addIssue({ code: 'custom', path: ['verdict', 'runId'], message: 'names a run no attempt started' });
    }
  });
export type LocalReview = z.infer<typeof localReviewSchema>;
export type ReviewAttempt = LocalReview['attempts'][number];

function describeIssue(issue: z.core.$ZodIssue): string {
  const field = issue.path.length === 0 ? '(root)' : issue.path.map(String).join('.');
  return `${field}: ${issue.message}`;
}

function admit<T>(what: string, schema: z.ZodType<T>, value: unknown): Admission<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues.map(describeIssue).join('; ');
  return { ok: false, reason: `${what} refused: ${issues}` };
}

export function admitTicketReadiness(value: unknown): Admission<TicketReadiness> {
  return admit('ticket readiness', ticketReadinessSchema, value);
}

export function admitCuratorQueue(value: unknown): Admission<CuratorQueue> {
  return admit('curator queue', curatorQueueSchema, value);
}

export function admitConflictClass(value: unknown): Admission<ConflictClass> {
  return admit('conflict class', conflictClassSchema, value);
}

export function admitReviewVerdict(value: unknown): Admission<ReviewVerdict> {
  return admit('review verdict', reviewVerdictSchema, value);
}

export function admitLocalReview(value: unknown): Admission<LocalReview> {
  return admit('local review', localReviewSchema, value);
}

/** The reviewer the loop delegates, whose completion contract its final message follows. */
export const REVIEWER_SPECIALIST = 'core:independent-code-reviewer';

const clip = (text: string): string => text.slice(0, REASON_MAX);

function locationOf(finding: SpecialistFinding): string | undefined {
  const evidence = finding.evidence[0];
  return evidence === undefined ? undefined : `${evidence.path}:${String(evidence.line)}`;
}

function refusedCompletion(cause: string): Admission<ReviewVerdict> {
  return { ok: false, reason: `review completion refused: ${cause}` };
}

/**
 * The reviewer's final message, as its specialist contract defines it, read as
 * the loop's verdict on `headSha`. The head and the round are the kernel's: the
 * reviewer never states what it judged. A reviewer that could not judge, or
 * whose verdict contradicts its own findings, gives no verdict at all, and a
 * blocking finding the loop cannot locate is refused rather than dropped.
 */
export function admitReviewCompletion(
  text: string,
  headSha: string,
  round: 1 | 2,
): Admission<ReviewVerdict> {
  let value: unknown;
  try {
    value = JSON.parse(text.trim());
  } catch {
    return refusedCompletion('the final message is not the JSON object the contract asks for');
  }
  const completion = parseSpecialistCompletionValue(value);
  if (completion === undefined) return refusedCompletion('the completion breaks its contract');
  if (completion.specialistId !== REVIEWER_SPECIALIST) {
    return refusedCompletion(`signed by ${completion.specialistId}, not ${REVIEWER_SPECIALIST}`);
  }
  if (completion.verdict === 'degraded') {
    return refusedCompletion(`the reviewer could not judge: ${completion.limitations.join('; ')}`);
  }
  const blocking = completion.findings.filter((finding) => finding.classification === 'blocking');
  if ((completion.verdict === 'pass') !== (blocking.length === 0)) {
    return refusedCompletion(`a ${completion.verdict} verdict with ${String(blocking.length)} blocking findings`);
  }
  const advisory = completion.findings.filter((finding) => finding.classification !== 'blocking');
  const verdict = admitReviewVerdict({
    headSha,
    round,
    blocking: blocking.map((finding) => ({
      location: locationOf(finding) ?? '',
      scenario: clip(`${finding.summary} ${finding.consequence ?? ''}`.trim()),
      correction: clip(finding.resolutionCondition ?? finding.recommendation),
    })),
    advisory: advisory.map((finding) => {
      const location = locationOf(finding);
      return {
        ...(location === undefined ? {} : { location }),
        note: clip(`${finding.summary} ${finding.recommendation}`.trim()),
      };
    }),
  });
  return verdict.ok ? verdict : refusedCompletion(verdict.reason);
}

// The loop admits the tracker observation with the same two readings, so a
// ticket id or an area means one thing on both sides of the boundary.
export { area as footprintAreaSchema, ticketId as ticketIdSchema };
