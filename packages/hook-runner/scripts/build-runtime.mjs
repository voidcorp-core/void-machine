// tdd-cover: e2e packages/hook-runner/src/cli.test.ts
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// One builder owns the published and source-self-host artifact.
// https://esbuild.github.io/api/#bundle, #define, #legal-comments
export async function buildHookRuntime({ root, outfile }) {
  await build({
    absWorkingDir: root, entryPoints: [join(root, 'packages/hook-runner/src/cli.ts')],
    alias: { '@voidcorp/mission-engine/events': join(root, 'packages/mission-engine/src/events/index.ts') },
    bundle: true, platform: 'node', format: 'esm', target: 'node24', outfile,
    // YAML's Node distribution is CommonJS and imports the built-in process module.
    banner: { js: "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);" },
  });
  // Remove esbuild's host-dependent module-path comments from the parent.
  writeFileSync(outfile, readFileSync(outfile, 'utf8').replace(/^\/\/ [^\r\n]*\.(?:m?js|tsx?)\r?\n/gm, ''));
}
