/**
 * Integration tests for the `doctor` command.
 *
 * doctor renders to process.stdout and calls process.exit(1) when any check
 * fails. We run it against a temp cwd with stdout captured and process.exit
 * stubbed to throw, so we can assert on the rendered report without the test
 * runner exiting. `--no-remote` keeps the run offline (no marketplace fetch).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctor } from '../../packages/cli/src/commands/doctor.js';
import { init } from '../../packages/cli/src/commands/init.js';
import { update } from '../../packages/cli/src/commands/update.js';

let originalCwd: string;
let dir: string;
let output: string;

beforeEach(() => {
  originalCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'doctor-test-'));
  process.chdir(dir);
  output = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    return true;
  });
  // process.exit must not kill the test runner; surface the code as a throw.
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as never);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Run doctor, swallowing the stubbed process.exit throw; return rendered output. */
async function runDoctor(): Promise<string> {
  try {
    await doctor(['--no-remote']);
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith('process.exit(')) throw err;
  }
  return output;
}

describe('doctor', () => {
  it('reports missing harness files in an empty project and exits 1', async () => {
    const out = await runDoctor();
    expect(out).toContain('.void/config.json missing');
    expect(out).toContain('failed');
  });

  it('requires neither jq nor gh under --no-remote (fully offline)', async () => {
    const out = await runDoctor();
    expect(out).not.toContain('jq');
    expect(out).not.toContain('gh CLI');
  });

  it('accepts a valid .void/config.json', async () => {
    mkdirSync(join(dir, '.void'), { recursive: true });
    writeFileSync(join(dir, '.void', 'config.json'), JSON.stringify({ core: '0.5.4' }));
    const out = await runDoctor();
    expect(out).toContain('valid JSON');
  });

  it('flags an invalid .void/config.json', async () => {
    mkdirSync(join(dir, '.void'), { recursive: true });
    writeFileSync(join(dir, '.void', 'config.json'), '{ not json');
    const out = await runDoctor();
    expect(out).toContain('invalid JSON');
  });

  it('does NOT ding a missing AGENTS.md on a Claude-only project (docs are per-runtime)', async () => {
    // CLAUDE.md present (claude detected), no Codex footprint -> AGENTS.md is not this project's concern.
    writeFileSync(join(dir, 'CLAUDE.md'), '# CLAUDE.md\n<!-- void-harness:begin -->\nx\n<!-- void-harness:end -->\n');
    const out = await runDoctor();
    expect(out).toContain('CLAUDE.md');
    expect(out).not.toContain('AGENTS.md');
  });

  it('checks AGENTS.md when Codex is detected, flagging a missing block', async () => {
    // A Codex footprint (.codex/) makes AGENTS.md this project's concern.
    mkdirSync(join(dir, '.codex'), { recursive: true });
    writeFileSync(join(dir, 'AGENTS.md'), '# AGENTS.md\n(no managed block here)\n');
    const out = await runDoctor();
    expect(out).toContain('AGENTS.md');
    expect(out).toContain('block missing');
  });

  it('reds a config-present project with NO runtime wired (guards against a false all-green)', async () => {
    mkdirSync(join(dir, '.void'), { recursive: true });
    writeFileSync(join(dir, '.void', 'config.json'), JSON.stringify({ core: '^0.17.0' }));
    // no CLAUDE.md/.claude, no AGENTS.md/.codex
    const out = await runDoctor();
    expect(out).toContain('no agent runtime wired');
    expect(out).toContain('failed');
  });

  it('a Codex-only project sees no Claude marketplace noise (no gh / settings checks)', async () => {
    mkdirSync(join(dir, '.codex'), { recursive: true });
    writeFileSync(join(dir, 'AGENTS.md'), '# AGENTS.md\n<!-- void-harness:begin -->\nx\n<!-- void-harness:end -->\n');
    const out = await runDoctor();
    expect(out).toContain('codex floor');
    expect(out).not.toContain('settings.json');
    expect(out).not.toContain('gh CLI');
  });

  it('checks local pack assets against config instead of marketplace settings', async () => {
    await init(['--runtime', 'claude', '--pack', 'nextjs', '--no-interactive']);
    output = '';

    const out = await runDoctor();

    expect(out).toContain('packs coherence');
    expect(out).toContain('local pack assets match');
    expect(out).not.toContain('pinned in config but not enabled');
  });

  // The doctrine file is created once from a template and its own first lines
  // tell the reader it is theirs. Writing one rule into it used to print
  // `x void manifest 1 file(s) differ` and exit 1, naming `hydrate` as the
  // remedy -- which restores nothing there, it re-records the hash. Proven at
  // this level and not only on `judgeLayout`, because the defect lived in what
  // `observeManifest` counted, one layer below the verdict.
  it('stays green after the project writes into its own doctrine file', async () => {
    await init(['--runtime', 'claude', '--no-interactive']);
    appendFileSync(join(dir, '.void', 'PROJECT-DOCTRINE.md'), '\n- never fetch in a component.\n');
    output = '';

    const out = await runDoctor();

    expect(out).toContain('assets match manifest');
    expect(out).toContain('co-owned file(s) carry project edits');
    expect(out).not.toContain('differ from manifest');
  });

  // Co-ownership licences writing INTO the file, never removing it, and it must
  // not become a hole a real drift hides in.
  it('still reports a managed asset whose bytes drifted, doctrine edited or not', async () => {
    await init(['--runtime', 'claude', '--no-interactive']);
    appendFileSync(join(dir, '.void', 'PROJECT-DOCTRINE.md'), '\n- a rule.\n');
    appendFileSync(join(dir, '.claude', 'skills', 'void-tdd', 'SKILL.md'), '\nedited by hand\n');
    output = '';

    const out = await runDoctor();

    expect(out).toContain('1 file(s) differ from manifest');
    // Naming it, because the alternative was rehashing the manifest by hand.
    expect(out).toContain('.claude/skills/void-tdd/SKILL.md');
  });

  // A real repository, because the defect is entirely about what git decides:
  // the project carried `.void/*` above the managed block, git does not descend
  // into an excluded directory, and install-manifest.json, config.json and the
  // hook runner were all untracked on a fresh clone while .claude/settings.json
  // named the hooks. The check read the lines and never asked git whether they won.
  it('names the project rule that hides a path the harness declares tracked', async () => {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), '.void/*\n!.void/PROJECT-DOCTRINE.md\n');
    await init(['--runtime', 'claude', '--no-interactive']);
    output = '';

    const out = await runDoctor();

    expect(out).toContain('void kept');
    expect(out).toContain('.void/config.json');
    expect(out).toContain('.gitignore:1:.void/*');
  });

  it('stays green on the same install without that rule', async () => {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    await init(['--runtime', 'claude', '--no-interactive']);
    output = '';

    const out = await runDoctor();

    expect(out).toContain('git keeps all');
    expect(out).not.toContain('cannot start without');
  });

  // With a programme at one path doctor printed eight autopilot lines; with the
  // same file at another it printed none, and a silent report reads as "no
  // active programme". Saying nothing about a thing you looked for is the one
  // answer a reader cannot tell from not having looked.
  it('says where it looked for a programme instead of falling silent', async () => {
    await init(['--runtime', 'claude', '--no-interactive']);
    output = '';

    const out = await runDoctor();

    expect(out).toContain('.void/program.md');
    expect(out).toContain('no active program');
  });

  it('runs the autopilot preconditions once a programme is declared', async () => {
    await init(['--runtime', 'claude', '--no-interactive']);
    writeFileSync(
      join(dir, '.void', 'program.md'),
      '---\nschemaVersion: 1\nstatus: executing\nprogram: p\nplan: docs/p.md\nspec: docs/s.md\nhumanGates: [merge]\n---\n',
    );
    output = '';

    const out = await runDoctor();

    expect(out).not.toContain('no active program');
  });

  it('reports the source repository as self-host not-installed instead of skipping green', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'void-harness' }));
    mkdirSync(join(dir, 'packages', 'cli'), { recursive: true });
    mkdirSync(join(dir, 'packages', 'core'), { recursive: true });

    const out = await runDoctor();

    expect(out).toContain('self-host');
    expect(out).toContain('not-installed');
    expect(out).not.toContain('skipped');
    expect(out).not.toContain('nothing to fix');
  });
});


describe('published lint boundaries', () => {
  it('diagnoses first Codex install and doctor from actual published ownership', async () => {
    const biome = JSON.stringify({ files: { includes: ['**'] } });
    const knip = JSON.stringify({ ignore: [] });
    writeFileSync(join(dir, 'biome.json'), biome);
    writeFileSync(join(dir, 'knip.json'), knip);
    await init(['--runtime', 'codex', '--no-interactive']);
    expect(output).toContain('lint boundary');
    expect(output).toContain('.void/hooks/');
    expect(output).toContain('knip boundary');
    expect(output).not.toContain('ownership unknown');
    output = '';
    const out = await runDoctor();
    expect(out).toContain('lint boundary');
    expect(out).toContain('knip boundary');
    expect(out).toContain('.void/hooks/');
    output = '';
    await update([]);
    expect(output).toContain('lint boundary');
    expect(output).toContain('knip boundary');
    expect(readFileSync(join(dir, 'biome.json'), 'utf8')).toBe(biome);
    expect(readFileSync(join(dir, 'knip.json'), 'utf8')).toBe(knip);
  });
});
