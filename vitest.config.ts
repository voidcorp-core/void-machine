import { defineConfig } from 'vitest/config';
import { sharedVitestTestOptions } from './test/support/vitest-options.js';

// Vitest 5 inline projects inherit setup/isolation; root globalSetup runs once.
// https://vitest.dev/guide/projects · https://vitest.dev/config/sequence
const engine = ['packages/mission-engine/src/**/*.test.ts'];
const network = [
  'packages/cli/src/lib/ui/**/*.test.ts',
  'packages/void-machine/test/*daemon*.test.ts',
];

export default defineConfig({
  test: {
    ...sharedVitestTestOptions,
    projects: [
      {
        test: {
          name: 'engine', include: engine, maxWorkers: 4,
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: 'local',
          include: ['packages/**/*.test.ts', 'test/**/*.test.ts', 'apps/**/*.test.ts'],
          exclude: [...engine, ...network, '**/node_modules/**', '**/dist/**'],
          // Includes indirect subprocess fixtures: keep one heavy file at a time.
          maxWorkers: 1, sequence: { groupOrder: 1 },
        },
      },
      {
        test: {
          name: 'network', include: network, maxWorkers: 1, pool: 'threads',
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
