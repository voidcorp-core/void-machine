// tdd-cover: e2e packages/cli/src/lib/runs/mission-command-correction.test.ts
import type { CanonicalEvent } from '../events/types.js';
import { canonicalJsonHash } from './canonical-json.js';
import { parseEvidence } from './schema.js';
import type { Evidence } from './types.js';

export interface CommandEvidenceCorrection {
  readonly failedEventId: string;
  readonly replacementEventId: string;
}
function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isCommandEvidenceCorrections(value: unknown): value is readonly CommandEvidenceCorrection[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) return false;
  const ids = new Set<string>();
  return value.every(pair => {
    if (!record(pair) || Object.keys(pair).length !== 2
      || typeof pair['failedEventId'] !== 'string' || typeof pair['replacementEventId'] !== 'string') return false;
    const pairIds = [pair['failedEventId'], pair['replacementEventId']];
    if (pairIds.some(id => !/^evt_[A-Za-z0-9_-]{8,100}$/.test(id) || ids.has(id))
      || pairIds[0] === pairIds[1]) return false;
    pairIds.forEach(id => { ids.add(id); });
    return true;
  });
}
function field(payload: unknown, key: string): unknown {
  return record(payload) ? payload[key] : undefined;
}
function commandProof(event: CanonicalEvent, missionId: string): Evidence | undefined {
  if (event.kind !== 'evidence.recorded') return undefined;
  const parsed = parseEvidence(field(event.payload, 'evidence'));
  if (!parsed.ok) return undefined;
  const proof = parsed.value;
  if (event.missionId !== missionId || proof.missionId !== missionId
    || event.subject !== proof.evidenceId || event.source !== proof.producer
    || !/^void-harness(?:@[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.+-]+)?)?:mission\.verify$/.test(proof.producer)
    || proof.source !== `command:${proof.command[0]?.split('/').at(-1)}`
    || proof.inputHash !== canonicalJsonHash({ command: proof.command,
      shell: false, environment: proof.environment })) return undefined;
  return proof;
}

/** Only the recorded mono-argv ENOENT defect is eligible; no command is executed or inferred. */
export function validCommandEvidenceCorrections(events: readonly CanonicalEvent[],
  pairs: readonly CommandEvidenceCorrection[], dependencies: Readonly<Record<string, string>>): boolean {
  const missionId = events[0]?.missionId;
  if (missionId === undefined || !isCommandEvidenceCorrections(pairs)) return false;
  return pairs.every(pair => {
    const failedEvent = events.find(event => event.eventId === pair.failedEventId);
    const replacementEvent = events.find(event => event.eventId === pair.replacementEventId);
    if (failedEvent === undefined || replacementEvent === undefined
      || failedEvent.seq >= replacementEvent.seq) return false;
    const failed = commandProof(failedEvent, missionId);
    const replacement = commandProof(replacementEvent, missionId);
    if (failed === undefined || replacement === undefined || failed.status !== 'failed'
      || failed.exitCode !== 127 || failed.command.length !== 1 || failed.output.truncated
      || failed.output.stdout !== '' || failed.output.stderr !== `spawn ${failed.command[0]} ENOENT`
      || replacement.status !== 'passed' || replacement.exitCode !== 0
      || replacement.command.length < 2
      || !replacement.command.every(token => /^[A-Za-z0-9_./:@=+-]+$/.test(token))
      || failed.command[0] !== replacement.command.join(' ')
      || failed.producer !== replacement.producer || failed.diffHash !== replacement.diffHash
      || canonicalJsonHash(failed.environment) !== canonicalJsonHash(replacement.environment)
      || canonicalJsonHash(failed.dependencies) !== canonicalJsonHash(replacement.dependencies)
      || !replacement.dependencies.some(dependency => dependency.kind === 'diff'
        && dependency.key === 'git:working-tree' && dependency.hash === replacement.diffHash)
      || replacement.dependencies.some(dependency => dependencies[dependency.key] !== dependency.hash)) return false;
    // A named success must still be the current proof of that corrected input at admission.
    return !events.some(event => event.seq > replacementEvent.seq && event.kind === 'evidence.recorded'
      && field(field(event.payload, 'evidence'), 'inputHash') === replacement.inputHash);
  });
}
