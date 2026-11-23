import { checkpointCodec, type CheckpointMarkers } from '../session/checkpoint.js';

/**
 * The markers a real install passes, spelled out: the current namespace writes, the former one is
 * still read. A test that proves the migration has to name both brands, which is why this file
 * lives with the tests and not with the pure package, which owns neither.
 */
export const CHECKPOINT_MARKERS: CheckpointMarkers = {
  current: {
    begin: '<!-- void-machine:context-continuity:begin -->',
    end: '<!-- void-machine:context-continuity:end -->',
  },
  recognized: [
    {
      begin: '<!-- void-machine:context-continuity:begin -->',
      end: '<!-- void-machine:context-continuity:end -->',
    },
    {
      begin: '<!-- void-harness:context-continuity:begin -->',
      end: '<!-- void-harness:context-continuity:end -->',
    },
  ],
};

export const {
  parseCheckpoint,
} = checkpointCodec(CHECKPOINT_MARKERS);
