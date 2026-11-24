import { describe, expect, it } from 'vitest';
import identity from '../../../core/src/data/identity.json' with { type: 'json' };
import { CHECKPOINT_MARKERS } from './checkpoint-markers.js';

// The engine never reads the identity; its tests stand in for the hook runtime that does. This
// keeps the stand-in honest: the markers the tests pass are the ones a real install derives.
describe('the checkpoint markers the engine tests use', () => {
  it('are the current and former namespaces of the product identity', () => {
    const pair = (namespace: string) => ({
      begin: `<!-- ${namespace}:context-continuity:begin -->`,
      end: `<!-- ${namespace}:context-continuity:end -->`,
    });
    const namespaces = [identity.markers.namespace, ...identity.markers.deprecated];
    expect(CHECKPOINT_MARKERS.recognized).toEqual(namespaces.map(pair));
    expect(CHECKPOINT_MARKERS.current).toEqual(pair(identity.markers.namespace));
  });
});
