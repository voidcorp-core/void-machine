import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { isSafeRelativePath } from '../transaction.js';

export const SELF_HOST_RECEIPT_PATH = '.void/self-host-receipt-v1.json';
export interface SelfHostOwnedFile {
  readonly path: string;
  readonly sha256: string;
  readonly mode: number;
}

export interface SelfHostReceipt {
  readonly schemaVersion: 1;
  readonly sourceHash: string;
  readonly runtimes: readonly ['claude', 'codex'];
  readonly files: readonly SelfHostOwnedFile[];
}

export interface SelfHostReceiptFileInput {
  readonly path: string;
  readonly content: Uint8Array;
  readonly mode: number;
}

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function lexical(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildSelfHostReceipt(input: {
  readonly sourceHash: string;
  readonly files: readonly SelfHostReceiptFileInput[];
}): SelfHostReceipt {
  if (!/^[a-f0-9]{64}$/.test(input.sourceHash)) {
    throw new Error('invalid self-host source hash');
  }
  const files = input.files.map((file) => {
    if (!isSafeRelativePath(file.path)) {
      throw new Error(`unsafe self-host receipt path: ${file.path}`);
    }
    return {
      path: file.path,
      sha256: sha256(file.content),
      mode: file.mode & 0o777,
    };
  }).sort((a, b) => lexical(a.path, b.path));
  if (new Set(files.map((file) => file.path)).size !== files.length) {
    throw new Error('duplicate self-host receipt path');
  }
  return {
    schemaVersion: 1,
    sourceHash: input.sourceHash,
    runtimes: ['claude', 'codex'],
    files,
  };
}

export function encodeSelfHostReceipt(receipt: SelfHostReceipt): string {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

function isOwnedFile(value: unknown): value is SelfHostOwnedFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const file = value as Record<string, unknown>;
  return typeof file.path === 'string'
    && isSafeRelativePath(file.path)
    && typeof file.sha256 === 'string'
    && /^[a-f0-9]{64}$/.test(file.sha256)
    && Number.isInteger(file.mode)
    && Number(file.mode) >= 0
    && Number(file.mode) <= 0o777;
}

export function parseSelfHostReceipt(body: string): SelfHostReceipt | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  // Legacy rollout metadata is readable, but has no authority in the returned contract.
  const receipt = value as Record<string, unknown>;
  const runtimes = receipt.runtimes;
  const files = receipt.files;
  if (
    receipt.schemaVersion !== 1
    || typeof receipt.sourceHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(receipt.sourceHash)
    || (receipt.mode !== undefined
      && (typeof receipt.mode !== 'string'
        || !['shadow', 'warn', 'enforce', 'release-gate'].includes(receipt.mode)))
    || !Array.isArray(runtimes)
    || runtimes.length !== 2
    || runtimes[0] !== 'claude'
    || runtimes[1] !== 'codex'
    || !Array.isArray(files)
    || !files.every(isOwnedFile)
  ) {
    return undefined;
  }
  if (new Set(files.map((file) => file.path)).size !== files.length) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    sourceHash: receipt.sourceHash,
    runtimes: ['claude', 'codex'],
    files,
  };
}

export async function readSelfHostReceipt(
  artifactRoot: string,
): Promise<SelfHostReceipt | undefined> {
  try {
    return parseSelfHostReceipt(
      await readFile(join(artifactRoot, ...SELF_HOST_RECEIPT_PATH.split('/')), 'utf8'),
    );
  } catch {
    return undefined;
  }
}

export async function selfHostReceiptDrift(
  artifactRoot: string,
  receipt: SelfHostReceipt,
): Promise<string[]> {
  const drift: string[] = [];
  const expected = new Set([
    ...receipt.files.map((file) => file.path),
    SELF_HOST_RECEIPT_PATH,
  ]);
  for (const file of receipt.files) {
    const path = join(artifactRoot, ...file.path.split('/'));
    try {
      const info = await lstat(path);
      if (
        !info.isFile()
        || info.isSymbolicLink()
        || (info.mode & 0o777) !== file.mode
        || sha256(await readFile(path)) !== file.sha256
      ) {
        drift.push(file.path);
      }
    } catch {
      drift.push(file.path);
    }
  }
  let visited = 0;
  async function findUnexpected(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      visited += 1;
      if (visited > 10_000) {
        throw new Error('artifact entry budget exceeded');
      }
      const path = join(directory, entry.name);
      const rel = relative(artifactRoot, path).replaceAll('\\', '/');
      if (entry.isSymbolicLink()) {
        drift.push(rel);
      } else if (entry.isDirectory()) {
        await findUnexpected(path);
      } else if (entry.isFile() && !expected.has(rel)) {
        drift.push(rel);
      }
    }
  }
  try {
    await findUnexpected(artifactRoot);
  } catch {
    drift.push('artifact-enumeration-failed');
  }
  return drift;
}
