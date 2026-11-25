// Factual installation status. Historical score snapshots are left untouched.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshnessNotice, resolveFreshness, voidMachineDir } from '@voidcorp/hook-runner';
import { installedPath, remedyPrefix, resolveProjectRoots } from '../lib/project-roots.js';
import { detectedAdapters, type RuntimeInspection } from '../lib/runtime-adapters.js';
import { banner, blank, c, footer, line } from '../lib/render.js';
import { readInstallReceipt } from '../lib/receipts.js';

/** Render only observations supplied by the existing installation adapters. */
export function statusLines(
  runtimes: readonly Pick<RuntimeInspection, 'runtime' | 'evidence'>[],
  installedVersion: string | undefined,
): string[] {
  const out = [`installed version: ${installedVersion ?? 'unknown'}`, '', 'RUNTIMES'];
  const show = (value: boolean | null): string => value === null ? 'unknown' : value ? 'yes' : 'no';
  if (runtimes.length === 0) out.push('  no runtime detected');
  for (const { runtime, evidence } of runtimes) {
    out.push(`  ${runtime} installed=${show(evidence.installed)} wired=${show(evidence.wired)} `
      + `fired=${show(evidence.fired)} observed=${show(evidence.observed)}`);
  }
  return out;
}

export async function status(_args: readonly string[]): Promise<void> {
  // A linked worktree observes the installation in the main checkout. Remedies
  // and the persisted snapshot name that same root.
  const roots = resolveProjectRoots();
  const cwd = roots.installRoot;
  const receipt = await readInstallReceipt(cwd);
  const inspections = await Promise.all(detectedAdapters(cwd).map((adapter) => adapter.inspect(cwd)));
  const runtimes = inspections.map(({ runtime, evidence }) => ({ runtime, evidence }));

  banner('status');
  blank();
  for (const text of statusLines(runtimes, receipt?.version)) line(text);

  let persisted = false;
  try {
    const localDir = voidMachineDir(cwd);
    mkdirSync(localDir, { recursive: true });
    writeFileSync(join(localDir, 'status.json'), `${JSON.stringify({
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      installedVersion: receipt?.version ?? 'unknown',
      runtimes,
    }, null, 2)}\n`);
    persisted = true;
  } catch {
    // Rendering remains useful on a read-only install; the footer reports it.
  }
  blank();

  const notice = freshnessNotice(
    await resolveFreshness({ installed: receipt?.version ?? 'unknown', env: process.env, now: Date.now() }),
    receipt?.source,
    remedyPrefix(roots),
  );
  if (notice !== undefined) line(c.yellow(`  ${notice}`));
  footer(persisted
    ? c.green(`state written to ${installedPath(roots, '.void/machine/status.json')}`)
    : c.dim('.void not writable — render only'));
}
