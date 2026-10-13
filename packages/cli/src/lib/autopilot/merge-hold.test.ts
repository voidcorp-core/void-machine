import { describe, expect, it } from 'vitest';
import { MERGE_HOLD_PATH, mergeHoldRecord, parseMergeHold } from './merge-hold.js';

// The hold is the one instruction a person gives the loop about merges, and it
// only ever takes authority away. So anything but a clean absence reads as a
// hold: a damaged file must never hand a merge back to the machine.

const SINCE = '2026-09-28T21:00:00.000Z';

describe('parseMergeHold', () => {
  it('reads no file as the automatic default', () => {
    expect(parseMergeHold({ kind: 'absent' })).toEqual({ held: false });
  });

  it('reads the record `merges --by-human` writes as a hold, with its date', () => {
    const hold = parseMergeHold({ kind: 'text', text: mergeHoldRecord(SINCE) });

    expect(hold).toEqual({ held: true, detail: `a person holds the merges since ${SINCE}` });
  });

  it('reads a file that is not JSON as a hold, and says why', () => {
    const hold = parseMergeHold({ kind: 'text', text: '{ by-human' });

    expect(hold.held).toBe(true);
    expect(hold.held && hold.detail).toMatch(/unreadable/);
  });

  it('reads a record of another shape as a hold rather than a release', () => {
    for (const text of ['{}', '{"schemaVersion":2,"mergedBy":"human","since":"x"}', '"automatic"', 'null']) {
      const hold = parseMergeHold({ kind: 'text', text });
      expect(hold.held).toBe(true);
      expect(hold.held && hold.detail).toMatch(new RegExp(MERGE_HOLD_PATH.replaceAll('.', '\\.')));
    }
  });

  it('reads a file it could not open as a hold, naming the cause', () => {
    const hold = parseMergeHold({ kind: 'unreadable', cause: 'EACCES: permission denied' });

    expect(hold).toEqual({
      held: true,
      detail: `${MERGE_HOLD_PATH} is unreadable (EACCES: permission denied), so the merges stay a person's`,
    });
  });
});

describe('mergeHoldRecord', () => {
  it('writes a record the parser reads back', () => {
    expect(JSON.parse(mergeHoldRecord(SINCE))).toEqual({ schemaVersion: 1, mergedBy: 'human', since: SINCE });
  });
});
