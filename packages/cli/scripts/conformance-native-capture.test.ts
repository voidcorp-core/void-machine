// @test-resource subprocess
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const load = () => import('./conformance-native-capture.mjs');
const target = { pid: 100, parentPid: 80, beforeUtcMs: 200, afterUtcMs: 210 };
const events = [
  { kind: 'start', pid: 100, parentPid: 80, name: 'powershell.exe', utcMs: 205 },
  { kind: 'start', pid: 101, parentPid: 100, name: 'node.exe', utcMs: 300 },
  { kind: 'stop', pid: 101, parentPid: 100, name: 'node.exe', utcMs: 315, code: 37 },
];

it('keeps both idle input waits off the event-draining thread with one bounded pending read', () => {
  const source = readFileSync(new URL('./conformance-native-capture.ps1', import.meta.url), 'utf8');
  expect(source).not.toContain('[Console]::In.ReadLineAsync()');
  expect(source.match(/\$inputTask = \[CaptureInput\]::Read\(\)/g)).toHaveLength(2);
  expect(source).toContain('Task.Factory.StartNew');
  expect(source).toContain('TaskCreationOptions.LongRunning, TaskScheduler.Default');
  expect(source).toContain('line.Length >= 65536');
  expect(source).toContain('if ($inputTask.IsCompleted)');
  expect(source).toContain('$line=$inputTask.Result');
});

let observerCloseConfirmed = false;

// The real Console.In/WMI regression needs Windows; source contracts are not its substitute.
it.skipIf(process.platform !== 'win32')('drains real events with stdin open before and between requests', async () => {
  observerCloseConfirmed = false;
  const { conformanceEnvironment } = await import('./conformance-process.mjs');
  const env = conformanceEnvironment({ TEMP: process.env.TEMP, TMP: process.env.TMP });
  const script = fileURLToPath(new URL('./conformance-native-capture.ps1', import.meta.url));
  const { captureStartup, captureLifecycle } = await load();
  const startup = captureStartup();
  const startedAt = performance.now();
  const observer = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, '-Mode', 'Capture'],
    { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const processEvidence = captureLifecycle(observer, startedAt);
  const diagnostic = () => JSON.stringify({ startup: startup.snapshot(), process: processEvidence.snapshot() });
  const children: ReturnType<typeof spawn>[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      let phase = 'ready';
      let expectedPid: number | undefined;
      let started = false;
      let pending = '';
      let bytes = 0;
      const deadline = setTimeout(() => reject(new Error(`idle-input event delivery stalled: ${phase}; evidence=${diagnostic()}`)), 8000);
      const fail = (error: Error) => { clearTimeout(deadline); reject(error); };
      const produceEvent = () => {
        const child = spawn(process.execPath, ['-e', 'process.exitCode=37'], { env, stdio: 'ignore', windowsHide: true });
        children.push(child); expectedPid = child.pid; started = false;
        child.once('error', fail);
      };
      observer.once('error', fail);
      observer.stderr.on('data', () => fail(new Error(`native observer stderr; evidence=${diagnostic()}`)));
      observer.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 65536) { fail(new Error('native test output bound')); return; }
        pending += chunk.toString('utf8');
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
          try {
            const event = JSON.parse(line);
            if (event.kind === 'startup') {
              expect(phase).toBe('ready');
              expect(startup.add(event, Math.round(performance.now() - startedAt))).toBe(true);
            } else if (phase === 'ready' && event.kind === 'ready') { phase = 'first-idle'; produceEvent(); }
            else if (phase === 'request' && event.kind === 'unknown' && event.reason === 'identity-count') {
              phase = 'between-requests'; produceEvent();
            } else if (event.pid === expectedPid && event.kind === 'start') started = true;
            else if (event.pid === expectedPid && event.kind === 'stop') {
              expect(started).toBe(true);
              expect(event.code).toBe(37);
              if (phase === 'first-idle') {
                phase = 'request';
                // A rejected empty sample acknowledges consumption without any debugger attach.
                observer.stdin.write(`${JSON.stringify({ kind: 'sample', events: [] })}\n`);
              } else if (phase === 'between-requests') {
                phase = 'complete'; observer.stdin.end(`${JSON.stringify({ kind: 'stop' })}\n`);
              }
            }
          } catch (error) { fail(error instanceof Error ? error : new Error('invalid native test output')); }
        }
      });
      observer.once('close', code => {
        clearTimeout(deadline);
        if (phase === 'complete' && code === 0) resolve();
        else reject(new Error(`native observer exited ${code} during ${phase}; evidence=${diagnostic()}`));
      });
    });
  } finally {
    observer.stdin.end();
    if (observer.exitCode === null) observer.kill();
    for (const child of children) if (child.exitCode === null) child.kill();
    try {
      await processEvidence.waitForClose();
      observerCloseConfirmed = true;
    } catch {
      // Preserve the original regression failure; the control independently refuses.
      process.stderr.write('native observer close unconfirmed after 500ms; host control refused\n');
    }
  }
});

describe('bounded native capture correlation', () => {
  it('retains an already exited child from the prearmed queue without unrelated metadata', async () => {
    const { correlateCapture } = await load();
    const result = correlateCapture([
      { ...events[1], pid: 900, parentPid: 899, commandLine: 'private', env: 'secret' }, ...events,
    ], target, 190, false);
    expect(result).toEqual({ status: 'correlated', events, target, readyUtcMs: 190 });
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
    const { captureQueue, correlateCapture } = await load();
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

it('persists a bounded active snapshot before target completion so an outer timeout retains evidence', async () => {
  const { captureJournal } = await load();
  const directory = mkdtempSync(join(tmpdir(), 'native-journal-'));
  try {
    const journal = captureJournal(directory);
    await journal.write({ phase: 'active', status: 'correlated', events, snapshots: [] });
    expect(JSON.parse(readFileSync(join(directory, 'capture.json'), 'utf8')))
      .toMatchObject({ phase: 'active', status: 'correlated', events });
    await expect(journal.write({ text: 'x'.repeat(3 * 1024 * 1024) })).rejects.toThrow(/bound/);
    expect(JSON.parse(readFileSync(join(directory, 'capture.json'), 'utf8')).phase).toBe('active');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it('receives actual spawn identity before stderr without affecting stdin or the original exit', async () => {
  const { runConformanceProcess } = await import('./conformance-process.mjs');
  const observations: Array<{ kind: string; pid?: number; beforeUtcMs?: number; afterUtcMs?: number }> = [];
  const result = await runConformanceProcess({ command: process.execPath, cwd: process.cwd(),
    args: ['-e', "process.stderr.write('observed');process.stdin.resume();process.stdin.on('end',()=>{process.exitCode=37})"],
    observeProcess: event => { observations.push(event); if (event.kind === 'stderr') throw new Error('observer only'); },
    report: () => {},
  });
  expect(observations[0]).toMatchObject({ kind: 'spawn', parentPid: process.pid });
  expect(observations[0]?.pid).toBeGreaterThan(0);
  expect(observations[0]?.afterUtcMs).toBeGreaterThanOrEqual(observations[0]?.beforeUtcMs ?? 0);
  expect(observations[1]).toMatchObject({ kind: 'stderr', text: 'observed' });
  expect(result).toMatchObject({ outcome: { kind: 'exited', code: 37 }, stderr: 'observed' });
});

it('keeps native collector scope, readiness and attach mode explicit without claiming local Windows execution', () => {
  const source = readFileSync(new URL('./conformance-native-capture.ps1', import.meta.url), 'utf8');
  expect(source.indexOf('$watch.Arm()')).toBeLessThan(source.indexOf("Emit @{ kind='ready'"));
  expect(source.indexOf('stop.Start();')).toBeLessThan(source.indexOf('start.Start();'));
  expect(source).toContain('if (admitted >= 256)');
  expect(source).toContain('Win32_ProcessStopTrace');
  expect(source).toContain('-pvr -pd -sins -noshell -netsyms no');
  expect(source).toContain('process.WaitForExit(5000)');
  expect(source).toContain('$rounds -lt 2');
  expect(source).not.toMatch(/Get-Process\s*$|CommandLine|[\x27\x22;]\.dump|[\x27\x22;]\.kill|\.closehandle|Invoke-WebRequest|ExecutionPolicy|Start-Sleep/mi);
});

it('correlates precise OS ticks within the millisecond spawn interval without accepting invalid intervals', async () => {
  const { correlateCapture } = await load();
  const precise = [{ ...events[0], utcMs: 210.25 }, events[1], events[2]];
  expect(correlateCapture(precise, target, 190, false)).toMatchObject({ status: 'correlated' });
  expect(correlateCapture(events, { ...target, beforeUtcMs: Number.NaN }, 190, false))
    .toMatchObject({ status: 'unknown', events: [] });
});


it('passes only the SDK location needed by the observer, without inherited credentials', async () => {
  const { captureTool } = await load();
  vi.stubEnv('ProgramFiles(x86)', 'C:/synthetic-sdk');
  vi.stubEnv('SYNTHETIC_CREDENTIAL', 'must-not-reach-observer');
  try {
    const result = await captureTool(process.execPath, ['-e',
      'process.stdout.write(JSON.stringify({sdk:process.env["ProgramFiles(x86)"],credential:process.env.SYNTHETIC_CREDENTIAL}))'],
    { timeoutMs: 1000, maxBytes: 1024 });
    expect(JSON.parse(result.text)).toEqual({ sdk: 'C:/synthetic-sdk' });
  } finally { vi.unstubAllEnvs(); }
});


describe('bounded observer startup evidence', () => {
  it('retains each reached boundary without claiming readiness or copying arbitrary fields', async () => {
    const { captureStartup } = await load();
    const startup = captureStartup();
    expect(startup.snapshot()).toEqual([]);
    for (const [index, stage] of ['script-entered', 'encoding-before', 'encoding-after', 'emit-before',
      'compile-types', 'emit-after', 'create-watchers', 'arm-stop', 'arm-start'].entries()) {
      expect(startup.add({ kind: 'startup', stage, privateText: 'must-not-export' }, index * 10)).toBe(true);
    }
    expect(startup.snapshot()).toEqual([
      { stage: 'script-entered', receivedMs: 0 }, { stage: 'encoding-before', receivedMs: 10 },
      { stage: 'encoding-after', receivedMs: 20 }, { stage: 'emit-before', receivedMs: 30 },
      { stage: 'compile-types', receivedMs: 40 }, { stage: 'emit-after', receivedMs: 50 },
      { stage: 'create-watchers', receivedMs: 60 }, { stage: 'arm-stop', receivedMs: 70 },
      { stage: 'arm-start', receivedMs: 80 },
    ]);
    expect(JSON.stringify(startup.snapshot())).not.toMatch(/must-not-export|ready/);
    expect(startup.add({ kind: 'startup', stage: 'arm-start' }, 90)).toBe(false);
    expect(startup.snapshot()).toHaveLength(9);
  });

  it('requires each encoding and first serialization boundary in execution order', async () => {
    const { captureStartup } = await load();
    const startup = captureStartup();
    expect(startup.add({ kind: 'startup', stage: 'script-entered' }, 0)).toBe(true);
    for (const [required, premature] of [
      ['encoding-before', 'encoding-after'], ['encoding-after', 'emit-before'],
      ['emit-before', 'compile-types'], ['compile-types', 'emit-after'], ['emit-after', 'create-watchers'],
    ]) {
      expect(startup.add({ kind: 'startup', stage: premature }, 1)).toBe(false);
      expect(startup.add({ kind: 'startup', stage: required }, 1)).toBe(true);
      expect(startup.add({ kind: 'startup', stage: required }, 1)).toBe(false);
    }
    expect(startup.snapshot().at(-1)).toEqual({ stage: 'emit-after', receivedMs: 1 });
  });

  it('refuses unknown, repeated, out-of-order and nonmonotonic startup evidence', async () => {
    const { captureStartup } = await load();
    const startup = captureStartup();
    for (const record of [undefined, { kind: 'startup', stage: 'secret-path' },
      { kind: 'startup', stage: 'compile-types' }, { kind: 'ready', stage: 'script-entered' }]) {
      expect(startup.add(record, 1)).toBe(false);
    }
    expect(startup.add({ kind: 'startup', stage: 'script-entered' }, Number.NaN)).toBe(false);
    expect(startup.add({ kind: 'startup', stage: 'script-entered' }, -1)).toBe(false);
    expect(startup.snapshot()).toEqual([]);
    expect(startup.add({ kind: 'startup', stage: 'script-entered' }, 2)).toBe(true);
    expect(startup.add({ kind: 'startup', stage: 'script-entered' }, 3)).toBe(false);
    expect(startup.add({ kind: 'startup', stage: 'encoding-before' }, 1)).toBe(false);
    expect(startup.snapshot()).toEqual([{ stage: 'script-entered', receivedMs: 2 }]);
  });
});


describe('observer process evidence before readiness', () => {
  it('observes immediate output and exit without a ready message or exporting content', async () => {
    const { captureLifecycle } = await load();
    expect(captureLifecycle).toBeTypeOf('function');
    const child = spawn(process.execPath, ['-e', "process.stdout.write('private-out');process.stderr.write('private-err');process.exitCode=37"],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    const evidence = captureLifecycle(child, performance.now());
    await new Promise<void>(resolve => child.once('close', () => resolve()));
    const snapshot = evidence.snapshot();
    expect(snapshot.pid).toBe(child.pid);
    expect(snapshot.spawnMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.stdout).toMatchObject({ bytes: 11 });
    expect(snapshot.stderr).toMatchObject({ bytes: 11 });
    expect(snapshot.stdout.firstMs).toBeGreaterThanOrEqual(snapshot.spawnMs);
    expect(snapshot.exit).toMatchObject({ code: 37 });
    expect(snapshot.close).toMatchObject({ code: 37 });
    expect(snapshot.close.atMs).toBeGreaterThanOrEqual(snapshot.exit.atMs);
    expect(JSON.stringify(snapshot)).not.toMatch(/private-out|private-err/);
  });

  it('observes a launch error before readiness without claiming a successful spawn', async () => {
    const { captureLifecycle } = await load();
    expect(captureLifecycle).toBeTypeOf('function');
    const directory = mkdtempSync(join(tmpdir(), 'native-missing-executable-'));
    try {
      const child = spawn(join(directory, 'absent-executable'), [], { stdio: ['pipe', 'pipe', 'pipe'] });
      const evidence = captureLifecycle(child, performance.now());
      await new Promise<void>(resolve => child.once('close', () => resolve()));
      expect(evidence.snapshot()).toMatchObject({ error: { code: 'ENOENT' }, stdout: { bytes: 0 }, stderr: { bytes: 0 } });
      expect(evidence.snapshot().spawnMs).toBeUndefined();
      expect(JSON.stringify(evidence.snapshot())).not.toContain(directory);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('saturates counters without retaining output or altering the child outcome', async () => {
    const { captureLifecycle } = await load();
    expect(captureLifecycle).toBeTypeOf('function');
    const child = spawn(process.execPath, ['-e', "process.stdout.write('x'.repeat(100000));process.exitCode=37"],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    const evidence = captureLifecycle(child, performance.now());
    await new Promise<void>(resolve => child.once('close', () => resolve()));
    expect(evidence.snapshot().stdout).toMatchObject({ bytes: 65537 });
    expect(evidence.snapshot().close).toMatchObject({ code: 37 });
    expect(Buffer.byteLength(JSON.stringify(evidence.snapshot()))).toBeLessThan(1024);
  });
});


// Runs after the original observer, never as its warmup. This is a host control,
// not consumer qualification or a benchmark: prior cache state remains a limit.
it.skipIf(process.platform !== 'win32')('reports a minimal File host control with the same open input contract', async () => {
  if (!observerCloseConfirmed) throw new Error('native host control refused: observer close not confirmed');
  const { conformanceEnvironment } = await import('./conformance-process.mjs');
  const { captureLifecycle } = await load();
  const directory = mkdtempSync(join(tmpdir(), 'native-host-control-'));
  const script = join(directory, 'control.ps1');
  writeFileSync(script, `param([ValidateSet('Preflight','Capture')][string]$Mode,
      [string]$Cdb, [string]$SymbolCache)
[Console]::Out.WriteLine('native-host-control')
exit 0
`);
  const env = conformanceEnvironment({ TEMP: process.env.TEMP, TMP: process.env.TMP });
  const startedAt = performance.now();
  const control = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, '-Mode', 'Capture'],
    { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const evidence = captureLifecycle(control, startedAt);
  let output = '';
  try {
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`native host control stalled; evidence=${JSON.stringify(evidence.snapshot())}`)), 8000);
      const fail = () => { clearTimeout(deadline); reject(new Error(`native host control failed; evidence=${JSON.stringify(evidence.snapshot())}`)); };
      control.once('error', fail);
      control.stderr.on('data', fail);
      control.stdout.on('data', chunk => {
        if (Buffer.byteLength(output) + chunk.length > 64) { fail(); return; }
        output += chunk.toString('utf8');
      });
      control.once('close', code => {
        clearTimeout(deadline);
        if (code === 0 && output.trim() === 'native-host-control') resolve();
        else fail();
      });
    });
  } finally {
    control.stdin.end();
    if (control.exitCode === null && control.signalCode === null) control.kill();
    // Bounded cleanup only, after the unchanged observation deadline. Report a
    // retained fixture explicitly rather than replacing the primary failure.
    await new Promise<void>(resolve => {
      if (evidence.snapshot().close !== undefined) { resolve(); return; }
      const deadline = setTimeout(resolve, 500);
      control.once('close', () => { clearTimeout(deadline); resolve(); });
    });
    try { rmSync(directory, { recursive: true, force: true }); }
    catch { process.stderr.write('native host control cleanup incomplete\n'); }
    process.stdout.write(`${JSON.stringify({ nativeHostControl: evidence.snapshot() })}\n`);
  }
});


describe('observer closure admission', () => {
  it('refuses after 500ms when exit occurs without close', async () => {
    const { captureLifecycle } = await load();
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    const evidence = captureLifecycle(child, performance.now());
    expect(evidence.waitForClose).toBeTypeOf('function');
    vi.useFakeTimers();
    try {
      const closed = evidence.waitForClose();
      const refused = expect(closed).rejects.toThrow('native observer close unconfirmed after 500ms; host control refused');
      child.emit('exit', 0);
      await vi.advanceTimersByTimeAsync(500);
      await refused;
      expect(child.listenerCount('close')).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it('admits only after observed close and accepts close already recorded', async () => {
    const { captureLifecycle } = await load();
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    const evidence = captureLifecycle(child, performance.now());
    expect(evidence.waitForClose).toBeTypeOf('function');
    vi.useFakeTimers();
    try {
      let admitted = false;
      const closed = evidence.waitForClose().then(() => { admitted = true; });
      child.emit('exit', 0);
      await vi.advanceTimersByTimeAsync(499);
      expect(admitted).toBe(false);
      child.emit('close', 0);
      await closed;
      expect(admitted).toBe(true);
      await expect(evidence.waitForClose()).resolves.toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
      expect(child.listenerCount('close')).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
