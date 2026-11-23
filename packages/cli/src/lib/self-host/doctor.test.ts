import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  diagnoseSelfHost,
  selfHostChildEnvironment,
} from './doctor.js';
import {
  syncSelfHost,
  type BuildHookBundle,
  type SelfHostSyncResult,
} from './compile.js';
import { SELF_HOST_RECEIPT_PATH } from './receipt.js';
import { wireSelfHostRuntimeSurfaces } from './wire.js';

const REPO = resolve(import.meta.dirname, '../../../../..');
const roots: string[] = [];
const buildHookBundle: BuildHookBundle = async ({ outfile }) => {
  await cp(join(REPO, 'packages/core/hooks/_void-hook.mjs'), outfile);
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ));
});

/**
 * One real compilation for the whole file, copied per test.
 *
 * Every test below needs the same thing: a freshly published shadow artifact of
 * the real repository -- the real one, because the doctor checks its agents
 * against the canonical specialist catalog of the running CLI, which a smaller
 * fixture could not satisfy. Compiling it once per test cost about 900 ms each
 * and made every duration a function of how busy the machine was; copying the
 * 137-file result costs about 110 ms. Most tests then tamper with their own
 * copy, which is exactly why each gets one -- and why the template, built
 * before any test and never written to, introduces no order between them.
 *
 * The hook carries its own budget because it is the one place here allowed to do
 * the real work; nothing it asserts depends on how long it takes.
 */
let greenArtifact: string;
let template: SelfHostSyncResult;

beforeAll(async () => {
  greenArtifact = await mkdtemp(join(tmpdir(), 'void-self-doctor-template-'));
  template = await syncSelfHost(REPO, {
    generatedRoot: greenArtifact,
    buildHookBundle,
    wireRuntimeSurfaces: wireSelfHostRuntimeSurfaces,
    mode: 'shadow',
  });
}, 60_000);

afterAll(async () => {
  await rm(greenArtifact, { recursive: true, force: true });
});

async function generatedFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'void-self-doctor-'));
  roots.push(root);
  await cp(greenArtifact, root, { recursive: true });
  return root;
}

/**
 * The hash the template was compiled from, handed back instead of re-read.
 *
 * Hashing the real repository is 725 files and 175 ms idle, 600 ms under a
 * loaded machine, and none of the tests using this are about the hash: they are
 * about what the doctor concludes once the hash matches. Two things are proven
 * elsewhere and not repeated here: `compile.test.ts` proves the hash function
 * itself, that it moves when a source moves and that a second reading of an
 * unchanged tree reproduces the receipt's value. What `compile.test.ts` cannot
 * prove is that the doctor reaches that function when nothing is injected, so
 * exactly one test below leaves `computeSourceHash` undefined and pays the real
 * hash for it. The test that needs a mismatch injects its own.
 */
function templateSourceHash(): Promise<string> {
  return Promise.resolve(template.sourceHash);
}

describe('diagnoseSelfHost', () => {
  it('never forwards ambient credentials to runtime or hook probes', () => {
    const childEnvironment = selfHostChildEnvironment(
      {
        PATH: '/trusted/bin',
        LANG: 'fr_FR.UTF-8',
        HOME: '/Users/private',
        ANTHROPIC_API_KEY: 'secret-anthropic',
        OPENAI_API_KEY: 'secret-openai',
        NPM_TOKEN: 'secret-npm',
      },
      {
        VOID_PROJECT_ROOT: '/project',
      },
    );

    expect(childEnvironment).toEqual({
      PATH: '/trusted/bin',
      LANG: 'fr_FR.UTF-8',
      VOID_PROJECT_ROOT: '/project',
    });
  });

  /**
   * The one diagnosis that reaches the runtime inspections, and so the one that
   * spawns the compiled hook for each runtime: `hook-claude` and `hook-codex`
   * report `ok` only if the artifact's runner really fired. That is the file's
   * real proof and it is process spawning, which no fixture makes cheap, so its
   * budget is stated here rather than raised for every test in a config.
   */
  it('keeps a valid artifact degraded when native runtimes are unavailable', async () => {
    const generatedRoot = await generatedFixture();
    const diagnosis = await diagnoseSelfHost(REPO, {
      generatedRoot,
      computeSourceHash: templateSourceHash,
      runtimeAvailable: () => false,
      probeEventReplay: async () => ({ ok: true, detail: 'canonical replay proven' }),
    });

    expect(diagnosis.state).toBe('degraded');
    expect(diagnosis.blocking).toBe(false);
    expect(diagnosis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'receipt', status: 'ok' }),
      expect.objectContaining({ id: 'discovery', status: 'ok' }),
      expect.objectContaining({ id: 'hook-claude', status: 'ok' }),
      expect.objectContaining({ id: 'hook-codex', status: 'ok' }),
      expect.objectContaining({ id: 'event-replay', status: 'ok' }),
      expect.objectContaining({ id: 'runtime-claude', status: 'degraded' }),
      expect.objectContaining({ id: 'runtime-codex', status: 'degraded' }),
    ]));
  }, 60_000);

  it('distinguishes source staleness from owned-file drift', async () => {
    const generatedRoot = await generatedFixture();
    const stale = await diagnoseSelfHost(REPO, {
      generatedRoot,
      computeSourceHash: async () => 'f'.repeat(64),
      runtimeAvailable: () => false,
      probeEventReplay: async () => ({ ok: true, detail: 'ok' }),
    });
    expect(stale.state).toBe('stale');
    expect(stale.blocking).toBe(true);

    await writeFile(
      join(generatedRoot, 'current/.void/hooks/_void-hook.mjs'),
      'tampered',
    );
    const drifted = await diagnoseSelfHost(REPO, {
      generatedRoot,
      computeSourceHash: templateSourceHash,
      runtimeAvailable: () => false,
      probeEventReplay: async () => ({ ok: true, detail: 'ok' }),
    });
    expect(drifted.state).toBe('drifted');
    expect(drifted.blocking).toBe(true);
  });

  /**
   * The one diagnosis that hashes the real repository through the doctor's own
   * default. Every other diagnosis here injects the template's hash, which
   * bypasses `options.computeSourceHash ?? hashSelfHostSource`; replace or drop
   * that default and this is the only test that notices. It pays one real hash
   * on purpose, then stops before any process is spawned.
   *
   * The receipt is rewritten with a hash nothing produced, so the doctor's
   * comparison fails on the receipt's side alone and the `stale` branch carries
   * the hash the doctor computed. Two defaults survive a test that tampers an
   * owned file instead and expects `drifted` with the receipt's own value: a
   * constant, if it happens to be the template's, and a default that hands the
   * receipt back, which the `receipt` in scope at that line makes one line
   * long. Here the constant answers with a hash that is not the template's,
   * and the echo answers `receipt.sourceHash`, which now equals the foreign
   * value, so the doctor reads the sources as current and moves on to the
   * runtime probes: no `stale`, and a `sourceHash` that is not the template's.
   */
  it('hashes the real repository through its default when no hash is injected', async () => {
    const generatedRoot = await generatedFixture();
    const receiptPath = join(generatedRoot, 'current', SELF_HOST_RECEIPT_PATH);
    const receipt: unknown = JSON.parse(await readFile(receiptPath, 'utf8'));
    await writeFile(
      receiptPath,
      JSON.stringify({ ...(receipt as object), sourceHash: 'e'.repeat(64) }),
    );
    const diagnosis = await diagnoseSelfHost(REPO, {
      generatedRoot,
      runtimeAvailable: () => false,
      probeEventReplay: async () => ({ ok: true, detail: 'ok' }),
    });
    expect(diagnosis.state).toBe('stale');
    expect(diagnosis.sourceHash).toBe(template.sourceHash);
  });

  it('does not let a shadow receipt impersonate the release gate', async () => {
    const generatedRoot = await generatedFixture();
    const diagnosis = await diagnoseSelfHost(REPO, {
      generatedRoot,
      mode: 'release-gate',
      runtimeAvailable: () => false,
      probeEventReplay: async () => ({ ok: true, detail: 'ok' }),
    });
    expect(diagnosis.state).toBe('stale');
    expect(diagnosis.blocking).toBe(true);
  });

  it('fails closed on an unexpected file inside the owned artifact', async () => {
    const generatedRoot = await generatedFixture();
    await writeFile(join(generatedRoot, 'current', 'unexpected.txt'), 'injected');
    const diagnosis = await diagnoseSelfHost(REPO, {
      generatedRoot,
      computeSourceHash: templateSourceHash,
      runtimeAvailable: () => false,
      probeEventReplay: async () => ({ ok: true, detail: 'ok' }),
    });
    expect(diagnosis.state).toBe('drifted');
    expect(diagnosis.checks[0]?.detail).toContain('unexpected.txt');
  });
});
