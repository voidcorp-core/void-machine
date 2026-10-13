// @test-resource subprocess
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, it } from 'vitest';
import { packageManagerCommand } from '../../packages/cli/src/lib/package-manager.js';
import { prepareStableUpdate } from '../../packages/cli/scripts/conformance-update.mjs';

// Focused local adapter to the same proof run by install-conformance on each OS.
// CI supplies the immutable tarball produced once by consumer-artifact.
let root: string;
let proof: Awaited<ReturnType<typeof prepareStableUpdate>>;
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'void-packed-update-')));
  const npm = packageManagerCommand('npm');
  const packed = await promisify(execFile)(npm.executable, [...npm.prefixArguments,
    'pack', resolve(import.meta.dirname, '../../packages/cli'), '--ignore-scripts', '--json', '--pack-destination', root], {
    cwd: root, env: { ...process.env, HOME: root, USERPROFILE: root, npm_config_cache: join(root, 'pack-cache') },
    timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  proof = await prepareStableUpdate(root, join(root, JSON.parse(packed.stdout)[0].filename));
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

it('previews the complete selection without activation', async () => { await proof.preview(); });
it('adopts actual npm bins, preserves a clone and runs offline without its source', async () => { await proof.current(); });
it('updates all three runtime projects through the native stable launcher only when explicitly selected', async () => { await proof.all(); });
it('recovers complete absent and partial receipts for Claude, Codex and both through public update', async () => { await proof.ownership(); });
it('survives termination after native launcher publication and before activation', async () => { await proof.interrupt(); });
it('recovers through the native launcher before a failing acquisition without overwriting the old selection', async () => { await proof.recover(); });
it('completes a repeated invocation and runs its recovered platform shim', async () => { await proof.repeat(); });
