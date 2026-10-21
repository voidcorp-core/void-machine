// Disposable Windows diagnostics only. Never a replacement for consumer qualification.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { conformanceEnvironment } from './conformance-process.mjs';

const SCRIPT = fileURLToPath(new URL('./conformance-native-capture.ps1', import.meta.url));
const MAX_EVENTS = 256;
const MAX_TEXT = 256 * 1024;
const MAX_TOTAL = 2 * 1024 * 1024;
const TOOL_ENV = () => conformanceEnvironment({ TEMP: process.env.TEMP, TMP: process.env.TMP,
  'ProgramFiles(x86)': process.env['ProgramFiles(x86)'] });
const report = status => process.stdout.write(`${JSON.stringify({ nativeCapture: status })}\n`);

// Fixed boundaries only: the last record identifies the operation entered,
// never readiness, a process identity, or successful consumer qualification.
export function captureStartup() {
  const names = ['script-entered', 'compile-types', 'create-watchers', 'arm-stop', 'arm-start'];
  const stages = [];
  return {
    add(event, receivedMs) {
      if (event?.kind !== 'startup' || stages.length >= names.length || event.stage !== names[stages.length]
        || !Number.isFinite(receivedMs) || receivedMs < (stages.at(-1)?.receivedMs ?? 0)) return false;
      stages.push({ stage: event.stage, receivedMs });
      return true;
    },
    snapshot: () => stages.map(stage => ({ ...stage })),
  };
}

function metadata(event) {
  if (!event || !['start', 'stop'].includes(event.kind)
    || !Number.isSafeInteger(event.pid) || event.pid <= 0
    || !Number.isSafeInteger(event.parentPid) || event.parentPid <= 0
    || !['node.exe', 'powershell.exe'].includes(event.name)
    || !Number.isFinite(event.utcMs)
    || (event.kind === 'stop' && !Number.isSafeInteger(event.code))) return undefined;
  return { kind: event.kind, pid: event.pid, parentPid: event.parentPid,
    name: event.name, utcMs: event.utcMs, ...(event.kind === 'stop' ? { code: event.code } : {}) };
}

export function captureQueue() {
  const events = [];
  let overflow = false;
  return {
    add(value) {
      const event = metadata(value);
      if (!event || events.length >= MAX_EVENTS) overflow = true;
      if (!overflow) events.push(event);
    },
    snapshot: () => ({ events: [...events], overflow }),
  };
}

export function correlateCapture(input, target, readyUtcMs, overflow) {
  const unknown = { status: 'unknown', events: [] };
  if (overflow || !target || !Number.isFinite(readyUtcMs)
    || !Number.isFinite(target.beforeUtcMs) || !Number.isFinite(target.afterUtcMs)
    || target.afterUtcMs < target.beforeUtcMs || readyUtcMs > target.beforeUtcMs) return unknown;
  const events = input.map(metadata).filter(Boolean);
  const shim = events.filter(event => event.kind === 'start' && event.pid === target.pid);
  if (shim.length !== 1 || shim[0].parentPid !== target.parentPid || shim[0].name !== 'powershell.exe'
    || shim[0].utcMs < target.beforeUtcMs || shim[0].utcMs >= target.afterUtcMs + 1) return unknown;
  const children = events.filter(event => event.kind === 'start' && event.parentPid === target.pid);
  if (children.length !== 1 || children[0].name !== 'node.exe' || children[0].utcMs < shim[0].utcMs) return unknown;
  const child = children[0];
  if (events.filter(event => event.kind === 'start' && event.pid === child.pid).length !== 1) return unknown;
  const selected = events.filter(event => event.pid === target.pid || event.pid === child.pid);
  for (const start of [shim[0], child]) {
    const stops = selected.filter(event => event.kind === 'stop' && event.pid === start.pid);
    if (stops.length > 1 || stops.some(event => event.utcMs < start.utcMs
      || event.parentPid !== start.parentPid || event.name !== start.name)) return unknown;
  }
  selected.sort((left, right) => left.utcMs - right.utcMs);
  return { status: selected.some(event => event.kind === 'stop' && event.pid === child.pid)
    ? 'correlated' : 'incomplete', events: selected, readyUtcMs,
    target: { pid: target.pid, parentPid: target.parentPid,
      beforeUtcMs: target.beforeUtcMs, afterUtcMs: target.afterUtcMs } };
}

export function sanitizeCapture(value) {
  // No raw strings, parameters, locals or environment commands are requested from CDB.
  // Permit only stack/handle metadata lines; discard banners, errors and arbitrary text.
  return Buffer.from(String(value).split('\n').filter(line =>
    !/Bearer|token\s*=|secret\s*=|password\s*=/i.test(line)
    && (/^[\s\da-f`]+.*(?:!|\b(?:System\.|Microsoft\.|ntdll|KERNELBASE|kernel32|clr|node)\b)/i.test(line)
      || /^[\s]*(?:ntdll|KERNELBASE|kernel32|clr|node)!/.test(line)
      || /^\s*(?:Handle\b|Type\b|Attributes\b|GrantedAccess\b|HandleCount\b|PointerCount\b|Object Specific|No object specific|[\da-f]+:\s)/i.test(line)
      || /^\s*Name\s+.*\\Device\\NamedPipe\\[\w.\\-]+\s*$/i.test(line)))
    .join('\n')).subarray(0, MAX_TEXT).toString('utf8');
}

export function captureTool(command, args, { timeoutMs = 5000, maxBytes = MAX_TEXT } = {}) {
  return new Promise(resolveTool => {
    const child = spawn(command, args, { env: TOOL_ENV(), shell: false, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'] });
    let text = Buffer.alloc(0);
    let forced;
    let finished = false;
    let reap;
    const finish = (status, code) => {
      if (finished) return;
      finished = true; clearTimeout(timer); clearTimeout(reap);
      resolveTool({ status: forced ?? status, code, text: text.toString('utf8') });
    };
    const stop = reason => {
      if (forced) return;
      forced = reason;
      child.kill('SIGKILL'); // This is only our observer, never the target or its tree.
      reap = setTimeout(() => finish('termination-unobserved'), 500);
    };
    const timer = setTimeout(() => stop('timed-out'), timeoutMs);
    const collect = chunk => {
      const room = Math.max(0, maxBytes - text.length);
      text = Buffer.concat([text, chunk.subarray(0, room)]);
      if (chunk.length > room) stop('output-exceeded');
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', () => finish('spawn-error'));
    child.once('close', code => finish('exited', code));
  });
}

export function captureJournal(directory) {
  let pending;
  let draining;
  const path = join(directory, 'capture.json');
  const drain = async () => {
    while (pending !== undefined) {
      const bytes = pending; pending = undefined;
      await writeFile(`${path}.tmp`, bytes);
      await rename(`${path}.tmp`, path);
    }
  };
  return { async write(proof) {
    const bytes = Buffer.from(`${JSON.stringify(proof)}\n`);
    if (bytes.length > MAX_TOTAL) throw new Error('capture-output-bound');
    pending = bytes;
    if (!draining) draining = drain().finally(() => { draining = undefined; });
    await draining;
  } };
}

export async function writePreflight(directory, run = captureTool) {
  await mkdir(directory, { recursive: true });
  const started = performance.now();
  const result = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', SCRIPT, '-Mode', 'Preflight'],
    { timeoutMs: 10000, maxBytes: 64 * 1024 });
  let capability;
  try { capability = JSON.parse(result.text.trim()); } catch { /* Unavailable is explicit below. */ }
  const available = result.status === 'exited' && result.code === 0 && capability?.available === true;
  const symbolCache = join(directory, 'symbols');
  // Offline capture only: exported native names and matching installed SOS.
  // Missing PDBs remain an attribution limit, never fetched during the target.
  if (available) await mkdir(symbolCache, { recursive: true });
  const proof = { available, sourceSha: /^[0-9a-f]{40}$/.test(process.env.GATE_SHA ?? '')
    ? process.env.GATE_SHA : undefined, node: process.version, platform: process.platform, arch: process.arch,
    status: result.status, code: result.code,
    durationMs: Math.round(performance.now() - started),
    ...(available ? { capability, symbolCache } : {}) };
  await writeFile(join(directory, 'preflight.json'), `${JSON.stringify(proof)}\n`);
  return proof;
}

export async function withNativeCapture(options, execute, arm) {
  let session;
  let primaryOutcome;
  try { session = await arm(); } catch { report('unknown-readiness'); }
  try {
    const result = await execute(session ? { ...options, observeProcess: event => {
      try { session.observe(event); } catch { report('unknown-observer'); }
    } } : options);
    primaryOutcome = result.outcome;
    return result;
  } finally {
    try { await session?.finish(primaryOutcome); } catch { report('unknown-cleanup'); }
  }
}

export async function armNativeCapture(directory) {
  const preflight = JSON.parse(await readFile(join(directory, 'preflight.json'), 'utf8'));
  const journal = captureJournal(directory);
  if (!preflight.available) {
    await journal.write({ status: 'unknown', reason: 'preflight-unavailable', events: [], snapshots: [] });
    throw new Error('native-capture-unavailable');
  }
  const started = performance.now();
  const queue = captureQueue();
  const startup = captureStartup();
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', SCRIPT,
    '-Mode', 'Capture', '-Cdb', preflight.capability.cdb, '-SymbolCache', preflight.symbolCache],
  { env: TOOL_ENV(), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let readyUtcMs;
  let target;
  let unknown = false;
  let pending = '';
  let total = 0;
  let stderrBytes = 0;
  let lifecycle = '';
  let samples = 0;
  let done = false;
  let finishing = false;
  let readinessMs;
  let primaryOutcome;
  let closeResolve;
  const closed = new Promise(resolveClosed => { closeResolve = resolveClosed; });
  const timers = [];
  const snapshots = [];
  let readyResolve;
  const ready = new Promise(resolveReady => { readyResolve = resolveReady; });
  const stop = () => { if (!done) { done = true; child.kill('SIGKILL'); } };
  const send = message => { if (!done) child.stdin.write(`${JSON.stringify(message)}\n`); };
  const deadline = setTimeout(() => { unknown = true; stop(); }, 120000);
  const readiness = setTimeout(() => { unknown = true; readyResolve(false); stop(); }, 10000);
  child.stdin.on('error', () => { unknown = true; });
  child.stderr.on('data', chunk => { stderrBytes += chunk.length; unknown = true; if (stderrBytes > 65536) stop(); });
  child.once('error', () => { unknown = true; readyResolve(false); });
  child.once('close', () => {
    if (!finishing) unknown = true;
    done = true; readyResolve(false); closeResolve(); persist();
  });
  const persist = (phase = 'active') => {
    const state = queue.snapshot();
    const correlation = correlateCapture(state.events, target, readyUtcMs, unknown || state.overflow);
    return journal.write({ ...correlation, phase, readinessMs, startup: startup.snapshot(),
      durationMs: Math.round(performance.now() - started),
      snapshots: correlation.status === 'unknown' ? [] : snapshots, unknown,
      queueOverflow: state.overflow, observerBytes: total, stderrBytes, primaryOutcome })
      .catch(() => { unknown = true; report('unknown-artifact-write'); });
  };
  const sample = () => {
    const state = queue.snapshot();
    const correlation = correlateCapture(state.events, target, readyUtcMs, unknown || state.overflow);
    if (correlation.status === 'unknown') return;
    send({ kind: 'sample', target, events: correlation.events });
  };
  child.stdout.on('data', chunk => {
    total += chunk.length;
    if (total > MAX_TOTAL || pending.length + chunk.length > 1024 * 1024) { unknown = true; stop(); return; }
    pending += chunk.toString('utf8');
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      try {
        const event = JSON.parse(line);
        if (event.kind === 'startup' && readyUtcMs === undefined) {
          if (!startup.add(event, Math.round(performance.now() - started))) unknown = true;
        } else if (event.kind === 'ready' && readyUtcMs === undefined && Number.isFinite(event.utcMs)) {
          readyUtcMs = event.utcMs; clearTimeout(readiness); readyResolve(true);
        } else if (event.kind === 'start' || event.kind === 'stop') queue.add(event);
        else if (event.kind === 'snapshot' && snapshots.length < 4
          && queue.snapshot().events.some(item => item.kind === 'start' && item.pid === event.pid
            && (item.pid === target?.pid || item.parentPid === target?.pid))) {
          snapshots.push({ pid: event.pid, utcMs: event.utcMs, status: event.status, code: event.code,
            identity: event.identity, reason: event.reason, text: sanitizeCapture(event.text), durationMs: event.durationMs });
        } else { unknown = true; }
      } catch { unknown = true; }
    }
    persist();
  });
  if (!await ready) {
    clearTimeout(deadline); clearTimeout(readiness); stop();
    await persist('readiness-failed'); throw new Error('capture-not-ready');
  }
  readinessMs = Math.round(performance.now() - started);
  await persist();
  report({ readinessMs });
  return {
    observe(event) {
      if (event.kind === 'spawn') { target = event; persist(); }
      if (event.kind === 'stderr' && samples === 0) {
        lifecycle = (lifecycle + event.text).slice(-8192);
        if (lifecycle.includes('"phase":"node-exit"')) {
          samples = 2;
          for (const delay of [5000, 15000]) timers.push(setTimeout(sample, delay));
        }
      }
    },
    async finish(outcome) {
      primaryOutcome = outcome;
      for (const timer of timers) clearTimeout(timer);
      clearTimeout(deadline); clearTimeout(readiness);
      finishing = true;
      send({ kind: 'stop' }); child.stdin.end();
      let stopTimer;
      await Promise.race([closed, new Promise(resolveStop => {
        stopTimer = setTimeout(() => { unknown = true; stop(); resolveStop(); }, 5500);
      })]);
      clearTimeout(stopTimer);
      await persist('complete');
      const bytes = await readFile(join(directory, 'capture.json'));
      await writeFile(join(directory, 'capture.sha256.txt'), `${createHash('sha256').update(bytes).digest('hex')}  capture.json\n`);
    },
  };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--preflight' || !process.argv[3]) throw new Error('native capture requires --preflight directory');
  try { await writePreflight(resolve(process.argv[3])); }
  catch { report('unknown-preflight'); }
}
