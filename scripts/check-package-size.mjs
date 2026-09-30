#!/usr/bin/env node
// Release safety: keep the published tarballs inside a declared ceiling.
//
// This gate does not make anything smaller. It exists because nothing was
// watching: weight arrives one legitimate feature at a time, and without a
// ceiling the first time anyone notices is after it is on npm. A number that is
// measured every run and bounded on purpose is the difference between a size
// budget and a size surprise.
//
// It measures `pnpm pack`, not `npm pack`, because pnpm is what RELEASING.md
// mandates and therefore what consumers actually download — and because pnpm
// rewrites `workspace:` specifiers at pack time, so a pnpm tarball is the only
// faithful one (see check-publish-safety.mjs, which packs the same way).
//
// The compressed tarball is the only figure a ceiling belongs on: it is what
// crosses the network on `npx`. Unpacked size and bundle size are
// interesting, but nobody waits on them.
//
// Raising a ceiling is a normal thing to do. Do it in the same commit as the
// change that needs it, with the reason in the commit message, so the growth is
// a decision on the record rather than a drift nobody signed.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_IDENTITY } from './product-identity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/**
 * Compressed-tarball ceilings, in bytes.
 *
 * Set 2026-08-06 from measured sizes with roughly one sixth of headroom: enough
 * that an honest addition does not trip the gate, tight enough that a doubling
 * cannot pass unseen. Measured then: the CLI 728,218 · harness-graph 85,748 ·
 * pack-monorepo 7,934 · pack-nextjs 6,176.
 *
 * The packs get a proportionally looser ceiling on purpose: on a 7 kB package a
 * tight bound measures noise, not growth.
 */
export const PACKAGE_LIMITS = Object.freeze({
  // Raised from 850 kB on 2026-09-01, with the autopilot cycle. Two reasons,
  // and the second is the one that matters: the slice added the nine commands
  // that give twenty-seven already-shipped functions a caller, so the package
  // was carrying their weight without their value; and the previous ceiling was
  // met exactly, to the byte, which means it had stopped warning anyone and was
  // going to refuse the next commit whatever it contained.
  // DEV-738 measured 901.1 kB after adding verified worker journal routing.
  // Retain a bounded 20 kB margin for this safety behavior; no payload omitted.
  // DEV-843 measured 922,113 bytes with the rendered-scope contract and native
  // agent projection. Packed contents contain no eval fixtures or local receipts.
  // Keep the complete review contract with bounded headroom; no payload omitted.
  // The official TypeScript 6 worker measures 1954.7 kB in the real pnpm pack
  // on 2026-09-16. Both runtime assets and upstream licenses are included.
  // Own the supported compiler API offline with about 45 kB of headroom.
  // The native autopilot loop measures 2016.5 kB on 2026-09-24 (develop:
  // 1996.1 kB): about 20 kB of new loop code in dist/main.js, no fixture or
  // test code packed. It shipped beside the cluster engine it replaced until
  // step 7 of the native loop plan removed that engine: 1942.1 kB on
  // 2026-09-24 (develop: 2018.6 kB). The ceiling comes back down with it, to
  // the same 45 kB of headroom the compiler worker was given.
  // The kernel's delegation capability ships in the CLI (DEV-923, decision
  // 0cfd77e6): 1995.2 kB on 2026-09-28, with the CLI aligned on the kernel's
  // zod 4.6.5 so the bundle carries one zod, not two (2075.5 kB before). The
  // same 45 kB of headroom again.
  // Delegation to Codex (DEV-926, proposed decision 5dd5306b) bundles the ws
  // client the adapter needs to reach the Codex daemon on its Unix socket:
  // 2050.5 kB on 2026-09-29, no fixture or test code packed. The same 45 kB of
  // headroom.
  [PRODUCT_IDENTITY.packageName]: 2_095_000,
  '@voidcorp/harness-graph': 120_000,
  '@voidcorp/pack-monorepo': 20_000,
  '@voidcorp/pack-nextjs': 20_000,
});

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
        nextAction: `either remove the weight, or raise the ceiling in PACKAGE_LIMITS in this same commit with the reason in the commit message.`,
      });
    }
  }
  return { ok: failures.length === 0, failures };
}

/** Pack each publishable package and read the tarball it would ship. */
export function measure(packages) {
  return packages.map(({ directory, name }) => {
    const out = mkdtempSync(join(tmpdir(), 'package-size-'));
    try {
      execFileSync('pnpm', ['pack', '--pack-destination', out], {
        cwd: resolve(ROOT, directory),
        stdio: 'ignore',
      });
      const tarball = readdirSync(out).find((file) => file.endsWith('.tgz'));
      if (tarball === undefined) throw new Error('pnpm pack produced no tarball');
      return { package: name, bytes: statSync(join(out, tarball)).size };
    } catch (error) {
      return { package: name, bytes: undefined, error: error.message };
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
}

// Mirrors PACKAGES in check-publish-safety.mjs; the test asserts they agree.
const PACKAGES = [
  { directory: 'packages/cli', name: PRODUCT_IDENTITY.packageName },
  { directory: 'packages/harness-graph', name: '@voidcorp/harness-graph' },
  { directory: 'packages/packs/pack-monorepo', name: '@voidcorp/pack-monorepo' },
  { directory: 'packages/packs/pack-nextjs', name: '@voidcorp/pack-nextjs' },
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const measurements = measure(PACKAGES);
  const verdict = judge(measurements);
  // Printed every run, breach or not: a trajectory is more useful than an alarm.
  for (const measurement of measurements) {
    const limit = PACKAGE_LIMITS[measurement.package];
    const size = measurement.bytes === undefined ? 'unmeasured' : formatBytes(measurement.bytes);
    const ceiling = limit === undefined ? 'no ceiling' : formatBytes(limit);
    console.log(`check-package-size: ${measurement.package} ${size} / ${ceiling}`);
  }
  if (!verdict.ok) {
    console.error('check-package-size: a published package is over its ceiling:');
    for (const failure of verdict.failures) {
      const measured = failure.measured === undefined ? 'unmeasured' : formatBytes(failure.measured);
      const over =
        failure.overshootBytes === undefined ? '' : ` (+${formatBytes(failure.overshootBytes)})`;
      console.error(`  ${failure.package}: ${measured}${over}`);
      console.error(`  -> ${failure.nextAction}`);
    }
    process.exit(1);
  }
  console.log(`check-package-size: ${PACKAGES.length} package(s) within their ceilings.`);
}
