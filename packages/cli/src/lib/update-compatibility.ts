import { readInstallReceipt } from './receipts.js';
import { cliVersion } from './paths.js';
import { compareVersions } from './version.js';

/** Shared before-effect guard for materialization and project mutations. */
export async function assertProjectCompatibility(projectRoot: string): Promise<void> {
  const receipt = await readInstallReceipt(projectRoot);
  if (receipt !== undefined && compareVersions(receipt.version, cliVersion()) > 0) {
    throw new Error(`Installed harness ${receipt.version} is newer than CLI ${cliVersion()}; `
      + 'run void-machine update before changing this project.');
  }
}
