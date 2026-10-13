/**
 * The loop merges in exactly one place, and only on the head a verdict proves.
 *
 * Since the single merge mode the loop merges itself, `gh pr merge
 * --match-head-commit`, or arms the merge queue or an auto-merge request on the
 * same head, always on a head a local verdict passed. That argv is the boundary
 * most likely to be crossed by a helpful edit -- dropping `--match-head-commit`
 * "because the head was just read", or adding `--admin` to get past a slow
 * check, reads as a convenience and removes the proof.
 *
 * So it is a gate. What it inspects is the argv the code can actually emit, not
 * the words it uses: a comment saying "never merge" and a guard refusing
 * `--auto-merge` both name the thing they forbid, and a substring scan would
 * fail the code that enforces the rule. The command literals are where a merge
 * would have to appear.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const SURFACES = [
  'packages/cli/src/lib/autopilot',
  'packages/cli/src/commands/autopilot.ts',
  'packages/cli/src/commands/autopilot-loop.ts',
];

/** The one source allowed to arm or disarm a merge, named so the gate is exhaustive. */
const MERGE_SOURCE = 'packages/cli/src/commands/autopilot-loop.ts';

function filesUnder(relative: string): string[] {
  const absolute = join(ROOT, relative);
  if (statSync(absolute).isFile()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(relative, entry.name)) : [join(absolute, entry.name)],
  );
}

/** Active source only: a test may legitimately name what it forbids. */
const ACTIVE = SURFACES.flatMap(filesUnder)
  .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.includes('fixtures'))
  .map((path) => ({ path: path.slice(ROOT.length), text: readFileSync(path, 'utf8') }));

interface Argv {
  readonly file: string;
  readonly source: string;
  readonly tokens: readonly string[];
}

/**
 * Every array literal whose first word is a gh or git subcommand, read to its
 * matching bracket. The runners take argv without the program name, so the
 * literal starts at the subcommand: `['pr', 'merge', ...]`, `['push', ...]`.
 */
function argvLiterals(file: string, text: string): Argv[] {
  const found: Argv[] = [];
  const start = /\[\s*'(?:pr|api|push|run)'/g;
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
const MERGES = (command: Argv): boolean => command.tokens[0] === 'pr' && command.tokens[1] === 'merge';

function violating(predicate: (command: Argv) => boolean): string[] {
  return COMMANDS.filter(predicate).map((command) => `${command.file}: ${command.source}`);
}

describe('the argv the autopilot surface can emit', () => {
  it('was actually collected, so an empty result means clean and not mis-scoped', () => {
    expect(ACTIVE.length).toBeGreaterThan(10);
    expect(COMMANDS.length).toBeGreaterThan(4);
    expect(COMMANDS.filter(MERGES).length).toBeGreaterThan(0);
  });

  it('merges, arms and disarms from one file only', () => {
    expect(violating((command) => MERGES(command) && command.file !== MERGE_SOURCE)).toEqual([]);
  });

  // `--admin` bypasses the protection a repository adds on top of the verdict,
  // and deleting the branch removes the head a person may still need to read.
  // The merge method is the one the repository allows, read from its settings,
  // so no method is written into the argv by hand.
  it('binds every merge and arming to the head the verdict proves, and never bypasses', () => {
    for (const merge of COMMANDS.filter(MERGES)) {
      if (!merge.tokens.includes('--disable-auto')) {
        expect(merge.tokens, merge.source).toContain('--match-head-commit');
      }
      for (const forbidden of ['--admin', '--merge', '--squash', '--rebase', '--delete-branch']) {
        expect(merge.tokens, `${merge.source} ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('never merges through the API, only through gh pr merge on the head', () => {
    const direct = (command: Argv): boolean =>
      command.tokens.some((token) => /\/merge\b|mergePullRequest|enablePullRequestAutoMerge/.test(token));
    expect(violating(direct)).toEqual([]);
    const mutations = ACTIVE.filter((file) => /mutation[^`']*\bmergePullRequest\b/.test(file.text));
    expect(mutations.map((file) => file.path)).toEqual([]);
  });

  it('pushes nothing: a worker pushes its own branch, the loop only reads and merges', () => {
    expect(violating((command) => command.tokens[0] === 'push')).toEqual([]);
  });
});
