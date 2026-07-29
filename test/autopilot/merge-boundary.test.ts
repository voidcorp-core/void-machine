/**
 * Autopilot publishes; it does not merge.
 *
 * That boundary is the safety argument of the whole design: a human reads one
 * reconciled pull request and decides. It is also the boundary most likely to be
 * crossed by a helpful edit — arming `--auto` "just for low-risk clusters" is a
 * two-word change that reads as a convenience and removes the gate.
 *
 * So it is a gate. What it inspects is the argv the code can actually emit, not
 * the words the code uses: a comment saying "never merge" and a guard rejecting
 * `--auto-merge` both name the thing they forbid, and a substring scan would
 * fail the code that enforces the rule while passing code that merges through a
 * variable. The command literals are where merging would have to appear.
 *
 * The superseded `lib/backlog/` engine still carries the auto-merge it was built
 * with; the cutover deletes it wholesale, and pinning its shape here would only
 * protect code on its way out.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const SURFACES = ['packages/cli/src/lib/autopilot', 'packages/cli/src/commands/autopilot.ts'];

function filesUnder(relative: string): string[] {
  const absolute = join(ROOT, relative);
  if (statSync(absolute).isFile()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(relative, entry.name)) : [join(absolute, entry.name)],
  );
}

/** Active source only: a test may legitimately name what it forbids. */
const ACTIVE = SURFACES.flatMap(filesUnder)
  .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts'))
  .map((path) => ({ path: path.slice(ROOT.length), text: readFileSync(path, 'utf8') }));

interface Argv {
  readonly file: string;
  readonly source: string;
  readonly tokens: readonly string[];
}

/**
 * Every array literal that starts with `'git'` or `'gh'`, read to its matching
 * bracket. Anchoring on the program name rather than on every `[` is what keeps
 * this exhaustive: a scan that walks all brackets consumes `string[]` and `[]`
 * first and silently skips the command that follows.
 */
function argvLiterals(file: string, text: string): Argv[] {
  const found: Argv[] = [];
  const start = /\[\s*'(?:git|gh)'/g;

  for (const match of text.matchAll(start)) {
    let depth = 0;
    let end = match.index;
    for (; end < text.length; end += 1) {
      if (text[end] === '[') depth += 1;
      else if (text[end] === ']') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const source = text.slice(match.index, end + 1);
    found.push({
      file,
      source: source.replace(/\s+/g, ' '),
      // Quoted words only: an interpolated value is not a subcommand.
      tokens: [...source.matchAll(/'([^']*)'/g)].map((token) => token[1] ?? ''),
    });
  }
  return found;
}

const COMMANDS = ACTIVE.flatMap((file) => argvLiterals(file.path, file.text));

function violating(predicate: (command: Argv) => boolean): string[] {
  return COMMANDS.filter(predicate).map((command) => `${command.file}: ${command.source}`);
}

describe('the argv the autopilot surface can emit', () => {
  it('was actually collected, so an empty result means clean and not mis-scoped', () => {
    expect(ACTIVE.length).toBeGreaterThan(20);
    expect(COMMANDS.length).toBeGreaterThan(4);
    // Sanity on the extractor itself: the publish push is one of the commands.
    expect(COMMANDS.some((command) => command.tokens[0] === 'git' && command.tokens[1] === 'push')).toBe(true);
  });

  it('never asks gh to merge a pull request', () => {
    expect(
      violating((command) => command.tokens[0] === 'gh' && command.tokens.includes('merge')),
    ).toEqual([]);
  });

  it('never arms an auto-merge flag', () => {
    expect(violating((command) => command.tokens.some((token) => token.startsWith('--auto')))).toEqual([]);
  });

  it('never calls a merge endpoint through the API client', () => {
    expect(
      violating(
        (command) => command.tokens[0] === 'gh' && command.tokens.some((token) => /\/merge\b/.test(token)),
      ),
    ).toEqual([]);
  });

  it('never forces a push', () => {
    const forced = (command: Argv): boolean =>
      command.tokens.includes('push') &&
      command.tokens.some(
        (token) => token === '-f' || token.startsWith('--force') || token.startsWith('+refs/'),
      );

    expect(violating(forced)).toEqual([]);
  });

  it('never pushes a worker branch', () => {
    expect(
      violating(
        (command) =>
          command.tokens.includes('push') &&
          command.source.includes('autopilot-worker'),
      ),
    ).toEqual([]);
  });
});
