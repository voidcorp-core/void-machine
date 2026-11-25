#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { buildHookRuntime } from './build-runtime.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUTPUT = join(ROOT, 'packages/core/dist/hooks/_void-hook.mjs');
if (process.argv.includes('--check')) {
  const temporary = await mkdtemp(join(tmpdir(), 'hook-check-'));
  try {
    const expected = join(temporary, 'hook.mjs');
    await buildHookRuntime({ root: ROOT, outfile: expected });
    if (!(await readFile(expected)).equals(await readFile(OUTPUT))) {
      throw new Error('Stale hook delivery. Run pnpm derive.');
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
} else await buildHookRuntime({ root: ROOT, outfile: OUTPUT });
