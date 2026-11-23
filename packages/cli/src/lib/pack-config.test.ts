import { describe, expect, it } from 'vitest';
import {
  computePinBumps,
  enabledPluginNames,
  resolveEffectivePin,
  withPackPins,
} from './pack-config.js';

describe('enabledPluginNames', () => {
  it('always includes core and strips the marketplace suffix', () => {
    expect(enabledPluginNames({ 'harness@voidcorp': true, 'harness-nextjs@voidcorp': true }).sort()).toEqual(
      ['harness', 'harness-nextjs'],
    );
  });

  it('ignores keys not set to true', () => {
    expect(enabledPluginNames({ 'harness-pwa@voidcorp': false })).toEqual(['harness']);
  });

  it('applies add and remove deltas', () => {
    const cur = { 'harness@voidcorp': true, 'harness-nextjs@voidcorp': true };
    expect(enabledPluginNames(cur, { add: ['harness-react'] }).sort()).toEqual(['harness', 'harness-nextjs', 'harness-react']);
    expect(enabledPluginNames(cur, { remove: ['harness-nextjs'] })).toEqual(['harness']);
  });
});

describe('resolveEffectivePin', () => {
  it('prefers core, then an existing pack pin, then the remote', () => {
    expect(resolveEffectivePin({ core: '^1.0.0', packs: { '@voidcorp/x': '^0.9.0' } }, '^2.0.0')).toBe('^1.0.0');
    expect(resolveEffectivePin({ packs: { '@voidcorp/x': '^0.9.0' } }, '^2.0.0')).toBe('^0.9.0');
    expect(resolveEffectivePin({}, '^2.0.0')).toBe('^2.0.0');
    expect(resolveEffectivePin({})).toBeUndefined();
  });
});

describe('withPackPins', () => {
  it('adds pins for new packs and removes dropped ones, immutably', () => {
    const config = { core: '^1.0.0', packs: { '@voidcorp/a': '^1.0.0' } };
    const next = withPackPins(config, { addNames: ['b'], removeNames: ['a'], pin: '^1.0.0' });
    expect(next.packs).toEqual({ '@voidcorp/b': '^1.0.0' });
    expect(config.packs).toEqual({ '@voidcorp/a': '^1.0.0' }); // original untouched
  });

  it('skips adds when the pin is undefined (settings-only activation)', () => {
    expect(withPackPins({}, { addNames: ['b'] }).packs).toEqual({});
  });
});

describe('computePinBumps', () => {
  it('bumps core and lagging packs, leaves current ones, and reports the changes', () => {
    const config = { core: '^0.16.0', packs: { '@voidcorp/a': '^0.16.0', '@voidcorp/b': '^0.17.0' } };
    const { changes, next } = computePinBumps(config, '0.17.0');
    expect(next.core).toBe('^0.17.0');
    expect(next.packs).toEqual({ '@voidcorp/a': '^0.17.0', '@voidcorp/b': '^0.17.0' });
    // only core + pack a actually changed (b already at head)
    expect(changes.map((c) => c.name).sort()).toEqual(['a', 'harness']);
  });

  it('reports no changes when everything is already at head', () => {
    const { changes } = computePinBumps({ core: '^0.17.0', packs: { '@voidcorp/a': '^0.17.0' } }, '0.17.0');
    expect(changes).toEqual([]);
  });

  it('handles a config with no core and no packs', () => {
    const { changes, next } = computePinBumps({}, '0.17.0');
    expect(changes).toEqual([]);
    expect(next.core).toBeUndefined();
    expect(next.packs).toEqual({});
  });
});


it('preserves opaque authority exactly when adding/removing packs and bumping pins', () => {
  const autopilot = { enabled: false, protectedPaths: ['private/**'], unknownFutureRestriction: 'keep' };
  const initial = { core: '^1.0.0', packs: { '@voidcorp/old': '^1.0.0' }, autopilot };
  const packed = withPackPins(initial, { addNames: ['new'], removeNames: ['old'], pin: '^2.0.0' });
  expect(packed.autopilot).toBe(autopilot);
  expect(computePinBumps(packed, '3.0.0').next.autopilot).toBe(autopilot);
  expect(withPackPins({}, { addNames: ['new'], pin: '^2.0.0' })).not.toHaveProperty('autopilot');
});
