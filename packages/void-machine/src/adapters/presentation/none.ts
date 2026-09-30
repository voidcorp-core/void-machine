// tdd-cover: e2e packages/void-machine/test/presentation-adapters-contract.test.ts
import { surfaceCause } from '../../core/presentation.js';
import type { SurfacePort } from '../../runtime/presentation.js';

/**
 * No multiplexer: nothing is opened. The run is the same native session, visible through
 * `void-machine agents status` and `claude agents`.
 */
export function createNoSurface(): SurfacePort {
  const cause = surfaceCause('not-detected', 'detection');
  return {
    kind: 'none',
    open: async () => ({ ok: false, cause }),
    inspect: async () => ({ state: 'unknown', cause }),
    close: async () => ({ outcome: 'skipped', cause }),
  };
}
