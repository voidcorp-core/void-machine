import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node24',
  outDir: 'dist',
  // Declarations are not emitted: the package exposes a binary, no types entry.
  dts: false,
  // No source map in the published CLI: consumers never debug it, and it is the largest file in the
  // tarball. Rebuild locally with `--sourcemap` if you ever need one for development.
  sourcemap: false,
  clean: true,
  splitting: false,
  // Bundled CommonJS internals (notably yaml) need createRequire in the ESM
  // artifact; without the shim an extracted offline tarball crashes at startup.
  shims: true,
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  treeshake: true,
  // Bundle every runtime dependency so the npm tarball itself runs offline.
  // These packages remain devDependencies for compilation/tests only.
  noExternal: [
    '@clack/prompts',
    '@voidcorp/harness-graph',
    '@voidcorp/hook-runner',
    '@voidcorp/mission-engine',
    '@voidcorp/void-machine',
    'picomatch',
    'yaml',
    'zod',
  ],
});
