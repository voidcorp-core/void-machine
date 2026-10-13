// A stateful stand-in for herdr, tmux and cmux, replaying the answers each CLI gives (herdr 0.9
// JSON and error codes, tmux(1) formats and "can't find pane", cmux --json tree and text acks).
// State lives in the JSON file named by FAKE_MUX_STATE; FAKE_MUX_FAIL names one step to fail
// and FAKE_MUX_HANG one step to hang, a step being the first two words of the call.
import { readFileSync, writeFileSync } from 'node:fs';

const [kind, ...argv] = process.argv.slice(2);
const path = process.env.FAKE_MUX_STATE;
const state = JSON.parse(readFileSync(path, 'utf8'));
state.log ??= [];
const save = () => writeFileSync(path, JSON.stringify(state));
const out = (value) => process.stdout.write(typeof value === 'string' ? value : `${JSON.stringify(value)}\n`);
const fail = (text, code = 1) => { save(); process.stderr.write(text); process.exit(code); };
const option = (args, name) => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };

function gate(step) {
  state.log.push({ step, argv, socket: process.env.HERDR_SOCKET_PATH ?? process.env.CMUX_SOCKET_PATH ?? null });
  if (process.env.FAKE_MUX_HANG === step) { save(); setTimeout(() => {}, 60_000); return false; }
  if (process.env.FAKE_MUX_FAIL === step) fail(`{"error":{"code":"injected","message":"${step} failed"}}\n`);
  return true;
}

function herdr([group, verb, ...rest]) {
  if (!gate(`${group} ${verb}`)) return;
  const pane = (id) => state.panes.find((known) => known.pane_id === id);
  const missing = (id) => fail(`{"error":{"code":"pane_not_found","message":"pane ${id} not found"},"id":"cli"}\n`);
  const fresh = (tab_id, cwd) => {
    const created = { pane_id: `w1:p${String(++state.next)}`, tab_id, cwd, tokens: {}, typed: [] };
    state.panes.push(created);
    return created;
  };
  const key = `${group} ${verb}`;
  if (key === 'tab list') return out({ result: { tabs: state.tabs } });
  if (key === 'pane list') return out({ result: { panes: state.panes } });
  if (key === 'tab create') {
    const tab = { tab_id: `w1:t${String(++state.next)}`, label: option(rest, '--label') };
    state.tabs.push(tab);
    return out({ result: { tab, root_pane: fresh(tab.tab_id, option(rest, '--cwd')) } });
  }
  if (key === 'pane split') {
    const target = pane(rest[0]);
    if (target === undefined) return missing(rest[0]);
    const created = fresh(target.tab_id, option(rest, '--cwd'));
    created.direction = option(rest, '--direction');
    return out({ result: { pane: created } });
  }
  if (key === 'tab rename') { state.tabs.find((tab) => tab.tab_id === rest[0]).label = rest[1]; return out({ result: {} }); }
  const target = pane(rest[0]);
  if (target === undefined) return missing(rest[0]);
  if (key === 'pane get') return out({ result: { pane: target } });
  if (key === 'pane rename') { target.label = rest[1]; return out({ result: { pane: target } }); }
  if (key === 'pane run') { target.typed.push(rest[1]); return out(''); }
  if (key === 'pane report-metadata') {
    rest.forEach((arg, index) => { if (arg === '--token') { const [name, value] = rest[index + 1].split('='); target.tokens[name] = value; } });
    return out('');
  }
  if (key === 'pane close') {
    state.panes = state.panes.filter((known) => known !== target);
    // herdr closes a tab with its last pane.
    state.tabs = state.tabs.filter((tab) => state.panes.some((known) => known.tab_id === tab.tab_id));
    return out({ result: { type: 'ok' } });
  }
  return fail(`unknown herdr call ${key}\n`, 2);
}

function tmux(args) {
  if (args[0] !== '-S') return fail('no socket\n', 2);
  const [verb, ...rest] = args.slice(2);
  state.socket = args[1];
  if (!gate(verb)) return;
  const pane = (id) => state.panes.find((known) => known.id === id);
  const format = (row) => `${row.id}\t${row.title}\t${row.run ?? ''}`;
  const target = option(rest, '-t');
  if (verb === 'list-panes') return out(state.panes.map(format).join('\n') + '\n');
  if (pane(target) === undefined) return fail(`can't find pane: ${target}\n`);
  if (verb === 'split-window') {
    const command = rest.slice(rest.indexOf('--') + 1);
    const created = { id: `%${String(++state.next)}`, title: 'shell', command, cwd: option(rest, '-c'),
      direction: rest.includes('-h') ? 'right' : 'down', from: target };
    state.panes.push(created);
    return out(`${created.id}\n`);
  }
  if (verb === 'select-pane') { pane(target).title = option(rest, '-T'); return out(''); }
  if (verb === 'set-option') { pane(target).run = rest.at(-1); return out(''); }
  if (verb === 'display-message') return out(`${format(pane(target))}\n`);
  if (verb === 'kill-pane') { state.panes = state.panes.filter((known) => known.id !== target); return out(''); }
  return fail(`unknown tmux call ${verb}\n`, 2);
}

function cmux(args) {
  if (args[0] !== '--json') return fail('expected --json\n', 2);
  const [verb, ...rest] = args.slice(1);
  if (!gate(verb)) return;
  const surface = (ref) => state.surfaces.find((known) => known.ref === ref);
  if (verb === 'tree') {
    if (option(rest, '--workspace') !== state.workspace) return fail('workspace not found\n');
    return out({ windows: [{ workspaces: [{ ref: 'workspace:1', panes: state.surfaces.map((known) => ({ surfaces: [known] })) }] }] });
  }
  if (verb === 'new-split') {
    const created = { ref: `surface:${String(++state.next)}`, title: 'zsh', type: 'terminal', command: option(rest, '--command'),
      direction: rest[0], from: option(rest, '--surface') };
    state.surfaces.push(created);
    // A split that races another creation: the tree then shows two new surfaces.
    if (process.env.FAKE_MUX_EXTRA === '1') state.surfaces.push({ ref: `surface:${String(++state.next)}`, title: 'zsh', type: 'terminal' });
    return out(`OK ${created.ref} workspace:1\n`);
  }
  if (verb === 'set-status' || verb === 'clear-status') { state.status ??= {}; state.status[rest[0]] = rest[1] ?? null; return out('OK\n'); }
  const target = surface(option(rest, '--surface'));
  if (target === undefined) return fail('surface not found\n');
  if (verb === 'rename-tab') { target.title = rest.at(-1); return out('OK\n'); }
  if (verb === 'close-surface') { state.surfaces = state.surfaces.filter((known) => known !== target); return out('OK\n'); }
  return fail(`unknown cmux call ${verb}\n`, 2);
}

({ herdr, tmux, cmux })[kind](argv);
if (!process.env.FAKE_MUX_HANG || !state.log.some((entry) => entry.step === process.env.FAKE_MUX_HANG)) save();
