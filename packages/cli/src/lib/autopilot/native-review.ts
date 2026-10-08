import { createHash } from 'node:crypto';
import {
  type CanonicalEvent, canonicalJsonHash, type IndependentReviewReceipt,
  parseSpecialistCompletionValue, type ReviewSubject, sameReviewSubject,
  type SpecialistCompletion,
} from '@voidcorp/mission-engine';
import { readBoundedProjectFile } from '../safe-read.js';

export interface NativeReview {
  readonly receipt: IndependentReviewReceipt;
  readonly completion: SpecialistCompletion;
  readonly invocationEventId: string;
  readonly completionEventId: string;
}
function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value && name in value
    ? Reflect.get(value, name) : undefined;
}
function refused(reason: string): never { throw Error(`NATIVE_REVIEW_REFUSED: ${reason}`); }

/** Only canonical requested -> started -> completed evidence is a review transport. */
export async function collectNativeReview(
  root: string, events: readonly CanonicalEvent[], subject: ReviewSubject, writerId: string, round: 1 | 2,
): Promise<NativeReview> {
  const writerSeq = events.filter(event => event.kind === 'lead-writer.completed').at(-1)?.seq ?? 0;
  const terminals = events.filter(event => event.kind === 'specialist.completed'
    && event.missionId === subject.taskId && event.subject === 'core:independent-code-reviewer'
    && event.seq > writerSeq && field(event.payload, 'stage') === 'post-implementation');
  const terminal = terminals.at(-1);
  const completion = parseSpecialistCompletionValue(field(terminal?.payload, 'completion'));
  const receipt = completion?.review;
  if (terminal === undefined || completion === undefined || receipt === undefined
    || !sameReviewSubject(subject, receipt) || receipt.writerId !== writerId || receipt.reviewerId === writerId
    || canonicalJsonHash(field(terminal.payload, 'reviewSubject')) !== canonicalJsonHash(subject)
    || canonicalJsonHash(field(terminal.payload, 'reviewScope')) !== canonicalJsonHash(receipt.scope)
    || (round === 1 ? receipt.scope.kind !== 'general' : receipt.scope.kind !== 'targeted')) {
    refused('missing independent completion for the exact commit, base, criteria, writer and scope');
  }
  const sameDispatch = (event: CanonicalEvent) => event.missionId === subject.taskId
    && event.subject === terminal.subject
    && ['stage', 'reviewRound', 'inputHash', 'contractVersion', 'reviewSubject', 'reviewScope']
      .every(key => canonicalJsonHash(field(event.payload, key)) === canonicalJsonHash(field(terminal.payload, key)));
  const request = events.filter(event => event.kind === 'specialist.requested' && sameDispatch(event)
    && event.source === 'void-harness:mission.dispatch' && event.seq < terminal.seq).at(-1);
  const starts = events.filter(event => event.kind === 'specialist.started' && sameDispatch(event)
    && event.source === terminal.source && event.seq > (request?.seq ?? terminal.seq) && event.seq < terminal.seq);
  const invocation = starts.find(event => receipt.provenance.kind === 'native-context'
    ? field(event.payload, 'contextId') === receipt.provenance.contextId
      && field(terminal.payload, 'contextId') === receipt.provenance.contextId
    : field(terminal.payload, 'reviewInvocationEventId') === event.eventId
      && (field(event.payload, 'reviewerId') === receipt.reviewerId
        || (typeof field(event.payload, 'contextId') === 'string'
          && field(event.payload, 'contextId') !== ''
          && field(event.payload, 'contextId') === field(terminal.payload, 'contextId'))));
  if (request === undefined || invocation === undefined
    || terminal.source !== `runtime:${String(field(request.payload, 'runtime'))}`
    || events.some(event => event.kind === 'specialist.failed' && sameDispatch(event)
      && event.seq > invocation.seq && event.seq < terminal.seq)) refused('no matching actual independent invocation');
  if (receipt.provenance.kind === 'review-artifact') {
    const artifact = await readBoundedProjectFile({ root, inputPath: receipt.provenance.path, maxBytes: 65536,
      pathEscapeMessage: 'NATIVE_REVIEW_REFUSED: artifact escapes project',
      invalidMessage: 'NATIVE_REVIEW_REFUSED: artifact is not bounded and stable' });
    if (`sha256:${createHash('sha256').update(artifact.body).digest('hex')}` !== receipt.provenance.sha256) {
      refused('artifact bytes changed');
    }
    const body: unknown = JSON.parse(artifact.body);
    const { review: _receipt, ...result } = completion;
    const { provenance: _provenance, ...review } = receipt;
    if (field(body, 'requestEventId') !== request.eventId || field(body, 'invocationEventId') !== invocation.eventId
      || canonicalJsonHash(field(body, 'result')) !== canonicalJsonHash(result)
      || canonicalJsonHash(field(body, 'review')) !== canonicalJsonHash(review)) refused('artifact binding changed');
  }
  return { completion, receipt, invocationEventId: invocation.eventId, completionEventId: terminal.eventId };
}
