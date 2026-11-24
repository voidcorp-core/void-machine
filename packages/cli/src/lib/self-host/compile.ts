import { createHash, randomUUID } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire as createSourceRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { PRODUCT_COMMAND, voidMachinePath } from '@voidcorp/hook-runner';
import { pathToFileURL } from 'node:url';
import { isHarnessSourceRepo } from '../self-repo.js';
import {
  buildSelfHostReceipt,
  encodeSelfHostReceipt,
  readSelfHostReceipt,
  SELF_HOST_RECEIPT_PATH,
  type SelfHostMode,
  type SelfHostReceiptFileInput,
  selfHostReceiptDrift,
} from './receipt.js';
import type {
  WireSelfHostRuntimeInput,
  WireSelfHostRuntimeSurfaces,
} from './wire.js';

const MAX_SOURCE_FILES = 10_000;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_ARTIFACT_FILES = 5_000;
const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
const SOURCE_INPUTS = [
  'packages/core',
  'packages/cli/src',
  'packages/hook-runner/src',
  'packages/hook-runner/scripts',
  'packages/mission-engine/src',
  'package.json',
  'pnpm-lock.yaml',
] as const;
const HASH_EXCLUSIONS = new Set([
  'packages/core/hooks/_void-hook.mjs',
]);

function lexical(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface BuildHookBundleInput {
  readonly root: string;
  readonly outfile: string;
}

export type BuildHookBundle = (
  input: BuildHookBundleInput,
) => Promise<void>;

export interface SyncSelfHostOptions {
  readonly generatedRoot?: string;
  readonly buildHookBundle?: BuildHookBundle;
  readonly wireRuntimeSurfaces?: WireSelfHostRuntimeSurfaces;
  readonly computeSourceHash?: (root: string) => Promise<string>;
  readonly mode: SelfHostMode;
  /** Test-only fault injection after the previous artifact is backed up. */
  readonly failAfterBackup?: boolean;
}

export interface SelfHostSyncResult {
  readonly changed: boolean;
  readonly sourceHash: string;
  readonly mode: SelfHostMode;
  readonly files: number;
  readonly artifactRoot: string;
}

async function safeInfo(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch {
    return undefined;
  }
}

async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(path: string): Promise<void> {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      throw new Error(`self-host source contains a symbolic link: ${relative(root, path)}`);
    }
    if (info.isFile()) {
      const rel = relative(root, path).replaceAll('\\', '/');
      if (!HASH_EXCLUSIONS.has(rel)) files.push(path);
      return;
    }
    if (!info.isDirectory()) {
      throw new Error(`self-host source is not a regular file or directory: ${path}`);
    }
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => lexical(a.name, b.name))) {
      await visit(join(path, entry.name));
      if (files.length > MAX_SOURCE_FILES) {
        throw new Error(`self-host source exceeds ${MAX_SOURCE_FILES} files`);
      }
    }
  }
  for (const input of SOURCE_INPUTS) await visit(join(root, ...input.split('/')));
  return files.sort(lexical);
}

export async function hashSelfHostSource(root: string): Promise<string> {
  const canonicalRoot = resolve(root);
  const hash = createHash('sha256');
  let bytes = 0;
  for (const path of await sourceFiles(canonicalRoot)) {
    const content = await readFile(path);
    bytes += content.byteLength;
    if (bytes > MAX_SOURCE_BYTES) {
      throw new Error(`self-host source exceeds ${MAX_SOURCE_BYTES} bytes`);
    }
    const rel = relative(canonicalRoot, path).replaceAll('\\', '/');
    hash.update(rel);
    hash.update('\u0000');
    hash.update(String(content.byteLength));
    hash.update('\u0000');
    hash.update(content);
    hash.update('\u0000');
  }
  return hash.digest('hex');
}

async function sourceBuilder(root: string) {
  const requireFromSource = createSourceRequire(
    join(root, 'packages', 'cli', 'package.json'),
  );
  const esbuildUrl = pathToFileURL(requireFromSource.resolve('esbuild')).href;
  return import(esbuildUrl);
}

const defaultBuildHookBundle: BuildHookBundle = async ({ root, outfile }) => {
  const builder = await import(pathToFileURL(join(root, 'packages/hook-runner/scripts/build-runtime.mjs')).href);
  await builder.buildHookRuntime({ root, outfile });
};

const defaultWireRuntimeSurfaces = async (
  input: WireSelfHostRuntimeInput & { readonly root: string },
): Promise<void> => {
  const worker = join(dirname(input.overlayRoot), 'wire-runtime.cjs');
  const { build } = await sourceBuilder(input.root);
  await build({
    absWorkingDir: input.root,
    entryPoints: [join(input.root, 'packages/cli/src/lib/self-host/wire.ts')],
    alias: {
      '@voidcorp/mission-engine/events': join(
        input.root,
        'packages/mission-engine/src/events/index.ts',
      ),
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    outfile: worker,
    logLevel: 'silent',
  });
  const sourceModule = createSourceRequire(import.meta.url)(worker) as {
    readonly wireSelfHostRuntimeSurfaces?: WireSelfHostRuntimeSurfaces;
  };
  if (sourceModule.wireSelfHostRuntimeSurfaces === undefined) {
    throw new Error('compiled self-host runtime worker has no wire entry point');
  }
  await sourceModule.wireSelfHostRuntimeSurfaces(input);
};

async function copyCompilerCore(root: string, destination: string): Promise<void> {
  const source = join(root, 'packages', 'core');
  const inputs = [
    '.claude-plugin',
    'agents',
    'skills',
    'specialists',
    'codex',
    'PHILOSOPHY.md',
    'PROJECT-DOCTRINE.template.md',
  ];
  await mkdir(destination, { recursive: true });
  for (const input of inputs) {
    await cp(join(source, input), join(destination, input), { recursive: true });
  }
  await mkdir(join(destination, 'hooks'), { recursive: true });
}

async function collectArtifactFiles(
  artifactRoot: string,
): Promise<SelfHostReceiptFileInput[]> {
  const files: SelfHostReceiptFileInput[] = [];
  let bytes = 0;
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => lexical(a.name, b.name))) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`self-host artifact contains a symbolic link: ${path}`);
      }
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        const info = await lstat(path);
        const content = await readFile(path);
        bytes += content.byteLength;
        if (files.length >= MAX_ARTIFACT_FILES || bytes > MAX_ARTIFACT_BYTES) {
          throw new Error('self-host artifact exceeds its bounded file or byte budget');
        }
        files.push({
          path: relative(artifactRoot, path).replaceAll('\\', '/'),
          content,
          mode: info.mode & 0o777,
        });
      }
    }
  }
  await visit(artifactRoot);
  return files;
}

async function compileArtifact(input: {
  readonly root: string;
  readonly artifactRoot: string;
  readonly overlayRoot: string;
  readonly finalRoot: string;
  readonly sourceHash: string;
  readonly mode: SelfHostMode;
  readonly buildHookBundle: BuildHookBundle;
  readonly wireRuntimeSurfaces: WireSelfHostRuntimeSurfaces;
}): Promise<number> {
  await copyCompilerCore(input.root, input.overlayRoot);
  await input.buildHookBundle({
    root: input.root,
    outfile: join(input.overlayRoot, 'hooks', '_void-hook.mjs'),
  });
  await mkdir(join(input.artifactRoot, '.void'), { recursive: true });
  // The doctrine is derived content, so the artifact must reproduce the level it
  // lives at; copying into a directory that does not exist yet fails outright.
  await mkdir(join(input.artifactRoot, '.void', 'installed'), { recursive: true });
  await writeFile(
    join(input.artifactRoot, '.void', 'config.json'),
    `${JSON.stringify({
      selfHost: { mode: input.mode, sourceHash: input.sourceHash },
      commands: {
        test: ['pnpm', 'test'],
        typecheck: ['pnpm', 'typecheck'],
        lint: ['pnpm', 'lint'],
      },
      modes: { tdd: 'strict', codeReview: 'strict' },
    }, null, 2)}\n`,
  );
  await Promise.all([
    cp(
      join(input.overlayRoot, 'PHILOSOPHY.md'),
      join(input.artifactRoot, '.void', 'installed', 'PHILOSOPHY.md'),
    ),
    cp(
      join(input.overlayRoot, 'PROJECT-DOCTRINE.template.md'),
      join(input.artifactRoot, '.void', 'PROJECT-DOCTRINE.md'),
    ),
  ]);
  await input.wireRuntimeSurfaces(input);
  const files = await collectArtifactFiles(input.artifactRoot);
  const receipt = buildSelfHostReceipt({
    sourceHash: input.sourceHash,
    mode: input.mode,
    files,
  });
  const receiptPath = join(
    input.artifactRoot,
    ...SELF_HOST_RECEIPT_PATH.split('/'),
  );
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, encodeSelfHostReceipt(receipt), { mode: 0o644 });
  return files.length;
}

async function assertSafeGeneratedRoot(
  generatedRoot: string,
  ancestors: readonly string[],
): Promise<void> {
  for (const path of [...ancestors, generatedRoot]) {
    const info = await safeInfo(path);
    if (info?.isSymbolicLink()) {
      throw new Error('self-host generated path must not cross a symbolic link');
    }
    if (info !== undefined && !info.isDirectory()) {
      throw new Error('self-host generated path must contain directories only');
    }
  }
  await mkdir(generatedRoot, { recursive: true });
}

async function publishArtifact(
  generatedRoot: string,
  artifactRoot: string,
  failAfterBackup: boolean,
): Promise<void> {
  const current = join(generatedRoot, 'current');
  const backup = join(generatedRoot, `.previous-${randomUUID()}`);
  const currentInfo = await safeInfo(current);
  if (currentInfo?.isSymbolicLink()) {
    throw new Error('self-host current artifact must not be a symbolic link');
  }
  if (currentInfo !== undefined && !currentInfo.isDirectory()) {
    throw new Error('self-host current artifact must be a directory');
  }
  let previousMoved = false;
  let nextPublished = false;
  try {
    if (currentInfo !== undefined) {
      await rename(current, backup);
      previousMoved = true;
    }
    if (failAfterBackup) {
      throw new Error('injected self-host publication failure');
    }
    await rename(artifactRoot, current);
    nextPublished = true;
    if (previousMoved) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (nextPublished) await rm(current, { recursive: true, force: true });
    if (previousMoved) await rename(backup, current);
    throw error;
  }
}

export async function syncSelfHost(
  root: string,
  options: SyncSelfHostOptions,
): Promise<SelfHostSyncResult> {
  const canonicalRoot = resolve(root);
  if (!isHarnessSourceRepo(canonicalRoot)) {
    throw new Error(`self-host sync is only valid in the ${PRODUCT_COMMAND} source repository`);
  }
  const generatedRoot = resolve(
    options.generatedRoot ?? voidMachinePath(canonicalRoot, 'generated'),
  );
  await assertSafeGeneratedRoot(
    generatedRoot,
    options.generatedRoot === undefined ? [join(canonicalRoot, '.void')] : [],
  );
  const artifactRoot = join(generatedRoot, 'current');
  const computeSourceHash = options.computeSourceHash ?? hashSelfHostSource;
  const sourceHash = await computeSourceHash(canonicalRoot);
  const currentReceipt = await readSelfHostReceipt(artifactRoot);
  if (
    currentReceipt?.sourceHash === sourceHash
    && currentReceipt.mode === options.mode
    && (await selfHostReceiptDrift(artifactRoot, currentReceipt)).length === 0
  ) {
    return {
      changed: false,
      sourceHash,
      mode: options.mode,
      files: currentReceipt.files.length,
      artifactRoot,
    };
  }

  const stageRoot = await mkdtemp(join(generatedRoot, '.staging-'));
  const stagedArtifact = join(stageRoot, 'artifact');
  const overlayRoot = join(stageRoot, 'core');
  try {
    await mkdir(stagedArtifact, { recursive: true });
    const files = await compileArtifact({
      root: canonicalRoot,
      artifactRoot: stagedArtifact,
      overlayRoot,
      finalRoot: artifactRoot,
      sourceHash,
      mode: options.mode,
      buildHookBundle: options.buildHookBundle ?? defaultBuildHookBundle,
      wireRuntimeSurfaces: options.wireRuntimeSurfaces
        ?? ((input) => defaultWireRuntimeSurfaces({
          ...input,
          root: canonicalRoot,
        })),
    });
    if (await computeSourceHash(canonicalRoot) !== sourceHash) {
      throw new Error('self-host sources changed during compilation');
    }
    await publishArtifact(
      generatedRoot,
      stagedArtifact,
      options.failAfterBackup === true,
    );
    return {
      changed: true,
      sourceHash,
      mode: options.mode,
      files,
      artifactRoot,
    };
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}
