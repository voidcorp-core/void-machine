import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface WorkspacePackageJson {
  readonly name?: string;
  readonly packageManager?: string;
  readonly engines?: { readonly node?: string };
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly workspaces?: readonly string[] | { readonly packages?: readonly string[] };
}

export interface WorkspacePackage {
  readonly path: string;
  readonly directory: string;
  readonly packageJson: WorkspacePackageJson;
}

function readPackage(directory: string): WorkspacePackageJson | undefined {
  const path = join(directory, 'package.json');
  if (!existsSync(path)) return undefined;
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    return value as WorkspacePackageJson;
  } catch {
    return undefined;
  }
}

function workspacePatterns(root: string, pkg: WorkspacePackageJson | undefined): readonly string[] {
  const workspaces = pkg?.workspaces;
  if (Array.isArray(workspaces)) return workspaces.filter((item): item is string => typeof item === 'string');
  if (workspaces !== undefined && !Array.isArray(workspaces)) {
    const packages = (workspaces as { readonly packages?: readonly string[] }).packages;
    if (Array.isArray(packages)) return packages.filter((item): item is string => typeof item === 'string');
  }
  const pnpmPath = join(root, 'pnpm-workspace.yaml');
  if (!existsSync(pnpmPath)) return [];
  try {
    let inPackages = false;
    return readFileSync(pnpmPath, 'utf8').split('\n').flatMap((line) => {
      if (/^packages:\s*$/.test(line)) {
        inPackages = true;
        return [];
      }
      if (/^[A-Za-z][^:]*:\s*$/.test(line)) inPackages = false;
      if (!inPackages) return [];
      const match = /^\s*-\s*['"]?([^'"\s]+)['"]?/.exec(line);
      return match?.[1] === undefined ? [] : [match[1]];
    });
  } catch {
    return [];
  }
}

function safePattern(pattern: string): boolean {
  const base = pattern.endsWith('/*') ? pattern.slice(0, -2) : pattern;
  return base.length > 0
    && !isAbsolute(base)
    && base !== '..'
    && !base.startsWith(`..${sep}`)
    && !base.includes(`${sep}..${sep}`)
    && !base.includes('\\')
    && !base.includes('*');
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function directoriesFor(root: string, pattern: string): readonly string[] {
  if (!safePattern(pattern)) return [];
  const base = pattern.endsWith('/*') ? pattern.slice(0, -2) : pattern;
  const directory = resolve(root, base);
  if (!inside(root, directory) || !existsSync(directory)) return [];
  if (!pattern.endsWith('/*')) return [directory];
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => join(directory, entry.name))
      .filter((candidate) => {
        try {
          return statSync(candidate).isDirectory() && inside(root, realpathSync(candidate));
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

export function workspacePackages(root: string): readonly WorkspacePackage[] {
  const canonicalRoot = realpathSync(resolve(root));
  const rootPackage = readPackage(canonicalRoot);
  const packages: WorkspacePackage[] = [];
  if (rootPackage !== undefined) {
    packages.push(Object.freeze({ path: '.', directory: canonicalRoot, packageJson: rootPackage }));
  }
  for (const pattern of workspacePatterns(canonicalRoot, rootPackage)) {
    for (const candidate of directoriesFor(canonicalRoot, pattern)) {
      const canonical = realpathSync(candidate);
      if (!inside(canonicalRoot, canonical)) continue;
      const packageJson = readPackage(canonical);
      if (packageJson === undefined) continue;
      const path = relative(canonicalRoot, canonical).split(sep).join('/');
      packages.push(Object.freeze({ path, directory: canonical, packageJson }));
    }
  }
  const unique = new Map(packages.map((item) => [item.path, item]));
  return Object.freeze([...unique.values()].sort((left, right) => left.path.localeCompare(right.path)));
}

export function workspaceHasFile(root: string, relativePaths: readonly string[]): boolean {
  return workspacePackages(root).some((workspace) => relativePaths.some((path) =>
    existsSync(join(workspace.directory, path))));
}

export function workspaceHasDependency(root: string, pattern: RegExp): boolean {
  return workspacePackages(root).some(({ packageJson }) => {
    const dependencies = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
      ...(packageJson.peerDependencies ?? {}),
    };
    return Object.keys(dependencies).some((dependency) => pattern.test(dependency));
  });
}
