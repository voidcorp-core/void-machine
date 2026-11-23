import {
  accessSync,
  constants,
  readFileSync,
} from 'node:fs';
import { delimiter, isAbsolute, join, relative } from 'node:path';
import type { JsonValue } from '@voidcorp/mission-engine/events';

export type Environment = Readonly<Record<string, string | undefined>>;

export interface LifecycleExecution {
  readonly status: 'ok' | 'skipped' | 'degraded';
  readonly details: { readonly [key: string]: JsonValue };
  readonly diagnostic?: string;
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function within(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function executable(path: string): boolean {
  try {
    accessSync(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findExecutable(
  name: string,
  root: string,
  env: Environment,
): string | undefined {
  if ((isAbsolute(name) || name.includes('/') || name.includes('\\')) && executable(name)) {
    return name;
  }
  const suffixes = process.platform === 'win32'
    ? ['', '.cmd', '.exe', '.bat']
    : [''];
  const local = join(root, 'node_modules', '.bin', name);
  for (const suffix of suffixes) {
    if (executable(`${local}${suffix}`)) return `${local}${suffix}`;
  }
  for (const directory of (env['PATH'] ?? '').split(delimiter)) {
    if (directory === '') continue;
    for (const suffix of suffixes) {
      const candidate = join(directory, `${name}${suffix}`);
      if (executable(candidate)) return candidate;
    }
  }
  return undefined;
}

export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}
