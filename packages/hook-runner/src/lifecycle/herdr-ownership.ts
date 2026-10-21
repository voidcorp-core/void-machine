// tdd-cover: e2e packages/hook-runner/src/lifecycle/herdr-bootstrap.test.ts
import * as z from 'zod/mini';
import { record } from './executor-shared.js';

const discoverySchema = z.object({ result: z.object({ process_info: z.object({
  pane_id: z.string(), foreground_processes: z.array(z.object({
    pid: z.number().check(z.int(), z.minimum(2)),
  })).check(z.minLength(1), z.maxLength(256)),
}) }) });

export function foreground(output: Buffer, pane: string): readonly number[] | undefined {
  try {
    const value: unknown = JSON.parse(output.toString('utf8'));
    if (record(value)?.['error'] !== undefined) return undefined;
    const result = discoverySchema.safeParse(value);
    if (!result.success || result.data.result.process_info.pane_id !== pane) return undefined;
    return result.data.result.process_info.foreground_processes.map(item => item.pid);
  } catch { return undefined; }
}

export function proveOwnership(
  pids: readonly number[], call: (command: string, args: readonly string[]) => Buffer,
): string | undefined {
  let pid = process.pid;
  const visited = new Set<number>();
  for (let depth = 0; depth < 64; depth++) {
    if (visited.has(pid)) return 'parent-cycle';
    visited.add(pid);
    if (pids.includes(pid)) return undefined;
    const parent = call('ps', ['-o', 'ppid=', '-p', String(pid)]).toString('utf8').trim();
    if (!/^[0-9]+$/.test(parent) || !Number.isSafeInteger(Number(parent))) return 'invalid-parent';
    pid = Number(parent);
    if (pid <= 1) return 'ownership-unproven';
  }
  return 'parent-depth-exceeded';
}

