import { statSync } from 'node:fs';
import { win32 } from 'node:path';

interface CommandOptions {
  readonly platform?: string;
  readonly nodeExecutable?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly isFile?: (path: string) => boolean;
}

function isRegularFile(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}

/** One resolver for production acquisition and consumer conformance. Never runs a shell shim. */
export function packageManagerCommand(manager: 'npm' | 'pnpm', overrides: CommandOptions = {}) {
  if (manager !== 'npm' && manager !== 'pnpm') throw new Error(`Unsupported package manager: ${String(manager)}`);
  const platform = overrides.platform ?? process.platform;
  const nodeExecutable = overrides.nodeExecutable ?? process.execPath;
  const environment = overrides.environment ?? process.env;
  const isFile = overrides.isFile ?? isRegularFile;
  if (platform !== 'win32') return { executable: manager, prefixArguments: [] as string[] };
  if (manager === 'pnpm') {
    const candidate = environment.npm_execpath;
    if (candidate && /\.(?:cjs|mjs|js)$/i.test(candidate) && isFile(candidate)) {
      return { executable: nodeExecutable, prefixArguments: [candidate] };
    }
  } else {
    const directories = [win32.dirname(nodeExecutable), ...(environment.PATH ?? environment.Path ?? '').split(';')]
      .filter(entry => entry !== '').slice(0, 128);
    for (const directory of new Set(directories)) {
      const candidate = win32.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js');
      if (isFile(candidate)) return { executable: nodeExecutable, prefixArguments: [candidate] };
    }
  }
  throw new Error(`Package manager cannot resolve ${manager} JavaScript entrypoint on Windows`);
}
