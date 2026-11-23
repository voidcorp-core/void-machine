#!/usr/bin/env node
// Does every skill reference in the live doctrine point at something that exists?
//
// A skill's identity is the name of its directory, and that name is copied by
// hand into routing tables, slash commands, sourcing notes and hooks. Nothing
// connects the copies to the original, so a rename leaves references pointing
// into the void and nothing says so: the agent silently fails to route, which
// reads as the skill not applying rather than as a broken link. Renaming
// `session-handoff` to `checkpoint` left four such references, and an audit
// found them weeks later rather than the build. A rename should be mechanical,
// not an act of vigilance.
//
// What exists is read from the generated catalogue, never from a list kept here:
// a second inventory would drift from the first, which is the failure this whole
// check is about.
//
// Live surfaces only. Specs, plans and decision records cite retired skills on
// purpose, because they record what was decided at the time and must read as
// written. Test files are excluded too: they name skills as fixtures, and a
// broken reference in a test already fails as a test.
//
// Usage: node scripts/check-skill-references.mjs
// Code references are checked here too; navigation uses ordinary search, not a generated register.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_IDENTITY } from './product-identity.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOGUE = resolve(ROOT, 'packages/core/data/model.json');
const RETIREMENTS = resolve(ROOT, 'packages/hook-runner/src/retired-skills.ts');

/**
 * A `void-`prefixed name, as written in code or prose. The leading boundary
 * rejects `_void-hook.mjs`: an underscore is a word character, so the token is
 * part of a longer identifier of the machinery and not a reference to a skill.
 */
const PREFIXED = /(?<![\w-])void-[a-z0-9]+(?:-[a-z0-9]+)*/g;

/**
 * A segment a `SKILL.md` follows, in either spelling: `skills/<name>/SKILL.md`
 * or `'skills', '<name>', 'SKILL.md'`. Whatever that segment is spelled, it names
 * a skill directory -- which is what the prefixed-token check cannot see, since
 * the sentinel that broke `init` wrote the bare `tdd`.
 */
const SKILL_DIRECTORY = /(?:skills\/([a-z0-9][a-z0-9-]*)\/SKILL\.md|'skills',\s*'([a-z0-9][a-z0-9-]*)',\s*'SKILL\.md')/g;

/** Where a name in a string literal reaches a directory a runtime resolves. */
const SCANNED = ['packages', 'apps', 'scripts'];

/**
 * Not scanned, each for its own reason and none of them "it was noisy":
 * `core-assets` is a byte mirror of `packages/core`; `void-graph.mjs` is a
 * bundle whose inputs are already checked; tests name skills
 * as fixtures, and a broken reference in a test already fails as a test.
 */
const NOT_SCANNED = [
  'node_modules',
  'dist',
  'coverage',
  join('packages', 'cli', 'core-assets'),
  join('packages', 'core', 'graph', 'void-graph.mjs'),
];

/**
 * `void-`names that are machinery, not skills. Each one is an identifier this
 * harness writes for itself -- a scratch-directory prefix, a check name, a
 * module -- and each is listed so a NEW one is red until someone says which it
 * is. That is the whole point: the list is not maintenance, it is the gate.
 */
const DECLARED = [
  { name: 'void-autopilot-conformance', reason: 'conformance run label, `packages/cli/scripts/`' },
  { name: 'void-continuity', reason: 'graph studio live-render channel' },
  { name: 'void-doctor-smoke', reason: 'scratch prefix for the doctor hook smoke test' },
  { name: 'void-enforce', reason: 'name of the enforcement prerequisite check' },
  { name: 'void-eval', reason: 'eval harness sandbox prefix' },
  { name: 'void-eval-native', reason: 'eval harness native-specialist runtime prefix' },
  { name: 'void-hook-probe', reason: 'scratch prefix for the hook smoke probe' },
  { name: 'void-hygiene', reason: 'name of the repository hygiene doctor check' },
  { name: 'void-init-stage', reason: 'scratch prefix for the isolated init stage' },
  { name: 'void-install-conformance', reason: 'conformance run label, `packages/cli/scripts/`' },
  { name: 'void-internal', reason: 'marker for sidecars a consumer never receives' },
  { name: 'void-journal-anchor', reason: 'reserved basename of a change-journal sentinel' },
  { name: 'void-last-event-id', reason: 'graph studio live-render cursor' },
  { name: 'void-layout', reason: 'module owning the void directory layout' },
  { name: 'void-machine-legacy', reason: 'portable legacy conformance contract family' },
  { name: 'void-machine', reason: 'private TypeScript Machine package, `packages/void-machine/`' },
  { name: 'void-migration', reason: 'name of the void layout migration check' },
  { name: 'void-probe', reason: 'observed write path written by the hook probe' },
  { name: 'void-project-benchmark', reason: 'project-graph benchmark fixture prefix' },
  { name: 'void-project-graph-conformance', reason: 'conformance run label, `scripts/`' },
  { name: 'void-project-graph-orphan', reason: 'conformance run label, `scripts/`' },
  { name: 'void-review', reason: 'basename of the versioned review public key, `.github/`' },
  { name: 'void-consumer', reason: 'scratch prefix for isolated consumer workspaces' },
  { name: 'void-package', reason: 'scratch prefix for extracted package artifacts' },
  { name: 'void-runtime-stage', reason: 'scratch prefix for the isolated `runtime add` stage' },
  { name: 'void-security', reason: 'scratch prefix of the `security` command' },
  { name: 'void-tx', reason: 'scratch prefix of the file transaction' },
  { name: 'void-orchestrator', reason: 'cmux presentation status identifier' },
];

/**
 * Skill directories a fixture deliberately owns instead of this harness. Each is
 * a stand-in for what a CONSUMER wrote, so it must stay unprefixed: prefixing it
 * would make the fixture prove the opposite of what it was written to prove.
 */
const FOREIGN_SKILLS = [
  { name: 'private', reason: "a project's own skill, which install must not touch" },
  { name: 'my-skill', reason: 'placeholder in the void layout documentation' },
  { name: 'custom', reason: 'placeholder in the void layout documentation' },
];

/** Every skill directory this text names, once each, sorted. */
export function skillDirectorySegments(text) {
  const found = new Set();
  for (const match of text.matchAll(SKILL_DIRECTORY)) {
    const segment = match[1] ?? match[2];
    if (segment !== undefined) found.add(segment);
  }
  return [...found].sort();
}

/** Every `void-`token written in this text, once each, sorted for a stable report. */
export function prefixedTokens(text) {
  return [...new Set(text.match(PREFIXED) ?? [])].sort();
}

/**
 * A namespaced skill name, core (`harness:tdd`) or pack (`harness-server:x`), in
 * prose or as a slash command, but never one of the product's own `<name>:` markers.
 *
 * This used to be how a reference was written. It is now what a reference must
 * never be: the namespace exists only under a Claude Code marketplace plugin,
 * and the npm package — the primary channel — lands every skill flat in
 * `.claude/skills/`, where the namespaced call returns Unknown skill.
 */
const NAMESPACED = /(?<!void-)\bharness(?:-[a-z]+)?:([a-z0-9]+(?:-[a-z0-9]+)*)/g;

/** Files loaded in a session, or shipped to a consumer, where a dead link misroutes. */
const SURFACES = [
  'CLAUDE.md',
  'AGENTS.md',
  'README.md',
  'CONTRIBUTING.md',
  '.void/PROJECT-DOCTRINE.md',
  'docs/ARCHITECTURE.md',
  'docs/PHILOSOPHY.md',
  'packages/core/PHILOSOPHY.md',
  'packages/core/PROJECT-DOCTRINE.template.md',
  'packages/core/.claude-plugin/plugin.json',
  'packages/cli/core-assets/.claude-plugin/plugin.json',
  'docs/HARNESS_EVOLUTION.md',
  'docs/CHEATSHEET.md',
  'packages/core/skills',
  'packages/core/agents',
  'packages/core/commands',
  'packages/core/hooks',
  'packages/packs',
];

/** Every namespaced name written in this text, sorted for a stable report. */
export function extractReferences(text) {
  const found = new Set();
  for (const match of text.matchAll(NAMESPACED)) {
    if (match[1] !== undefined) found.add(match[1]);
  }
  return [...found].sort();
}

/**
 * Live plugin descriptions use the mandatory skill prefix. Ordinary English
 * words cannot establish a reference: guessing "plan" or "context" would hide
 * stale names behind false positives. The exact product name is not a skill.
 * Retired names deliberately remain candidates; only the live catalogue admits.
 */
export function extractPluginReferences(description) {
  return prefixedTokens(typeof description === 'string' ? description : '')
    .filter((name) => name !== PRODUCT_IDENTITY.commands.primary
      && !PRODUCT_IDENTITY.commands.deprecated.includes(name));
}

/**
 * The references resolving to nothing. `known` holds skills, agents, commands
 * and packs alike: they share one spelling, so splitting them would report every
 * agent as dangling.
 */
export function danglingReferences(references, known) {
  return [...new Set(references)].filter((name) => !known.has(name)).sort();
}

// The same set difference serves code tokens and names in shipped descriptions.
export { danglingReferences as unresolvedTokens };

function walk(path, code = false, seen = []) {
  let entry;
  try {
    entry = statSync(path);
  } catch {
    return seen;
  }
  const rel = relative(ROOT, path);
  if (code && NOT_SCANNED.some((skip) => rel === skip || rel.split('/').includes(skip))) return seen;
  if (entry.isFile()) {
    const accepted = code
      ? /\.(?:ts|tsx|mjs|js)$/.test(path)
      : /\.(?:md|source)$/.test(path) || basename(path) === 'plugin.json';
    if (accepted && !path.includes('.test.')) seen.push(path);
    return seen;
  }
  for (const child of readdirSync(path)) {
    if (child === 'node_modules' || child === 'dist') continue;
    walk(join(path, child), code, seen);
  }
  return seen;
}

function knownNames() {
  const model = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
  return new Set((model.nodes ?? []).map((node) => node.name).filter(Boolean));
}

/** The retired names, read from the register that owns them rather than re-listed. */
function retiredNames() {
  const source = readFileSync(RETIREMENTS, 'utf8');
  return new Set((source.match(/'(void-[a-z0-9-]+)':/g) ?? []).map((hit) => hit.slice(1, -2)));
}

function codeReferences(known) {
  const resolvable = new Set([
    ...known,
    ...retiredNames(),
    ...DECLARED.map((entry) => entry.name),
    PRODUCT_IDENTITY.commands.primary,
    ...PRODUCT_IDENTITY.commands.deprecated,
  ]);
  const foreign = new Set(FOREIGN_SKILLS.map((entry) => entry.name));
  const missing = [];
  for (const root of SCANNED) {
    for (const file of walk(resolve(ROOT, root), true)) {
      const contents = readFileSync(file, 'utf8');
      const names = danglingReferences(prefixedTokens(contents), resolvable);
      const bare = skillDirectorySegments(contents)
        .filter((segment) => !segment.startsWith('void-') && !foreign.has(segment));
      if (names.length > 0 || bare.length > 0) {
        missing.push({ file: relative(ROOT, file), names, bare });
      }
    }
  }
  return missing;
}

function main() {
  const known = knownNames();
  const codeMissing = codeReferences(known);
  const namespaced = [];
  const dangling = [];
  const pluginMissing = [];
  for (const surface of SURFACES) {
    for (const file of walk(resolve(ROOT, surface))) {
      const contents = readFileSync(file, 'utf8');
      const plugin = basename(file) === 'plugin.json';
      const text = plugin ? JSON.parse(contents)?.description : contents;
      if (typeof text !== 'string') continue;
      if (plugin) {
        const missing = danglingReferences(extractPluginReferences(text), known);
        if (missing.length > 0) pluginMissing.push({ file: file.slice(ROOT.length + 1), names: missing });
      }
      const found = extractReferences(text);
      if (found.length === 0) continue;
      const relative = file.slice(ROOT.length + 1);
      namespaced.push({ file: relative, names: found });
      // A namespaced name that also names nothing is worth saying separately:
      // dropping the namespace would not save it.
      const missing = danglingReferences(found, known);
      if (missing.length > 0) dangling.push({ file: relative, names: missing });
    }
  }
  if (namespaced.length === 0 && pluginMissing.length === 0 && codeMissing.length === 0) {
    process.stdout.write(
      `check-skill-references: code references, live surfaces and plugin descriptions resolve (${String(known.size)} known names).\n`,
    );
    return;
  }
  for (const { file, names } of namespaced) {
    process.stderr.write(`${file}: ${names.map((n) => `harness:${n}`).join(', ')}\n`);
  }
  for (const { file, names } of dangling) {
    process.stderr.write(`${file}: ${names.join(', ')} names nothing in the catalogue either\n`);
  }
  if (namespaced.length > 0) {
    process.stderr.write(
      '\ncheck-skill-references: the names above carry a namespace no local install resolves.\n'
      + 'Write the bare name; the invocation syntax belongs to the runtime, not to the doctrine.\n',
    );
  }
  for (const { file, names } of pluginMissing) {
    process.stderr.write(`${file}: ${names.join(', ')} names no live skill; correct the plugin description.\n`);
  }
  for (const { file, names, bare } of codeMissing) {
    if (names.length > 0) {
      process.stderr.write(`${file}: ${names.join(', ')} resolves to no skill, retirement or declared identifier.\n`);
    }
    for (const name of bare) {
      process.stderr.write(`${file}: skills/${name}/SKILL.md names an unprefixed skill directory.\n`);
    }
  }
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
