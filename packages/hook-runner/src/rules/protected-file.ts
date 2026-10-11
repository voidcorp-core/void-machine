import { readFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { isCoOwned } from '../co-owned.js';
import type { RuleVerdict } from '../enforcement/types.js';
import { allow, block } from './verdict.js';

interface ProtectedFileOptions {
  readonly root?: string;
}

function manifestOwnedPaths(root: string): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(resolve(root, '.void/install-manifest.json'), 'utf8'));
    if (typeof parsed !== 'object' || parsed === undefined || Array.isArray(parsed)) return new Set();
    const files = (parsed as { readonly files?: unknown }).files;
    if (!Array.isArray(files)) return new Set();
    return new Set(files.flatMap((file) => {
      if (typeof file !== 'object' || file === undefined || Array.isArray(file)) return [];
      const path = (file as { readonly path?: unknown }).path;
      return typeof path === 'string' && path.length > 0 ? [path.replaceAll('\\', '/')] : [];
    }));
  } catch {
    return new Set();
  }
}

function projectPath(root: string, path: string): string | undefined {
  const absolute = resolve(root, path);
  const relativePath = relative(resolve(root), absolute).replaceAll('\\', '/');
  return relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath)
    ? undefined
    : relativePath;
}

function protectedReason(path: string, root: string | undefined): string | undefined {
  if (root !== undefined) {
    const relativePath = projectPath(root, path);
    if (
      relativePath !== undefined
      && !isCoOwned(relativePath)
      && manifestOwnedPaths(root).has(relativePath)
    ) {
      return 'delivered harness asset; change the harness through void-learn';
    }
  }
  const normalized = path.replaceAll('\\', '/').toLowerCase();
  const base = basename(normalized);
  if (/^\.env(?:\..+)?$/.test(base) && !/\.(?:example|sample|template|dist)$/.test(base)) {
    return 'environment file with secrets';
  }
  if (/\.(?:pem|key|p12|pfx|keystore|jks|asc)$/.test(base) || /^id_(?:rsa|ed25519|ecdsa|dsa)$/.test(base)) {
    return 'private key / certificate';
  }
  if (/(?:\.npmrc|\.netrc|\.pgpass)$/.test(base)) return 'credential file';
  if (!base.endsWith('.md') && /(?:secret|credential)/.test(base)) return 'credential file';
  if (new Set([
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
    'cargo.lock',
    'poetry.lock',
    'composer.lock',
  ]).has(base)) {
    return 'lockfile (regenerate via the package manager, do not hand-edit)';
  }
  if (/(^|\/)\.git\//.test(normalized)) return 'internal git metadata';
  return undefined;
}

export function protectedFile(paths: readonly string[], options: ProtectedFileOptions = {}): RuleVerdict {
  for (const path of paths) {
    const reason = protectedReason(path, options.root);
    if (reason !== undefined) {
      const learn = reason.includes('void-learn') ? ' Use void-learn to capture the missing harness capability.' : '';
      return block('PROTECTED_FILE', `refusing to edit ${path}.${learn}`, [`${path}: ${reason}`]);
    }
  }
  return allow();
}
