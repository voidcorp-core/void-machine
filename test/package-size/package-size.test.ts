/**
 * Tests for scripts/check-package-size.mjs — the published-tarball size ceiling.
 * The pure judge() carries the load; measure() packs the real repository.
 */

import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM script, no types
import { judge, formatBytes, PACKAGE_LIMITS } from '../../scripts/check-package-size.mjs';
import { PRODUCT_IDENTITY } from '../../packages/hook-runner/src/identity.js';

describe('judge', () => {
  it('passes a package under its ceiling', () => {
    const verdict = judge([{ package: PRODUCT_IDENTITY.packageName, bytes: 700_000 }]);

    expect(verdict.ok).toBe(true);
    expect(verdict.failures).toEqual([]);
  });

  it('passes a package exactly at its ceiling, which is a limit and not a wall', () => {
    const limit = PACKAGE_LIMITS[PRODUCT_IDENTITY.packageName];
    const verdict = judge([{ package: PRODUCT_IDENTITY.packageName, bytes: limit }]);

    expect(verdict.ok).toBe(true);
  });

  it('fails one byte over, so the ceiling means what it says', () => {
    const limit = PACKAGE_LIMITS[PRODUCT_IDENTITY.packageName];
    const verdict = judge([{ package: PRODUCT_IDENTITY.packageName, bytes: limit + 1 }]);

    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toHaveLength(1);
  });

  it('reports the measurement, the ceiling, and the overshoot', () => {
    const limit = PACKAGE_LIMITS[PRODUCT_IDENTITY.packageName];
    const [failure] = judge([{ package: PRODUCT_IDENTITY.packageName, bytes: limit + 50_000 }]).failures;

    expect(failure.measured).toBe(limit + 50_000);
    expect(failure.limit).toBe(limit);
    expect(failure.overshootBytes).toBe(50_000);
    // A ceiling breach is a decision to make, so the message has to say what the
    // two options are rather than only that a number moved.
    expect(failure.nextAction).toMatch(/raise the ceiling|remove the weight/i);
  });

  it('judges every package, not just the first that breaches', () => {
    const verdict = judge([
      { package: PRODUCT_IDENTITY.packageName, bytes: PACKAGE_LIMITS[PRODUCT_IDENTITY.packageName] + 1 },
      { package: '@voidcorp/pack-monorepo', bytes: PACKAGE_LIMITS['@voidcorp/pack-monorepo'] + 1 },
    ]);

    expect(verdict.failures).toHaveLength(2);
  });

  it('fails a package with no declared ceiling rather than letting it through', () => {
    // A newly published package must not be silently unbounded: the gate exists
    // because the weight nobody watches is the weight that grows.
    const verdict = judge([{ package: '@voidcorp/brand-new', bytes: 10 }]);

    expect(verdict.ok).toBe(false);
    expect(verdict.failures[0].nextAction).toMatch(/declare a ceiling/i);
  });

  it('fails a package that could not be measured instead of passing in silence', () => {
    const verdict = judge([{ package: PRODUCT_IDENTITY.packageName, bytes: undefined, error: 'pnpm pack failed' }]);

    expect(verdict.ok).toBe(false);
    expect(verdict.failures[0].nextAction).toMatch(/pnpm pack/i);
  });
});

describe('formatBytes', () => {
  it('renders kB with one decimal, the unit npm itself reports', () => {
    expect(formatBytes(728_218)).toBe('728.2 kB');
  });

  it('renders a small package without pretending to precision it lacks', () => {
    expect(formatBytes(7_934)).toBe('7.9 kB');
  });
});

describe('PACKAGE_LIMITS', () => {
  it('covers every package the publish-safety gate packs', async () => {
    // The two gates must not drift apart: a package that publishes without a
    // ceiling is exactly the gap this gate was added to close.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../../scripts/check-publish-safety.mjs', import.meta.url), 'utf8'),
    );
    const packed = [...source.matchAll(/'(packages\/[^']+)'/g)].map((match) => match[1]);

    expect(packed.length).toBeGreaterThan(0);
    for (const directory of packed) {
      const manifest = await import('node:fs').then((fs) =>
        JSON.parse(
          fs.readFileSync(new URL(`../../${directory}/package.json`, import.meta.url), 'utf8'),
        ),
      );
      expect(Object.keys(PACKAGE_LIMITS)).toContain(manifest.name);
    }
  });
});
