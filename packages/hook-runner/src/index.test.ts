import { describe, expect, it } from 'vitest';
import * as api from './index.js';

// The public surface of this package is what the CLI imports by name. A symbol
// dropped from the barrel typechecks inside the package and breaks the CLI, so
// the contract is asserted here rather than discovered at build time.
describe('the package surface', () => {
  it('exports the bounded journal reader retained consumers use', () => {
    expect(typeof api.readMissionJournals).toBe('function');
  });

  it('exports the layout vocabulary doctor judges a project against', () => {
    expect(typeof api.pendingMigrations).toBe('function');
    expect(typeof api.isMachineEntry).toBe('function');
    expect(api.VOID_MACHINE_DIR).toBe('machine');
  });
});
