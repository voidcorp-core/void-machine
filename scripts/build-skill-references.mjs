#!/usr/bin/env node
// Where does this harness name one of its own skills, and does every name resolve?
//
// A skill's identity is the name of its directory. That name is also copied into
// code -- as a path segment a probe joins, as a routing string, as the subject of
// a refusal message -- and nothing connects the copy to the original. A rename
// therefore leaves live code pointing at a directory that no longer exists, and
// says nothing.
//
// It already cost a day. `runtime-adapters.ts` decided whether a local install
// had materialized by probing the `tdd` skill directory by name. The `void-` prefix
// pass renamed the directory, the probe missed, the install read as absent, and
// `init` failed on a stage that was in fact complete -- reporting sixteen missing
// native specialists, which is nowhere near the cause.
//
// The prefix is what makes the fix possible: every shipped skill carries it
// (CLAUDE.md rule 8), so every reference to one is a `void-`token, and a token is
// greppable in a way a bare English word like `plan` or `context` never was.
//
// So this script does two things, and the second is the one that holds:
//
//   1. It writes `docs/SKILL-REFERENCES.md` -- the register naming every file
//      that names a skill, so a rename is a sweep down a list rather than an act
//      of vigilance.
//   2. It refuses any `void-`token that resolves to nothing. A token resolves if
//      the catalogue holds it, if the retirement register redirects it, or if it
//      is declared below as an identifier of the machinery rather than a skill.
//      A new internal `void-`name is red until it is declared, and a rename is
//      red until every call site follows.
//
// What exists is read from the generated catalogue, never from a list kept here:
// a second inventory would drift from the first, which is the failure this whole
// check is about. Freshness is not a gate of its own either -- `derive.mjs` runs
// this and asserts the tree is unchanged, so the register cannot go stale
// without the build saying so.
//
// Usage: node scripts/build-skill-references.mjs [--check]
// Exported: prefixedTokens, unresolvedTokens, renderRegister -- pure, unit-tested.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_IDENTITY } from './product-identity.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOGUE = resolve(ROOT, 'packages/core/data/model.json');
const RETIREMENTS = resolve(ROOT, 'packages/hook-runner/src/retired-skills.ts');
const REGISTER = resolve(ROOT, 'docs/SKILL-REFERENCES.md');

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
 * `core-assets` is a byte mirror of `packages/core` and would double every
 * entry; `void-graph.mjs` is a bundle, so its tokens are its inputs' tokens
 * already counted; the register is this script's own output; tests name skills
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
 * Scanned for unresolved names like everything else, but kept OUT of the
 * register: the retirement register names every shipped skill by construction,
 * as the target of a redirection, so listing it under all sixty-seven turns the
 * table into a wall where nothing stands out. It needs no sweep either — a
 * sibling test already asserts every replacement it names is still shipped.
 */
const NOT_REGISTERED = [
  join('packages', 'hook-runner', 'src', 'retired-skills.ts'),
  join('packages', 'core', 'hooks', '_void-hook.mjs'),
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

/** The tokens naming nothing. `resolvable` holds live, retired and declared names alike. */
export function unresolvedTokens(tokens, resolvable) {
  return [...new Set(tokens)].filter((token) => !resolvable.has(token)).sort();
}

/** The register, rendered. Generated: the reader is told so on the first line. */
export function renderRegister({ named, declared }) {
  const lines = [
    '<!-- Generated by scripts/build-skill-references.mjs. Do not edit; run `pnpm derive`. -->',
    '',
    '# Skill references',
    '',
    'Every place this harness names one of its own skills from code, and every',
    '`void-`name that is machinery rather than a skill.',
    '',
    'Read this before renaming a skill: the rename is a sweep down the first table.',
    'Nothing here is maintained by hand — `scripts/build-skill-references.mjs`',
    'regenerates it and refuses any `void-`token that resolves to nothing, and',
    '`pnpm derive:check` fails when the file on disk is not what the sources say.',
    '',
    '## Skills named from code',
    '',
    'A name written here is load-bearing: it is a path segment, a routing string or',
    'the subject of a message. Renaming the skill without following this list is how',
    '`init` came to report sixteen missing specialists because a probe naming the',
    '`tdd` skill directory stopped matching.',
    '',
    'The retirement register (`packages/hook-runner/src/retired-skills.ts` and its',
    'compiled mirror) is checked but not listed: it names every shipped skill as the',
    'target of a redirection, and a sibling test already asserts each one still ships.',
    '',
    '| skill | named in |',
    '| --- | --- |',
  ];
  for (const { name, files } of named) {
    lines.push(`| \`${name}\` | ${files.map((file) => `\`${file}\``).join('<br>')} |`);
  }
  lines.push(
    '',
    '## Declared `void-` identifiers',
    '',
    'These are not skills. Each is an identifier the machinery writes for itself, and',
    'each is declared in the script so that a new one fails the check until someone',
    'says which it is.',
    '',
    '| identifier | what it is |',
    '| --- | --- |',
  );
  for (const { name, reason } of declared) {
    lines.push(`| \`${name}\` | ${reason} |`);
  }
  lines.push(
    '',
    '## Unprefixed skill directories',
    '',
    'A path ending in `SKILL.md` names a skill directory whatever the segment before',
    'it is spelled, and a segment with no `void-` prefix is a reference to a skill',
    'this harness does not ship. Only these are allowed.',
    '',
    '| directory | why it stays unprefixed |',
    '| --- | --- |',
  );
  for (const { name, reason } of FOREIGN_SKILLS) {
    lines.push(`| \`${name}\` | ${reason} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function isSkipped(path) {
  const rel = relative(ROOT, path);
  return NOT_SCANNED.some((skip) => rel === skip || rel.split('/').includes(skip));
}

function walk(path, seen = []) {
  let entry;
  try {
    entry = statSync(path);
  } catch {
    return seen;
  }
  if (isSkipped(path)) return seen;
  if (entry.isFile()) {
    if (/\.(?:ts|tsx|mjs|js)$/.test(path) && !path.includes('.test.')) seen.push(path);
    return seen;
  }
  for (const child of readdirSync(path)) walk(join(path, child), seen);
  return seen;
}

function catalogueNames() {
  const model = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
  return new Set((model.nodes ?? []).map((node) => node.name).filter(Boolean));
}

/** The retired names, read from the register that owns them rather than re-listed. */
function retiredNames() {
  const source = readFileSync(RETIREMENTS, 'utf8');
  return new Set((source.match(/'(void-[a-z0-9-]+)':/g) ?? []).map((hit) => hit.slice(1, -2)));
}

function main() {
  const check = process.argv.includes('--check');
  const resolvable = new Set([
    ...catalogueNames(),
    ...retiredNames(),
    ...DECLARED.map((entry) => entry.name),
    // The product's own command names, current and deprecated, are not skills.
    PRODUCT_IDENTITY.commands.primary,
    ...PRODUCT_IDENTITY.commands.deprecated,
  ]);
  const skills = catalogueNames();
  const foreign = new Set(FOREIGN_SKILLS.map((entry) => entry.name));
  const byName = new Map();
  const unresolved = [];
  const unprefixed = [];
  for (const root of SCANNED) {
    for (const file of walk(resolve(ROOT, root))) {
      const tokens = prefixedTokens(readFileSync(file, 'utf8'));
      if (tokens.length === 0) continue;
      const rel = relative(ROOT, file);
      const missing = unresolvedTokens(tokens, resolvable);
      if (missing.length > 0) unresolved.push({ file: rel, names: missing });
      const bare = skillDirectorySegments(readFileSync(file, 'utf8'))
        .filter((segment) => !segment.startsWith('void-') && !foreign.has(segment));
      if (bare.length > 0) unprefixed.push({ file: rel, names: bare });
      if (NOT_REGISTERED.includes(rel)) continue;
      for (const token of tokens) {
        if (!skills.has(token)) continue;
        if (!byName.has(token)) byName.set(token, []);
        byName.get(token).push(rel);
      }
    }
  }
  if (unprefixed.length > 0) {
    for (const { file, names } of unprefixed) {
      process.stderr.write(`${file}: skills/${names.join(', skills/')}/SKILL.md\n`);
    }
    process.stderr.write(
      '\nbuild-skill-references: the paths above name a skill directory with no `void-` prefix.\n'
      + 'Every skill this harness ships carries the prefix, so an unprefixed one either points at\n'
      + 'a directory that no longer exists, or belongs to the consumer — declare it in\n'
      + 'FOREIGN_SKILLS in scripts/build-skill-references.mjs with whose it is.\n',
    );
    process.exitCode = 1;
    return;
  }
  if (unresolved.length > 0) {
    for (const { file, names } of unresolved) {
      process.stderr.write(`${file}: ${names.join(', ')}\n`);
    }
    process.stderr.write(
      '\nbuild-skill-references: the names above resolve to no skill, no retirement and no\n'
      + 'declared identifier. Rename the reference to the skill that carries the work now, or\n'
      + 'declare it in DECLARED in scripts/build-skill-references.mjs with what it is.\n',
    );
    process.exitCode = 1;
    return;
  }
  const named = [...byName]
    .map(([name, files]) => ({ name, files: [...new Set(files)].sort() }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const rendered = renderRegister({ named, declared: DECLARED });
  if (check) {
    let current;
    try {
      current = readFileSync(REGISTER, 'utf8');
    } catch {
      current = '';
    }
    if (current !== rendered) {
      process.stderr.write(
        'build-skill-references: docs/SKILL-REFERENCES.md is stale. Run `pnpm derive`.\n',
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `build-skill-references: register fresh, ${String(named.length)} skill(s) named from code.\n`,
    );
    return;
  }
  writeFileSync(REGISTER, rendered);
  process.stdout.write(
    `build-skill-references: docs/SKILL-REFERENCES.md written, ${String(named.length)} skill(s) named from code.\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
