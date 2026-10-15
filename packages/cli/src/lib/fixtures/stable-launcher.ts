// tdd-cover: e2e packages/cli/src/lib/cli-installation.test.ts
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Small standalone bundle only; the packed owner proves the actual tsup output.
let bytes: Promise<Uint8Array> | undefined;
export function bundledLauncher(): Promise<Uint8Array> {
  bytes ??= build({
    entryPoints: [fileURLToPath(new URL('../stable-launcher.mjs', import.meta.url))],
    bundle: true, platform: 'node', target: 'node24', format: 'esm', write: false,
  }).then(result => {
    const output = result.outputFiles[0];
    if (!output) throw new Error('Missing standalone launcher bundle');
    return output.contents;
  });
  return bytes;
}
