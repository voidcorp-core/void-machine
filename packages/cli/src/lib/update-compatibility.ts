import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { INSTALL_RECEIPT_PATH, parseReceipt } from './receipts.js';
import { INSTALL_MANIFEST_PATH, parseInstallManifest } from './install-manifest.js';
import { configSchema } from './config-schema.js';
import { findPack } from './packs.js';
import { cliVersion } from './paths.js';
import { compareVersions } from './version.js';

const recordSchema = z.object({ schemaVersion: z.literal(1).optional() }).passthrough();
const exactVersion = z.string().regex(/^\d+\.\d+\.\d+$/);

async function optionalRecord(root: string, path: string): Promise<string | undefined> {
  const target = join(root, path);
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4_194_304) {
      throw new Error(`${path}: expected a bounded regular file`);
    }
    return await readFile(target, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function validateRecord(body: string, label: string): unknown {
  let value: unknown;
  try { value = JSON.parse(body); }
  catch { throw new Error(`${label}: invalid JSON; repair the record before updating`); }
  if (!recordSchema.safeParse(value).success) {
    throw new Error(`${label}: unsupported schema; use a compatible CLI`);
  }
  return value;
}

/** Shared before-effect guard for materialization and project mutations. */
export async function assertProjectCompatibility(
  projectRoot: string,
  options: { readonly replaceUnparseableConfig?: boolean; readonly acquiringCandidate?: boolean } = {},
): Promise<void> {
  const receiptBody = await optionalRecord(projectRoot, INSTALL_RECEIPT_PATH);
  if (receiptBody !== undefined) validateRecord(receiptBody, 'receipt');
  const receipt = receiptBody === undefined ? undefined : parseReceipt(receiptBody);
  if (receiptBody !== undefined && receipt === undefined) throw new Error('receipt: invalid record');
  const manifestBody = await optionalRecord(projectRoot, INSTALL_MANIFEST_PATH);
  if (manifestBody !== undefined) validateRecord(manifestBody, 'manifest');
  const manifest = manifestBody === undefined ? undefined : parseInstallManifest(manifestBody);
  if (manifestBody !== undefined && manifest === undefined) throw new Error('manifest: invalid record');
  if (receipt && manifest && receipt.version !== manifest.version) {
    throw new Error('receipt and manifest versions disagree; restore consistent records before update');
  }
  const version = receipt?.version ?? manifest?.version;
  if (version !== undefined && !exactVersion.safeParse(version).success) {
    throw new Error('installation version is invalid');
  }
  if (!options.acquiringCandidate && version !== undefined && compareVersions(version, cliVersion()) > 0) {
    throw new Error(`Installed harness ${version} is newer than CLI ${cliVersion()}; `
      + 'run void-machine update before changing this project.');
  }
  const configBody = await optionalRecord(projectRoot, '.void/config.json');
  if (configBody === undefined) return;
  try { JSON.parse(configBody); }
  catch {
    if (options.replaceUnparseableConfig) return;
    throw new Error('.void/config.json: unreadable configuration; repair invalid JSON');
  }
  const config = configSchema.safeParse(validateRecord(configBody, '.void/config.json'));
  if (!config.success) throw new Error('.void/config.json: invalid settings or pack declarations');
  for (const key of Object.keys(config.data.packs ?? {})) {
    if (!findPack(key.replace(/^@voidcorp\//, ''))) {
      throw new Error(`.void/config.json: selected pack '${key}' is retired or unsupported; `
        + 'choose its replacement');
    }
  }
}
