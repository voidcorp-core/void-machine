import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { PreparedInstall } from './local-install.js';
import type { RuntimeAdapter } from './runtime-adapters.js';

/** Internal compiler seam; never exposed as an install command-line flag. */
export interface InstallPreparation {
  readonly projectRoot: string;
  readonly onPrepared: (plan: PreparedInstall) => void;
}

/** Smoke exactly what remains after ownership decisions, without claiming retained files. */
export async function inspectInstallProjection(
  projectRoot: string,
  stageRoot: string,
  retained: readonly string[],
  adapters: readonly RuntimeAdapter[],
): Promise<void> {
  const projection = await mkdtemp(join(tmpdir(), 'harness-install-projection-'));
  try {
    await cp(stageRoot, projection, { recursive: true });
    for (const path of retained) {
      const destination = join(projection, path);
      await mkdir(dirname(destination), { recursive: true });
      await cp(join(projectRoot, path), destination);
    }
    for (const adapter of adapters) {
      const inspection = await adapter.inspect(projection);
      if (inspection.evidence.installed !== true || inspection.evidence.wired !== true
        || inspection.evidence.fired !== true) {
        const failures = inspection.checks.filter(check => !check.ok).map(check => check.message);
        throw new Error(`${adapter.label} projected install smoke failed: ${failures.join('; ')}`);
      }
    }
  } finally {
    await rm(projection, { recursive: true, force: true });
  }
}
