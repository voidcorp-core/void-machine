import { COMMAND_CATALOG } from '../lib/command-catalog.js';
import { PRODUCT_COMMAND, PRODUCT_IDENTITY } from '@voidcorp/hook-runner';
// `void-machine help` / no-args — the command reference, rendered through the
// shared render layer so the front door wears the same "void" identity as every
// other command (a plain template string used to read as an afterthought).

import { CORE_PLUGIN_NAME, MARKETPLACE_REPO } from '../lib/packs.js';
import { blank, brand, c, glyph, heading, termWidth } from '../lib/render.js';

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
  write(`  ${c.accent(glyph.arrow)} ${brand(PRODUCT_COMMAND)}  ${c.muted('— a development-doctrine OS for coding agents')}\n`);
  write(`  ${c.muted(glyph.dash.repeat(Math.min(termWidth(), 88) - 2))}\n`);
  write(`  ${c.muted('Public & MIT. Install free, account-free — no account, no key:')}\n`);
  const npx = `npx ${PRODUCT_IDENTITY.packageName}`;
  write(`  ${c.accent2(`${npx} init`)}    ${c.muted('# wire the current project')}\n`);
  write(`  ${c.accent2(`${npx} status`)}  ${c.muted('# deterministic, offline health')}\n`);
  write(`  ${c.muted('on pnpm? use')} ${c.muted(`pnpm dlx ${PRODUCT_IDENTITY.packageName} …`)} ${c.muted('to silence npm config warnings.')}\n`);

  heading('Commands');
  for (const command of Object.values(COMMAND_CATALOG)) {
    for (const row of command.help) cmd(row.signature, row.description);
  }

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
  example(`${PRODUCT_COMMAND} init`, 'interactive, auto-detects runtimes + packs');
  example(`${PRODUCT_COMMAND} init --pack nextjs --pack monorepo`, 'script-friendly');
  example(`${PRODUCT_COMMAND} init --runtime codex`, 'Codex-only: wire its safety floor');
  example(`${PRODUCT_COMMAND} init --marketplace`, 'explicit opt-in to the secondary Claude marketplace');
  example(`${PRODUCT_COMMAND} runtime add codex`, 'add Codex to a Claude project, later');
  example(`${PRODUCT_COMMAND} status`, 'offline project health');
  example(`${PRODUCT_COMMAND} autopilot status`, 'where the cluster in flight stands');
  example(`${PRODUCT_COMMAND} autopilot abort`, 'give the cluster back, losing no commit');
  example(`${PRODUCT_COMMAND} update --dry-run`, 'plan stable CLI + current project update');
  example(`${PRODUCT_COMMAND} decisions new --title "Use X" --slug use-x`, 'create one conflict-free ADR');
  example(`${PRODUCT_COMMAND} mission start --title "Ship feature"`, 'start a local team-mode evidence ledger');
  example(`${PRODUCT_COMMAND} mission resume --id mis_<id>`, 'resume from receipts without replaying proven effects');
  example(`${PRODUCT_COMMAND} mission plan --ticket ticket.md --json`, 'compile risk, applicability, and DAG');

  blank();
  write(`  ${c.muted('Skills load as')} ${c.accent('/harness:<name>')} ${c.muted('and')} ${c.accent('/harness-<stack>:<name>')}${c.muted('.')}\n`);
  write(`  ${c.muted('Marketplace (optional):')} ${c.muted(`github.com/${MARKETPLACE_REPO}`)}\n`);
  blank();
}
