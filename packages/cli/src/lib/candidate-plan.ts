import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { init } from '../commands/init.js';
import { planProgramMigration } from './autopilot/program-migration.js';
import { CO_OWNED_FILES } from './co-owned.js';
import { INSTALL_MANIFEST_PATH, readInstallManifest } from './install-manifest.js';
import type { PreparedInstall } from './local-install.js';
import { cliVersion } from './paths.js';
import { INSTALL_RECEIPT_PATH, readInstallReceipt } from './receipts.js';
import { detectRuntimes } from './runtime.js';
import { type FileMutation, isSafeRelativePath } from './transaction.js';
import { assertProjectCompatibility } from './update-compatibility.js';
import { STABLE_VERSION } from './update-release.js';

const directories = ['.void/hooks', '.void/installed', '.claude/skills', '.claude/agents', '.claude/commands', '.agents/skills', '.codex/agents'];
const exactPaths = new Set<string>([...CO_OWNED_FILES, INSTALL_MANIFEST_PATH, INSTALL_RECEIPT_PATH,
  '.codex/hooks.json', '.void/program.md', '.void/machine/autopilot/merge-hold.json']);
export function isUpdateProjectPath(path: string): boolean {
  return isSafeRelativePath(path) && (exactPaths.has(path) || directories.some(directory => path.startsWith(`${directory}/`)));
}
const projectPath = z.string().max(1024).refine(isUpdateProjectPath);
const mode = z.number().int().min(0).max(0o777);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const inputSchema = z.strictObject({ path: projectPath, sha256: digest, mode });
export type CandidateInput = z.infer<typeof inputSchema>;
export const candidateRequestSchema = z.strictObject({
  protocol: z.literal(1), operationId: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/),
  version: z.string().max(64).regex(STABLE_VERSION), root: z.string().max(4096).refine(isAbsolute),
});
export type CandidateRequest = z.infer<typeof candidateRequestSchema>;
const mutationSchema = z.union([
  z.strictObject({ path: projectPath, remove: z.literal(true) }),
  z.strictObject({ path: projectPath, content: z.string().max(48 * 1024 * 1024), mode }),
]);
const responseSchema = candidateRequestSchema.extend({
  mutations: z.array(mutationSchema).max(10_000), inputs: z.array(inputSchema).max(10_000),
  restored: z.array(projectPath).max(10_000), preserved: z.array(projectPath).max(10_000),
  runtimes: z.array(z.enum(['claude', 'codex'])).min(1).max(2),
});

function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

/** Read only the installer's finite ownership boundary, including retained projected assets. */
export async function captureCandidateInputs(root: string): Promise<CandidateInput[]> {
  const inputs: CandidateInput[] = [];
  let total = 0;
  async function visit(path: string, depth: number): Promise<void> {
    if (inputs.length >= 10_000 || depth > 32) throw new Error('Project input limit exceeded');
    const target = join(root, path);
    let info: Stats;
    try { info = await lstat(target); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(`Project input is a symbolic link: ${path}`);
    if (info.isDirectory() && !exactPaths.has(path)) {
      for (const name of await readdir(target)) await visit(`${path}/${name}`, depth + 1);
      return;
    }
    if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error(`Invalid bounded project input: ${path}`);
    const bytes = await readFile(target);
    total += bytes.length;
    if (total > 128 * 1024 * 1024) throw new Error('Project input byte limit exceeded');
    inputs.push({ path, sha256: hash(bytes), mode: info.mode & 0o777 });
  }
  // Check ancestors too: lstat of a leaf does not expose a linked .void or runtime root.
  const ancestors = new Set([...exactPaths, ...directories].flatMap(path => {
    const parts = path.split('/');
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
  }));
  for (const ancestor of ancestors) {
    try {
      const info = await lstat(join(root, ancestor));
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Invalid project input directory: ${ancestor}`);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  for (const path of [...exactPaths, ...directories]) await visit(path, 0);
  return inputs.sort((a, b) => a.path.localeCompare(b.path));
}

export async function assertCandidateInputs(root: string, expected: readonly CandidateInput[]): Promise<void> {
  const actual = await captureCandidateInputs(root);
  const before = new Map(expected.map(input => [input.path, input]));
  const after = new Map(actual.map(input => [input.path, input]));
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(path);
    const b = after.get(path);
    if (a?.sha256 !== b?.sha256 || a?.mode !== b?.mode) throw new Error(`Project input changed at ${path}; prepare the update again`);
  }
}

export function decodeCandidatePlan(body: string, expected: CandidateRequest) {
  if (Buffer.byteLength(body) > 192 * 1024 * 1024) throw new Error('Candidate plan exceeds byte limit');
  const plan = responseSchema.parse(JSON.parse(body));
  for (const key of ['protocol', 'operationId', 'version', 'root'] as const) {
    if (plan[key] !== expected[key]) throw new Error(`Candidate plan ${key} differs from request`);
  }
  for (const entries of [plan.mutations, plan.inputs]) {
    if (new Set(entries.map(entry => entry.path)).size !== entries.length) throw new Error('Duplicate candidate path');
  }
  let total = 0;
  const inputs = new Map(plan.inputs.map(input => [input.path, input]));
  const mutations: FileMutation[] = plan.mutations.map(mutation => {
    const input = inputs.get(mutation.path);
    const expected = input ? { exists: true as const, sha256: input.sha256, mode: input.mode } : { exists: false as const };
    if ('remove' in mutation) return { ...mutation, expected };
    const bytes = Buffer.from(mutation.content, 'base64');
    total += bytes.length;
    if (bytes.toString('base64') !== mutation.content || bytes.length > 32 * 1024 * 1024 || total > 128 * 1024 * 1024) {
      throw new Error('Invalid candidate content or byte limit exceeded');
    }
    return { path: mutation.path, content: bytes, mode: mutation.mode, expected };
  });
  return { ...plan, mutations };
}

/** Runs inside the selected release, so compilation and smoke use that release's bundled assets. */
export async function prepareCandidatePlan(value: unknown) {
  const request = candidateRequestSchema.parse(value);
  if (request.version !== cliVersion()) throw new Error('Candidate executable differs from requested release');
  if (await realpath(request.root) !== request.root) throw new Error('Candidate project root must be canonical');
  const inputs = await captureCandidateInputs(request.root);
  await assertProjectCompatibility(request.root);
  const programInput = inputs.find(input => input.path === '.void/program.md');
  const holdInput = inputs.find(input => input.path === '.void/machine/autopilot/merge-hold.json');
  const migration = programInput ? planProgramMigration(
    await readFile(join(request.root, programInput.path), 'utf8'),
    holdInput ? await readFile(join(request.root, holdInput.path), 'utf8') : undefined,
    new Date().toISOString(),
  ).map(mutation => ({ ...mutation, mode: mutation.mode ?? programInput.mode })) : [];
  const receipt = await readInstallReceipt(request.root);
  const manifest = readInstallManifest(request.root);
  if (!receipt && !manifest) throw new Error('Update requires an installed project; use init to install');
  if (receipt?.source === 'marketplace') throw new Error('Marketplace update is unsupported by stable local update; retain the marketplace installation');
  const runtimes = receipt ? [...receipt.runtimes] : [...detectRuntimes(request.root)];
  if (runtimes.length === 0) throw new Error('Installed runtime selection is unknown; restore the installation receipt');
  let prepared: PreparedInstall | undefined;
  await init(['--no-interactive', '--runtime', runtimes.join(','), '--preserve-doctrine'], {
    projectRoot: request.root, onPrepared: plan => { prepared = plan; },
  });
  if (!prepared) throw new Error('Candidate compiler did not produce a plan');
  await assertCandidateInputs(request.root, inputs);
  const plan = { ...request, inputs, runtimes, restored: prepared.restored, preserved: prepared.preserved,
    mutations: [...migration, ...prepared.mutations].map(mutation => 'remove' in mutation ? mutation
      : { path: mutation.path, content: Buffer.from(mutation.content).toString('base64'), mode: mutation.mode ?? 0o644 }),
  };
  decodeCandidatePlan(JSON.stringify(plan), request);
  return plan;
}
