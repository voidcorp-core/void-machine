// `void-harness help` / no-args — the command reference, rendered through the
// shared render layer so the front door wears the same "void" identity as every
// other command (a plain template string used to read as an afterthought).

import { blank, brand, c, glyph, heading, termWidth } from '../lib/render.js';
import { CORE_PLUGIN_NAME, MARKETPLACE_REPO } from '../lib/packs.js';

const write = (s: string): void => void process.stdout.write(s);

/** Sign-post column: the command signature is padded to this before its description. */
const SIG = 26;

/** One command row: `  <sig>   <description…>` with the description wrapped + hanging-indented. */
function cmd(sig: string, desc: string): void {
  const width = Math.min(termWidth(), 88);
  const descCol = Math.max(30, width - SIG - 2);
  const words = desc.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    if (cur !== '' && `${cur} ${word}`.length > descCol) {
      lines.push(cur);
      cur = word;
    } else {
      cur = cur === '' ? word : `${cur} ${word}`;
    }
  }
  if (cur !== '') lines.push(cur);

  if (sig.length <= SIG - 2) {
    write(`  ${c.accent2(sig.padEnd(SIG - 2))}  ${c.muted(lines[0] ?? '')}\n`);
  } else {
    // Long signature: put it on its own line, description starts under the column.
    write(`  ${c.accent2(sig)}\n  ${' '.repeat(SIG)}${c.muted(lines[0] ?? '')}\n`);
  }
  for (const l of lines.slice(1)) write(`  ${' '.repeat(SIG)}${c.muted(l)}\n`);
}

/** One pack row: `  <name>   <description>`. */
function pack(name: string, desc: string): void {
  write(`  ${c.accent2(name.padEnd(SIG - 2))}  ${c.muted(desc)}\n`);
}

/** One example row: `  <command>   # comment`. */
function example(command: string, note: string): void {
  write(`  ${command.padEnd(50)}${c.muted(`# ${note}`)}\n`);
}

export function printHelp(): void {
  blank();
  write(`  ${c.accent(glyph.arrow)} ${brand('void-harness')}  ${c.muted('— a development-doctrine OS for coding agents')}\n`);
  write(`  ${c.muted(glyph.dash.repeat(Math.min(termWidth(), 88) - 2))}\n`);
  write(`  ${c.muted('Public & MIT. Install free, account-free — no account, no key:')}\n`);
  write(`  ${c.accent2('npx voidharness init')}    ${c.muted('# wire the current project')}\n`);
  write(`  ${c.accent2('npx voidharness status')}  ${c.muted('# deterministic, offline health')}\n`);
  write(`  ${c.muted('on pnpm? use')} ${c.muted('pnpm dlx voidharness …')} ${c.muted('to silence npm config warnings.')}\n`);

  heading('Commands');
  cmd('init [--pack] [--runtime]', 'Install bundled local assets by default: detect runtimes + stack, activate packs, write doctrine. --runtime claude|codex|both, --source marketplace, --force.');
  cmd('runtime <list|add <r>>', 'Show which runtimes are wired, or add one (claude|codex) a posteriori without a reinstall — touches only that runtime.');
  cmd('add <pack>', 'Activate a stack pack in the current project.');
  cmd('remove <pack>', 'Deactivate a pack (core cannot be removed).');
  cmd('list', 'Show active and available packs.');
  cmd('status', 'Project health: the five-state capability lifecycle + a score. Deterministic, offline, no LLM.');
  cmd('doctor [--no-remote] [--fix]', 'Health-check the install (config, doctrine, per-runtime wiring), and report structural drift from the conventions the harness declares. --fix repairs the mechanical ones, refused on a dirty tree, never committed. --dry-run shows the mutations.');
  cmd('update [--dry-run] [--untrack-derived]', 'Recompile local receipt-owned assets from this CLI; migrate the .void layout. --untrack-derived drops regenerated files from the git index, keeping them on disk.');
  cmd('hydrate', 'Restore this project\'s harness assets from .void/install-manifest.json and prove every file against its hash. Refuses to run on a different version.');
  cmd('check [--doctrine]', 'Report local vs remote version drift. --doctrine also diffs PHILOSOPHY.md.');
  cmd('graph <sub>', 'Build / gate / report the skill-agent graph (build, check, audit, live, behavior).');
  cmd('graph <query> <file>', 'Ask this project\'s graph: explain · path · impact · subgraph · owners · tests-for · staleness. Bounded (--max-nodes/--max-depth), read-only, and explicit when the answer may be incomplete.');
  cmd('autopilot [sub]', 'Drain a bounded cluster of ready work units into one integration PR you merge. plan · start · status · resume · abort; --json for the skill. Resumes from .void/program.md, so no unit or run id is passed.');
  cmd('audit', 'Self-evolution audit: surface stale / never-fired skills as deprecation candidates. HITL.');
  cmd('projects', 'Every Void project on this machine and where attention is owed. Offline projection, never writes; --json for a served view.');
  cmd('resume', 'Pick this project back up: the session checkpoint, recent decisions, and what is NOT answered. Reads, never guesses.');
  cmd('ui', 'Serve the projects view on localhost, read per request. Loopback only, one-shot token, stops with the command.');
  cmd('adoption', 'Maintainer: pull public npm + GitHub stats (tier-1 telemetry, zero phone-home).');
  cmd('decisions <sub>', 'Create, validate, or render one-file ADRs without a shared counter or index.');
  cmd('mission <sub>', 'Plan a deterministic DAG, then start, resume, verify, inspect, archive, or explicitly prune an auditable local mission run.');
  cmd('security <adapters|scan>', 'Run the local security baseline over whatever scanners are installed. A target is refused without an explicit, unexpired authorization naming its host.');
  cmd('self-host <sync|doctor>', 'Maintainer: compile current sources into an isolated dogfood artifact and verify source, hooks, events, replay, and runtime availability.');
  cmd('version · help', 'Print the version (also -v) · print this reference.');

  heading('Packs');
  pack(CORE_PLUGIN_NAME, 'core — universal craftsman skills (always active)');
  pack('harness-monorepo', 'Turborepo monorepo conventions');
  pack('harness-react', 'React 19 + shadcn/Radix + accessibility');
  pack('harness-nextjs', 'Next.js 16 App Router conventions');
  pack('harness-server', 'Server Actions, webhooks, Drizzle, Zod boundaries');
  pack('harness-pwa', 'PWA manifest, service worker, offline-first');
  pack('harness-mobile', 'Expo + React Native + native modules');
  write(`  ${c.muted('--pack accepts the bare stack too: nextjs, monorepo, react, …')}\n`);

  heading('Examples');
  example('void-harness init', 'interactive, auto-detects runtimes + packs');
  example('void-harness init --pack nextjs --pack monorepo', 'script-friendly');
  example('void-harness init --runtime codex', 'Codex-only: wire its safety floor');
  example('void-harness init --marketplace', 'explicit opt-in to the secondary Claude marketplace');
  example('void-harness runtime add codex', 'add Codex to a Claude project, later');
  example('void-harness status', 'offline project health');
  example('void-harness autopilot status', 'where the cluster in flight stands');
  example('void-harness autopilot abort', 'give the cluster back, losing no commit');
  example('void-harness update --dry-run', 'preview version + floor drift');
  example('void-harness decisions new --title "Use X" --slug use-x', 'create one conflict-free ADR');
  example('void-harness mission start --title "Ship feature"', 'start a local team-mode evidence ledger');
  example('void-harness mission resume --id mis_<id>', 'resume from receipts without replaying proven effects');
  example('void-harness mission plan --ticket ticket.md --json', 'compile risk, applicability, and DAG');

  blank();
  write(`  ${c.muted('Skills load as')} ${c.accent('/harness:<name>')} ${c.muted('and')} ${c.accent('/harness-<stack>:<name>')}${c.muted('.')}\n`);
  write(`  ${c.muted('Marketplace (optional):')} ${c.muted(`github.com/${MARKETPLACE_REPO}`)}\n`);
  blank();
}
