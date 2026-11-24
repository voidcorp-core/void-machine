import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/result.ts', 'src/option.ts', 'src/pipe.ts'],
  format: ['esm'],
  target: 'node24',
  outDir: 'dist',
  // Declarations come from `tsc` in the build script: tsup's dts build forces
  // `baseUrl`, which TypeScript 6 deprecates and TypeScript 7 removes.
  dts: false,
  sourcemap: true,
  clean: ['dist/*.js', 'dist/*.map', 'dist/*.d.ts'],
  splitting: false,
  treeshake: true,
});
