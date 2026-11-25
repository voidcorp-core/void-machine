import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { PRODUCT_IDENTITY } from '@voidcorp/hook-runner';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  hashSelfHostSource,
  syncSelfHost,
  type BuildHookBundle,
} from './compile.js';
import { readSelfHostReceipt, SELF_HOST_RECEIPT_PATH } from './receipt.js';
import {
  wireSelfHostRuntimeSurfaces,
  type WireSelfHostRuntimeSurfaces,
} from './wire.js';

const REPO = resolve(import.meta.dirname, '../../../../..');
const roots: string[] = [];

async function temporaryRoot(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `${name}-`));
  roots.push(root);
  return root;
}

const copyCommittedRunner: BuildHookBundle = async ({ outfile }) => {
  await cp(join(REPO, 'packages/core/dist/hooks/_void-hook.mjs'), outfile);
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ));
});

/**
 * A harness source repository small enough that compiling it costs nothing
 * worth measuring, so that no verdict below depends on how busy the machine is.
 *
 * The real repository is 725 hashed files and a 137-file artifact. Measured on
 * an idle machine, one sync of it costs about 900 ms; under a full concurrent
 * suite that became 3 s, and with a second suite running beside it, 10 s -- the
 * budget -- with nothing in the code having changed. A test whose verdict is
 * decided by machine load no longer asserts what it claims to.
 *
 * This fixture carries every path `syncSelfHost` reads: the shape that makes
 * `isHarnessSourceRepo` say yes, every hashed source input, and every core
 * input the compiler copies. Fifteen files. One test in this file still
 * compiles the real repository, and it is the one deliberately allowed to be
 * slow; the behaviours -- idempotence, rollback, refusal when sources move --
 * are properties of the orchestration, not of the corpus it runs on.
 */
const HARNESS_SOURCE_FIXTURE: Readonly<Record<string, string>> = {
  'package.json': `${JSON.stringify({ name: 'void-harness', private: true })}\n`,
  'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
  'AGENTS.md': '# Agents\n',
  'CLAUDE.md': '# Claude\n',
  'packages/cli/package.json': `${JSON.stringify({ name: PRODUCT_IDENTITY.packageName })}\n`,
  'packages/cli/src/index.ts': 'export const cli = true;\n',
  'packages/hook-runner/src/cli.ts': 'export const hook = true;\n',
  'packages/hook-runner/scripts/build-runtime.mjs': 'export const builder = true;\n',
  'packages/mission-engine/src/index.ts': 'export const engine = true;\n',
  'packages/core/src/.claude-plugin/plugin.json':
    `${JSON.stringify({ name: 'harness-core', hooks: {} })}\n`,
  'packages/core/src/agents/doctrine-critic.md': '---\nname: doctrine-critic\n---\n',
  'packages/core/src/skills/void-tdd/SKILL.md': '---\nname: void-tdd\n---\n',
  'packages/core/src/specialists/catalog.json': '[]\n',
  'packages/core/src/codex/hooks.json': '{}\n',
  'packages/core/src/PHILOSOPHY.md': '# Philosophy\n',
  'packages/core/src/PROJECT-DOCTRINE.template.md': '# Doctrine\n',
};

async function harnessSourceFixture(): Promise<string> {
  const root = await temporaryRoot('void-self-source');
  for (const [path, content] of Object.entries(HARNESS_SOURCE_FIXTURE)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

/**
 * The adapter seam `syncSelfHost` already exposes, with the real signature and
 * the kind of surface the real one writes: a runtime settings file and the
 * runtime doc, both inside the staged artifact. What the real adapters put
 * there is proven where they run for real, below and in `doctor.test.ts`.
 */
const wireFixtureSurfaces: WireSelfHostRuntimeSurfaces = async (input) => {
  await mkdir(join(input.artifactRoot, '.claude'), { recursive: true });
  await writeFile(join(input.artifactRoot, '.claude', 'settings.json'), '{}\n');
  await writeFile(
    join(input.artifactRoot, 'CLAUDE.md'),
    `<!-- void-harness ${input.sourceHash} -->\n`,
  );
};

/** Every file under `root`, with its content, so "unchanged" means all of it. */
async function treeSnapshot(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else {
        files.set(relative(root, path), await readFile(path, 'utf8'));
      }
    }
  }
  await visit(root);
  return files;
}

function fixtureSyncOptions(generatedRoot: string) {
  return {
    generatedRoot,
    buildHookBundle: copyCommittedRunner,
    wireRuntimeSurfaces: wireFixtureSurfaces,
  } as const;
}

describe('hashSelfHostSource', () => {
  it('changes when a current source input changes', async () => {
    const root = await harnessSourceFixture();
    const before = await hashSelfHostSource(root);
    const skill = join(root, 'packages/core/src/skills/void-tdd/SKILL.md');
    const current = await readFile(skill, 'utf8');
    await writeFile(skill, `${current}\nsource drift\n`);
    expect(await hashSelfHostSource(root)).not.toBe(before);
  });
});

describe('syncSelfHost', () => {
  /**
   * The file's single proof that the real compilation path works on the real
   * sources, and the one place deliberately allowed to be slow: its budget is
   * stated here, in the open, rather than raised for everyone in a config. No
   * assertion of its own depends on how long it takes.
   */
  it('compiles the real repository once, and leaves its native files alone', async () => {
    const generatedRoot = await temporaryRoot('void-self-real');
    const nativeFiles = ['AGENTS.md', 'CLAUDE.md'];
    const nativeBefore = await Promise.all(
      nativeFiles.map((file) => readFile(join(REPO, file))),
    );

    const result = await syncSelfHost(REPO, {
      generatedRoot,
      buildHookBundle: copyCommittedRunner,
      wireRuntimeSurfaces: wireSelfHostRuntimeSurfaces,
    });

    const current = join(generatedRoot, 'current');
    expect(result).toMatchObject({ changed: true, artifactRoot: current });
    expect(result.files).toBeGreaterThan(0);
    expect(await readSelfHostReceipt(current))
      .toMatchObject({ sourceHash: result.sourceHash });
    expect((await lstat(join(current, '.void', 'hooks', '_void-hook.mjs'))).isFile())
      .toBe(true);
    for (const [index, file] of nativeFiles.entries()) {
      expect(await readFile(join(REPO, file))).toEqual(nativeBefore[index]);
    }
  }, 60_000);

  it('is idempotent and never changes native repository files', async () => {
    // The hash stays real on both readings: re-hashing the sources and finding
    // the same value is what idempotence MEANS. It is cheap because the fixture
    // is, not because the reading was skipped.
    const source = await harnessSourceFixture();
    const generatedRoot = await temporaryRoot('void-self-generated');
    const options = { ...fixtureSyncOptions(generatedRoot) } as const;
    const sourceBefore = await treeSnapshot(source);

    const first = await syncSelfHost(source, options);
    const current = join(generatedRoot, 'current');
    const modifiedAt = (await lstat(current)).mtimeMs;
    const second = await syncSelfHost(source, options);

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.sourceHash).toBe(first.sourceHash);
    expect((await lstat(current)).mtimeMs).toBe(modifiedAt);
    expect(await treeSnapshot(source)).toEqual(sourceBefore);
    expect(await readSelfHostReceipt(current)).not.toHaveProperty('mode');
  });

  it.each(['shadow', 'warn', 'enforce', 'release-gate'])(
    'does not rebuild solely for legacy receipt mode %s', async (mode) => {
      const source = await harnessSourceFixture();
      const generatedRoot = await temporaryRoot('void-self-legacy');
      const options = fixtureSyncOptions(generatedRoot);
      await syncSelfHost(source, options);
      const current = join(generatedRoot, 'current');
      const receiptPath = join(current, SELF_HOST_RECEIPT_PATH);
      const receipt = await readSelfHostReceipt(current);
      await writeFile(receiptPath, JSON.stringify({ ...receipt, mode }));
      const before = await treeSnapshot(current);
      expect((await syncSelfHost(source, options)).changed).toBe(false);
      expect(await treeSnapshot(current)).toEqual(before);
    },
  );

  it('restores the last green artifact when publication fails', async () => {
    const source = await harnessSourceFixture();
    const generatedRoot = await temporaryRoot('void-self-rollback');
    await syncSelfHost(source, fixtureSyncOptions(generatedRoot));
    const before = await treeSnapshot(join(generatedRoot, 'current'));
    await writeFile(join(source, 'packages/core/src/PHILOSOPHY.md'), '# Changed\n');

    await expect(syncSelfHost(source, {
      ...fixtureSyncOptions(generatedRoot),
      failAfterBackup: true,
    })).rejects.toThrow('injected self-host publication failure');

    expect(await treeSnapshot(join(generatedRoot, 'current'))).toEqual(before);
    expect(await readdir(generatedRoot)).toEqual(['current']);
  });

  it('refuses to publish when sources change during compilation', async () => {
    // The sources really move, from inside the compilation, and the real hash
    // function is what notices: the guard is the second reading, and injecting
    // two different values would prove the comparison rather than the guard.
    const source = await harnessSourceFixture();
    const generatedRoot = await temporaryRoot('void-self-concurrent');

    await expect(syncSelfHost(source, {
      ...fixtureSyncOptions(generatedRoot),
      wireRuntimeSurfaces: async (input) => {
        await wireFixtureSurfaces(input);
        await writeFile(join(source, 'packages/core/src/PHILOSOPHY.md'), '# Moved\n');
      },
    })).rejects.toThrow('self-host sources changed during compilation');

    expect(await lstat(join(generatedRoot, 'current')).catch(() => undefined))
      .toBeUndefined();
    expect(await readdir(generatedRoot)).toEqual([]);
  });
});
