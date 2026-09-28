// Stands in for `claude`: replays outputs captured from Claude Code 2.1.283 on 2026-09-28.
// Paths in the captures were replaced by /work/...; shapes, states and messages are verbatim.
import { readFileSync } from 'node:fs';

const mode = process.argv[2] ?? '';
const read = (name) => readFileSync(new URL(`./claude-session/${name}`, import.meta.url), 'utf8');
const out = (name) => process.stdout.write(read(name));
const err = (name) => process.stderr.write(read(name));

switch (mode) {
  case 'version': out('version.stdout'); break;
  case 'version-old': process.stdout.write('2.1.256 (Claude Code)\n'); break;
  case 'dispatch': out('dispatch.stdout'); process.stderr.write('Starting background service…\n'); break;
  case 'dispatch-no-ack': process.stderr.write('Starting background service…\n'); break;
  case 'untrusted': err('untrusted.stderr'); process.exitCode = 1; break;
  case 'unknown-agent': out('unknown-agent.stdout'); err('unknown-agent.stderr'); break;
  case 'resume': out('resume.stdout'); err('resume.stderr'); break;
  case 'agents': out('agents.json'); break;
  case 'agents-garbage': process.stdout.write('[{"id": '); break;
  case 'agents-fail': process.stderr.write('error: unknown option\n'); process.exitCode = 1; break;
  case 'stop': out('stop.stdout'); break;
  case 'hang': setInterval(() => undefined, 1_000); break;
  default: process.stderr.write(`fixture: unknown mode ${mode}\n`); process.exitCode = 64;
}
