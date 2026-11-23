import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Node 24 listen/error/close semantics: https://nodejs.org/docs/latest-v24.x/api/net.html
const PROBE = `
import { createServer, createConnection } from 'node:net';
const server = createServer(socket => socket.end('ready'));
const fail = error => {
  process.stderr.write(error.code || 'CONNECTION_FAILED');
  process.exitCode = 1;
  server.close();
};
server.on('error', fail);
server.listen(0, '127.0.0.1', () => {
  const client = createConnection(server.address().port, '127.0.0.1');
  let received = '';
  client.on('error', fail);
  client.on('data', chunk => { received += chunk; });
  client.on('end', () => {
    if (received !== 'ready') process.exitCode = 1;
    server.close();
  });
});
`;

function unavailable(label, result) {
  const diagnostic = result.error?.code ?? result.stderr?.trim() ?? result.signal;
  const reason = /^[A-Z][A-Z0-9_]{0,63}$/.test(diagnostic ?? '')
    ? diagnostic : 'PROCESS_FAILED';
  return { status: 'unknown', exitCode: 2, reason: `${label}: ${reason}` };
}

/** One capability probe, then one bounded lane. No retry or success on absence. */
export function runNetworkLane(execute = spawnSync, args = []) {
  // Only certification ordering may vary; callers cannot override lane safety.
  // Vitest 5.0.1: https://vitest.dev/config/sequence
  const seen = new Set();
  for (const argument of args) {
    const seed = /^--sequence.seed=([1-9][0-9]*)$/.exec(argument);
    const option = argument === '--sequence.shuffle' ? 'shuffle' : seed ? 'seed' : undefined;
    if (!option || seen.has(option) || (seed && Number(seed[1]) > 2_147_483_647)) {
      return { status: 'unknown', exitCode: 2, reason: 'unsupported network lane arguments' };
    }
    seen.add(option);
  }
  const probe = execute(process.execPath, ['--input-type=module', '-e', PROBE], {
    encoding: 'utf8', shell: false, timeout: 2_000, killSignal: 'SIGKILL', maxBuffer: 4_096,
  });
  if (probe.error || probe.status !== 0) return unavailable('loopback unavailable', probe);
  const tests = execute(process.execPath, [
    fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
    // Threads die with the bounded parent; a timed-out fork can outlive it.
    // Vitest 5: https://vitest.dev/config/pool.html
    'run', '--project=*:network-browser', '--maxWorkers=1', '--pool=threads', ...args,
  ], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'inherit', shell: false, timeout: 120_000, killSignal: 'SIGKILL',
  });
  if (tests.error || !Number.isInteger(tests.status)) {
    return unavailable('network test process unavailable', tests);
  }
  return { status: tests.status === 0 ? 'passed' : 'failed', exitCode: tests.status === 0 ? 0 : 1 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runNetworkLane(spawnSync, process.argv.slice(2));
  process.stdout.write(`${JSON.stringify({ lane: 'network-browser', ...result })}\n`);
  process.exitCode = result.exitCode;
}
