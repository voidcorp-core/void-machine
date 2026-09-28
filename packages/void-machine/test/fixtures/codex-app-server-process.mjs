// Stands in for `codex`: `--version`, and `app-server --listen unix://PATH`, which serves the
// JSON-RPC frames captured from Codex CLI 0.155.1 on 2026-09-28 (./codex-app-server/) over a
// WebSocket on a Unix socket, as the real one does. Frames are replayed verbatim with their
// ids rewritten; the scripts below only choose which captured frame answers each request.
// Synthetic frames (never captured) are marked so, and follow the 0.155.1 protocol types.
import { appendFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const mode = process.env.FAKE_CODEX_MODE ?? 'complete';
const log = process.env.FAKE_CODEX_LOG;
const read = (name) => JSON.parse(readFileSync(new URL(`./codex-app-server/${name}`, import.meta.url), 'utf8'));
const note = (entry) => { if (log !== undefined) appendFileSync(log, `${JSON.stringify(entry)}\n`); };

if (process.argv[2] === '--version') {
  process.stdout.write(`codex-cli ${process.env.FAKE_CODEX_VERSION ?? '0.155.1'}\n`);
  process.exit(0);
}
const listen = process.argv[3] === '--listen' ? process.argv[4] ?? '' : '';
if (process.argv[2] !== 'app-server' || !listen.startsWith('unix://')) {
  process.stderr.write('fake codex: unexpected arguments\n');
  process.exit(64);
}
if (mode === 'exit-at-start') process.exit(1);

const dispatch = read('dispatch.frames.json');
const captured = (id) => dispatch.frames.find((frame) => frame.id === id && frame.method === undefined);
const notifications = dispatch.frames.filter((frame) => frame.method !== undefined);
const reads = {
  inProgress: read('read-in-progress.json').result,
  completed: read('read-completed.json').result,
  secondCompleted: read('read-second-turn-completed.json').result,
};

// Synthetic: the in-progress read with the thread waiting on an approval (ThreadActiveFlag).
function waitingOnApproval() {
  const result = structuredClone(reads.inProgress);
  result.thread.status = { type: 'active', activeFlags: ['waitingOnApproval'] };
  return result;
}

let threadReads = 0;
let turnStarts = 0;
let connections = 0;

function answer(message) {
  switch (message.method) {
    case 'initialize': return { result: captured(1).result };
    case 'thread/start':
      return mode === 'fail-thread-start' ? { error: { code: -32600, message: 'model not available' } }
        : { result: captured(2).result, after: notifications.filter((frame) => frame.method !== 'remoteControl/status/changed') };
    case 'turn/start':
      turnStarts += 1;
      if (mode === 'hang-turn-start' && turnStarts === 1) return undefined;
      return { result: turnStarts === 1 ? captured(3).result : read('turn-start-second.json').result };
    case 'thread/read': {
      threadReads += 1;
      if (mode === 'approval') return { result: waitingOnApproval(), request: true };
      if (turnStarts >= 2) return { result: reads.secondCompleted };
      return { result: threadReads === 1 ? reads.inProgress : reads.completed };
    }
    case 'turn/steer': return { result: read('steer.json').result };
    case 'turn/interrupt': return { result: read('interrupt.json').result };
    default: return { error: { code: -32601, message: `unknown method ${message.method}` } };
  }
}

const server = createServer();
const sockets = new WebSocketServer({ server });
sockets.on('connection', (socket) => {
  connections += 1;
  const connection = connections;
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    note({ connection, message });
    if (message.id === undefined || message.method === undefined) return;
    const reply = answer(message);
    if (reply === undefined) return;
    // Synthetic: a server-initiated approval request, as item/commandExecution/requestApproval shapes it.
    if (reply.request === true) {
      const thread = reads.inProgress.thread;
      socket.send(JSON.stringify({ id: 900, method: 'item/commandExecution/requestApproval', params: {
        threadId: thread.id, turnId: thread.turns.at(-1).id, itemId: 'call_synthetic', command: 'rm -rf build' } }));
    }
    socket.send(JSON.stringify(reply.error === undefined ? { id: message.id, result: reply.result }
      : { id: message.id, error: reply.error }));
    for (const frame of reply.after ?? []) socket.send(JSON.stringify(frame));
  });
});
server.listen(listen.slice('unix://'.length));
