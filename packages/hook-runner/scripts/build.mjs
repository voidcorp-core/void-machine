#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHookRuntime } from './build-runtime.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, '..', '..');
const OUTPUT = resolve(REPOSITORY_ROOT, 'packages/core/hooks/_void-hook.mjs');

await buildHookRuntime({ root: REPOSITORY_ROOT, outfile: OUTPUT });
