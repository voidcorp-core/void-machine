import { lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { INSTALL_MANIFEST_PATH } from './install-manifest.js';
import { resolveProjectRoots } from './project-roots.js';
import { discoverConfiguredProjects } from './projects/catalog.js';
import { INSTALL_RECEIPT_PATH } from './receipts.js';

function present(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}
function installation(root: string): string {
  const canonical = realpathSync(resolveProjectRoots(root).installRoot);
  if (!present(join(canonical, INSTALL_RECEIPT_PATH)) && !present(join(canonical, INSTALL_MANIFEST_PATH))) {
    throw new Error(`Installation records are missing at ${canonical}; restore them or run init explicitly`);
  }
  return canonical;
}

/** Uses the existing discovery owner, but requires complete evidence before a mutating all selection. */
export function selectUpdateProjects(options: { readonly cwd: string; readonly globalDir: string; readonly all: boolean }): string[] {
  if (options.all) {
    const discovery = discoverConfiguredProjects({ cwd: options.cwd, globalDir: options.globalDir, requireComplete: true });
    if (discovery.unreadable.length > 0) {
      throw new Error(`Incomplete project discovery: ${discovery.unreadable.slice(0, 10).map(item => `${item.path}: ${item.reason}`).join('; ')}`);
    }
    return [...new Set(discovery.projects.map(project => installation(project.path)))].sort();
  }
  let root = realpathSync(resolve(options.cwd));
  for (;;) {
    if (present(join(root, '.void/config.json')) || present(join(root, INSTALL_RECEIPT_PATH))
      || present(join(root, INSTALL_MANIFEST_PATH))) return [installation(root)];
    const parent = dirname(root);
    if (parent === root) return [];
    root = parent;
  }
}
