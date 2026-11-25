import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * True when `root` is the void-machine source repo itself. Keyed on the root
 * package.json `name` (the private workspace root kept its original name through
 * the rename) **and** the `packages/{cli,core}` workspace layout, so a consumer
 * that merely vendors a `.void/` dir — or happens to share a name — is never
 * mistaken for the source. Any read/parse error resolves to `false`: an
 * unreadable root can't be the source repo we're protecting.
 */
export function isHarnessSourceRepo(root: string): boolean {
  try {
    const pkgPath = join(root, 'package.json');
    if (!existsSync(pkgPath)) return false;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: unknown };
    if (pkg.name !== 'void-harness') return false;
    return existsSync(join(root, 'packages', 'cli')) && existsSync(join(root, 'packages', 'core'));
  } catch {
    return false;
  }
}
