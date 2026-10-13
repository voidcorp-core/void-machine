/**
 * A failed install must not leave rules for files it never wrote.
 *
 * The ignore block enumerates the agents the receipt owns -- no pattern can tell
 * `doctrine-critic` from an agent the project wrote under the same name, so the
 * names are listed one by one. It was written before the file transaction and
 * outside its scope, so an install that failed afterwards left a repository
 * ignoring agent paths that are not on disk. An agent the project then wrote
 * under one of those names would be invisible to git, silently, at the first
 * clone: the exact loss the enumeration exists to prevent, reintroduced on the
 * failure path (DEV-665).
 *
 * The failure below is a real one, and it is the one that actually happens: a
 * managed file replaced by a directory, which the second install refuses
 * to overwrite. Nothing about the transaction is stubbed. Only
 * `process.exit` is, so the runner survives to read the repository afterwards --
 * the same treatment `doctor.test.ts` gives it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { init } from '../../packages/cli/src/commands/init.js';
import { update } from '../../packages/cli/src/commands/update.js';

let dir: string;
let cwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'void-ignore-tx-'));
  cwd = process.cwd();
  process.chdir(dir);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${String(code ?? 0)})`);
  }) as never);
});
afterEach(() => {
  process.chdir(cwd);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const exclude = (): string => {
  try {
    return readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8');
  } catch {
    return '';
  }
};

/** Every agent path the block claims, whether or not it is on disk. */
function claimedAgentPaths(): readonly string[] {
  return exclude()
    .split('\n')
    .map((rule) => rule.trim())
    .filter((rule) => rule.startsWith('.claude/agents/') && rule.endsWith('.md'));
}

/** A second install that cannot commit: a directory occupies an owned file. */
async function failingSecondInstall(): Promise<void> {
  const target = join(dir, '.void', 'installed', 'PHILOSOPHY.md');
  rmSync(target);
  mkdirSync(target);
  await expect(init(['--runtime', 'claude', '--no-interactive'])).rejects.toThrow(/process\.exit\(1\)/);
}

describe('the ignore block never outlives a transaction that failed', () => {
  it('restores edited delivered files and names every restored path', async () => {
    await init(['--runtime', 'claude', '--no-interactive']);
    const paths = ['.claude/skills/void-tdd/SKILL.md', '.void/installed/PHILOSOPHY.md'];
    const originals = paths.map((path) => readFileSync(join(dir, path), 'utf8'));
    for (const path of paths) writeFileSync(join(dir, path), '# locally changed\n');
    const printed: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
      printed.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    });
    await init(['--runtime', 'claude', '--no-interactive']);
    expect(printed.join('')).toContain('restored');
    paths.forEach((path, index) => {
      expect(printed.join('')).toContain(path);
      expect(readFileSync(join(dir, path), 'utf8')).toBe(originals[index]);
    });
  });
  it('claims no agent path the install did not write', async () => {
    const temporary = join(dir, 'temporary');
    mkdirSync(temporary);
    vi.stubEnv('TMPDIR', temporary);
    vi.stubEnv('TMP', temporary);
    vi.stubEnv('TEMP', temporary);
    await init(['--runtime', 'claude', '--no-interactive']);
    // The project cleared them out; whether it was right to is not the question.
    // What matters is that the failed install below does not claim them back.
    rmSync(join(dir, '.claude', 'agents'), { recursive: true, force: true });

    let stageAtExit: string[] | undefined;
    vi.mocked(process.exit).mockImplementationOnce((code) => {
      stageAtExit = readdirSync(temporary).filter((name) => name.startsWith('void-init-stage-'));
      throw new Error(`process.exit(${String(code ?? 0)})`);
    });
    await failingSecondInstall();

    // Throwing from a mocked exit runs finally; a real process.exit does not.
    // Observe cleanup at the exit boundary, before the mock can mask a leak.
    expect(stageAtExit).toEqual([]);

    const absent = claimedAgentPaths().filter((path) => !existsSync(join(dir, ...path.split('/'))));
    expect(absent).toEqual([]);
  });

  it('refuses legacy layout before update can leave an unrecoverable repair', async () => {
    await init(['--runtime', 'claude', '--no-interactive']);
    // Update owns a global transaction before classifying the project. Give this
    // refusal proof its own physical store, not Vitest's shared /var tmp alias
    // or a launcher selected from the developer's PATH.
    const home = join(realpathSync(dir), 'fixture-home');
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('VOID_GLOBAL_DIR', join(home, '.void'));
    vi.stubEnv('PATH', dirname(process.execPath));
    const legacy = join(dir, '.void/state.json');
    const migrated = join(dir, '.void/machine/status.json');
    const bytes = Buffer.from('{"score":1}\n');
    writeFileSync(legacy, bytes);
    const philosophy = join(dir, '.void/installed/PHILOSOPHY.md');
    rmSync(philosophy);
    mkdirSync(philosophy);
    const printed: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
      printed.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    });

    await expect(update([], { fetcher: async () => {
      throw new Error('Legacy refusal must precede acquisition');
    } })).rejects.toThrow(/Legacy layout at/);

    expect(readFileSync(legacy)).toEqual(bytes);
    expect(existsSync(migrated)).toBe(false);
    expect(printed.join('')).not.toContain('Prior layout repairs remain applied');
  });

  // The reason the block was written before the transaction in the first place.
  // Trading a silent ignore for a `git clean` that carries off the install would
  // be a worse bargain than the defect.
  it('still hides what the harness generates, so a clean cannot take it', async () => {
    await init(['--runtime', 'claude', '--no-interactive']);

    await failingSecondInstall();

    expect(exclude()).toContain('.void/machine/');
  });

  it('claims every agent once the install did commit', async () => {
    await init(['--runtime', 'claude', '--no-interactive']);

    expect(exclude()).toContain('.claude/agents/doctrine-critic.md');
    expect(claimedAgentPaths().length).toBeGreaterThan(1);
  });
});

// `.gitignore` beats `info/exclude`, which is the right way round: a project
// rule must win over ours. What is not right is winning in silence. The project
// that prompted this carried `.void/*` from years before the harness, so its
// clone had no config.json, no install-manifest.json and no hook runner, while
// `.claude/settings.json` was committed and named seven hooks pointing at them.
describe('init says so when a project rule hides what it just installed', () => {
  it('names the path and the rule instead of reporting a clean install', async () => {
    writeFileSync(join(dir, '.gitignore'), '.void/*\n!.void/PROJECT-DOCTRINE.md\n');
    const printed: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
      printed.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    });

    await init(['--runtime', 'claude', '--no-interactive']);

    const out = printed.join('');
    expect(out).toContain('.void/config.json');
    expect(out).toContain('.gitignore:1:.void/*');
  });

  it('says nothing on a project whose rules leave the harness visible', async () => {
    const printed: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
      printed.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    });

    await init(['--runtime', 'claude', '--no-interactive']);

    expect(printed.join('')).not.toContain('hidden from git by a project rule');
  });
});
