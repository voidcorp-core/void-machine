#!/usr/bin/env node
// Explicit generation, or read-only freshness checks before any build can repair delivery.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKS = [
  ['pnpm', 'hooks:check'],
  ['node', 'packages/cli/scripts/copy-core-assets.mjs', '--check'],
];
const BUILDS = [
  ['pnpm', 'build:cli'],
];
for (const [command, ...args] of process.argv.includes('--check') ? CHECKS : BUILDS) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
process.stdout.write(process.argv.includes('--check')
  ? 'derive:check — every delivery matches its sources.\n'
  : 'derive: assembled delivery.\n');
