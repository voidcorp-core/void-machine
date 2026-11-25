#!/usr/bin/env node
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withCliArtifact } from '../packages/cli/scripts/conformance-artifact.mjs';
import { PRODUCT_IDENTITY } from './product-identity.mjs';

// CLI only: the release workflow does not publish internal workspace packs.
// DEV-1143: the real post-retirement pnpm archive is 914,621 bytes.
// 1.1 MB leaves about 20% headroom and still catches accidental doubling.
export const PACKAGE_LIMITS = Object.freeze({ [PRODUCT_IDENTITY.packageName]: 1_100_000 });

/** kB with one decimal — the unit npm reports, so the numbers can be compared. */
export function formatBytes(bytes) {
  return `${(bytes / 1000).toFixed(1)} kB`;
}

/**
 * Judge measured sizes against the ceilings.
 *
 * Pure, so the interesting cases (a breach, an unmeasurable package, a package
 * nobody declared) are testable without packing anything.
 */
export function judge(measurements) {
  const failures = [];
  for (const measurement of measurements) {
    const limit = PACKAGE_LIMITS[measurement.package];
    if (measurement.bytes === undefined) {
      failures.push({
        package: measurement.package,
        measured: undefined,
        limit,
        overshootBytes: undefined,
        nextAction: `could not measure: ${measurement.error ?? 'unknown error'}. Check that \`pnpm pack\` runs in that package, then rerun.`,
      });
      continue;
    }
    if (limit === undefined) {
      failures.push({
        package: measurement.package,
        measured: measurement.bytes,
        limit: undefined,
        overshootBytes: undefined,
        nextAction: `declare a ceiling for ${measurement.package} in PACKAGE_LIMITS (measured ${formatBytes(measurement.bytes)}); a published package nobody bounds is the one that grows.`,
      });
      continue;
    }
    if (measurement.bytes > limit) {
      failures.push({
        package: measurement.package,
        measured: measurement.bytes,
        limit,
        overshootBytes: measurement.bytes - limit,
        nextAction: `remove accidental payload growth; a necessary ceiling change requires a new measured archive and a documented reason.`,
      });
    }
  }
  return { ok: failures.length === 0, failures };
}

export function measureArtifact(tarball) {
  return [{ package: PRODUCT_IDENTITY.packageName, bytes: statSync(tarball).size }];
}

export function checkPackageSize(tarball) {
  const measurements = measureArtifact(tarball);
  const verdict = judge(measurements);
  process.stdout.write(`check-package-size: CLI ${formatBytes(measurements[0].bytes)} / ${formatBytes(PACKAGE_LIMITS[PRODUCT_IDENTITY.packageName])}\n`);
  if (!verdict.ok) throw new Error(verdict.failures.map(failure => failure.nextAction).join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await withCliArtifact(checkPackageSize); }
  catch (error) {
    process.stderr.write(`check-package-size: ${error.message}\n`);
    process.exitCode = 1;
  }
}
