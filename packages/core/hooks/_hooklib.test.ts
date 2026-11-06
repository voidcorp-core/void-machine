import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// _hooklib.sh is the SOURCED library every PreToolUse hook uses to parse the
// agent's tool-call JSON. These tests cover `hooklib_edits`, the runtime-agnostic
// edit stream that lets a content-scanning hook iterate instead of assuming
// Claude's single-file Edit/Write shape:
//   - Claude: Edit|Write     -> one record (file_path, content|new_string)
//   - Codex:  apply_patch    -> one record per "*** (Add|Update) File:" section,
//                               carrying only that section's ADDED (+) lines.
// Without it, wiring the content-scan hooks for Codex would fire them against an
// empty payload — a wired-but-dead hook, a silent enforcement hole.
const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, '_hooklib.sh');
// Resolve before the no-jq fixtures restrict PATH; login-shell state is irrelevant.
const BASH = execFileSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim();

const RS = '\x1e'; // record separator: ends one <path,content> record
const US = '\x1f'; // unit separator: splits path from content

interface Edit {
  readonly path: string;
  readonly content: string;
}

const NO_JQ_TOOLS = ['awk', 'cat', 'git', 'grep', 'sed', 'head', 'basename', 'tr', 'dirname', 'env'];
let noJqPath: string;

beforeAll(() => {
  noJqPath = mkdtempSync(join(tmpdir(), 'vh-hooklib-no-jq-'));
  const locations = spawnSync('/bin/sh', ['-c', NO_JQ_TOOLS.map((tool) => `command -v ${tool}`).join('\n')], {
    encoding: 'utf8',
  }).stdout.trim().split('\n');
  for (const location of locations) {
    if (!location.startsWith('/')) continue;
    symlinkSync(location, join(noJqPath, location.split('/').pop() ?? ''));
  }
});

afterAll(() => {
  rmSync(noJqPath, { recursive: true, force: true });
});

/** Feed a tool-call JSON to hooklib_edits and decode the record stream. */
function runEdits(input: string): Edit[] {
  const res = spawnSync(BASH, ['-c', `source "${lib}"; hooklib_read; hooklib_edits`], {
    input,
    encoding: 'utf8',
  });
  const out = res.stdout ?? '';
  return out
    .split(RS)
    .filter((r) => r.length > 0)
    .map((r) => {
      const i = r.indexOf(US);
      return { path: r.slice(0, i), content: r.slice(i + 1) };
    });
}

describe('hooklib_edits — Claude Edit|Write shape', () => {
  it('yields one record from a Write (file_path + content)', () => {
    const edits = runEdits(
      JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: 'src/a.ts', content: 'const x = 1\n' },
      }),
    );
    expect(edits).toEqual([{ path: 'src/a.ts', content: 'const x = 1\n' }]);
  });

  it('yields one record from an Edit (file_path + new_string)', () => {
    const edits = runEdits(
      JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: 'src/b.ts', old_string: 'a', new_string: 'const y: any = 2\n' },
      }),
    );
    expect(edits).toEqual([{ path: 'src/b.ts', content: 'const y: any = 2\n' }]);
  });
});

describe('hooklib_edits — Codex apply_patch shape', () => {
  it('yields the ADDED lines only, so a removed or untouched line never trips a scan', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/c.ts',
      '@@ context',
      ' const untouched = console.log',
      '-const removed: any = 1',
      '+const added = 2',
      '*** End Patch',
    ].join('\n');
    const edits = runEdits(JSON.stringify({ tool_name: 'apply_patch', tool_input: { input: patch } }));
    expect(edits).toEqual([{ path: 'src/c.ts', content: 'const added = 2\n' }]);
  });

  it('yields one record per file in a multi-file patch', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/one.ts',
      '+const one = 1',
      '*** Add File: src/two.ts',
      '+const two = 2',
      '+const three = 3',
      '*** End Patch',
    ].join('\n');
    const edits = runEdits(JSON.stringify({ tool_name: 'apply_patch', tool_input: { input: patch } }));
    expect(edits).toEqual([
      { path: 'src/one.ts', content: 'const one = 1\n' },
      { path: 'src/two.ts', content: 'const two = 2\nconst three = 3\n' },
    ]);
  });

  it('emits no record for a Delete File section (nothing to content-scan)', () => {
    const patch = ['*** Begin Patch', '*** Delete File: src/gone.ts', '*** End Patch'].join('\n');
    expect(runEdits(JSON.stringify({ tool_name: 'apply_patch', tool_input: { input: patch } }))).toEqual([]);
  });

  it('reads the patch from .tool_input.patch as well as .input', () => {
    const patch = ['*** Begin Patch', '*** Update File: src/d.ts', '+const d = 4', '*** End Patch'].join('\n');
    const edits = runEdits(JSON.stringify({ tool_name: 'apply_patch', tool_input: { patch } }));
    expect(edits).toEqual([{ path: 'src/d.ts', content: 'const d = 4\n' }]);
  });

  it('does not mistake a +++ diff header for an added line', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/e.ts',
      '+++ b/src/e.ts',
      '+const e = 5',
      '*** End Patch',
    ].join('\n');
    const edits = runEdits(JSON.stringify({ tool_name: 'apply_patch', tool_input: { patch } }));
    expect(edits).toEqual([{ path: 'src/e.ts', content: 'const e = 5\n' }]);
  });
});

describe('hooklib_edits — without jq', () => {
  /** Same call, but with jq unresolvable. */
  function runEditsNoJq(input: string): Edit[] {
    const res = spawnSync(BASH, ['-c', `source "${lib}"; hooklib_read; hooklib_edits`], {
      input,
      encoding: 'utf8',
      env: { ...process.env, PATH: noJqPath },
    });
    return (res.stdout ?? '')
      .split(RS)
      .filter((r) => r.length > 0)
      .map((r) => {
        const i = r.indexOf(US);
        return { path: r.slice(0, i), content: r.slice(i + 1) };
      });
  }

  // The PATH-only hooks (tdd-guard, auto-format) must keep enforcing on a
  // jq-less machine exactly as they did before this stream existed. The
  // content-scanning hooks are unaffected: they fail closed via
  // hooklib_require_jq before ever reading a record (#63).
  it('still yields the Claude file_path, with no content', () => {
    const edits = runEditsNoJq(
      JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'src/a.ts', content: 'x' } }),
    );
    expect(edits).toEqual([{ path: 'src/a.ts', content: '' }]);
  });
});

describe('hooklib scalar and content extraction', () => {
  const call = JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: 'apps/web/src/x.ts', content: 'const value = 1;' },
  });

  function run(body: string, path = process.env.PATH): { code: number; stdout: string; stderr: string } {
    const result = spawnSync(BASH, ['-c', `set -euo pipefail; source "${lib}"; ${body}`], {
      input: call,
      encoding: 'utf8',
      env: { ...process.env, ...(path === undefined ? {} : { PATH: path }) },
    });
    return {
      code: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }

  it.each([
    ['with jq', process.env.PATH],
    ['without jq', noJqPath],
  ])('reads scalar fields %s', (_case, path) => {
    const result = run(
      'hooklib_read; printf "%s|%s" "$(hooklib_tool)" "$(hooklib_file)"',
      path,
    );

    expect(result).toMatchObject({ code: 0, stdout: 'Write|apps/web/src/x.ts' });
  });

  it('returns exact content when jq is present', () => {
    expect(run('hooklib_read; hooklib_content').stdout.trimEnd()).toBe('const value = 1;');
  });

  it('fails closed with an actionable error when exact content cannot be read', () => {
    const result = run('hooklib_read; hooklib_require_jq test-hook', noJqPath);

    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/jq is required[\s\S]*Blocking[\s\S]*void-machine doctor/);
  });
});

describe('hooklib path normalization', () => {
  function runRelpath(path: string, projectRoot?: string): string {
    return spawnSync(
      BASH,
      ['-c', `source "${lib}"; hooklib_relpath "$1"`, '_', path],
      {
        encoding: 'utf8',
        env: { ...process.env, ...(projectRoot === undefined ? {} : { CLAUDE_PROJECT_DIR: projectRoot }) },
      },
    ).stdout;
  }

  it('passes a relative path through unchanged', () => {
    expect(runRelpath('apps/web/src/x.ts')).toBe('apps/web/src/x.ts');
  });

  it('strips the physical project root from an absolute path', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'vh-hooklib-root-'));
    mkdirSync(join(projectRoot, 'apps', 'web', 'src'), { recursive: true });

    expect(runRelpath(join(projectRoot, 'apps/web/src/x.ts'), projectRoot)).toBe(
      'apps/web/src/x.ts',
    );
  });
});

describe('hooklib_edits — degenerate payloads', () => {
  it('emits nothing when there is neither a file_path nor a patch', () => {
    expect(runEdits(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }))).toEqual([]);
  });

  it('emits nothing on a non-JSON payload rather than throwing', () => {
    expect(runEdits('not json at all')).toEqual([]);
  });
});
