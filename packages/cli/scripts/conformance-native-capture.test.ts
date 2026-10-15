// @test-resource subprocess
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const load = () => import('./conformance-native-capture.mjs');
const target = { pid: 100, parentPid: 80, beforeUtcMs: 200, afterUtcMs: 210 };
const events = [
  { kind: 'start', pid: 100, parentPid: 80, name: 'powershell.exe', utcMs: 205 },
  { kind: 'start', pid: 101, parentPid: 100, name: 'node.exe', utcMs: 300 },
  { kind: 'stop', pid: 101, parentPid: 100, name: 'node.exe', utcMs: 315, code: 37 },
];

describe('bounded native capture correlation', () => {
  it('retains an already exited child from the prearmed queue without unrelated metadata', async () => {
    const { correlateCapture } = await load();
    const result = correlateCapture([
      { ...events[1], pid: 900, parentPid: 899, commandLine: 'private', env: 'secret' }, ...events,
    ], target, 190, false);
    expect(result).toEqual({ status: 'correlated', events });
    expect(JSON.stringify(result)).not.toMatch(/private|secret|900|commandLine/);
  });

  it.each([
    ['overflow', events, target, 190, true],
    ['late readiness', events, target, 201, false],
    ['missing shim creation', events.slice(1), target, 190, false],
    ['wrong parent', events, { ...target, parentPid: 79 }, 190, false],
    ['creation interval mismatch', events, { ...target, afterUtcMs: 204 }, 190, false],
    ['reused shim PID', [...events, { ...events[0], utcMs: 400 }], target, 190, false],
    ['reused child PID', [...events, { ...events[1], utcMs: 400 }], target, 190, false],
    ['missing child start', [events[0], events[2]], target, 190, false],
    ['stop before start', [events[0], events[1], { ...events[2], utcMs: 290 }], target, 190, false],
    ['multiple children', [...events, { ...events[1], pid: 102 }], target, 190, false],
  ])('reports %s as UNKNOWN, never absent or successful qualification', async (_name, input, identity, ready, overflow) => {
    const { correlateCapture } = await load();
    expect(correlateCapture(input, identity, ready, overflow)).toMatchObject({ status: 'unknown', events: [] });
  });

  it('does not interpret a missing stop as proof the process is live', async () => {
    const { correlateCapture } = await load();
    expect(correlateCapture(events.slice(0, 2), target, 190, false)).toMatchObject({ status: 'incomplete' });
  });

  it('bounds the metadata queue, stops admitting records on overflow and exports no unrelated record', async () => {
    const { captureQueue } = await load();
    const queue = captureQueue();
    for (let index = 0; index < 300; index++) queue.add({ ...events[1], pid: index + 1000 });
    expect(queue.snapshot().events).toHaveLength(256);
    expect(queue.snapshot().overflow).toBe(true);
    expect(correlateCapture(queue.snapshot().events, target, 190, queue.snapshot().overflow))
      .toEqual({ status: 'unknown', events: [] });
  });

  it('rejects unbounded or malformed records before storing them', async () => {
    const { captureQueue } = await load();
    const queue = captureQueue();
    queue.add({ ...events[1], pid: -1, payload: 'x'.repeat(10000) });
    expect(queue.snapshot()).toEqual({ events: [], overflow: true });
  });
});

describe('capture coordination is independent of the target outcome', () => {
  it('awaits readiness before exactly one unchanged target invocation and preserves its raw failure', async () => {
    const { withNativeCapture } = await load();
    const order: string[] = [];
    const options = { command: 'powershell.exe', args: ['-File', 'shim.ps1', '--version'], env: { PATH: 'fixture' }, input: undefined };
    const failure = { outcome: { kind: 'timed-out' }, stdout: 'original stdout', stderr: 'original stderr' };
    const session = {
      observe: () => { order.push('observe'); },
      finish: async () => { order.push('finish'); throw new Error('collector failed'); },
    };
    const result = await withNativeCapture(options, async actual => {
      order.push('target');
      expect(actual.args).toBe(options.args);
      expect(actual.env).toBe(options.env);
      expect(actual.input).toBeUndefined();
      expect(actual.timeoutMs).toBeUndefined();
      actual.observeProcess({ kind: 'spawn', ...target });
      return failure;
    }, async () => { order.push('armed'); return session; });
    expect(result).toBe(failure);
    expect(order).toEqual(['armed', 'target', 'observe', 'finish']);
  });

  it('preserves a thrown primary error when capture cleanup also fails', async () => {
    const { withNativeCapture } = await load();
    const primary = new Error('primary');
    await expect(withNativeCapture({}, async () => { throw primary; }, async () => ({
      observe: () => {}, finish: async () => { throw new Error('cleanup'); },
    }))).rejects.toBe(primary);
  });

  it('still executes the original command once if native capability/readiness fails', async () => {
    const { withNativeCapture } = await load();
    let calls = 0;
    const outcome = { outcome: { kind: 'exited', code: 37 }, stdout: 'same', stderr: '' };
    await expect(withNativeCapture({}, async () => { calls++; return outcome; }, async () => {
      throw new Error('readiness unavailable');
    })).resolves.toBe(outcome);
    expect(calls).toBe(1);
  });

  it('bounds a real observer subprocess without killing or changing the separately owned target', async () => {
    const { captureTool } = await load();
    const result = await captureTool(process.execPath, ['-e', 'process.stdout.write("x".repeat(5000));setInterval(()=>{},1000)'],
      { timeoutMs: 1000, maxBytes: 64 });
    expect(result.status).toBe('output-exceeded');
    expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(64);
  });

  it('retains actual observer exit instead of treating every completion as success', async () => {
    const { captureTool } = await load();
    expect(await captureTool(process.execPath, ['-e', 'process.exitCode=37'], { timeoutMs: 1000, maxBytes: 64 }))
      .toMatchObject({ status: 'exited', code: 37 });
  });

  it('exports only bounded stack and handle metadata, without memory, environment or private paths', async () => {
    const { sanitizeCapture } = await load();
    const raw = 'ntdll!NtWaitForSingleObject+0x14\nName C:\\private\\secret.txt\nName \\Device\\NamedPipe\\fixture-1\nBearer sensitive\nTOKEN=credential\n';
    const result = sanitizeCapture(raw);
    expect(result).toContain('ntdll!NtWaitForSingleObject');
    expect(result).toContain('NamedPipe');
    expect(result).not.toMatch(/secret.txt|sensitive|credential|C:\\private/);
    expect(Buffer.byteLength(sanitizeCapture('x'.repeat(300000)))).toBeLessThanOrEqual(256 * 1024);
  });

  it('writes failed preflight as bounded metadata without requiring a real Windows installation', async () => {
    const { writePreflight } = await load();
    const directory = mkdtempSync(join(tmpdir(), 'native-capture-'));
    try {
      await writePreflight(directory, async () => ({ status: 'exited', code: 1, text: 'TOKEN=secret' }));
      const result = JSON.parse(readFileSync(join(directory, 'preflight.json'), 'utf8'));
      expect(result.available).toBe(false);
      expect(JSON.stringify(result)).not.toContain('secret');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
