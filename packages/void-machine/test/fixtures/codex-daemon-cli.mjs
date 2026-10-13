// Stands in for the `codex` CLI's daemon management: `app-server daemon version` prints the JSON
// the real one printed on 2026-09-29 (Codex 0.158.0), from a state file the test controls, and
// `app-server daemon start` marks that daemon running, or fails as asked. Every call is logged.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const statePath = process.env.FAKE_DAEMON_STATE ?? '';
const log = process.env.FAKE_DAEMON_LOG;
const args = process.argv.slice(2);
if (log !== undefined) appendFileSync(log, `${JSON.stringify(args)}\n`);
const state = JSON.parse(readFileSync(statePath, 'utf8'));

if (state.noDaemon === true) {
  // An older codex, which knows no daemon: clap refuses the subcommand with exit 2.
  process.stderr.write("error: unrecognized subcommand 'daemon'\n");
  process.exit(2);
}
if (args.join(' ') === 'app-server daemon version') {
  process.stdout.write(`${JSON.stringify({ status: state.status, backend: 'pid',
    managedCodexPath: '/home/user/.codex/packages/standalone/current/bin/codex', managedCodexVersion: state.server,
    socketPath: state.socketPath, cliVersion: state.cli,
    appServerVersion: state.status === 'running' ? state.server : null })}\n`);
  process.exit(0);
}
if (args.join(' ') === 'app-server daemon start') {
  if (state.startFails === true) {
    process.stderr.write('failed to start the app server daemon\n');
    process.exit(1);
  }
  writeFileSync(statePath, JSON.stringify({ ...state, status: 'running' }));
  process.exit(0);
}
process.stderr.write(`fake codex: unexpected arguments ${args.join(' ')}\n`);
process.exit(64);
